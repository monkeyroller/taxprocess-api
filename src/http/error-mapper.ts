import type {Response} from 'express';
import {
    ArcaAuthError,
    ArcaError,
    ArcaServiceError,
    ArcaSoapError,
    ArcaValidationError,
    NotImplementedError,
} from '../arca/index.js';
import {TicketRequiredError} from '../session/ticket-store.js';

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
 * Maps any thrown value to an HTTP status + neutral error body. ARCA SDK errors are matched by
 * `instanceof` (single SDK instance); framework HTTP errors (e.g. class-validator `400`s surfaced by
 * routing-controllers) are matched by their numeric `httpCode`.
 */
export function toHttpError(err: unknown): HttpErrorResult {
    if (err instanceof TicketRequiredError) {
        return make(409, 'TICKET_REQUIRED', err.message, {
            cuit: err.cuit,
            service: err.service,
            environment: err.environment,
        });
    }
    if (err instanceof ArcaValidationError) {
        return make(400, 'ARCA_VALIDATION', err.message);
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
        return make(httpCode, name, messageOf(err, 'Request failed'));
    }

    return make(500, 'INTERNAL', 'Internal Server Error');
}

/** Writes {@link toHttpError} to the response. */
export function sendError(res: Response, err: unknown): Response {
    const {status, body} = toHttpError(err);
    return res.status(status).json(body);
}
