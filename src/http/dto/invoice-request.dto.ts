import {Type} from 'class-transformer';
import {ArrayMinSize, IsArray, IsDefined, IsInt, IsPositive, ValidateNested} from 'class-validator';
import {EntityAuthDto} from './entity-auth.dto.js';
import {NeutralInvoiceDto} from './invoice.dto.js';

/**
 * The request envelopes for the invoice routes, each pairing the entity block with whatever that route needs
 * to name a voucher.
 *
 * Every nested object carries `@IsDefined()` as well as `@ValidateNested()`, and both are load-bearing:
 * nested validation checks an object's contents, so a missing one has nothing to validate and passes, and
 * the controller then dereferences `undefined` — turning a malformed body into a `500` instead of a `400`.
 *
 * Stated once here rather than per class, which is how it went wrong: the rule was written on one envelope
 * and the three beside it went without.
 */

/** Body for `POST /invoices/authorize`. */
export class AuthorizeInvoiceRequestDto {
    @IsDefined()
    @ValidateNested()
    @Type(() => EntityAuthDto)
    entity!: EntityAuthDto;

    @IsDefined()
    @ValidateNested()
    @Type(() => NeutralInvoiceDto)
    invoice!: NeutralInvoiceDto;
}

/** Body for `POST /invoices/last-authorized`. */
export class LastAuthorizedRequestDto {
    @IsDefined()
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

/** Body for `POST /invoices/query`. */
export class QueryVoucherRequestDto {
    @IsDefined()
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
