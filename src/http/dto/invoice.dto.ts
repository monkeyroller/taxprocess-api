import {Type} from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
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
import {
    Concept,
    NEUTRAL_INVOICE_CONCEPTS,
    type NeutralInvoiceConcept,
} from '../../providers/provider/neutral-invoice.js';
import {WEB_SERVICES, type WebService} from '../../providers/provider/web-service.js';
import {IsAuthorityDate} from './authority-date/authority-date.js';
import {
    InvoiceAssociatedVoucherDto,
    InvoiceExportDto,
    InvoiceItemDto,
    InvoiceOptionalDto,
} from './invoice-export/invoice-export.dto.js';

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
        const {lines, totals, items, export: exportBlock} = args.object as {
            lines?: Array<InvoiceLineDto>;
            totals?: InvoiceTotalsDto;
            items?: Array<InvoiceItemDto>;
            export?: InvoiceExportDto;
        };
        const lineAmount = (lines ?? []).some((l) => l.netAmount !== 0 || l.taxAmount !== 0);
        const headerAmount = [totals?.untaxed, totals?.exempt, totals?.perceptions].some(
            (amount) => amount !== undefined && amount !== 0,
        );
        // Item detail is the third channel, and the only one an export voucher uses: it is zero-rated, so it
        // declares no tax bases and carries its money per line instead. Without this, every export would
        // fail a check meant to catch an empty domestic one.
        //
        // Counted only on an export voucher, because it is the only one whose mapper reads `items`. A
        // domestic voucher's `ImpTotal` is derived from `lines` and `totals` alone (`invoice.mapper.ts`),
        // so accepting item money as its amount would let `{lines: [], items: [...]}` through to exactly
        // the `ImpTotal` of `0` this check exists to refuse — with the empty channel now harder to see.
        // `export` is the test rather than `webService` because the buyer block is what a caller sends and
        // `InvoiceNamesAReceiver` has already made it exactly one of the two.
        const itemAmount =
            present(exportBlock) && (items ?? []).some((item) => item.totalAmount !== 0);
        return lineAmount || headerAmount || itemAmount;
    }

    defaultMessage(args: ValidationArguments): string {
        const {export: exportBlock} = args.object as {export?: InvoiceExportDto};
        return present(exportBlock)
            ? 'invoice carries no amount — send at least one line with an amount, a non-zero totals entry, ' +
                  'or itemized detail'
            : 'invoice carries no amount — send at least one line with an amount, or a non-zero totals ' +
                  'entry. Itemized detail counts as an amount only on an export voucher, which is the one ' +
                  'this service reads items for';
    }
}

/**
 * Exactly one of `receiver` and `export` — never both, never neither.
 *
 * The two describe mutually exclusive documents. A domestic voucher identifies its buyer by an
 * identification type and number plus a fiscal condition; an export identifies it by free text plus a
 * customs destination, and has no equivalent of any of the three. Carrying both would leave the provider
 * choosing which document the caller meant.
 *
 * `concept` is deliberately *not* part of this rule. It says what the voucher bills, which both documents
 * have to answer, so it is required throughout — only which of its codes are valid narrows per document,
 * and that is the provider's call, needing the authority's voucher-type numbering.
 */
@ValidatorConstraint({name: 'invoiceNamesAReceiver'})
class InvoiceNamesAReceiver implements ValidatorConstraintInterface {
    validate(_value: unknown, args: ValidationArguments): boolean {
        const {receiver, export: exportBlock} = args.object as NeutralInvoiceDto;
        return present(receiver) !== present(exportBlock);
    }

    defaultMessage(args: ValidationArguments): string {
        const {receiver} = args.object as NeutralInvoiceDto;
        return present(receiver)
            ? 'send either receiver (a domestic voucher) or export (a foreign-trade voucher), not both'
            : 'invoice names no buyer — send receiver for a domestic voucher or export for a foreign-trade one';
    }
}

/**
 * A shipment can only accompany goods.
 *
 * Entity-agnostic in a way the export block's other rules are not: it reads `concept`, which is this
 * contract's own catalogue, rather than any authority code. A services export has nothing to ship, so a
 * permit on one is a caller mistake in any jurisdiction.
 *
 * Lives here rather than on `InvoiceExportDto` because a class-level validator sees only the object it is
 * attached to, and the two halves of the rule are on different objects: `concept` on the invoice, the
 * permits inside `export`. From the export block the concept is unreadable.
 */
@ValidatorConstraint({name: 'invoicePermitsAccompanyGoods'})
class InvoicePermitsAccompanyGoods implements ValidatorConstraintInterface {
    validate(_value: unknown, args: ValidationArguments): boolean {
        const {concept, export: exportBlock} = args.object as NeutralInvoiceDto;
        if (exportBlock === undefined || concept === Concept.GOODS) {
            return true;
        }
        return (exportBlock.shippingPermits ?? []).length === 0 && exportBlock.shippingPermitPresent !== true;
    }

    defaultMessage(): string {
        return (
            'a voucher that is not for goods has nothing to ship, so export.shippingPermits and ' +
            `export.shippingPermitPresent must be omitted — send concept ${String(Concept.GOODS)} if this ` +
            'voucher covers a shipment'
        );
    }
}

/**
 * Whether a field was actually sent. `null` counts as absent, matching `@IsOptional()`, which skips a
 * property's validators for `null` as well as `undefined`. Testing `=== undefined` alone let
 * `{"currencyIso": null}` pass the exactly-one check and reach the mapper as a `null` that died on
 * `.toUpperCase()`, turning a `400` into an opaque `500`.
 *
 * Takes `unknown` on purpose. The DTO types declare these properties non-nullable, so narrowing them would
 * make the `null` half look unreachable and invite its removal — but the value being tested came off a JSON
 * body, where it is only as typed as the caller made it.
 */
function present(value: unknown): boolean {
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
        return present(currencyCode) !== present(currencyIso);
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
    /**
     * Canonical code; the provider maps it to the entity's voucher-type code (AR: CbteTipo).
     *
     * Hosts `InvoiceNamesAReceiver` because the document type is what decides which buyer block applies,
     * and because a class-level check has to hang off a *required* property — `@IsOptional()` disables every
     * validator on its own property when the value is absent, so attaching it to `receiver` or `export`
     * would switch it off in the case it exists to catch.
     */
    @IsInt()
    @IsPositive()
    @Validate(InvoiceNamesAReceiver)
    documentTypeCode!: number;

    /**
     * Concept: 1 = goods, 2 = services, 3 = both.
     *
     * Required on every voucher. Which of its four codes are valid depends on the document — an export
     * cannot be `3` (goods and services) and a domestic voucher cannot be `4` (other) — and the provider
     * refuses the one its service cannot express, since deciding that needs the authority's own
     * voucher-type numbering.
     *
     * Also hosts `InvoicePermitsAccompanyGoods`, which needs both this and the `export` block to read.
     */
    @IsIn(NEUTRAL_INVOICE_CONCEPTS)
    @Validate(InvoicePermitsAccompanyGoods)
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

    /**
     * The buyer of a domestic voucher. Absent on an export, which carries `export` instead.
     *
     * No longer `@IsDefined`: the guard that used to catch a missing object now belongs to
     * `InvoiceNamesAReceiver`, which knows that absent is legitimate here only when `export` is present. The
     * original reason for the guard still holds — nested validation has nothing to validate on a missing
     * object, so it passes and the mapper reads a field off `undefined` — which is why exactly one of the
     * two is a hard requirement rather than a preference.
     */
    @IsOptional()
    @ValidateNested()
    @Type(() => InvoiceReceiverDto)
    receiver?: InvoiceReceiverDto;

    /**
     * The foreign-trade block. Its presence is what makes this an export voucher, and selects the authority
     * service that authorizes it.
     */
    @IsOptional()
    @ValidateNested()
    @Type(() => InvoiceExportDto)
    export?: InvoiceExportDto;


    /**
     * Which of the entity's web services should authorize this voucher (its `configuration.webService`).
     *
     * Omitted is the entity's ordinary service. Only the caller can settle what a document type cannot: an
     * entity may have two services issuing the same types, distinguished only by whether the voucher carries
     * item detail. Naming a service that contradicts `documentTypeCode` is a `400` rather than a silent
     * choice.
     */
    @IsOptional()
    @IsIn(WEB_SERVICES)
    webService?: WebService;

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

    /**
     * Per-product detail, for the services that invoice with it — an export voucher, and factura electrónica
     * con detalle when it lands.
     *
     * Not the same thing as `lines`, which is a *tax subtotal*. An export is zero-rated, so it declares no
     * tax bases at all and sends `lines: []` with its money here instead.
     */
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({each: true})
    @Type(() => InvoiceItemDto)
    items?: Array<InvoiceItemDto>;

    /** Vouchers this one references — the invoice a credit or debit note adjusts. */
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({each: true})
    @Type(() => InvoiceAssociatedVoucherDto)
    associatedVouchers?: Array<InvoiceAssociatedVoucherDto>;

    /** Optional data fields the authority defines by regulation. */
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({each: true})
    @Type(() => InvoiceOptionalDto)
    optionals?: Array<InvoiceOptionalDto>;

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
