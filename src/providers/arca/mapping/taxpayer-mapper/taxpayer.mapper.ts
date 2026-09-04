import {
    AR_CITY_CODE_SCHEME,
    AR_CITY_CODE_SCHEME_VERSION,
    AR_COUNTRY_CODE,
    AR_COUNTRY_CODE_SCHEME,
    AR_REGION_CODE_SCHEME,
    provinceByArcaId,
    resolveIndecLocality,
} from '../geography/geography.js';
import {deriveFiscalConditionCode} from '../fiscal-condition/fiscal-condition.js';
import {identificationTypeForClaveKind} from '../padron-routing/padron-routing.js';
import type {PadronAddress, TaxpayerData} from '../../sdk/taxpayer-registry/padron.types.js';
import type {
    TaxpayerActivityDto,
    TaxpayerAddressDto,
    TaxpayerDto,
    TaxpayerResultDto,
    TaxpayerTaxDto,
} from '../../../../http/dto/taxpayer-result.dto.js';

/**
 * SDK padrón data → the neutral taxpayer DTOs. Optional scalars stay `undefined`, which `res.json` drops, so
 * a key is omitted rather than sent as `null`; `addresses` and `activities` are always arrays, and `taxes` is
 * present exactly when the answering registry can report taxes.
 */

/**
 * ARCA's address, with each geographic level carrying a code and the standard that code belongs to.
 *
 * `regionCode` means two different things either side of this function: on the SDK's address it is ARCA's own
 * `idProvincia`, and on the wire it is the ISO 3166-2 subdivision. A translation rather than a passthrough,
 * since ARCA's catalog id never reaches a caller.
 *
 * ARCA's own names do travel, as the fallback for a level that did not resolve. Each scheme is set only
 * alongside its resolved code: a scheme naming a code that is not there is noise a caller would have to
 * defend against, and the version dates the code, so an address that resolved to none has nothing to date.
 */
function toNeutralAddress(address: PadronAddress): TaxpayerAddressDto {
    const province = provinceByArcaId(address.regionCode);
    const cityCode = resolveIndecLocality(province, address.city);

    return {
        street: address.street,
        postalCode: address.postalCode,
        city: address.city,
        region: address.region,
        countryCode: AR_COUNTRY_CODE,
        countryCodeScheme: AR_COUNTRY_CODE_SCHEME,
        regionCode: province?.iso,
        regionCodeScheme: province === undefined ? undefined : AR_REGION_CODE_SCHEME,
        cityCode,
        cityCodeScheme: cityCode === undefined ? undefined : AR_CITY_CODE_SCHEME,
        cityCodeSchemeVersion: cityCode === undefined ? undefined : AR_CITY_CODE_SCHEME_VERSION,
        kind: address.kind,
        status: address.status,
    };
}

export function toNeutralTaxpayer(data: TaxpayerData): TaxpayerDto {
    const activities: Array<TaxpayerActivityDto> = data.activities.map((activity) => ({
        code: activity.code,
        description: activity.description,
        period: activity.period,
        primary: activity.primary,
    }));
    const taxes: Array<TaxpayerTaxDto> | undefined = data.taxes?.map((tax) => ({
        code: tax.code,
        description: tax.description,
        period: tax.period,
        status: tax.status,
        reason: tax.reason,
    }));

    return {
        taxId: data.taxId,
        taxIdType: data.taxIdType,
        // The row's own identification pair. The type is omitted when ARCA reported no `tipoClave`, so the
        // pair never names a kind the registry did not state.
        identificationTypeCode: identificationTypeForClaveKind(data.taxIdType),
        identificationNumber: data.taxId,
        personType: data.personType,
        name: data.name,
        firstName: data.firstName,
        lastName: data.lastName,
        registrationStatus: data.registrationStatus,
        documentType: data.documentType,
        documentNumber: data.documentNumber,
        birthDate: data.birthDate,
        registrationDate: data.registrationDate,
        incorporationDate: data.incorporationDate,
        legalForm: data.legalForm,
        fiscalYearEndMonth: data.fiscalYearEndMonth,
        fiscalAddress: data.fiscalAddress === undefined ? undefined : toNeutralAddress(data.fiscalAddress),
        addresses: data.addresses.map(toNeutralAddress),
        activities,
        taxes,
        simplifiedRegimeCategory: data.simplifiedRegimeCategory,
        fiscalConditionCode: deriveFiscalConditionCode(data),
        providerMetadata: data.providerMetadata,
    };
}

/**
 * The lookup envelope. `detail` is read off the entries rather than passed in, being a property of the
 * registry that answered — every entry of one lookup comes from the same service. Never called with an empty
 * list: no match is a not-found.
 */
export function toNeutralTaxpayerResult(
    entityCode: string,
    taxpayers: ReadonlyArray<TaxpayerData>,
): TaxpayerResultDto {
    if (taxpayers.length === 0) {
        // Not a caller error: the provider turns "no match" into a not-found before reaching here, so an
        // empty list means that guard broke. Checked on `length` rather than the element, since
        // `noUncheckedIndexedAccess` is off and the compiler believes `taxpayers[0]` is always there.
        throw new Error('toNeutralTaxpayerResult needs at least one taxpayer — no match is a TaxpayerNotFoundError');
    }
    return {
        entityCode,
        detail: taxpayers[0].detail,
        taxpayers: taxpayers.map(toNeutralTaxpayer),
    };
}
