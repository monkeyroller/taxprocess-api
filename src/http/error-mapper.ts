import type {Response} from 'express';
import {
    ArcaAuthError,
    ArcaError,
    ArcaServiceError,
    ArcaSoapError,
    ArcaValidationError,
    NotImplementedError,
} from '../providers/arca/sdk/index.js';
import {CredentialsRequiredError} from '../providers/arca/ticket-store.js';
import {UnknownEntityError, VoucherNotFoundError} from '../providers/provider.js';

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
 * Maps any thrown value to an HTTP status + neutral error body. ARCA SDK errors are matched by
 * `instanceof` (single SDK instance); framework HTTP errors (e.g. class-validator `400`s surfaced by
 * routing-controllers) are matched by their numeric `httpCode`.
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
    if (err instanceof ArcaValidationError) {
        // Top-level `code` stays the stable category (§8); the specific reason (e.g.
        // `VOUCHER_ALREADY_AUTHORIZED_MISMATCH`, `UNMAPPED_CURRENCY`) rides in `details.code` so callers can
        // branch on it without parsing the message. Absent when the validation error carried no code.
        return make(400, 'ARCA_VALIDATION', err.message, err.code === undefined ? undefined : {code: err.code});
    }
    if (err instanceof NotImplementedError) {
        return make(501, 'NOT_IMPLEMENTED', err.message);
    }
    if (err instanceof ArcaAuthError) {
        return make(502, 'ARCA_AUTH', err.message);
    }
    if (err instanceof ArcaServiceError) {
        return make(502, 'ARCA_SERVICE', err.message);
    }
    if (err instanceof ArcaSoapError) {
        return make(502, 'ARCA_SOAP', err.message);
    }
    if (err instanceof ArcaError) {
        return make(500, 'ARCA_ERROR', err.message);
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
