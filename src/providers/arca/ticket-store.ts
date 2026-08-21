import {
    ArcaValidationError,
    WsaaClient,
    certificateSubjectSerialNumber,
    type ArcaAuth,
    type ArcaConfig,
    type ServiceIdValue,
} from './sdk/index.js';
import {soap} from './clients.js';
import {toArcaEnvironment} from './environment.js';
import {canonicalCuit, parseArcaId} from './ar-identifiers.js';
import {delegateCredentialStore, type DelegateCredentials, type DelegateCredentialStore} from './delegate-credentials.js';
import {env} from '../../config/env.js';
import {DelegationNotConfiguredError, type GenericEnvironment, type IssuerCredentials} from '../provider.js';

/**
 * Raised when no valid ticket is cached for the issuer and the request carried no credentials. The HTTP
 * layer maps this to `409 CREDENTIALS_REQUIRED`; core then re-sends the same request with the issuer's
 * credentials attached, and this service logs in to ARCA and proceeds. Fields are reported in the
 * neutral vocabulary (`entityCode`, `issuerTaxId`, generic `environment`).
 */
export class CredentialsRequiredError extends Error {
    constructor(
        readonly entityCode: string,
        readonly issuerTaxId: string,
        readonly service: ServiceIdValue,
        readonly environment: GenericEnvironment,
    ) {
        super(`CREDENTIALS_REQUIRED for entity=${entityCode} issuerTaxId=${issuerTaxId} service=${service} env=${environment}`);
        this.name = 'CredentialsRequiredError';
    }
}

/**
 * Owns WSAA authentication for the whole process. This service — never core — talks to real ARCA: it
 * signs the login ticket request with a certificate, exchanges it for a ~12h ticket, and caches it
 * (shared across every core instance), so credentials cross the wire only on a refresh (~once per 12h),
 * never per request.
 *
 * The cache is keyed by the **signer** (certificate) identity, because ARCA binds a ticket to the
 * certificate that minted it (a second login for the same cert+service is refused with
 * `alreadyAuthenticated`). The two signer roles live in **separate partitions**:
 *
 * - tenant: `(entityCode, environment, issuerCuit, service)` — the issuer's own certificate;
 * - delegate: `(entityCode, environment, 'delegate', delegateCuit, service)` — our platform certificate,
 *   so one delegate ticket is reused across every represented CUIT.
 *
 * They are deliberately NOT merged on a shared CUIT: a taxpayer may hold several ARCA certificates, and a
 * *representación* is granted to one specific computador, so serving a delegated call from a ticket minted
 * by a different certificate of the same CUIT yields a permanent `601` that looks like a missing
 * delegation. The one provably-safe overlap is handled explicitly: when a tenant request's certificate IS
 * our delegate certificate, it mints/reuses inside the delegate partition — same physical certificate, so
 * ARCA has exactly one ticket for it and the two roles cannot collide.
 *
 * A tenant request that carries no credentials is served from cache; on a miss/expiry it raises
 * {@link CredentialsRequiredError}. A delegated request signs with the service's own delegate certificate
 * (never the request), so it never raises {@link CredentialsRequiredError}. The underlying
 * {@link WsaaClient} provides single-flight login de-duplication (so a refresh stampede collapses to one
 * `loginCms`), `alreadyAuthenticated` handling, and optional cross-restart persistence via
 * `ARCA_TICKET_CACHE_PATH`.
 */
export class TicketStore {
    constructor(
        private readonly wsaa: WsaaClient = new WsaaClient(soap, env.ticketCachePath),
        private readonly delegate: DelegateCredentialStore = delegateCredentialStore,
    ) {}

    /** Tenant cache partition: the issuer signs with its own certificate (service appended by WsaaClient). */
    private ownerKey(entityCode: string, environment: GenericEnvironment, signerCuit: string): string {
        return `${entityCode}:${environment}:${signerCuit}`;
    }

    /**
     * Delegate cache partition — disjoint from every tenant partition by the `delegate` segment, so a
     * ticket minted by a tenant certificate can never serve a delegated call (nor the reverse) even when
     * both identities are the same CUIT.
     */
    private delegateOwnerKey(entityCode: string, environment: GenericEnvironment, delegateCuit: string): string {
        return `${entityCode}:${environment}:delegate:${delegateCuit}`;
    }

    /**
     * Resolves an {@link ArcaAuth} for a call. `Auth.Cuit` is always `issuerTaxId` (the represented
     * taxpayer). When `delegated`, signs with the service's own delegate certificate for `environment`;
     * otherwise serves a cached tenant ticket, mints one from `credentials`, or — with neither — throws
     * {@link CredentialsRequiredError} so core re-sends with credentials.
     */
    async resolve(
        entityCode: string,
        issuerTaxId: string,
        service: ServiceIdValue,
        environment: GenericEnvironment,
        credentials?: IssuerCredentials,
        delegated = false,
    ): Promise<ArcaAuth> {
        // Parse first (both paths): `Auth.Cuit` must be the represented taxpayer's CUIT and can never be NaN.
        const cuit = parseArcaId(issuerTaxId, 'issuerTaxId');

        if (delegated) {
            return this.resolveDelegated(entityCode, cuit, service, environment);
        }

        // ---- Tenant-certificate path (certificate owner == issuer); signer == issuer. ----
        // `issuerTaxId` is already the canonical spelling here — `parseArcaId` above rejects anything that
        // isn't bare digits — so no normalization is applied (and none is needed): the key is exactly the
        // one earlier releases wrote, and a shared `ARCA_TICKET_CACHE_PATH` keeps working across the deploy.
        const ownerKey = this.ownerKey(entityCode, environment, issuerTaxId);

        // Only this issuer's own partition may serve a credential-less request: borrowing the delegate
        // ticket would hand out a ticket for our own CUIT to a caller that never presented a certificate
        // for it.
        const cached = this.wsaa.peekAccessTicket(ownerKey, service);
        if (cached) {
            return {token: cached.token, sign: cached.sign, cuit};
        }

        if (!credentials) {
            throw new CredentialsRequiredError(entityCode, issuerTaxId, service, environment);
        }

        // Fail fast when `issuerTaxId` doesn't match the certificate being sent. WSAA login authenticates the
        // certificate and carries no CUIT, so a mismatch would otherwise mint a valid ticket under the wrong
        // identity and only surface far downstream as an opaque WSFEv1 `600 ValidacionDeToken` rejection. The
        // cert's subject serialNumber RDN and `issuerTaxId` go through the same canonicalizer, so formatting
        // (dashes, a `CUIT ` prefix) never trips this — mirroring the registration-time check in `credentials.ts`.
        const serial = certificateSubjectSerialNumber(credentials.certPem);
        const certCuit = serial === null ? null : canonicalCuit(serial);
        // Gate on a canonical `issuerTaxId` first: comparing raw `!==` would let a both-`null` case
        // (cert carries no CUIT *and* `issuerTaxId` doesn't reduce to a CUIT) slip through and mint under an
        // unverified identity. Mirrors the `expected !== null` guard in `credentials.ts`.
        const expected = canonicalCuit(issuerTaxId);
        if (expected === null || certCuit !== expected) {
            throw new ArcaValidationError(
                certCuit === null
                    ? `certificate subject carries no CUIT; expected issuerTaxId ${issuerTaxId}`
                    : `issuerTaxId ${issuerTaxId} does not match the certificate's CUIT ${certCuit}`,
                'ISSUER_TAXID_CERT_MISMATCH',
            );
        }

        // The one safe overlap between the roles: if the request's certificate IS our delegate certificate,
        // mint inside the DELEGATE partition. ARCA holds a single ticket per (certificate, service), so
        // minting a second one here would be refused with `alreadyAuthenticated` for as long as the delegate
        // ticket lives. `expected` equals the delegate CUIT whenever the certificates match — both are that
        // same certificate's subject CUIT, and the guard above proved cert CUIT == `expected`.
        const sharesDelegateCertificate = this.delegate.matchesDelegateCertificate(environment, credentials.certPem);
        const signerKey = sharesDelegateCertificate
            ? this.delegateOwnerKey(entityCode, environment, expected)
            : ownerKey;
        if (sharesDelegateCertificate) {
            const shared = this.wsaa.peekAccessTicket(signerKey, service);
            if (shared) {
                return {token: shared.token, sign: shared.sign, cuit};
            }
        }

        const config: ArcaConfig = {
            cuit,
            certPem: credentials.certPem,
            keyPem: credentials.keyPem,
            environment: toArcaEnvironment(environment),
            ticketOwnerKey: signerKey,
        };
        const ticket = await this.wsaa.getAccessTicket(config, service);
        return {token: ticket.token, sign: ticket.sign, cuit};
    }

    /**
     * Delegated path: sign with the service's own delegate certificate for `environment` and keep
     * `Auth.Cuit` = the represented taxpayer (`cuit`). The ticket is cached in the delegate partition, so a
     * single delegate ticket is shared across every represented CUIT — and never mixed with a ticket minted
     * by some other certificate. Throws {@link DelegationNotConfiguredError} when no delegate cert is
     * configured.
     */
    private async resolveDelegated(
        entityCode: string,
        cuit: number,
        service: ServiceIdValue,
        environment: GenericEnvironment,
    ): Promise<ArcaAuth> {
        const delegate = this.delegate.get(environment);
        if (delegate === undefined) {
            throw new DelegationNotConfiguredError(environment, 'no delegate certificate is configured');
        }

        const ownerKey = this.delegateOwnerKey(entityCode, environment, delegate.delegateCuit);

        const cached = this.wsaa.peekAccessTicket(ownerKey, service);
        if (cached) {
            return {token: cached.token, sign: cached.sign, cuit};
        }

        const config: ArcaConfig = {
            cuit,
            certPem: delegate.certPem,
            keyPem: delegate.keyPem,
            environment: toArcaEnvironment(environment),
            ticketOwnerKey: ownerKey,
        };
        const ticket = await this.wsaa.getAccessTicket(config, service);
        return {token: ticket.token, sign: ticket.sign, cuit};
    }

    /**
     * Evicts the cached delegate ticket for `(environment, service)` so the next delegated request re-mints
     * a fresh one. Called when ARCA rejects the delegate ticket with a genuine token fault (bad
     * signature/hash, clock skew, an expired ticket the local clock still trusts): because one delegate
     * ticket is shared across every represented CUIT, leaving a bad one cached would fail every representado
     * until local expiry.
     *
     * Scoped to the rejected `service` on purpose — the delegate identity also holds padrón tickets, and
     * ARCA would refuse to re-mint those (`alreadyAuthenticated`) for up to ~12h if we dropped tickets it
     * never rejected. A no-op when delegation isn't configured for `environment`.
     */
    invalidateDelegated(entityCode: string, environment: GenericEnvironment, service: ServiceIdValue): void {
        let delegate: DelegateCredentials | undefined;
        try {
            delegate = this.delegate.get(environment);
        } catch {
            return; // this runs inside an error handler: never mask the error being reported
        }
        if (delegate === undefined) {
            return;
        }
        this.wsaa.clearCache(this.delegateOwnerKey(entityCode, environment, delegate.delegateCuit), service);
    }
}

/** Long-lived singleton — the shared ticket cache + WSAA minter for the process. */
export const ticketStore = new TicketStore();
