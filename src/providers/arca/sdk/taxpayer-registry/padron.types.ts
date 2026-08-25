/**
 * Shared value types for the ARCA padrón ("consulta de persona") services.
 *
 * These are the SDK's own English shapes — deliberately NOT the SOAP field names, which differ between
 * the two live services (constancia's `datosGenerales`/`datosRegimenGeneral` groups vs A13's flat
 * `persona`). Each service parses its own response into this one shape so the provider maps a single
 * structure to the neutral wire DTO.
 */

/**
 * The ARCA padrón services this SDK knows. `CONSTANCIA` is the ex-`ws_sr_padron_a5` service.
 *
 * Alcances 4 and 10 are deliberately absent. Both existed here as parse-less seeds until 2026-08-21 and were
 * removed once the two live services landed: A4's tax situation and A10's summarized data are both subsets of
 * what the constancia service already returns, so neither had a caller or a route to reach it by. Restore
 * them from git if a future alcance genuinely reports something these two do not.
 */
export type PadronService = 'CONSTANCIA' | 'A13';

/**
 * Which *kind* of answer a padrón service produces — carried on the result so a caller knows which
 * fields could be populated at all. The two live services are complementary, not nested:
 * `REGISTRATION` (constancia) has the tax picture but no identity document; `IDENTITY` (A13) has the
 * document, birth date and legal form but no taxes.
 */
export type PadronDetail = 'REGISTRATION' | 'IDENTITY';

export type PersonType = 'INDIVIDUAL' | 'LEGAL_ENTITY';

export type RegistrationStatus = 'ACTIVE' | 'INACTIVE';

/** A declared address. `kind`/`status` are ARCA's `tipoDomicilio`/`estadoDomicilio` verbatim. */
export interface PadronAddress {
    street?: string;
    city?: string;
    postalCode?: string;
    /** Province/state name (ARCA `descripcionProvincia`). */
    region?: string;
    /** Province/state code (ARCA `idProvincia`). */
    regionCode?: string;
    kind?: string;
    status?: string;
}

/** An economic activity. `period` is an ISO-8601 year-month (`2014-09`); `primary` mirrors `orden === 1`. */
export interface PadronActivity {
    code: string;
    description?: string;
    period?: string;
    primary?: boolean;
}

/** A registered tax. `status` is ARCA's `estadoImpuesto` code, `reason` its `motivo` text. */
export interface PadronTax {
    code: string;
    description?: string;
    period?: string;
    status?: string;
    reason?: string;
}

/**
 * One taxpayer as returned by a padrón service. Optional members are `undefined` when the authority did
 * not return them; `addresses`/`activities` are always arrays (empty when none), and `taxes` is present
 * only for `REGISTRATION` — the detail that can report them at all.
 *
 * `providerMetadata` carries ARCA-only data with no cross-country meaning (caracterizaciones, sucesión
 * flags, dependencia, regímenes, the per-block constancia errors) so the neutral contract never has to
 * grow a field for it.
 */
export interface TaxpayerData {
    detail: PadronDetail;
    taxId: string;
    taxIdType?: string;
    personType?: PersonType;
    name?: string;
    firstName?: string;
    lastName?: string;
    registrationStatus?: RegistrationStatus;
    documentType?: string;
    documentNumber?: string;
    birthDate?: string;
    registrationDate?: string;
    legalForm?: string;
    incorporationDate?: string;
    fiscalYearEndMonth?: number;
    fiscalAddress?: PadronAddress;
    addresses: Array<PadronAddress>;
    activities: Array<PadronActivity>;
    taxes?: Array<PadronTax>;
    simplifiedRegimeCategory?: string;
    providerMetadata: Record<string, unknown>;
}
