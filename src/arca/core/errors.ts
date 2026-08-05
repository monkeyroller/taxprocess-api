/**
 * Error hierarchy for the ARCA SDK.
 *
 * Every error extends {@link ArcaError} so a caller can branch on the failure category —
 * authentication vs. transport vs. business rejection — and decide what is safe to retry.
 * Transport failures (5xx, timeouts) are transient; auth and business errors are not.
 */
export class ArcaError extends Error {
    constructor(message: string, readonly code?: string) {
        super(message);
        this.name = new.target.name;
    }
}

/** WSAA authentication or login-ticket signing failure. Never retryable. */
export class ArcaAuthError extends ArcaError {}

/** SOAP transport failure: non-2xx HTTP, timeout, network error, or a SOAP Fault. */
export class ArcaSoapError extends ArcaError {
    constructor(message: string, readonly httpStatus?: number, code?: string) {
        super(message, code);
    }
}

/** A single `{Code, Msg}` pair as returned inside an ARCA service response `Errors.Err`. */
export interface ArcaErrorEntry {
    code: string;
    message: string;
}

/**
 * Business rejection reported inside an otherwise-successful SOAP response (the service
 * returned HTTP 200 but the payload carries `Errors`). Not retryable without changing the input.
 */
export class ArcaServiceError extends ArcaError {
    constructor(message: string, readonly errors: Array<ArcaErrorEntry>) {
        super(message, errors[0]?.code);
    }
}

/** Local validation failure raised before a request is sent. */
export class ArcaValidationError extends ArcaError {}

/** Thrown by a seeded-but-not-yet-implemented service operation. */
export class NotImplementedError extends ArcaError {
    constructor(what: string) {
        super(`${what} is not implemented yet`, 'NOT_IMPLEMENTED');
    }
}
