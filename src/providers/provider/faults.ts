import type {GenericEnvironment} from './environment.js';

/**
 * What kind of failure a provider is reporting — the neutral half of the error contract. A category maps to
 * exactly one HTTP status, so this enumerates the statuses the wire contract has rather than any one
 * authority's vocabulary. Only providers know which of their authority's failures belongs where.
 *
 * The split matters most across the three `502`s and the two `400`s: an authority that refused our
 * credential, one that rejected the content, and one we could not reach are all "retry later" to a caller but
 * different things to an operator — while a stable, caller-fixable rejection must read as a `400`, since a
 * `502` invites a retry that will fail identically.
 */
export type ProviderFaultCategory =
    /** Provider-side validation, before or instead of an authority call. → `400` */
    | 'VALIDATION'
    /** The authority rejected the request for a stable, caller-fixable reason. → `400` */
    | 'AUTHORITY_REJECTED'
    /** The authority refused our credential/token. → `502` */
    | 'AUTHORITY_AUTH'
    /** The authority rejected the request for a reason we have not classified. → `502` */
    | 'AUTHORITY_SERVICE'
    /** The authority could not be reached, or answered unintelligibly. → `502` */
    | 'AUTHORITY_TRANSPORT'
    /** A provider operation that exists but is not implemented yet. → `501` */
    | 'NOT_IMPLEMENTED'
    /** A provider failure that is neither the caller's fault nor the authority's. → `500` */
    | 'PROVIDER_INTERNAL';

/**
 * A provider failure already translated out of its authority's vocabulary — the only error shape the HTTP
 * layer needs to understand from a provider.
 *
 * `code` is the stable wire category the caller branches on, and the provider authors it: the codes are
 * already entity-prefixed on the wire, so neutralizing them here would be a breaking contract change, and
 * inventing a second neutral code would give callers two things to branch on. `details` is likewise
 * provider-shaped and travels verbatim.
 *
 * The HTTP layer contributes only the status, read from `category`, so it needs no `instanceof` against any
 * provider's error classes and no table of any authority's codes.
 */
export class ProviderFault extends Error {
    constructor(
        readonly category: ProviderFaultCategory,
        readonly code: string,
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ProviderFault';
    }
}

/**
 * Raised when no valid ticket is cached for the issuer and the request carried no credentials. Maps to
 * `409 CREDENTIALS_REQUIRED`; core then re-sends the same request with the issuer's credentials attached.
 * `service` is the authority's own web-service identifier, echoed as an opaque string.
 *
 * Neutral rather than provider-local because the handshake is a contract-level flow: any entity whose
 * credentials core holds encrypted goes through the same exchange.
 */
export class CredentialsRequiredError extends Error {
    constructor(
        readonly entityCode: string,
        readonly issuerTaxId: string,
        readonly service: string,
        readonly environment: GenericEnvironment,
    ) {
        super(
            `CREDENTIALS_REQUIRED for entity=${entityCode} issuerTaxId=${issuerTaxId} ` +
                `service=${service} env=${environment}`,
        );
        this.name = 'CredentialsRequiredError';
    }
}

/** Raised when a request names an entity code with no registered provider. Maps to `400`. */
export class UnknownEntityError extends Error {
    constructor(readonly entityCode: string) {
        super(`Unknown entity code: "${entityCode}"`);
        this.name = 'UnknownEntityError';
    }
}

/**
 * Raised on a delegated request when the represented taxpayer has not delegated the web service to our CUIT
 * (AR: not linked in ARCA's Administrador de Relaciones). A deterministic, user-actionable outcome, so it
 * maps to `403 DELEGATION_NOT_AUTHORIZED` rather than a generic `502`. The raw authority code and message
 * ride along, so a genuine token fault is never masked as this.
 */
export class DelegationNotAuthorizedError extends Error {
    constructor(
        readonly delegateTaxId: string,
        readonly issuerTaxId: string,
        readonly authorityCode: string,
        readonly authorityMessage: string,
    ) {
        super(
            `Delegate ${delegateTaxId} is not authorized to issue for ${issuerTaxId}: grant the web ` +
                `service to ${delegateTaxId} (AR: ARCA "Administrador de Relaciones"). ` +
                `[authority ${authorityCode}] ${authorityMessage}`,
        );
        this.name = 'DelegationNotAuthorizedError';
    }
}

/**
 * Raised when a request sets `delegated: true` but this service has no valid delegate certificate for that
 * environment — a server misconfiguration rather than a caller error, so it maps to a `500`. `reason`
 * distinguishes "none configured" from "configured but invalid".
 */
export class DelegationNotConfiguredError extends Error {
    constructor(
        readonly environment: GenericEnvironment,
        readonly reason: string,
    ) {
        super(`Delegation is not available for environment "${environment}": ${reason}`);
        this.name = 'DelegationNotConfiguredError';
    }
}

/**
 * Raised when the authority has no record of the queried voucher — it was never issued. Distinct from an
 * authority failure, which stays a `502`, because a genuine not-found is stable rather than transient.
 *
 * This is the signal core's orphan reconciliation depends on: a sale left pending after an authorize whose
 * response never persisted may be cleared and re-authorized only once the authority confirms the voucher does
 * not exist. Clearing on an ambiguous failure risks issuing a second fiscal document for a sale that was
 * already authorized.
 */
export class VoucherNotFoundError extends Error {
    constructor(
        readonly entityCode: string,
        readonly pointOfSaleNumber: number,
        readonly documentTypeCode: number,
        readonly voucherNumber: number,
    ) {
        super(
            `No voucher ${voucherNumber} for point of sale ${pointOfSaleNumber}, document type ` +
                `${documentTypeCode} (entity "${entityCode}")`,
        );
        this.name = 'VoucherNotFoundError';
    }
}

/**
 * Raised when the authority's registry holds nobody under the identifier — an unregistered tax id, or an
 * identity document that matches no clave. A stable outcome the caller can act on, so a `404` rather than
 * the `502` an authority failure gets.
 *
 * Reported for both lookup routes so callers have one signal, which is also why a successful lookup never
 * returns an empty taxpayer list.
 */
export class TaxpayerNotFoundError extends Error {
    constructor(
        readonly entityCode: string,
        readonly identificationTypeCode: number,
        readonly identificationNumber: string,
        readonly authorityMessage?: string,
    ) {
        super(
            `No taxpayer registered under identification type ${identificationTypeCode} number ` +
                `${identificationNumber} (entity "${entityCode}")` +
                (authorityMessage === undefined ? '' : `: ${authorityMessage}`),
        );
        this.name = 'TaxpayerNotFoundError';
    }
}
