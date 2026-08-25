import type {PadronAddress, TaxpayerData} from './sdk/index.js';
import type {
    TaxpayerActivityDto,
    TaxpayerAddressDto,
    TaxpayerDto,
    TaxpayerResultDto,
    TaxpayerTaxDto,
} from '../../http/dto/neutral-result.dto.js';

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

function toNeutralAddress(address: PadronAddress): TaxpayerAddressDto {
    return {
        street: address.street,
        city: address.city,
        postalCode: address.postalCode,
        region: address.region,
        regionCode: address.regionCode,
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
