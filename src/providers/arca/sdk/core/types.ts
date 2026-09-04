/**
 * Shared value types for the ARCA SDK. Per-service request/response types, whose field names mirror the ARCA
 * SOAP schema verbatim, live next to each service.
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

/** One registered point of sale, from WSFEv1 `FEParamGetPtosVenta`. */
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

/**
 * One published cotización, from WSFEv1 `FEParamGetCotizacion`. `rateDate` keeps ARCA's `FchCotiz` in its own
 * `yyyymmdd` spelling rather than being parsed into a `Date`: it is a day in the authority's calendar, and
 * running one through an instant is what shifts the day.
 */
export interface CurrencyRateInfo {
    /** `MonId` — echoed by the authority, so it may differ in case or padding from what was asked. */
    monId: string;
    /**
     * `MonCotiz` — the published rate, ARS per unit of `monId`.
     *
     * `| undefined` rather than a number the parser invented, and not optional: the caller must decide what
     * an unusable answer means, and a `?` would let one spread into a result unnoticed. An absent `MonCotiz`
     * reads as `NaN` and a blank one as `0` under a bare `Number()`, both values a caller acts on.
     */
    rate: number | undefined;
    /** `FchCotiz` in ARCA `yyyymmdd`: the day the rate is for, which may precede the day requested. */
    rateDate: string;
}

/**
 * One entry of the authority's currency catalogue, from WSFEv1 `FEParamGetTiposMonedas`. The days are
 * unparsed for the reason above, and `validTo` is absent for a currency still in force.
 */
export interface CurrencyTypeInfo {
    /** `Id` — the authority's currency code (`"PES"`, `"DOL"`, `"002"`). */
    id: string;
    /** `Desc` — the authority's own description. */
    description: string;
    /** `FchDesde` in ARCA `yyyymmdd`. */
    validFrom: string;
    /** `FchHasta` in ARCA `yyyymmdd`, when the authority reports one. */
    validTo?: string;
}
