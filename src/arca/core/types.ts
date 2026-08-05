/**
 * Shared value types for the ARCA SDK. These are the SDK's own contract shapes; per-service
 * request/response types (whose field names mirror the ARCA SOAP schema verbatim) live next to each
 * service in its own `*.types.ts`.
 */

/** Credentials injected into every business SOAP call, obtained from WSAA. */
export interface ArcaAuth {
    token: string;
    sign: string;
    /** Issuer CUIT (digits only) the certificate represents. */
    cuit: number;
}

/** A WSAA access ticket (Ticket de Acceso). Valid for ~12h; cached per (owner, service). */
export interface AccessTicket {
    token: string;
    sign: string;
    expirationTime: Date;
}

/** Result of a service dummy/health operation (e.g. WSFEv1 `FEDummy`). */
export interface ServerStatus {
    appServer: string;
    dbServer: string;
    authServer: string;
}
