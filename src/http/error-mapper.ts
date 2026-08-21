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
import {
    DelegationNotAuthorizedError,
    DelegationNotConfiguredError,
    UnknownEntityError,
    VoucherNotFoundError,
} from '../providers/provider.js';

/**
 * ARCA business-rejection codes (`Errors.Err[].Code`) that are stable and caller-actionable —
 * given the same input, ARCA rejects the same way every time, so these get their own category
 * and a `400` (never the generic `502 ARCA_SERVICE`, which reads as "retry me"). Add an entry
 * here once a code is confirmed to recur and worth a dedicated, translated message downstream.
 *
 * - `10069` — "Campo DocNro no puede ser igual al del emisor.": the receiver's identification
 *   number is the same as the issuing company's own — never transient, always caller-fixable.
 */
const KNOWN_ARCA_SERVICE_ERROR_CODES: Record<string, {readonly status: number; readonly code: string}> = {
    '10069': {status: 400, code: 'RECEIVER_MATCHES_ISSUER'},
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
    if (err instanceof DelegationNotAuthorizedError) {
        // A delegated call the authority refused because the represented CUIT hasn't delegated to us — a
        // deterministic, user-actionable outcome (grant the delegation), so a distinct `403`, never a `502`.
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
        // A known, recurring rejection gets its own stable category + `400` so the caller can branch on
        // `code` without parsing the (Spanish, ARCA-authored) message. `arcaErrors` still rides along so
        // an unmapped sibling code in the same response isn't silently dropped.
        // `Object.hasOwn`, not `in`: codes come straight off ARCA's XML with no validation, and `in` would
        // also match inherited keys (`constructor`, `toString`), yielding an undefined status downstream.
        const known = err.errors.find((e) => Object.hasOwn(KNOWN_ARCA_SERVICE_ERROR_CODES, e.code));
        if (known) {
            const {status, code} = KNOWN_ARCA_SERVICE_ERROR_CODES[known.code];
            return make(status, code, known.message, {arcaCode: known.code, arcaErrors: err.errors});
        }
        // Unclassified business rejection: keep the transport-agnostic 502, but expose the full
        // `{code, message}` list — previously dropped entirely — so a caller can branch on it, and so a
        // future recurring code can be promoted into `KNOWN_ARCA_SERVICE_ERROR_CODES` above.
        return make(502, 'ARCA_SERVICE', err.message, {arcaErrors: err.errors});
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
