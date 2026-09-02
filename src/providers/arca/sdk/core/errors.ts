/**
 * Error hierarchy for the ARCA SDK. Every error extends `ArcaError`, so a caller can branch on the category
 * — authentication, transport or business rejection — and decide what is safe to retry. Transport failures
 * are transient; auth and business errors are not.
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

/**
 * A single `{Code, Msg}` pair as ARCA reports one. One structure because ARCA uses one: it appears as the
 * fatal `Errors.Err` and the non-fatal `Observaciones.Obs`, and a single reader parses both, which is what
 * stopped the two drifting into different absent-child handling.
 */
export interface ArcaCodeMessage {
    code: string;
    message: string;
}

/** One inside a service response's `Errors.Err` — fatal. */
export type ArcaErrorEntry = ArcaCodeMessage;

/**
 * Business rejection reported inside an otherwise-successful SOAP response: HTTP 200 whose payload carries
 * `Errors`. Not retryable without changing the input.
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

/**
 * A padrón lookup for an identifier ARCA has no person registered under. Its own class rather than a service
 * error: the padrón services report it as a successful `200`, and it is a stable caller-visible outcome —
 * a `404` — never the retryable authority failure a service error implies.
 */
export class ArcaTaxpayerNotFoundError extends ArcaError {
    constructor(readonly taxpayerId: string, message?: string) {
        super(message ?? `No taxpayer registered under id ${taxpayerId}`, 'TAXPAYER_NOT_FOUND');
    }
}
