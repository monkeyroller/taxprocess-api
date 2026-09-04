import {Type} from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
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
import {IsAuthorityDate} from '../authority-date/authority-date.js';

/**
 * The foreign-trade block: what an export voucher carries and a domestic one has no field for.
 *
 * **What is validated here, and what is not.** Only rules decidable from the payload *without knowing the
 * authority's own codes* live in this file. That line matters because contract §9 keeps an authority's
 * vocabulary inside its provider, and several of the export rules can only be expressed in it:
 *
 * - "the rate must be exactly 1 in the local currency" needs to know which code is local (AR: `PES`);
 * - "a discount line must carry a negative total" needs to know which unit codes mean discount (AR: `97`,
 *   `99`);
 * - "a nota must reference an invoice" needs to know which document types are notas (AR: `20`, `21`);
 * - "an incoterm is mandatory for a goods invoice" needs to know which type code is a Factura (AR: `19`).
 *
 * Those are enforced where the entity's codes are already known — in the provider's mapper, which raises the
 * same `400` — or left to the authority, which owns them. Encoding them here would put ARCA's numbers in the
 * neutral HTTP layer to save one round trip, and the next entity would inherit them.
 */

/** A customs shipping permit and the destination of the goods it covers. */
export class InvoiceShippingPermitDto {
    /** The authority's despacho code (AR: `Id_permiso`, format `99999AAXX999999A`). */
    @IsString()
    @Length(1, 16)
    permitId!: string;

    /** Where the goods are going, in the same catalogue as the voucher's own destination. */
    @IsString()
    @Length(1, 3)
    destinationCode!: string;
}

/**
 * A shipment can only accompany goods.
 *
 * Entity-agnostic in a way the neighbouring rules are not: it reads `exportType`, which is this contract's
 * own vocabulary, rather than any authority code. A services export has nothing to ship, so a permit on one
 * is a caller mistake in any jurisdiction.
 */
@ValidatorConstraint({name: 'exportPermitsAccompanyGoods'})
class ExportPermitsAccompanyGoods implements ValidatorConstraintInterface {
    validate(_value: unknown, args: ValidationArguments): boolean {
        const {exportType, shippingPermits, shippingPermitPresent} = args.object as InvoiceExportDto;
        if (exportType === 'GOODS') {
            return true;
        }
        return (shippingPermits ?? []).length === 0 && shippingPermitPresent !== true;
    }

    defaultMessage(args: ValidationArguments): string {
        const {exportType} = args.object as InvoiceExportDto;
        return (
            `a ${exportType} export has nothing to ship, so shippingPermits/shippingPermitPresent must be ` +
            'omitted — send exportType "GOODS" if this voucher covers a shipment'
        );
    }
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

export class InvoiceExportDto {
    /** What is being exported. Distinct from `concept`, which has a "both" this vocabulary lacks. */
    @IsIn(['GOODS', 'SERVICES', 'OTHER'])
    exportType!: 'GOODS' | 'SERVICES' | 'OTHER';

    /**
     * Where the voucher is destined, as the authority's own customs-destination code (AR: `Dst_cmp`).
     *
     * A canonical fiscal code rather than ISO 3166-1, because the catalogue lists customs *destinations* and
     * ISO cannot express it: a free zone is a destination distinct from the country containing it, some
     * codes aggregate several countries, and others are catch-alls. The code for an Argentine special
     * customs area — the Tierra del Fuego case — is one of the unmappable ones.
     */
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
    @Validate(ExportPermitsAccompanyGoods)
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
     * two tables share no identifier, and the value is not computable from the destination — so a caller that
     * wants this specific identifier supplies it and the provider validates it against the published set.
     */
    @IsOptional()
    @IsString()
    @Length(1, 11)
    clientCountryTaxId?: string;

    /** How the buyer is constituted, which is what the per-country tax id is keyed by alongside the country. */
    @IsOptional()
    @IsIn(['INDIVIDUAL', 'LEGAL_ENTITY', 'OTHER'])
    receiverPersonType?: 'INDIVIDUAL' | 'LEGAL_ENTITY' | 'OTHER';

    /**
     * The ICC Incoterms clause (e.g. `"CIF"`, `"FOB"`, `"DAP"`).
     *
     * An international standard that covers its whole domain, so it travels as itself with no mapping table —
     * unlike the destination and unit codes. The provider checks it against the clauses the entity publishes.
     */
    @IsOptional()
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
     * Required by AR for a services or other export invoice and forbidden on a nota — both conditions the
     * provider applies, needing the entity's own type codes to state them.
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

    @IsString()
    @MinLength(1)
    @Length(1, 4000)
    description!: string;

    @IsOptional()
    @IsNumber()
    quantity?: number;

    /**
     * The authority's own unit code (AR: `Pro_umed`).
     *
     * A canonical fiscal code rather than a unit name, because not all of its values are units: an authority
     * may reserve some to mark a line as a deposit or a discount, which changes the amount rules that apply
     * to it. `@Min(0)` rather than `@IsPositive()` for that reason — AR's `0` is the no-unit marker.
     */
    @IsInt()
    @Min(0)
    unitOfMeasureCode!: number;

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
