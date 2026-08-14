import {Type} from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsDefined,
    IsIn,
    IsInt,
    IsISO8601,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Length,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import type {NeutralInvoiceConcept} from '../../providers/provider.js';
import {EntityAuthDto} from './entity-auth.dto.js';

/**
 * NEUTRAL contract: the request carries provider-agnostic canonical codes (`documentTypeCode`,
 * `receiver.identificationTypeCode`, `receiver.fiscalConditionCode`). The provider maps these to the tax
 * entity's real codes and owns the mechanical translation (currency, tax rates, totals, dates, QR).
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
    /** canonical `identificationTypeCode` → provider maps to the entity's document-type code (AR: DocTipo). */
    @IsInt()
    @Min(0)
    identificationTypeCode!: number;

    /** The receiver's identification number (digits as a string; `"0"` for an anonymous receiver). */
    @IsString()
    @MinLength(1)
    identificationNumber!: string;

    /** canonical `fiscalConditionCode` → provider maps to the entity's fiscal-condition code (AR: CondicionIVAReceptorId). */
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

/** A neutral invoice carrying core's generic ids. */
export class NeutralInvoiceDto {
    /** canonical `documentTypeCode` → provider maps to the entity's voucher-type code (AR: CbteTipo). */
    @IsInt()
    @IsPositive()
    documentTypeCode!: number;

    /** Concept: 1 = goods, 2 = services, 3 = both. */
    @IsIn([1, 2, 3])
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

    @ValidateNested()
    @Type(() => InvoiceReceiverDto)
    receiver!: InvoiceReceiverDto;

    /** ISO-4217 currency (e.g. `ARS`, `USD`); mapped to the entity's currency code by the provider. */
    @IsString()
    @Length(3, 3)
    currencyIso!: string;

    /** Exchange rate to the local currency (1 for the local currency itself). */
    @IsNumber()
    @IsPositive()
    currencyRate!: number;

    /** ISO-8601 issue date. */
    @IsISO8601()
    issueDate!: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({each: true})
    @Type(() => InvoiceLineDto)
    lines!: Array<InvoiceLineDto>;

    @IsOptional()
    @ValidateNested()
    @Type(() => InvoiceTotalsDto)
    totals?: InvoiceTotalsDto;

    /** ISO date — required by the entity when concept is 2 or 3 (AR: `FchServDesde`). */
    @IsOptional()
    @IsISO8601()
    serviceDateFrom?: string;

    /** ISO date — required by the entity when concept is 2 or 3 (AR: `FchServHasta`). */
    @IsOptional()
    @IsISO8601()
    serviceDateTo?: string;

    /** ISO date — required by the entity when concept is 2 or 3 (AR: `FchVtoPago`). */
    @IsOptional()
    @IsISO8601()
    paymentDueDate?: string;
}

/** Body for `POST /invoices/authorize`. */
export class AuthorizeInvoiceRequestDto {
    @ValidateNested()
    @Type(() => EntityAuthDto)
    entity!: EntityAuthDto;

    @ValidateNested()
    @Type(() => NeutralInvoiceDto)
    invoice!: NeutralInvoiceDto;
}

/** Body for `POST /invoices/last-authorized`. */
export class LastAuthorizedRequestDto {
    @ValidateNested()
    @Type(() => EntityAuthDto)
    entity!: EntityAuthDto;

    @IsInt()
    @IsPositive()
    pointOfSaleNumber!: number;

    @IsInt()
    @IsPositive()
    documentTypeCode!: number;
}

/** Body for `POST /invoices/next-numbers` — batch next-expected-number lookup for one point of sale. */
export class NextNumbersRequestDto {
    // `@IsDefined` alongside `@ValidateNested`: nested validation alone passes a *missing* `entity` (nothing to
    // validate), which would then NPE in the controller → 500. This makes a missing entity a clean 400.
    @IsDefined()
    @ValidateNested()
    @Type(() => EntityAuthDto)
    entity!: EntityAuthDto;

    @IsInt()
    @IsPositive()
    pointOfSaleNumber!: number;

    /** Canonical document-type codes (AR: each a CbteTipo). Non-empty; core may de-duplicate before sending. */
    @IsArray()
    @ArrayMinSize(1)
    @IsInt({each: true})
    @IsPositive({each: true})
    documentTypeCodes!: Array<number>;
}

/** Body for `POST /points-of-sale` — identity only; the point-of-sale list is scoped to the entity/issuer. */
export class PointsOfSaleRequestDto {
    // `@IsDefined` is required alongside `@ValidateNested`: nested validation alone passes a *missing* `entity`
    // (there is nothing to validate), which would then NPE in the controller → 500. This makes it a clean 400.
    @IsDefined()
    @ValidateNested()
    @Type(() => EntityAuthDto)
    entity!: EntityAuthDto;
}

/** Body for `POST /invoices/query`. */
export class QueryVoucherRequestDto {
    @ValidateNested()
    @Type(() => EntityAuthDto)
    entity!: EntityAuthDto;

    @IsInt()
    @IsPositive()
    pointOfSaleNumber!: number;

    @IsInt()
    @IsPositive()
    documentTypeCode!: number;

    @IsInt()
    @IsPositive()
    voucherNumber!: number;
}
