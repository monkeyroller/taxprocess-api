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

    /**
     * An invoice body has to name a buyer, and there are now two ways to do it — `receiver` for a domestic
     * voucher, `export` for a foreign-trade one. Neither can be `@IsDefined` on its own any more, so the
     * requirement moved to a class-level check reported on `documentTypeCode`, the field that decides which
     * of the two applies.
     *
     * The original hazard is unchanged and is why this is a hard requirement rather than a preference:
     * nested validation has nothing to validate on a missing object, so it passes, and the mapper then
     * dereferences `undefined`.
     */
    const invoiceBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        documentTypeCode: 1,
        concept: 1,
        pointOfSaleNumber: 3,
        voucherNumberFrom: 17,
        voucherNumberTo: 17,
        currencyCode: 'PES',
        currencyRate: 1,
        issueDate: '2026-08-05',
        lines: [{netAmount: 100, taxRatePercent: 21, taxAmount: 21}],
        ...overrides,
    });

    const exportBlock = {
        destinationCode: '203',
        clientName: 'Joao Da Silva',
        clientAddress: 'Rua 76 km 34.5 Alagoas',
        clientTaxId: 'PJ54482221-l',
        language: 'es',
    };

    it('reports a body naming neither receiver nor export', async () => {
        const errors = await validate(plainToInstance(NeutralInvoiceDto, invoiceBody()));

        expect(errors.map((e) => e.property)).toContain('documentTypeCode');
        expect(JSON.stringify(errors)).toContain('names no buyer');
    });

    it('reports a body naming both, rather than choosing one', async () => {
        const errors = await validate(
            plainToInstance(
                NeutralInvoiceDto,
                invoiceBody({
                    receiver: {identificationTypeCode: 80, identificationNumber: '20111111112', fiscalConditionCode: 1},
                    export: exportBlock,
                }),
            ),
        );

        expect(errors.map((e) => e.property)).toContain('documentTypeCode');
    });

    it('accepts a domestic body, and an export body — both carrying a concept', async () => {
        const domestic = await validate(
            plainToInstance(
                NeutralInvoiceDto,
                invoiceBody({
                    receiver: {identificationTypeCode: 80, identificationNumber: '20111111112', fiscalConditionCode: 1},
                }),
            ),
        );
        expect(domestic).toEqual([]);

        const foreign = await validate(
            plainToInstance(
                NeutralInvoiceDto,
                invoiceBody({
                    documentTypeCode: 19,
                    // One catalogue serves both documents now. `2` is services, valid on either.
                    concept: 2,
                    lines: [],
                    items: [{description: 'Consultoría', unitOfMeasureCode: 7, totalAmount: 500}],
                    export: exportBlock,
                }),
            ),
        );
        expect(foreign).toEqual([]);
    });

    it('requires a concept on an export body too, not only a domestic one', async () => {
        // The inverse of what this asserted before. `concept` used to be forbidden on an export, its
        // counterpart being a separate `exportType` field; one catalogue now serves both, so an export
        // that names nothing is as incomplete as a domestic one that does.
        const errors = await validate(
            plainToInstance(
                NeutralInvoiceDto,
                invoiceBody({
                    documentTypeCode: 19,
                    concept: undefined,
                    lines: [],
                    items: [{description: 'Consultoría', unitOfMeasureCode: 7, totalAmount: 500}],
                    export: exportBlock,
                }),
            ),
        );

        expect(errors.map((e) => e.property)).toContain('concept');
    });

    it('refuses a concept the document cannot express, at the provider rather than here', async () => {
        // `4` (other) is export-only and `3` (goods and services) domestic-only, but which document a type
        // code names is the authority's own numbering -- so the DTO accepts all four and the provider
        // refuses the one its service has no code for. Pinned so nobody "tightens" it into this layer.
        const errors = await validate(
            plainToInstance(
                NeutralInvoiceDto,
                invoiceBody({
                    documentTypeCode: 19,
                    concept: 3,
                    lines: [],
                    items: [{description: 'Consultoría', unitOfMeasureCode: 7, totalAmount: 500}],
                    export: exportBlock,
                }),
            ),
        );

        expect(errors).toEqual([]);
    });

    describe('a shipment can only accompany goods', () => {
        // The rule reads `concept` (on the invoice) and the permits (inside `export`), so it can only live
        // here -- a class-level validator sees one object, and from `InvoiceExportDto` the concept is
        // invisible. That is why it moved up when the two vocabularies merged.
        const shipping = (concept: number, permit: Record<string, unknown>): Record<string, unknown> =>
            invoiceBody({
                documentTypeCode: 19,
                concept,
                lines: [],
                items: [{description: 'Consultoría', unitOfMeasureCode: 7, totalAmount: 500}],
                export: {...exportBlock, ...permit},
            });

        it('refuses permits on a voucher that is not for goods', async () => {
            const errors = await validate(
                plainToInstance(NeutralInvoiceDto, shipping(2, {shippingPermits: [{permitId: 'X', destinationCode: '203'}]})),
            );
            expect(JSON.stringify(errors)).toContain('nothing to ship');
        });

        it('refuses an asserted permit on a voucher that is not for goods', async () => {
            const errors = await validate(
                plainToInstance(NeutralInvoiceDto, shipping(2, {shippingPermitPresent: true})),
            );
            expect(JSON.stringify(errors)).toContain('nothing to ship');
        });

        it('allows an explicit "no permit yet" on a goods voucher', async () => {
            const errors = await validate(
                plainToInstance(NeutralInvoiceDto, shipping(1, {shippingPermitPresent: false, incoterm: 'CIF'})),
            );
            expect(errors).toEqual([]);
        });

        it('says nothing about a domestic voucher, which carries no permits to judge', async () => {
            const errors = await validate(
                plainToInstance(
                    NeutralInvoiceDto,
                    invoiceBody({
                        concept: 2,
                        receiver: {identificationTypeCode: 80, identificationNumber: '20111111112', fiscalConditionCode: 1},
                    }),
                ),
            );
            expect(errors).toEqual([]);
        });
    });

    it('needs no such guard on `lines`, whose @IsArray already rejects an absent one', async () => {
        // Pinned so nobody "completes" the sweep by adding a redundant `@IsDefined` here: an array field
        // is already covered, and the distinction is why only the object-valued blocks needed changing.
        const errors = await validate(plainToInstance(NeutralInvoiceDto, {}));
        expect(errors.map((e) => e.property)).toContain('lines');
    });
});
