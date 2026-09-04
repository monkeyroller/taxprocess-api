import {Type} from 'class-transformer';
import {
    IsArray,
    IsDefined,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Length,
    Min,
    MinLength,
    Validate,
    ValidateNested,
    ValidatorConstraint,
    type ValidationArguments,
    type ValidatorConstraintInterface,
} from 'class-validator';
import {NEUTRAL_INVOICE_CONCEPTS, type NeutralInvoiceConcept} from '../../providers/provider/neutral-invoice.js';
import {IsAuthorityDate} from './authority-date/authority-date.js';

/**
 * The request carries provider-agnostic canonical codes. The provider maps these to the tax entity's real
 * codes and owns the mechanical translation of currency, tax rates, totals, dates and QR.
 */

/** One taxed line: net (base) + tax amount at a given rate. */
export class InvoiceLineDto {
    @IsNumber()
    netAmount!: number;

    /** Tax rate as a percentage (e.g. 21, 10.5, 0). */
    @IsNumber()
    @Min(0)
    taxRatePercent!: number;

    @IsNumber()
    @Min(0)
    taxAmount!: number;
}

/** The invoice receiver, identified by a per-entity identification type + number. */
export class InvoiceReceiverDto {
    /** Canonical code; the provider maps it to the entity's document-type code (AR: DocTipo). */
    @IsInt()
    @Min(0)
    identificationTypeCode!: number;

    /** The receiver's identification number (digits as a string; `"0"` for an anonymous receiver). */
    @IsString()
    @MinLength(1)
    identificationNumber!: string;

    /** Canonical code; the provider maps it to the entity's own (AR: CondicionIVAReceptorId). */
    @IsInt()
    @IsPositive()
    fiscalConditionCode!: number;
}

/** Optional invoice-level totals not derivable from the taxed lines. */
export class InvoiceTotalsDto {
    /** Net not subject to tax (AR: `ImpTotConc`). */
    @IsOptional()
    @IsNumber()
    @Min(0)
    untaxed?: number;

    /** Exempt amount (AR: `ImpOpEx`). */
    @IsOptional()
    @IsNumber()
    @Min(0)
    exempt?: number;

    /** Total perceptions/other tributes (AR: `ImpTrib`), reported as a single "Otros" tribute. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    perceptions?: number;
}

/**
 * A voucher has to bill something. Once an empty `lines` became a legitimate shape — a zero-rated issuer
 * carries its money in `totals` — nothing guaranteed that any more, and `{lines: [], totals: undefined}`
 * validated cleanly into an `ImpTotal` of `0`, costing a WSAA login and a round trip.
 *
 * Either channel alone is a valid invoice. Deliberately a presence check rather than an arithmetic audit:
 * reconciling the amounts is the authority's job.
 */
@ValidatorConstraint({name: 'invoiceCarriesAmount'})
class InvoiceCarriesAmount implements ValidatorConstraintInterface {
    validate(_value: unknown, args: ValidationArguments): boolean {
        const {lines, totals} = args.object as {lines?: Array<InvoiceLineDto>; totals?: InvoiceTotalsDto};
        const lineAmount = (lines ?? []).some((l) => l.netAmount !== 0 || l.taxAmount !== 0);
        const headerAmount = [totals?.untaxed, totals?.exempt, totals?.perceptions].some(
            (amount) => amount !== undefined && amount !== 0,
        );
        return lineAmount || headerAmount;
    }

    defaultMessage(): string {
        return 'invoice carries no amount — send at least one line with an amount, or a non-zero totals entry';
    }
}

/**
 * Whether a currency field was actually sent. `null` counts as absent, matching `@IsOptional()`, which skips
 * a property's validators for `null` as well as `undefined`. Testing `=== undefined` alone let
 * `{"currencyIso": null}` pass the exactly-one check and reach the mapper as a `null` that died on
 * `.toUpperCase()`, turning a `400` into an opaque `500`.
 */
function namesCurrency(value: unknown): boolean {
    return value !== undefined && value !== null;
}

/**
 * Exactly one of `currencyCode` and `currencyIso` — never both, never neither.
 *
 * Exactly-one-of rather than prefer-`currencyCode`, because silently preferring one would let a caller bug
 * send `{currencyIso: "USD", currencyCode: "PES"}` and produce a peso voucher for a dollar sale. Neither is
 * a `400` too: `currencyIso` used to be required, and relaxing it without this check would let a caller that
 * forgot the field declare nothing, leaving the mapper to invent a currency.
 *
 * The additive half of a two-step migration; this class goes with `currencyIso`.
 */
@ValidatorConstraint({name: 'invoiceNamesOneCurrency'})
class InvoiceNamesOneCurrency implements ValidatorConstraintInterface {
    validate(_value: unknown, args: ValidationArguments): boolean {
        const {currencyCode, currencyIso} = args.object as {
            currencyCode?: unknown;
            currencyIso?: unknown;
        };
        return namesCurrency(currencyCode) !== namesCurrency(currencyIso);
    }

    defaultMessage(): string {
        return (
            'send exactly one of currencyCode (the authority\'s own code, e.g. "DOL") or the deprecated ' +
            'currencyIso (e.g. "USD") — sending both is ambiguous and sending neither leaves the ' +
            'voucher without a currency'
        );
    }
}

/** A neutral invoice carrying core's generic ids. */
export class NeutralInvoiceDto {
    /** Canonical code; the provider maps it to the entity's voucher-type code (AR: CbteTipo). */
    @IsInt()
    @IsPositive()
    documentTypeCode!: number;

    /** Concept: 1 = goods, 2 = services, 3 = both. */
    @IsIn(NEUTRAL_INVOICE_CONCEPTS)
    concept!: NeutralInvoiceConcept;

    @IsInt()
    @IsPositive()
    pointOfSaleNumber!: number;

    /** Exact voucher number to authorize (WSFEv1 CbteDesde). Required — core owns the number. */
    @IsInt()
    @IsPositive()
    voucherNumberFrom!: number;

    /** Exact voucher number to authorize (WSFEv1 CbteHasta). Single-voucher flow: equals voucherNumberFrom. */
    @IsInt()
    @IsPositive()
    voucherNumberTo!: number;

    // `@IsDefined` alongside `@ValidateNested`: nested validation has nothing to validate on a missing
    // object, so it passes, and the mapper then reads a field off `undefined` — a `500` for an incomplete
    // body. `lines` needs no such guard, its `@IsArray()` already rejecting an absent one.
    @IsDefined()
    @ValidateNested()
    @Type(() => InvoiceReceiverDto)
    receiver!: InvoiceReceiverDto;

    /**
     * The authority's own currency code (AR: `MonId` — `"PES"`, `"DOL"`, `"060"`). The fourth canonical
     * fiscal code, identity-mapped like the other three.
     *
     * `@Length(1, 8)` rather than a fixed three: `002` and `060` are zero-padded and the padding is part of
     * the code, and ARCA itself types `MonId` as `String(8)` on the cotización response against `String(3)`
     * in the catalogue — so no future entity is assumed to code currencies in three characters.
     *
     * Optional only during the migration window.
     */
    @IsOptional()
    @IsString()
    @Length(1, 8)
    currencyCode?: string;

    /**
     * ISO-4217 currency (e.g. `ARS`, `USD`); mapped to the entity's currency code by the provider.
     *
     * @deprecated Superseded by `currencyCode`. ISO cannot express an authority's catalogue: ARCA's `DOL` and
     * `002` (the blue) are both `USD` at different published rates, so a caller pricing at the blue silently
     * declared the official code, and `049` (Gramos de Oro Fino) has no ISO code at all.
     */
    @IsOptional()
    @IsString()
    @Length(3, 3)
    currencyIso?: string;

    /**
     * Exchange rate to the local currency (1 for the local currency itself).
     *
     * Hosts `InvoiceNamesOneCurrency` because a class-level check has to hang off a required property:
     * `@IsOptional()` skips every validator on its own property when the value is absent, so attaching it to
     * either currency field would disable it in the cases it exists to catch. This field is also its natural
     * partner, a rate with no currency naming nothing.
     */
    @IsNumber()
    @IsPositive()
    @Validate(InvoiceNamesOneCurrency)
    currencyRate!: number;

    /**
     * The day the voucher is issued on — a calendar day in the authority's own calendar, or an instant
     * carrying a UTC offset. This becomes AR's `CbteFch`, the voucher's legal date, which is why a zoneless
     * datetime is refused rather than resolved against whatever `TZ` this service runs under.
     */
    @IsAuthorityDate()
    issueDate!: string;

    /**
     * The lines inside the VAT system — each a base plus the tax charged on it. A rate of `0` belongs here
     * and is not `totals.untaxed`: it is a base the entity taxes at zero and wants declared as such (AR: its
     * own alícuota id). Money outside the VAT system travels in `totals`.
     *
     * An empty array is meaningful rather than a mistake: an issuer who levies no VAT at all has no bases to
     * declare, and its vouchers must report no `Iva` element. What is not allowed is an invoice with no money
     * in either channel, which `InvoiceCarriesAmount` catches.
     */
    @IsArray()
    @ValidateNested({each: true})
    @Type(() => InvoiceLineDto)
    @Validate(InvoiceCarriesAmount)
    lines!: Array<InvoiceLineDto>;

    @IsOptional()
    @ValidateNested()
    @Type(() => InvoiceTotalsDto)
    totals?: InvoiceTotalsDto;

    /** Authority calendar day — required by the entity when concept is 2 or 3 (AR: `FchServDesde`). */
    @IsOptional()
    @IsAuthorityDate()
    serviceDateFrom?: string;

    /** Authority calendar day — required by the entity when concept is 2 or 3 (AR: `FchServHasta`). */
    @IsOptional()
    @IsAuthorityDate()
    serviceDateTo?: string;

    /** Authority calendar day — required by the entity when concept is 2 or 3 (AR: `FchVtoPago`). */
    @IsOptional()
    @IsAuthorityDate()
    paymentDueDate?: string;
}
