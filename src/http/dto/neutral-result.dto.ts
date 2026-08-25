// Type-only: the enum is used here purely to constrain the address scheme fields, so nothing is imported
// at runtime and `provider.ts` importing these DTOs back stays a compile-time-only relationship.
import type {AddressCodeScheme} from '../../providers/provider.js';

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

/**
 * Which kind of registry answer a taxpayer lookup produced. The authority services behind these are
 * complementary rather than nested — `REGISTRATION` knows the tax picture, `IDENTITY` knows the person —
 * so `detail` is what tells a caller which fields could be populated at all. It is derived from the
 * identification type sent, never chosen on the wire.
 */
export type TaxpayerDetail = 'REGISTRATION' | 'IDENTITY';

export type TaxpayerPersonType = 'INDIVIDUAL' | 'LEGAL_ENTITY';

export type TaxpayerRegistrationStatus = 'ACTIVE' | 'INACTIVE';

/**
 * A declared address. `kind`/`status` are the authority's own wording (AR: tipo/estado de domicilio).
 *
 * Every geographic level reads the same way — **a name from the authority, a code, and the standard that
 * code belongs to**:
 *
 * | level | authority's name | code | standard |
 * | --- | --- | --- | --- |
 * | country | — | `countryCode` | `countryCodeScheme` |
 * | region | `region` | `regionCode` | `regionCodeScheme` |
 * | city | `city` | `cityCode` | `cityCodeScheme` |
 *
 * **Resolve a level by matching the pair, not the code alone.** A code means nothing without the scheme
 * naming the catalog it was drawn from — `"AR"` is an ISO 3166-1 alpha-2 country here, but the same two
 * letters index something else in another coding system. Scheme values come from a closed vocabulary
 * (`AddressCodeScheme`) precisely so a caller can key on them.
 *
 * A scheme is present **exactly** when its code is, never alone. Each pair follows the absence rule
 * independently, so a partially-coded address is normal rather than a fault: read the codes when present,
 * and fall back to the authority's own name when a level did not resolve. The authority's names are also
 * the only thing left for a place its national catalog does not code at all.
 */
export class TaxpayerAddressDto {
    street?: string;
    postalCode?: string;

    /** Locality name as the authority holds it, free text (AR: localidad). */
    city?: string;
    /** Province/state name as the authority holds it (AR: descripcionProvincia). */
    region?: string;

    /** Country code (AR: `"AR"`) — every address an ARCA registry holds is Argentine. */
    countryCode?: string;
    countryCodeScheme?: AddressCodeScheme;

    /**
     * Province/state code (AR: `"AR-X"` for Córdoba). Resolved by the provider from whatever the authority
     * states internally; the authority's own catalog id is **not** on the wire, since it is meaningless to
     * anyone but that authority (CONTRACT §9).
     */
    regionCode?: string;
    regionCodeScheme?: AddressCodeScheme;

    /**
     * The locality as a code (AR: INDEC's 8-digit localidad censal code — provincia 2 + departamento 3 +
     * localidad 3 — e.g. `"14014010"` for the city of Córdoba).
     *
     * Emitted only where the locality resolves unambiguously. It is **absent, with no substitute**, when
     * the authority's free-text locality names a place the national catalog does not code — for AR, most
     * notably a *barrio* of an interior city. `city` still carries the authority's text in that case.
     */
    cityCode?: string;
    cityCodeScheme?: AddressCodeScheme;

    kind?: string;
    status?: string;
}

/** A registered economic activity. `period` is an ISO-8601 year-month (`"2014-09"`). */
export class TaxpayerActivityDto {
    code!: string;
    description?: string;
    period?: string;
    /** True for the taxpayer's principal activity (AR: orden 1). */
    primary?: boolean;
}

/** A tax the taxpayer is registered in. `period` is an ISO-8601 year-month. */
export class TaxpayerTaxDto {
    code!: string;
    description?: string;
    period?: string;
    /** Authority status code for the registration (AR: estadoImpuesto, e.g. `"AC"`). */
    status?: string;
    /** Authority-supplied reason/motive text, when it gives one (AR: motivo). */
    reason?: string;
}

/**
 * One taxpayer as the registry holds them. Which keys can appear depends on the result's `detail` — the
 * per-detail table lives in `docs/CONTRACT.md`. Three rules make the shape predictable:
 *
 * - **Always present, both details:** `taxId`, `addresses`, `activities`, `providerMetadata`.
 * - **Arrays the detail covers are always present**, `[]` when the authority reports none — so "none
 *   registered" is distinguishable from "this detail cannot report it". `taxes` therefore appears on
 *   every `REGISTRATION` result and on no `IDENTITY` result.
 * - **Optional scalars are omitted, never `null`**, when the authority did not return them — the same
 *   convention as `qr` / `dischargeDate` elsewhere in this contract.
 */
export class TaxpayerDto {
    /** The taxpayer's tax identifier (AR: CUIT/CUIL/CDI). Always present. */
    taxId!: string;

    /** Kind of tax identifier the authority holds (AR: tipoClave — `"CUIT"`, `"CUIL"`, `"CDI"`). */
    taxIdType?: string;

    /**
     * The same identification pair a lookup request and an invoice receiver carry, echoed so each row is
     * self-describing. This matters on a document lookup: one DNI commonly matches several taxpayers, and
     * each is keyed by a **different** clave than the one searched by, so a customer built from a row must
     * be identified by the row's own id rather than by the document the operator typed.
     *
     * `identificationNumber` repeats `taxId` and is always present. `identificationTypeCode` is the
     * canonical code behind `taxIdType` (AR: 80 CUIT / 86 CUIL / 87 CDI) and is omitted when the authority
     * did not state a kind — the pair never asserts a type the registry did not report.
     */
    identificationTypeCode?: number;
    identificationNumber?: string;

    personType?: TaxpayerPersonType;

    /** Legal name for an entity, full name for an individual. */
    name?: string;
    firstName?: string;
    lastName?: string;

    registrationStatus?: TaxpayerRegistrationStatus;

    /** Identity-document type/number (AR: tipoDocumento/numeroDocumento). `IDENTITY` results only. */
    documentType?: string;
    documentNumber?: string;

    /** ISO-8601 dates. `birthDate`/`registrationDate` are `IDENTITY` only. */
    birthDate?: string;
    registrationDate?: string;
    incorporationDate?: string;

    /** Legal form of an entity (AR: formaJuridica). `IDENTITY` results only. */
    legalForm?: string;

    /** Month the fiscal year closes, 1–12 (AR: mesCierre). */
    fiscalYearEndMonth?: number;

    /** The address the authority holds as fiscal, when it reports one. Also included in `addresses`. */
    fiscalAddress?: TaxpayerAddressDto;

    /** Every declared address. Always present; `[]` when none. */
    addresses!: Array<TaxpayerAddressDto>;

    /** Registered activities. Always present; `[]` when none. */
    activities!: Array<TaxpayerActivityDto>;

    /** Registered taxes. Present on `REGISTRATION` results only (`[]` when none), absent on `IDENTITY`. */
    taxes?: Array<TaxpayerTaxDto>;

    /** Small-taxpayer regime category (AR: categoría de monotributo). `REGISTRATION` results only. */
    simplifiedRegimeCategory?: string;

    /**
     * The taxpayer's VAT/fiscal condition, in the **same canonical code space** as
     * `invoice.receiver.fiscalConditionCode` (AR: RG 5616 — 1 Responsable Inscripto, 4 Sujeto Exento,
     * 6 Monotributo, 15 IVA no alcanzado) — so the condition a lookup reports is the one that will later
     * ride the invoice for that customer.
     *
     * Derived by the provider from the registry's own tax vocabulary, and **omitted whenever the registry
     * gives no basis to determine one**: on every `IDENTITY` result (which reports no taxes at all), for a
     * taxpayer with no VAT-relevant registration, and where the registrations on file contradict each
     * other. Absence means "not reported", never "Consumidor Final" — a caller should let the user choose
     * rather than default.
     */
    fiscalConditionCode?: number;

    /**
     * Entity-specific extras with no cross-country meaning, passed through opaquely. **Always present**
     * (at minimum naming the authority service that answered). For ARCA: caracterizaciones, sucesión and
     * fallecimiento markers, dependencia, regímenes, autónomos categories, and the per-block constancia
     * errors.
     */
    providerMetadata!: Record<string, unknown>;
}

/**
 * Result of `POST /taxpayers/lookup`. Always a list: an identity-document lookup can legitimately match
 * several taxpayers (one document commonly carries both a CUIL and a CUIT), while a tax-id lookup returns
 * exactly one. It is never empty on a `200` — no match is a `404 TAXPAYER_NOT_FOUND`.
 */
export class TaxpayerResultDto {
    /** Echoes the entity that answered, so a result is self-describing once detached from its request. */
    entityCode!: string;

    /** Which registry answered, and therefore which fields of `taxpayers[]` can be populated. */
    detail!: TaxpayerDetail;

    taxpayers!: Array<TaxpayerDto>;
}
