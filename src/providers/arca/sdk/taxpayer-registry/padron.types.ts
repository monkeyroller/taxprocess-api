import type {
    TaxpayerDetail,
    TaxpayerPersonType,
    TaxpayerRegistrationStatus,
} from '../../../provider/taxpayer-vocabulary/taxpayer-vocabulary.js';

/**
 * Shared value types for the ARCA padrón services. Deliberately not the SOAP field names, which differ
 * between the two live services — constancia's grouped blocks against A13's flat `persona`. Each service
 * parses its own response into this one shape, so the provider maps a single structure to the wire DTO.
 */

/**
 * The ARCA padrón services this SDK knows. `CONSTANCIA` is the ex-`ws_sr_padron_a5` service.
 *
 * Alcances 4 and 10 are absent: A4's tax situation and A10's summarized data are both subsets of what the
 * constancia service returns, so neither had a caller. Restore them from git if a future alcance reports
 * something these two do not.
 */
export type PadronService = 'CONSTANCIA' | 'A13';

/**
 * Which kind of answer a padrón service produces, carried on the result so a caller knows which fields could
 * be populated. The two live services are complementary rather than nested: constancia has the tax picture
 * but no identity document, A13 the document, birth date and legal form but no taxes.
 *
 * The three below are the neutral vocabularies under an ARCA-local name rather than copies: the provider
 * hands these values straight to the wire DTO.
 */
export type PadronDetail = TaxpayerDetail;

export type PersonType = TaxpayerPersonType;

export type RegistrationStatus = TaxpayerRegistrationStatus;

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
 * One taxpayer as returned by a padrón service. Optional members are `undefined` when the authority did not
 * return them; `addresses` and `activities` are always arrays, and `taxes` is present only for
 * `REGISTRATION`, the one detail that can report them.
 *
 * `providerMetadata` carries ARCA-only data with no cross-country meaning, so the neutral contract never has
 * to grow a field for it.
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
