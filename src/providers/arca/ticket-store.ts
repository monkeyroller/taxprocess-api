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
import {env} from '../../config/env.js';
import type {GenericEnvironment, IssuerCredentials} from '../provider.js';

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
 * signs the login ticket request with the issuer's credentials, exchanges it for a ~12h ticket, and
 * caches it (shared across every core instance, keyed by `(entityCode, environment, issuerTaxId, service)`),
 * so credentials cross the wire only on a refresh (~once per 12h), never per request.
 *
 * A request that carries no credentials is served from cache; on a miss/expiry it raises
 * {@link CredentialsRequiredError}. The underlying {@link WsaaClient} provides single-flight login
 * de-duplication (so a refresh stampede collapses to one `loginCms`), `alreadyAuthenticated` handling,
 * and optional cross-restart persistence via `ARCA_TICKET_CACHE_PATH`.
 */
export class TicketStore {
    constructor(private readonly wsaa: WsaaClient = new WsaaClient(soap, env.ticketCachePath)) {}

    /** Cache-partition key for one issuer (ARCA issues a distinct ticket per service, appended by WsaaClient). */
    private ownerKey(entityCode: string, environment: GenericEnvironment, issuerTaxId: string): string {
        return `${entityCode}:${environment}:${issuerTaxId}`;
    }

    /**
     * Resolves an {@link ArcaAuth} for a call. Serves a cached ticket when present; otherwise mints one
     * from `credentials` (logging in to ARCA); if neither is available, throws
     * {@link CredentialsRequiredError} so core re-sends with credentials.
     */
    async resolve(
        entityCode: string,
        issuerTaxId: string,
        service: ServiceIdValue,
        environment: GenericEnvironment,
        credentials?: IssuerCredentials,
    ): Promise<ArcaAuth> {
        const cuit = parseArcaId(issuerTaxId, 'issuerTaxId');
        const ownerKey = this.ownerKey(entityCode, environment, issuerTaxId);

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

        const config: ArcaConfig = {
            cuit,
            certPem: credentials.certPem,
            keyPem: credentials.keyPem,
            environment: toArcaEnvironment(environment),
            ticketOwnerKey: ownerKey,
        };
        const ticket = await this.wsaa.getAccessTicket(config, service);
        return {token: ticket.token, sign: ticket.sign, cuit};
    }
}

/** Long-lived singleton — the shared ticket cache + WSAA minter for the process. */
export const ticketStore = new TicketStore();
