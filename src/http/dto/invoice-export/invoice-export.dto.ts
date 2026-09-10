import {Transform, Type, type TransformFnParams} from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsEnum,
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
    InvoiceLineType,
    isNonProductLine,
} from '../../../providers/provider/invoice-line-type/invoice-line-type.js';
import {UnitOfMeasureCodeScheme} from '../../../providers/provider/unit-of-measure-scheme/unit-of-measure-scheme.js';
import {IsAuthorityDate} from '../authority-date/authority-date.js';

/**
 * The foreign-trade block: what an export voucher carries and a domestic one has no field for.
 *
 * **What is validated here, and what is not.** Only rules decidable from the payload *without knowing the
 * authority's own codes* live in this file. That line matters because contract §9 keeps an authority's
 * vocabulary inside its provider, and several of the export rules can only be expressed in it:
 *
 * - "the rate must be exactly 1 in the local currency" needs to know which code is local (AR: `PES`);
 * - "an incoterm is mandatory for a goods invoice" needs to know which type code is a Factura (AR: `19`);
 * - "a nota must reference an invoice" needs to know which document types are notas (AR: `20`, `21`).
 *
 * The first two are enforced in `export-invoice.mapper.ts`, where the entity's codes are already known and
 * which raises the same `400`. The third is the authority's: the cross-checks need the referenced voucher,
 * which this service does not hold. Encoding any of them here would put ARCA's numbers in the neutral HTTP
 * layer to save one round trip, and the next entity would inherit them.
 *
 * **"A discount line must carry a negative total" used to be on that list**, needing to know which unit
 * codes mean discount (AR: `97`, `99`). It is enforced here now, and nothing about the boundary moved: the
 * rule stopped needing an authority's numbering the moment `lineType` could name a discount line neutrally.
 * That is the shape to copy — a rule that reads as provider-specific is often a vocabulary that has not
 * been separated yet.
 */

/**
 * Trims a code before the validators measure it.
 *
 * **For a code the provider looks up in a catalogue, and only those.** `unitOfMeasureCode`,
 * `destinationCode`, `incoterm` and `clientCountryTaxId` each reach a normalizer that trims —
 * `normalizeRec20Code`, `normalizeDestinationCode`, `toIncoterms`, `toCountryTaxId` — so padding is already
 * tolerated by the layer that matches the value. Without this, a `@Length` bound equal to the code's own
 * width refuses `"KGM "` for being four characters: a length error for a whitespace mistake, raised a layer
 * *earlier* than the tolerance is written. Every bound in that group *is* the width — 3 for a Rec 20 code
 * and a `Dst_cmp`, 3 for an incoterm, 11 for a per-country CUIT — so none of them had any slack to hide
 * behind, which is why they are decorated rather than argued about one at a time.
 *
 * **Not for a value that travels verbatim**, which is why `permitId` and `clientTaxId` go without: nothing
 * normalizes either — the mapper and `fex-invoice.service.ts` hand both to ARCA exactly as sent — so there
 * is no tolerance here to contradict, and trimming would widen what the wire accepts on this side of a
 * field the authority judges on its own. The test is whether a provider normalizes the field, not whether
 * it looks like a code.
 *
 * `toClassOnly` because these are request DTOs — nothing serializes one back out, and a transform that ran
 * both ways would claim more than it means.
 *
 * Casing is deliberately not touched. Which spellings are the same code is the catalogue's question, and
 * this layer holds no catalogue — see `unitOfMeasureCode` below.
 */
function TrimmedCode(): PropertyDecorator {
    return Transform(
        ({value}: TransformFnParams): unknown => (typeof value === 'string' ? value.trim() : value),
        {toClassOnly: true},
    );
}

/** A customs shipping permit and the destination of the goods it covers. */
export class InvoiceShippingPermitDto {
    /** The authority's despacho code (AR: `Id_permiso`, format `99999AAXX999999A`). */
    @IsString()
    @Length(1, 16)
    permitId!: string;

    /** Where the goods are going, in the same catalogue as the voucher's own destination. */
    @TrimmedCode()
    @IsString()
    @Length(1, 3)
    destinationCode!: string;
}

/**
 * The buyer has to be identifiable.
 *
 * The authority wants at least one of the two (AR: 1580), and neither can be made unconditionally required:
 * `clientCountryTaxId` does not exist for every destination — AR publishes none at all for a special customs
 * area or a free zone — and `clientTaxId` is a foreign identifier a caller may not hold. So the rule is
 * "at least one", checked here because a voucher naming no buyer at all is decidable from the payload.
 */
@ValidatorConstraint({name: 'exportNamesTheBuyer'})
class ExportNamesTheBuyer implements ValidatorConstraintInterface {
    validate(_value: unknown, args: ValidationArguments): boolean {
        const {clientTaxId, clientCountryTaxId} = args.object as InvoiceExportDto;
        return present(clientTaxId) || present(clientCountryTaxId);
    }

    defaultMessage(): string {
        return (
            'export names no tax identification for the buyer — send clientTaxId (its own identifier in its ' +
            "own country) or clientCountryTaxId (the authority's generic per-country one)"
        );
    }
}

/** `null` counts as absent, matching `@IsOptional()`, which skips validators for `null` as well. */
function present(value: unknown): boolean {
    return value !== undefined && value !== null;
}

/**
 * What a line may carry, given what it says it is.
 *
 * **These rules used to live in the ARCA mapper**, and its comment said why: they could not be stated at all
 * without ARCA's numbering — "`99` is bonificación, `97` seña/anticipo, `0` no unit — which is why it lives
 * here rather than in the DTO, where those ids would be foreign vocabulary". With `lineType` naming the three
 * in the neutral vocabulary they are decidable from the payload alone, so by this file's own boundary rule
 * they belong here. Nothing about them is ARCA's; they follow from what the words mean.
 *
 * Membership of the Rec 20 catalogue is still *not* checked here — that is a catalogue the provider owns, and
 * an unknown or unsupported code is its `400`.
 */
@ValidatorConstraint({name: 'itemMatchesItsLineType'})
class ItemMatchesItsLineType implements ValidatorConstraintInterface {
    validate(_value: unknown, args: ValidationArguments): boolean {
        return failureOf(args.object as InvoiceItemDto) === null;
    }

    defaultMessage(args: ValidationArguments): string {
        return failureOf(args.object as InvoiceItemDto) ?? '';
    }
}

/** The one broken rule to report, or `null`. One function so the check and its message cannot disagree. */
function failureOf(item: InvoiceItemDto): string | null {
    const {lineType, unitOfMeasureCode, unitOfMeasureCodeScheme, quantity, unitPrice, discount, totalAmount} =
        item;
    if (!isNonProductLine(lineType)) {
        return present(unitOfMeasureCode)
            ? null
            : 'a product line is measured in something — send unitOfMeasureCode (a UN/ECE Rec 20 code), or ' +
                  'say what the line is instead with lineType';
    }
    // Neither the unit nor the catalogue it would have been drawn from says anything about a line that
    // measures nothing. Both stated here, because the provider's `assertUnitOfMeasureScheme` is only
    // reached on a product line — leaving the scheme to it would refuse one line shape and discard the
    // other for the same field.
    for (const [field, value] of [
        ['unitOfMeasureCode', unitOfMeasureCode],
        ['unitOfMeasureCodeScheme', unitOfMeasureCodeScheme],
    ] as const) {
        if (present(value)) {
            return `a ${lineType} line describes the line rather than goods, so it takes no ${field}`;
        }
    }
    // There is no quantity to price on a line that is not selling anything. An explicit zero passes: the
    // caller sent the field and set it to nothing, which is what the rule asks for. Tested through
    // `present`, so a `null` counts as absent here exactly as it does for `@IsOptional()` — a caller whose
    // serializer writes omitted optionals as `null` is not sending a quantity.
    for (const [field, value] of [
        ['quantity', quantity],
        ['unitPrice', unitPrice],
        ['discount', discount],
    ] as const) {
        if (present(value) && value !== 0) {
            return `${field} must be zero or absent on a ${lineType} line, which prices no quantity`;
        }
    }
    // A discount subtracts, which is what the word means. A deposit is unrestricted and may be either.
    if (lineType === InvoiceLineType.DISCOUNT && totalAmount >= 0) {
        return 'totalAmount must be negative on a DISCOUNT line';
    }
    return null;
}

export class InvoiceExportDto {
    /**
     * Where the voucher is destined, as the authority's own customs-destination code (AR: `Dst_cmp`).
     *
     * A canonical fiscal code rather than ISO 3166-1, because the catalogue lists customs *destinations* and
     * ISO cannot express it: a free zone is a destination distinct from the country containing it, some
     * codes aggregate several countries, and others are catch-alls. The code for an Argentine special
     * customs area — the Tierra del Fuego case — is one of the unmappable ones.
     */
    @TrimmedCode()
    @IsString()
    @Length(1, 3)
    destinationCode!: string;

    /** Whether a customs shipping permit exists yet (AR: `Permiso_existente`). */
    @IsOptional()
    @IsBoolean()
    shippingPermitPresent?: boolean;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({each: true})
    @Type(() => InvoiceShippingPermitDto)
    shippingPermits?: Array<InvoiceShippingPermitDto>;

    /**
     * The buyer's name or business name.
     *
     * Hosts two class-level checks, because a class-level constraint has to hang off a *required* property:
     * `@IsOptional()` disables every validator on its own property when the value is absent, which would
     * switch these off in exactly the cases they exist to catch.
     */
    @IsString()
    @MinLength(1)
    @Length(1, 200)
    @Validate(ExportNamesTheBuyer)
    clientName!: string;

    @IsString()
    @MinLength(1)
    @Length(1, 300)
    clientAddress!: string;

    /** The buyer's own tax identification in its own country (AR: `Id_impositivo`). */
    @IsOptional()
    @IsString()
    @Length(1, 50)
    clientTaxId?: string;

    /**
     * The authority's generic per-country tax id for the buyer (AR: `Cuit_pais_cliente`).
     *
     * Sent, never derived. The authority publishes no key joining these to its destination codes — AR's own
     * two tables share no identifier, and the value is not computable from the destination — so the caller
     * picks one from the published catalogue (§5) and the provider checks it against that set. The catalogue
     * carries a country and an entity type per code, which is what a picker selects on.
     */
    @IsOptional()
    @TrimmedCode()
    @IsString()
    @Length(1, 11)
    clientCountryTaxId?: string;

    /**
     * The ICC Incoterms clause (e.g. `"CIF"`, `"FOB"`, `"DAP"`).
     *
     * An international standard that covers its whole domain, so it travels as itself with no mapping table —
     * unlike the destination and unit codes. The provider checks it against the clauses the entity publishes.
     */
    @IsOptional()
    @TrimmedCode()
    @IsString()
    @Length(3, 3)
    incoterm?: string;

    @IsOptional()
    @IsString()
    @Length(1, 20)
    incotermDescription?: string;

    /** The language the document is written in, as ISO 639-1. */
    @IsIn(['es', 'en', 'pt'])
    language!: 'es' | 'en' | 'pt';

    /** The voucher is settled in its own foreign currency (AR: `CanMisMonExt`). */
    @IsOptional()
    @IsBoolean()
    settledInInvoiceCurrency?: boolean;

    /** How payment is made, in free text (AR: `Forma_pago`). */
    @IsOptional()
    @IsString()
    @Length(1, 50)
    paymentTerms?: string;

    @IsOptional()
    @IsString()
    @Length(1, 4000)
    commercialObservations?: string;

    @IsOptional()
    @IsString()
    @Length(1, 1000)
    observations?: string;

    /**
     * When payment is due (AR: `Fecha_pago`).
     *
     * Required by AR for a services or other export invoice, and forbidden on a nota. Both conditions are
     * the provider's, needing the entity's own type codes to state them: the required half is a `400`, and
     * the forbidden half is a silent drop, because there an empty element is itself the rejection.
     */
    @IsOptional()
    @IsAuthorityDate()
    paymentDate?: string;
}

/** One line of product detail. */
export class InvoiceItemDto {
    @IsOptional()
    @IsString()
    @Length(1, 50)
    code?: string;

    /**
     * Hosts the line-shape check, because a class-level constraint has to hang off a *required* property —
     * `@IsOptional()` disables every validator on its own property, which would switch this off in exactly
     * the cases it exists to catch.
     */
    @IsString()
    @MinLength(1)
    @Length(1, 4000)
    @Validate(ItemMatchesItsLineType)
    description!: string;

    @IsOptional()
    @IsNumber()
    quantity?: number;

    /**
     * What this line is. Absent means an ordinary product line.
     *
     * A neutral vocabulary rather than an authority's code, and a field of its own rather than a value of
     * `unitOfMeasureCode`, because a discount is not a unit of measure. An authority that says both through
     * one field — AR reserves `Pro_umed` `0`, `97` and `99` — is the provider's problem to map.
     */
    @IsOptional()
    @IsEnum(InvoiceLineType)
    lineType?: InvoiceLineType;

    /**
     * The unit's UN/ECE Recommendation 20 common code (`"KGM"`, `"C62"`, `"ZZ"`).
     *
     * Required on a product line and forbidden on any other — see {@link ItemMatchesItsLineType}, which is
     * where the conditional half is stated, since `@IsOptional()` cannot say "required unless".
     *
     * Membership is deliberately unchecked here: the catalogue belongs to the provider, which knows both
     * whether the code exists and whether *this entity* can express it — two different refusals that this
     * layer could not tell apart.
     *
     * {@link TrimmedCode} because `@Length(1, 3)` would otherwise refuse `"KGM "` for its length and never
     * mention the padding, ahead of the provider's `normalizeRec20Code`, whose whole job is that a
     * hand-typed body arrives raw. Casing is left to the provider: it is what matches the code against the
     * catalogue, and this layer holds none to match against.
     */
    @IsOptional()
    @TrimmedCode()
    @IsString()
    @Length(1, 3)
    unitOfMeasureCode?: string;

    /** Which catalogue {@link unitOfMeasureCode} was drawn from. Absent means UN/ECE Rec 20. */
    @IsOptional()
    @IsEnum(UnitOfMeasureCodeScheme)
    unitOfMeasureCodeScheme?: UnitOfMeasureCodeScheme;

    @IsOptional()
    @IsNumber()
    unitPrice?: number;

    @IsOptional()
    @IsNumber()
    discount?: number;

    /**
     * The line's total.
     *
     * Deliberately unbounded in sign: a discount or adjustment line is legitimately negative, and which unit
     * codes permit that is the entity's rule rather than this contract's.
     */
    @IsNumber()
    totalAmount!: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    taxRatePercent?: number;

    @IsOptional()
    @IsNumber()
    taxAmount?: number;
}

/** A voucher this one references — the invoice a credit or debit note adjusts. */
export class InvoiceAssociatedVoucherDto {
    @IsInt()
    @IsPositive()
    documentTypeCode!: number;

    @IsInt()
    @IsPositive()
    pointOfSaleNumber!: number;

    @IsInt()
    @IsPositive()
    number!: number;

    /** The issuer of the referenced voucher, when it is not the issuer of this one. */
    @IsOptional()
    @IsString()
    @MinLength(1)
    issuerTaxId?: string;
}

/** An optional data field the authority defines by regulation (AR: `Opcionales`). */
export class InvoiceOptionalDto {
    @IsString()
    @MinLength(1)
    id!: string;

    @IsString()
    value!: string;
}
