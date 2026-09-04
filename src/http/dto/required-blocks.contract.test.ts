import 'reflect-metadata';
import {describe, expect, it} from '@jest/globals';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {ValidateCredentialsRequestDto} from './credentials.dto.js';
import {NeutralInvoiceDto} from './invoice.dto.js';
import {
    AuthorizeInvoiceRequestDto,
    LastAuthorizedRequestDto,
    NextNumbersRequestDto,
    QueryVoucherRequestDto,
} from './invoice-request.dto.js';
import {PointsOfSaleRequestDto} from './points-of-sale-request.dto.js';

/**
 * A missing nested block is a `400`, on every route that has one.
 *
 * `@ValidateNested()` validates an object's contents, so a missing object has nothing to validate and
 * passes. Every one of these routes then destructures the block and dereferences it, turning an incomplete
 * body into a `500` that names nothing the caller can fix.
 *
 * Swept as a table rather than case by case, because the defect was an asymmetry: the rule was written on
 * one DTO and four of the six blocks beside it went without. Enumerating every request DTO is what catches
 * the next one added without it.
 */
describe('every nested request block is required, not merely validated', () => {
    /** Each entry omits exactly the block under test and supplies enough of the rest to isolate it. */
    const cases: ReadonlyArray<{route: string; dto: new () => object; body: object; missing: string}> = [
        {
            route: 'POST /invoices/authorize',
            dto: AuthorizeInvoiceRequestDto,
            body: {invoice: {}},
            missing: 'entity',
        },
        {
            route: 'POST /invoices/authorize',
            dto: AuthorizeInvoiceRequestDto,
            body: {entity: {entityCode: 'ARCA', issuerTaxId: '20111111112', environment: 'testing'}},
            missing: 'invoice',
        },
        {
            route: 'POST /invoices/last-authorized',
            dto: LastAuthorizedRequestDto,
            body: {pointOfSaleNumber: 3, documentTypeCode: 1},
            missing: 'entity',
        },
        {
            route: 'POST /invoices/next-numbers',
            dto: NextNumbersRequestDto,
            body: {pointOfSaleNumber: 3, documentTypeCodes: [1]},
            missing: 'entity',
        },
        {
            route: 'POST /invoices/query',
            dto: QueryVoucherRequestDto,
            body: {pointOfSaleNumber: 3, documentTypeCode: 1, voucherNumber: 42},
            missing: 'entity',
        },
        {
            route: 'POST /points-of-sale',
            dto: PointsOfSaleRequestDto,
            body: {},
            missing: 'entity',
        },
        {
            route: 'POST /entities/:entityCode/credentials/validate',
            dto: ValidateCredentialsRequestDto,
            body: {
                entityCode: 'ARCA',
                environment: 'testing',
                configuration: {},
                expectedTaxId: '20111111112',
            },
            missing: 'credentials',
        },
    ];

    it.each(cases)('$route reports a missing $missing', async ({dto, body, missing}) => {
        const errors = await validate(plainToInstance(dto, body));
        expect(errors.map((e) => e.property)).toContain(missing);
    });

    it('reports a missing receiver on the invoice body itself', async () => {
        // Nested one level deeper than the envelopes above, and reached by the same dereference:
        // `buildCommonInvoiceRequest` reads `invoice.receiver.identificationTypeCode` unconditionally.
        const errors = await validate(
            plainToInstance(NeutralInvoiceDto, {
                documentTypeCode: 1,
                concept: 1,
                pointOfSaleNumber: 3,
                voucherNumberFrom: 17,
                voucherNumberTo: 17,
                currencyCode: 'PES',
                currencyRate: 1,
                issueDate: '2026-08-05',
                lines: [{netAmount: 100, taxRatePercent: 21, taxAmount: 21}],
            }),
        );

        expect(errors.map((e) => e.property)).toContain('receiver');
    });

    it('needs no such guard on `lines`, whose @IsArray already rejects an absent one', async () => {
        // Pinned so nobody "completes" the sweep by adding a redundant `@IsDefined` here: an array field
        // is already covered, and the distinction is why only the object-valued blocks needed changing.
        const errors = await validate(plainToInstance(NeutralInvoiceDto, {}));
        expect(errors.map((e) => e.property)).toContain('lines');
    });
});
