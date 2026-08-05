import {Type} from 'class-transformer';
import {
    IsArray,
    IsIn,
    IsInt,
    IsISO8601,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    MinLength,
    ValidateNested,
} from 'class-validator';
import {ArgentinaIssuerDto} from './issuer-auth.dto.js';

/**
 * Semantic document class — country-agnostic. The AR mapper turns this into an ARCA `CbteTipo`
 * (voucher type) together with the receiver's fiscal condition; the neutral doc never carries
 * `arcaCode`/`CbteTipo`/`MonId`.
 */
export const NEUTRAL_DOCUMENT_CLASSES = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const;
export type NeutralDocumentClass = (typeof NEUTRAL_DOCUMENT_CLASSES)[number];

/** A party (issuer or receiver) in neutral terms. */
export class NeutralPartyDto {
    /** Tax identifier (CUIT/CUIL/DNI number), digits only. */
    @IsInt()
    @IsPositive()
    taxId!: number;

    /** Semantic identification-type code (mapped to ARCA `DocTipo` by the AR mapper). */
    @IsOptional()
    @IsInt()
    identificationType?: number;

    /** Semantic fiscal-condition code (mapped to ARCA `CondicionIVAReceptorId` by the AR mapper). */
    @IsOptional()
    @IsInt()
    fiscalConditionId?: number;
}

/** One invoice line with a SEMANTIC VAT rate (percent) — not an ARCA VAT id. */
export class NeutralLineDto {
    @IsOptional()
    @IsString()
    description?: string;

    /** Taxed net amount for this line. */
    @IsNumber()
    netAmount!: number;

    /** VAT rate as a percentage (e.g. 21, 10.5, 0). */
    @IsNumber()
    vatRatePercent!: number;

    /** VAT amount for this line. */
    @IsNumber()
    vatAmount!: number;
}

/**
 * The neutral canonical invoice document. All AR-specific translation (voucher type, IVA condition,
 * ISO→`MonId`, VAT-id mapping, RG-4892 QR) is owned by `ar-invoice.mapper.ts`, not by this shape.
 */
export class NeutralInvoiceDto {
    @IsIn(NEUTRAL_DOCUMENT_CLASSES)
    documentClass!: NeutralDocumentClass;

    @ValidateNested()
    @Type(() => NeutralPartyDto)
    issuer!: NeutralPartyDto;

    @ValidateNested()
    @Type(() => NeutralPartyDto)
    receiver!: NeutralPartyDto;

    /** Sales point (punto de venta) number. */
    @IsInt()
    @IsPositive()
    salesPointNumber!: number;

    /** ISO-4217 currency code (e.g. `ARS`, `USD`). */
    @IsString()
    @MinLength(3)
    currency!: string;

    /** Exchange rate to the issuer's home currency (1 for local currency). */
    @IsNumber()
    currencyRate!: number;

    /** ISO-8601 issue date. */
    @IsISO8601()
    issueDate!: string;

    @IsArray()
    @ValidateNested({each: true})
    @Type(() => NeutralLineDto)
    lines!: Array<NeutralLineDto>;

    /** Non-taxed net total (ARCA `ImpTotConc`). */
    @IsOptional()
    @IsNumber()
    untaxedTotal?: number;

    /** Exempt total (ARCA `ImpOpEx`). */
    @IsOptional()
    @IsNumber()
    exemptTotal?: number;

    /** Perceptions/other tributes total (ARCA `Tributos`). */
    @IsOptional()
    @IsNumber()
    perceptionsTotal?: number;
}

/** Full body for `POST /invoices/authorize`: issuer identity (+ optional ticket) plus the neutral doc. */
export class AuthorizeInvoiceRequestDto {
    @ValidateNested()
    @Type(() => ArgentinaIssuerDto)
    issuer!: ArgentinaIssuerDto;

    @ValidateNested()
    @Type(() => NeutralInvoiceDto)
    invoice!: NeutralInvoiceDto;
}
