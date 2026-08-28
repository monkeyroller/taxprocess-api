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
import {identificationTypeForClaveKind} from '../code-maps/code-maps.js';
import type {PadronAddress, TaxpayerData} from '../../sdk/index.js';
import type {
    TaxpayerActivityDto,
    TaxpayerAddressDto,
    TaxpayerDto,
    TaxpayerResultDto,
    TaxpayerTaxDto,
} from '../../../../http/dto/neutral-result.dto.js';

/**
 * SDK padrón data → the neutral taxpayer DTOs.
 *
 * The SDK already speaks English and normalizes the two padrón response shapes into one, so this is a
 * thin, deliberate copy rather than a translation: keeping it explicit is what guarantees the wire only
 * ever carries fields the contract documents, instead of whatever a future SDK field happens to be named.
 *
 * Absence follows the contract's rule (see `TaxpayerDto`): optional scalars stay `undefined` — `res.json`
 * drops them, so the key is omitted rather than sent as `null` — while `addresses`/`activities` are always
 * arrays, and `taxes` is present exactly when the answering registry can report taxes at all.
 */

/**
 * ARCA's address, with each geographic level carrying a code and the standard that code belongs to.
 *
 * **`regionCode` means two different things either side of this function**, which is the one line here
 * worth reading twice: on the SDK's `PadronAddress` it is ARCA's own `idProvincia` (`"3"` = Córdoba), and
 * on the wire it is the ISO 3166-2 subdivision (`"AR-X"`). This is a translation, not a passthrough —
 * ARCA's catalog id deliberately never reaches a caller (CONTRACT §9), so `province.iso` is what goes out.
 *
 * ARCA's `region`/`city` names DO travel, as the fallback for a level that did not resolve. Each scheme is
 * set only alongside its own resolved code, never on its own: a scheme naming a code that is not there is
 * noise a caller would have to defend against. `cityCodeSchemeVersion` is guarded on the same condition for
 * the same reason — it dates the code, so an address that resolved to none has nothing to date.
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
        // The row's own identification pair. The number always mirrors `taxId`; the type is omitted when
        // ARCA reported no `tipoClave`, so the pair never names a kind the registry did not state.
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
 * The lookup envelope. `detail` is read off the entries rather than passed in, because it is a property
 * of the registry that answered — every entry of one lookup comes from the same service, so they agree by
 * construction. Never called with an empty list: no match is a `TaxpayerNotFoundError`.
 */
export function toNeutralTaxpayerResult(
    entityCode: string,
    taxpayers: ReadonlyArray<TaxpayerData>,
): TaxpayerResultDto {
    if (taxpayers.length === 0) {
        // Not a caller error, so not an `ArcaValidationError`: the provider turns "no match" into a
        // `TaxpayerNotFoundError` before reaching here, and an empty list means that guard broke. Saying so
        // beats reading `detail` off `undefined` and failing with a message that names neither the function
        // nor the invariant it kept. Checked on `length` rather than on the element, because
        // `noUncheckedIndexedAccess` is off — the compiler believes `taxpayers[0]` is always there.
        throw new Error('toNeutralTaxpayerResult needs at least one taxpayer — no match is a TaxpayerNotFoundError');
    }
    return {
        entityCode,
        detail: taxpayers[0].detail,
        taxpayers: taxpayers.map(toNeutralTaxpayer),
    };
}
