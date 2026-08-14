/** Neutral authorization status — country-agnostic. AR `Resultado` A/P/R maps onto these. */
export type NeutralAuthorizationStatus = 'AUTHORIZED' | 'PARTIAL' | 'REJECTED';

/** A neutral observation/error entry returned by the authority. */
export interface NeutralObservation {
    readonly code: string;
    readonly message: string;
}

/**
 * The neutral result of an authorization request. The AR mapper produces this from ARCA's WSFEv1
 * response (CAE → `authorizationCode`, `CAEFchVto` → `expiration`, `CbteDesde` → `authorizedNumber`,
 * RG-4892 QR → `qr`).
 */
export class NeutralAuthorizationResultDto {
    /** The authorization code (AR: CAE). */
    authorizationCode!: string;

    /** ISO-8601 expiration of the authorization code. */
    expiration!: string;

    /** The authority-assigned voucher number. */
    authorizedNumber!: number;

    /** Fiscal QR payload/URL, when the authority defines one (AR: RG-4892). */
    qr?: string;

    status!: NeutralAuthorizationStatus;

    observations!: Array<NeutralObservation>;

    /**
     * Entity-specific extras for core to persist opaquely on the authorization row. **Always present**
     * (an empty object when there are none). The meaningful fields are core-owned — e.g. core populates
     * `conceptTypeId` itself from the `concept` it sent; this service does not currently derive any, so
     * the object is `{}`. A provider may populate it in future for genuinely authority-derived fields.
     */
    providerMetadata!: Record<string, unknown>;
}

/** Result of `POST /invoices/last-authorized`. */
export class LastAuthorizedResultDto {
    number!: number;
}

/** One entry of `POST /invoices/next-numbers`: the next expected number for a document type. */
export class NextNumberDto {
    /** Echoes the requested canonical code (AR: CbteTipo); core maps the response back by this code. */
    documentTypeCode!: number;

    /** Next voucher number the authority expects (AR: FECompUltimoAutorizado + 1; never-authorized → 1). */
    nextNumber!: number;
}

/** Result of `POST /invoices/next-numbers` — one entry per requested document-type code. */
export class NextNumbersResultDto {
    numbers!: Array<NextNumberDto>;
}

/** One point of sale (AR: Punto de Venta) as reported by the authority. */
export class PointOfSaleDto {
    /** The point-of-sale number (AR: Nro / PtoVta). */
    number!: number;

    /** Issuance mode the point is registered for (AR: EmisionTipo, e.g. 'CAE', 'CAEA', 'RECE'). */
    issuanceMode?: string;

    /** True when the authority has the point of sale blocked (AR: Bloqueado = 'S'). */
    blocked!: boolean;

    /** De-registration date (ISO-8601) when the point has been dropped (AR: FchBaja); undefined while active. */
    dischargeDate?: string;
}

/** Result of `POST /points-of-sale` — every point of sale the authority has on file for the entity. */
export class PointsOfSaleResultDto {
    pointsOfSale!: Array<PointOfSaleDto>;
}

/** Neutral taxpayer-registry (padrón) lookup result. */
export class TaxpayerResultDto {
    idPersona!: number;
    taxId?: string;
    name?: string;
}
