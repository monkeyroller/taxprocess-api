import {Type} from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsIn,
    IsInt,
    IsISO8601,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Length,
    Min,
    ValidateNested,
} from 'class-validator';
import type {InvoiceConcept} from '../../arca/index.js';
import {ArgentinaIssuerDto} from './issuer-auth.dto.js';

/**
 * PRAGMATIC contract: the request carries ARCA-resolved codes (voucher type, receiver IVA condition,
 * receiver document type) exactly as `webprocess-api`'s catalogs already provide them
 * (`documentType.arcaCode`, `contributorType.arcaFiscalConditionId`, `identificationType.isoCode`).
 * The AR service owns only the mechanical translation: ISO→`MonId`, VAT%→id, totals, perceptions→
 * `Tributos`, dates, and the QR. It does NOT infer the Factura A/B/C letter.
 */

/** One taxed line: net (base imponible) + VAT amount at a given rate. */
export class InvoiceLineDto {
    @IsNumber()
    netAmount!: number;

    /** VAT rate as a percentage (e.g. 21, 10.5, 0). */
    @IsNumber()
    @Min(0)
    vatRatePercent!: number;

    @IsNumber()
    @Min(0)
    vatAmount!: number;
}

/** An Argentina invoice, with fiscal codes already resolved by the caller. */
export class ArgentinaInvoiceDto {
    /** ARCA `CbteTipo` (e.g. 1 = Factura A, 6 = Factura B, 11 = Factura C). Resolved by the caller. */
    @IsInt()
    @IsPositive()
    voucherType!: number;

    /** ARCA `Concepto`: 1 = productos, 2 = servicios, 3 = productos y servicios. */
    @IsIn([1, 2, 3])
    concept!: InvoiceConcept;

    /** `PtoVta`. */
    @IsInt()
    @IsPositive()
    salesPointNumber!: number;

    /** ARCA `CondicionIVAReceptorId` (RG 5616). Resolved by the caller. */
    @IsInt()
    @IsPositive()
    receiverIvaConditionId!: number;

    /** ARCA `DocTipo` (80 = CUIT, 96 = DNI, 99 = consumidor final). */
    @IsInt()
    @Min(0)
    receiverDocType!: number;

    /** ARCA `DocNro` (0 for an anonymous consumidor final). */
    @IsInt()
    @Min(0)
    receiverDocNumber!: number;

    /** ISO-4217 currency (e.g. `ARS`, `USD`); mapped to ARCA `MonId` by the service. */
    @IsString()
    @Length(3, 3)
    currency!: string;

    /** `MonCotiz` — exchange rate to ARS (1 for pesos). */
    @IsNumber()
    @IsPositive()
    currencyRate!: number;

    /** ISO-8601 issue date. Clamped to AFIP's ±5-day window for concept 1. */
    @IsISO8601()
    issueDate!: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({each: true})
    @Type(() => InvoiceLineDto)
    lines!: Array<InvoiceLineDto>;

    /** `ImpTotConc` — net not subject to VAT. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    untaxedTotal?: number;

    /** `ImpOpEx` — exempt amount. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    exemptTotal?: number;

    /** Total perceptions/other tributes (`ImpTrib`); reported as a single "Otros" (99) tribute. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    perceptionsTotal?: number;

    /** `FchServDesde` (ISO date) — required by ARCA when concept is 2 or 3. */
    @IsOptional()
    @IsISO8601()
    serviceDateFrom?: string;

    /** `FchServHasta` (ISO date) — required by ARCA when concept is 2 or 3. */
    @IsOptional()
    @IsISO8601()
    serviceDateTo?: string;

    /** `FchVtoPago` (ISO date) — required by ARCA when concept is 2 or 3. */
    @IsOptional()
    @IsISO8601()
    paymentDueDate?: string;
}

/** Body for `POST /invoices/authorize`. */
export class AuthorizeInvoiceRequestDto {
    @ValidateNested()
    @Type(() => ArgentinaIssuerDto)
    issuer!: ArgentinaIssuerDto;

    @ValidateNested()
    @Type(() => ArgentinaInvoiceDto)
    invoice!: ArgentinaInvoiceDto;
}

/** Body for `POST /invoices/last-authorized`. */
export class LastAuthorizedRequestDto {
    @ValidateNested()
    @Type(() => ArgentinaIssuerDto)
    issuer!: ArgentinaIssuerDto;

    @IsInt()
    @IsPositive()
    salesPointNumber!: number;

    @IsInt()
    @IsPositive()
    voucherType!: number;
}

/** Body for `POST /invoices/query`. */
export class QueryVoucherRequestDto {
    @ValidateNested()
    @Type(() => ArgentinaIssuerDto)
    issuer!: ArgentinaIssuerDto;

    @IsInt()
    @IsPositive()
    salesPointNumber!: number;

    @IsInt()
    @IsPositive()
    voucherType!: number;

    @IsInt()
    @IsPositive()
    voucherNumber!: number;
}
