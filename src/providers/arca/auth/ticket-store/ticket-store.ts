import type {ArcaConfig} from '../../sdk/core/arca-config.js';
import type {ServiceIdValue} from '../../sdk/core/constants.js';
import {ArcaValidationError} from '../../sdk/core/errors.js';
import {certificateSubjectSerialNumber} from '../../../pem/pem.js';
import type {ArcaAuth} from '../../sdk/core/types.js';
import {WsaaClient} from '../../sdk/core/wsaa-client/wsaa-client.js';
import {soap} from '../../clients.js';
import {toArcaEnvironment} from '../environment/environment.js';
import {canonicalCuit, parseArcaId} from '../../mapping/identifiers.js';
import {delegateCredentialStore, type DelegateCredentials, type DelegateCredentialStore} from '../delegate-credentials/delegate-credentials.js';
import {env} from '../../../../config/env.js';
import {CredentialsRequiredError, DelegationNotConfiguredError} from '../../../provider/faults.js';
import type {GenericEnvironment} from '../../../provider/environment.js';
import type {IssuerCredentials} from '../../../provider/entity-auth.js';

/**
 * Owns WSAA authentication for the whole process: signs the login ticket request with a certificate,
 * exchanges it for a ~12h ticket, and caches it, so credentials cross the wire only on a refresh.
 *
 * The cache is keyed by the signer's certificate identity, because ARCA binds a ticket to the certificate
 * that minted it and refuses a second login for the same cert and service with `alreadyAuthenticated`. The
 * two signer roles live in separate partitions:
 *
 * - tenant: `(entityCode, environment, issuerCuit, service)` — the issuer's own certificate;
 * - delegate: `(entityCode, environment, 'delegate', delegateCuit, service)` — our platform certificate, so
 *   one delegate ticket is reused across every represented CUIT.
 *
 * They are not merged on a shared CUIT: a taxpayer may hold several ARCA certificates and a representación
 * is granted to one specific computador, so serving a delegated call from a ticket minted by a different
 * certificate of the same CUIT yields a permanent `601` that looks like a missing delegation. The one safe
 * overlap is explicit — when a tenant request's certificate is our delegate certificate, it mints inside
 * the delegate partition, so ARCA still holds exactly one ticket for it.
 *
 * A tenant request with no credentials is served from cache and raises `CredentialsRequiredError` on a miss.
 * A delegated request signs with the service's own delegate certificate, so it never raises that.
 */
export class TicketStore {
    constructor(
        private readonly wsaa: WsaaClient = new WsaaClient(soap, env.ticketCachePath),
        private readonly delegate: DelegateCredentialStore = delegateCredentialStore,
    ) {}

    /**
     * Tenant cache partition: the issuer signs with its own certificate.
     *
     * Neither this shape nor the delegate one may be a prefix of the other, an invariant `ExpiringCache`
     * relies on but cannot enforce: `clearCache(owner)` sweeps every key beginning `${owner}:`, so a
     * delegate ticket dropped because a tenant's was is a ~12h outage for every represented CUIT.
     *
     * Both shapes end in an eleven-digit CUIT, so neither can end where the other continues — the only
     * candidate would be a tenant key whose signer CUIT was the literal `delegate`.
     */
    private ownerKey(entityCode: string, environment: GenericEnvironment, signerCuit: string): string {
        return `${entityCode}:${environment}:${signerCuit}`;
    }

    /**
     * Delegate cache partition, disjoint from every tenant partition by the `delegate` segment — so a ticket
     * minted by a tenant certificate can never serve a delegated call, or the reverse, even when both
     * identities are the same CUIT.
     */
    private delegateOwnerKey(entityCode: string, environment: GenericEnvironment, delegateCuit: string): string {
        return `${entityCode}:${environment}:delegate:${delegateCuit}`;
    }

    /**
     * Resolves the auth for a call. `Auth.Cuit` is always `issuerTaxId`, the represented taxpayer. When
     * `delegated`, signs with the service's own delegate certificate; otherwise serves a cached tenant
     * ticket, mints one from `credentials`, or with neither throws so core re-sends with credentials.
     */
    async resolve(
        entityCode: string,
        issuerTaxId: string,
        service: ServiceIdValue,
        environment: GenericEnvironment,
        credentials?: IssuerCredentials,
        delegated = false,
    ): Promise<ArcaAuth> {
        // Parsed first on both paths: `Auth.Cuit` must be the represented taxpayer's CUIT, never NaN.
        const cuit = parseArcaId(issuerTaxId, 'issuerTaxId');

        if (delegated) {
            return this.resolveDelegated(entityCode, cuit, service, environment);
        }

        // Tenant-certificate path: the certificate's owner is the issuer, so it is also the signer.
        // `issuerTaxId` is already canonical here, `parseArcaId` having rejected anything but bare digits, so
        // the key matches what earlier releases wrote and a shared ticket cache survives the deploy.
        const ownerKey = this.ownerKey(entityCode, environment, issuerTaxId);

        // Only this issuer's own partition may serve a credential-less request: borrowing the delegate ticket
        // would hand out a ticket for our own CUIT to a caller that never presented a certificate for it.
        const cached = this.peekAuth(ownerKey, service, cuit);
        if (cached !== undefined) {
            return cached;
        }

        if (!credentials) {
            throw new CredentialsRequiredError(entityCode, issuerTaxId, service, environment);
        }

        // Fails fast when `issuerTaxId` does not match the certificate being sent. WSAA login authenticates
        // the certificate and carries no CUIT, so a mismatch would otherwise mint a valid ticket under the
        // wrong identity and surface far downstream as an opaque `600 ValidacionDeToken`. Both sides go
        // through the same canonicalizer, so formatting never trips this.
        const serial = certificateSubjectSerialNumber(credentials.certPem);
        const certCuit = serial === null ? null : canonicalCuit(serial);
        // Gated on a canonical `issuerTaxId` first: a raw `!==` would let a both-`null` case through and mint
        // under an unverified identity.
        const expected = canonicalCuit(issuerTaxId);
        if (expected === null || certCuit !== expected) {
            throw new ArcaValidationError(
                certCuit === null
                    ? `certificate subject carries no CUIT; expected issuerTaxId ${issuerTaxId}`
                    : `issuerTaxId ${issuerTaxId} does not match the certificate's CUIT ${certCuit}`,
                'ISSUER_TAXID_CERT_MISMATCH',
            );
        }

        // The one safe overlap between the roles: a request carrying our delegate certificate mints inside
        // the delegate partition. ARCA holds a single ticket per certificate and service, so a second one
        // here would be refused with `alreadyAuthenticated` for as long as the delegate ticket lives.
        const sharesDelegateCertificate = this.delegate.matchesDelegateCertificate(environment, credentials.certPem);
        const signerKey = sharesDelegateCertificate
            ? this.delegateOwnerKey(entityCode, environment, expected)
            : ownerKey;
        if (sharesDelegateCertificate) {
            const shared = this.peekAuth(signerKey, service, cuit);
            if (shared !== undefined) {
                return shared;
            }
        }

        return this.mintAuth(signerKey, service, environment, cuit, credentials);
    }

    /**
     * A cached ticket for `ownerKey` projected onto `cuit`, or `undefined` on a miss. `cuit` is not the
     * ticket's owner: on the delegated path the ticket is minted by this service's certificate while
     * `Auth.Cuit` carries the represented taxpayer, and keeping the projection here stops the two from being
     * transposed at a call site.
     */
    private peekAuth(ownerKey: string, service: ServiceIdValue, cuit: number): ArcaAuth | undefined {
        const cached = this.wsaa.peekAccessTicket(ownerKey, service);
        return cached === undefined ? undefined : {token: cached.token, sign: cached.sign, cuit};
    }

    /** Mints or reuses a ticket for `ownerKey` with `pems`, projected onto `cuit`. */
    private async mintAuth(
        ownerKey: string,
        service: ServiceIdValue,
        environment: GenericEnvironment,
        cuit: number,
        pems: {readonly certPem: string; readonly keyPem: string},
    ): Promise<ArcaAuth> {
        const config: ArcaConfig = {
            cuit,
            certPem: pems.certPem,
            keyPem: pems.keyPem,
            environment: toArcaEnvironment(environment),
            ticketOwnerKey: ownerKey,
        };
        const ticket = await this.wsaa.getAccessTicket(config, service);
        return {token: ticket.token, sign: ticket.sign, cuit};
    }

    /**
     * Signs with the service's own delegate certificate while `Auth.Cuit` stays the represented taxpayer.
     * Cached in the delegate partition, so one delegate ticket is shared across every represented CUIT and
     * never mixed with a ticket minted by another certificate.
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

        const cached = this.peekAuth(ownerKey, service, cuit);
        if (cached !== undefined) {
            return cached;
        }

        return this.mintAuth(ownerKey, service, environment, cuit, delegate);
    }

    /**
     * Evicts the cached delegate ticket for `(environment, service)` so the next delegated request re-mints.
     * Called when ARCA rejects it with a genuine token fault: one delegate ticket is shared across every
     * represented CUIT, so leaving a bad one cached would fail every representado until local expiry.
     *
     * Scoped to the rejected `service`, because the delegate identity also holds padrón tickets and ARCA
     * would refuse to re-mint those for up to ~12h. A no-op when delegation is not configured.
     */
    invalidateDelegated(entityCode: string, environment: GenericEnvironment, service: ServiceIdValue): void {
        let delegate: DelegateCredentials | undefined;
        try {
            delegate = this.delegate.get(environment);
        } catch {
            return; // runs inside an error handler: never mask the error being reported
        }
        if (delegate === undefined) {
            return;
        }
        this.wsaa.clearCache(this.delegateOwnerKey(entityCode, environment, delegate.delegateCuit), service);
    }
}

/** Long-lived singleton — the shared ticket cache + WSAA minter for the process. */
export const ticketStore = new TicketStore();
