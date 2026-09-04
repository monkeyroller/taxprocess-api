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
} from '../../providers/provider/faults.js';

/**
 * Neutral fault category → HTTP status, the only thing this layer decides about a provider failure: the wire
 * `code`, `message` and `details` are all authored by the provider that raised it.
 *
 * Keeping it that way is what makes this module provider-agnostic. It used to `instanceof`-check the ARCA
 * SDK's error classes and carry ARCA's business-code table, which left a second entity's failures nowhere to
 * land but a generic `500`.
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

/** Reads a numeric `httpCode` off framework HTTP errors without relying on `instanceof`. */
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
 * A class-validator `ValidationError` trimmed to the caller-safe fields. Drops `value` and `target`, which
 * hold the submitted data — credentials included — and must never echo back in an error body.
 */
interface ValidationSummary {
    readonly property: string;
    readonly constraints?: Record<string, string>;
    readonly children?: ReadonlyArray<ValidationSummary>;
}

/** Recursively summarizes class-validator errors into the safe shape. */
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

/** The safe validation details off a `BadRequestError`, whose failures live on its `errors` property. */
function validationDetailsOf(err: unknown): ReadonlyArray<ValidationSummary> | undefined {
    if (typeof err === 'object' && err !== null && 'errors' in err) {
        return summarizeValidationErrors(err.errors);
    }
    return undefined;
}

/**
 * Maps any thrown value to an HTTP status and neutral error body.
 *
 * Three kinds of input and no fourth: the neutral errors, each with a status the contract fixes; a
 * `ProviderFault`, whose category gives the status and whose code, message and details the provider already
 * authored; and framework HTTP errors, matched by their numeric `httpCode`. Anything else is a `500`.
 *
 * A provider's own error classes never appear here — `TaxEntityProvider` translates them on the way out of
 * every public method.
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
        // The represented CUIT has not delegated to us — a user-actionable outcome, so a `403` rather than a
        // `502`. `arcaCode`/`arcaMessage` are the wire keys core reads, while the error itself is neutral, so
        // renaming them is a breaking change to make deliberately rather than while tidying this layer.
        return make(403, 'DELEGATION_NOT_AUTHORIZED', err.message, {
            delegateTaxId: err.delegateTaxId,
            issuerTaxId: err.issuerTaxId,
            arcaCode: err.authorityCode,
            arcaMessage: err.authorityMessage,
        });
    }
    if (err instanceof DelegationNotConfiguredError) {
        // No valid delegate certificate for the environment — a server misconfiguration, not a caller error.
        return make(500, 'DELEGATION_NOT_CONFIGURED', err.message, {environment: err.environment, reason: err.reason});
    }
    if (err instanceof VoucherNotFoundError) {
        // A never-issued voucher is a stable outcome rather than a transport failure, so a `404` — which is
        // what lets core's orphan reconciliation clear and re-authorize on exactly this signal.
        return make(404, 'VOUCHER_NOT_FOUND', err.message, {
            entityCode: err.entityCode,
            pointOfSaleNumber: err.pointOfSaleNumber,
            documentTypeCode: err.documentTypeCode,
            voucherNumber: err.voucherNumber,
        });
    }
    if (err instanceof TaxpayerNotFoundError) {
        // The registry holds nobody under this identifier — a stable outcome the caller can act on, never
        // the retryable `502` an authority failure means.
        return make(404, 'TAXPAYER_NOT_FOUND', err.message, {
            entityCode: err.entityCode,
            identificationTypeCode: err.identificationTypeCode,
            identificationNumber: err.identificationNumber,
        });
    }
    if (err instanceof ProviderFault) {
        // Everything entity-specific was decided by the provider; only the status is left.
        return make(STATUS_BY_CATEGORY[err.category], err.code, err.message, err.details);
    }

    const httpCode = httpCodeOf(err);
    if (httpCode !== undefined) {
        const name = err instanceof Error ? err.name : 'HTTP_ERROR';
        // Surfaces class-validator field failures so the caller can see which field failed: the framework
        // message promises an `errors` property, which the wire envelope exposes as `details`.
        return make(httpCode, name, messageOf(err, 'Request failed'), validationDetailsOf(err));
    }

    return make(500, 'INTERNAL', 'Internal Server Error');
}

/** Writes the mapped error to the response. */
export function sendError(res: Response, err: unknown): Response {
    const {status, body} = toHttpError(err);
    return res.status(status).json(body);
}
