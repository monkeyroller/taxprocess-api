// Type-only, so `provider/neutral-results.ts` importing this DTO back stays a compile-time relationship.
import type {AddressCodeScheme} from '../../providers/provider/address-code-scheme/address-code-scheme.js';
import type {
    TaxpayerDetail,
    TaxpayerPersonType,
    TaxpayerRegistrationStatus,
} from '../../providers/provider/taxpayer-vocabulary/taxpayer-vocabulary.js';

/**
 * A declared address. `kind`/`status` are the authority's own wording (AR: tipo/estado de domicilio).
 *
 * Every geographic level reads the same way: a name from the authority, a code, and the standard that code
 * belongs to. Resolve a level by matching the code and scheme together — a code means nothing without the
 * scheme naming the catalog it was drawn from, since `"AR"` is an ISO 3166-1 country here but indexes
 * something else in another coding system.
 *
 * A scheme is present exactly when its code is, never alone, and each pair follows that rule independently.
 * So a partially-coded address is normal rather than a fault: read the codes when present, and fall back to
 * the authority's own name when a level did not resolve.
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
     * states internally; the authority's own catalog id is not on the wire, being meaningless to anyone but
     * that authority.
     */
    regionCode?: string;
    regionCodeScheme?: AddressCodeScheme;

    /**
     * The locality as a code (AR: INDEC's 8-digit localidad censal code — provincia 2 + departamento 3 +
     * localidad 3, e.g. `"14014010"` for the city of Córdoba).
     *
     * Emitted only where the locality resolves unambiguously. It is absent with no substitute when the
     * authority's free-text locality names a place the national catalog does not code — for AR, most often a
     * barrio of an interior city. `city` still carries the authority's text in that case.
     */
    cityCode?: string;
    cityCodeScheme?: AddressCodeScheme;

    /**
     * Which snapshot of the coding system's catalog `cityCode` was drawn from, as an ISO date (AR: the day
     * georef-ar was read for the vendored INDEC index). Present exactly when `cityCode` is.
     *
     * Diagnostic only, for one situation: a caller resolving the code against its own copy of the same
     * catalog gets nothing back both for a code minted from a newer snapshot than its own and for one it
     * simply does not carry. Those need opposite responses — re-seed versus accept — and the version is what
     * separates them.
     *
     * Never match on it, and never reject a code for carrying an unfamiliar one.
     */
    cityCodeSchemeVersion?: string;

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
 * One taxpayer as the registry holds them. Which keys can appear depends on the result's `detail`, under
 * three rules:
 *
 * - `taxId`, `addresses`, `activities` and `providerMetadata` are always present.
 * - Arrays the detail covers are always present, `[]` when the authority reports none, so "none registered"
 *   is distinguishable from "this detail cannot report it". `taxes` therefore appears on every
 *   `REGISTRATION` result and on no `IDENTITY` result.
 * - Optional scalars are omitted rather than `null` when the authority did not return them.
 */
export class TaxpayerDto {
    /** The taxpayer's tax identifier (AR: CUIT/CUIL/CDI). Always present. */
    taxId!: string;

    /** Kind of tax identifier the authority holds (AR: tipoClave — `"CUIT"`, `"CUIL"`, `"CDI"`). */
    taxIdType?: string;

    /**
     * The same identification pair a lookup request and an invoice receiver carry, echoed so each row is
     * self-describing. This matters on a document lookup: one DNI commonly matches several taxpayers, each
     * keyed by a different clave than the one searched by, so a customer built from a row must be identified
     * by the row's own id rather than by the document the operator typed.
     *
     * `identificationNumber` repeats `taxId` and is always present. `identificationTypeCode` is the canonical
     * code behind `taxIdType` (AR: 80 CUIT / 86 CUIL / 87 CDI) and is omitted when the authority stated no
     * kind, so the pair never asserts a type the registry did not report.
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
     * The taxpayer's VAT/fiscal condition, in the same canonical code space as
     * `invoice.receiver.fiscalConditionCode` (AR: RG 5616 — 1 Responsable Inscripto, 4 Sujeto Exento,
     * 6 Monotributo, 15 IVA no alcanzado), so the condition a lookup reports is the one that will later ride
     * the invoice for that customer.
     *
     * Derived by the provider from the registry's own tax vocabulary, and omitted whenever the registry gives
     * no basis for one: on every `IDENTITY` result, for a taxpayer with no VAT-relevant registration, and
     * where the registrations on file contradict each other. Absence means "not reported", never "Consumidor
     * Final" — a caller should let the user choose rather than default.
     */
    fiscalConditionCode?: number;

    /**
     * Entity-specific extras with no cross-country meaning, passed through opaquely. Always present, at
     * minimum naming the authority service that answered. For ARCA: caracterizaciones, sucesión and
     * fallecimiento markers, dependencia, regímenes, autónomos categories, and the per-block constancia
     * errors.
     */
    providerMetadata!: Record<string, unknown>;
}

/**
 * Result of `POST /taxpayers/lookup`. Always a list: an identity-document lookup can legitimately match
 * several taxpayers, since one document commonly carries both a CUIL and a CUIT, while a tax-id lookup
 * returns exactly one. Never empty on a `200` — no match is a `404`.
 */
export class TaxpayerResultDto {
    /** Echoes the entity that answered, so a result is self-describing once detached from its request. */
    entityCode!: string;

    /** Which registry answered, and therefore which fields of `taxpayers[]` can be populated. */
    detail!: TaxpayerDetail;

    taxpayers!: Array<TaxpayerDto>;
}
