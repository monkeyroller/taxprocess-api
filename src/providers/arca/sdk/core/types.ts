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

/** One registered point of sale (WSFEv1 `FEParamGetPtosVenta` → `ResultGet.PtoVenta`). English SDK shape. */
export interface PointOfSaleInfo {
    /** `Nro` — the point-of-sale number. */
    number: number;
    /** `EmisionTipo` — issuance mode (e.g. `CAE`, `CAEA`, `RECE`). */
    issuanceMode?: string;
    /** `Bloqueado` = `'S'` → true. */
    blocked: boolean;
    /** `FchBaja` — de-registration date in ARCA `yyyymmdd`; undefined when active (`''`/`'NULL'`). */
    dischargeDate?: string;
}
