import type {Response} from 'express';
import {
    CredentialsRequiredError,
    DelegationNotAuthorizedError,
    DelegationNotConfiguredError,
    ProviderFault,
    TaxpayerNotFoundError,
    UnknownEntityError,
    VoucherNotFoundError,
    type ProviderFaultCategory,
} from '../providers/provider.js';

/**
 * Neutral fault category → HTTP status. This is the ONLY thing this layer decides about a provider failure:
 * the wire `code`, the `message` and the `details` are all authored by the provider that raised it (ARCA's
 * `ARCA_*` / `RECEIVER_MATCHES_ISSUER` and their detail shapes live in `providers/arca/faults.ts`).
 *
 * Keeping it that way is what makes this module provider-agnostic. It used to `instanceof`-check the ARCA
 * SDK's error classes and carry ARCA's own business-code table, which meant a second entity's failures had
 * nowhere to land but the generic `500` — while the service's whole premise is that the provider owns every
 * entity-specific detail.
 */
const STATUS_BY_CATEGORY: Record<ProviderFaultCategory, number> = {
    VALIDATION: 400,
    AUTHORITY_REJECTED: 400,
    AUTHORITY_AUTH: 502,
    AUTHORITY_SERVICE: 502,
    AUTHORITY_TRANSPORT: 502,
    NOT_IMPLEMENTED: 501,
    PROVIDER_INTERNAL: 500,
};

export interface HttpErrorResult {
    readonly status: number;
    readonly body: {
        readonly error: {
            readonly code: string;
            readonly message: string;
            readonly details?: unknown;
        };
    };
}

function make(status: number, code: string, message: string, details?: unknown): HttpErrorResult {
    const error = details === undefined ? {code, message} : {code, message, details};
    return {status, body: {error}};
}

/** Reads a numeric `httpCode` off framework HTTP errors (routing-controllers) without relying on `instanceof`. */
function httpCodeOf(err: unknown): number | undefined {
    if (typeof err === 'object' && err !== null && 'httpCode' in err) {
        const code: unknown = err.httpCode;
        return typeof code === 'number' ? code : undefined;
    }
    return undefined;
}

function messageOf(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
}

/**
 * A class-validator `ValidationError` trimmed to the caller-safe fields. Deliberately drops `value` and
 * `target` — those hold the *submitted* data (which can include `entity.credentials`) and must never echo
 * back in an error body.
 */
interface ValidationSummary {
    readonly property: string;
    readonly constraints?: Record<string, string>;
    readonly children?: ReadonlyArray<ValidationSummary>;
}

/** Recursively summarizes class-validator `ValidationError[]` into the safe `{property, constraints, children}` shape. */
function summarizeValidationErrors(errors: unknown): ReadonlyArray<ValidationSummary> | undefined {
    if (!Array.isArray(errors)) {
        return undefined;
    }
    const summarized = errors
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null && 'property' in e)
        .map((e) => {
            const constraints =
                typeof e.constraints === 'object' && e.constraints !== null
                    ? (e.constraints as Record<string, string>)
                    : undefined;
            const children = summarizeValidationErrors(e.children);
            return {
                property: String(e.property),
                ...(constraints ? {constraints} : {}),
                ...(children && children.length > 0 ? {children} : {}),
            };
        });
    return summarized.length > 0 ? summarized : undefined;
}

/** Pulls the (safe) validation details off a routing-controllers `BadRequestError`, whose class-validator
 *  failures live on its `errors` property — the very property its default message tells callers to inspect. */
function validationDetailsOf(err: unknown): ReadonlyArray<ValidationSummary> | undefined {
    if (typeof err === 'object' && err !== null && 'errors' in err) {
        return summarizeValidationErrors(err.errors);
    }
    return undefined;
}

/**
 * Maps any thrown value to an HTTP status + neutral error body.
 *
 * Three kinds of input, and no fourth: the neutral errors declared in `providers/provider.ts` (each with a
 * status the contract fixes), a {@link ProviderFault} whose category gives the status and whose
 * code/message/details the provider already authored, and framework HTTP errors (e.g. class-validator
 * `400`s surfaced by routing-controllers) matched by their numeric `httpCode`. Anything else is a `500`.
 *
 * A provider's own error classes never appear here — `TaxEntityProvider` translates them to a
 * {@link ProviderFault} on the way out of every public method.
 */
export function toHttpError(err: unknown): HttpErrorResult {
    if (err instanceof CredentialsRequiredError) {
        return make(409, 'CREDENTIALS_REQUIRED', err.message, {
            entityCode: err.entityCode,
            issuerTaxId: err.issuerTaxId,
            service: err.service,
            environment: err.environment,
        });
    }
    if (err instanceof UnknownEntityError) {
        return make(400, 'UNKNOWN_ENTITY', err.message, {entityCode: err.entityCode});
    }
    if (err instanceof DelegationNotAuthorizedError) {
        // A delegated call the authority refused because the represented CUIT hasn't delegated to us — a
        // deterministic, user-actionable outcome (grant the delegation), so a distinct `403`, never a `502`.
        // `arcaCode`/`arcaMessage` are the key names CONTRACT §8 froze and core reads; the error itself is
        // neutral (`authorityCode`/`authorityMessage`), so renaming the wire keys is a breaking change to
        // make deliberately with core, not a side effect of tidying this layer.
        return make(403, 'DELEGATION_NOT_AUTHORIZED', err.message, {
            delegateTaxId: err.delegateTaxId,
            issuerTaxId: err.issuerTaxId,
            arcaCode: err.authorityCode,
            arcaMessage: err.authorityMessage,
        });
    }
    if (err instanceof DelegationNotConfiguredError) {
        // `delegated:true` but this service has no valid delegate certificate for the environment — a server
        // misconfiguration, not a caller error.
        return make(500, 'DELEGATION_NOT_CONFIGURED', err.message, {environment: err.environment, reason: err.reason});
    }
    if (err instanceof VoucherNotFoundError) {
        // A never-issued voucher is a stable outcome, not a transport failure — a distinct `404` (never a
        // `502`) so core's orphan reconciliation can safely clear + re-authorize on exactly this signal.
        return make(404, 'VOUCHER_NOT_FOUND', err.message, {
            entityCode: err.entityCode,
            pointOfSaleNumber: err.pointOfSaleNumber,
            documentTypeCode: err.documentTypeCode,
            voucherNumber: err.voucherNumber,
        });
    }
    if (err instanceof TaxpayerNotFoundError) {
        // The registry holds nobody under this identifier — a stable outcome the caller can act on (fix the
        // number, or fall back to asking the customer), never the retryable `502` an authority failure means.
        return make(404, 'TAXPAYER_NOT_FOUND', err.message, {
            entityCode: err.entityCode,
            identificationTypeCode: err.identificationTypeCode,
            identificationNumber: err.identificationNumber,
        });
    }
    if (err instanceof ProviderFault) {
        // Everything entity-specific — the wire code, the message, the details shape — was decided by the
        // provider. All that is left here is the status its category implies.
        return make(STATUS_BY_CATEGORY[err.category], err.code, err.message, err.details);
    }

    const httpCode = httpCodeOf(err);
    if (httpCode !== undefined) {
        const name = err instanceof Error ? err.name : 'HTTP_ERROR';
        // Surface class-validator field failures (validation 400s) so the caller can see *which* field failed —
        // the framework message promises an `errors` property, which the wire envelope exposes as `details`.
        return make(httpCode, name, messageOf(err, 'Request failed'), validationDetailsOf(err));
    }

    return make(500, 'INTERNAL', 'Internal Server Error');
}

/** Writes {@link toHttpError} to the response. */
export function sendError(res: Response, err: unknown): Response {
    const {status, body} = toHttpError(err);
    return res.status(status).json(body);
}
