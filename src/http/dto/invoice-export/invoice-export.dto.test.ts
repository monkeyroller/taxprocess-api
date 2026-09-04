import 'reflect-metadata';
import {describe, expect, it} from '@jest/globals';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {InvoiceExportDto, InvoiceItemDto} from './invoice-export.dto.js';

/** A valid services export block — the shape with the fewest conditional fields switched on. */
const block = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    exportType: 'SERVICES',
    destinationCode: '203',
    clientName: 'Joao Da Silva',
    clientAddress: 'Rua 76 km 34.5 Alagoas',
    clientTaxId: 'PJ54482221-l',
    language: 'es',
    ...overrides,
});

const messagesOf = async (body: Record<string, unknown>): Promise<string> =>
    JSON.stringify(await validate(plainToInstance(InvoiceExportDto, body)));

describe('InvoiceExportDto', () => {
    it('accepts a minimal services export', async () => {
        expect(await validate(plainToInstance(InvoiceExportDto, block()))).toEqual([]);
    });

    it('accepts a goods export carrying a shipping permit', async () => {
        expect(
            await validate(
                plainToInstance(
                    InvoiceExportDto,
                    block({
                        exportType: 'GOODS',
                        shippingPermitPresent: true,
                        shippingPermits: [{permitId: '09052EC01006154G', destinationCode: '203'}],
                        incoterm: 'CIF',
                    }),
                ),
            ),
        ).toEqual([]);
    });

    it('accepts the Tierra del Fuego destination, which ISO cannot name', async () => {
        expect(
            await validate(
                plainToInstance(InvoiceExportDto, block({exportType: 'GOODS', destinationCode: '250'})),
            ),
        ).toEqual([]);
    });

    describe('the buyer has to be identifiable', () => {
        it('accepts either identifier alone', async () => {
            expect(await messagesOf(block())).toBe('[]');
            const {clientTaxId: _dropped, ...rest} = block();
            expect(await messagesOf({...rest, clientCountryTaxId: '50000000059'})).toBe('[]');
        });

        it('refuses a block naming neither', async () => {
            // Neither can be unconditionally required: the per-country id does not exist for every
            // destination, and the buyer's own is a foreign identifier a caller may not hold.
            const {clientTaxId: _dropped, ...rest} = block();
            expect(await messagesOf(rest)).toContain('no tax identification');
        });
    });

    describe('a shipment can only accompany goods', () => {
        it('refuses permits on a services export', async () => {
            expect(
                await messagesOf(block({shippingPermits: [{permitId: 'X', destinationCode: '203'}]})),
            ).toContain('nothing to ship');
        });

        it('refuses shippingPermitPresent on a services export', async () => {
            expect(await messagesOf(block({shippingPermitPresent: true}))).toContain('nothing to ship');
        });

        it('allows an explicit "no permit yet" on a goods export', async () => {
            expect(await messagesOf(block({exportType: 'GOODS', shippingPermitPresent: false}))).toBe('[]');
        });
    });

    describe('closed vocabularies', () => {
        it('refuses an unknown export type or language', async () => {
            expect(await messagesOf(block({exportType: 'BOTH'}))).toContain('exportType');
            expect(await messagesOf(block({language: 'fr'}))).toContain('language');
        });
    });

    it('refuses a zoneless datetime for the payment date, as every other date on this wire does', async () => {
        expect(await messagesOf(block({paymentDate: '2026-09-30T12:00:00'}))).toContain('paymentDate');
        expect(await messagesOf(block({paymentDate: '2026-09-30'}))).toBe('[]');
    });
});

describe('InvoiceItemDto', () => {
    const item = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        description: 'Consultoría',
        unitOfMeasureCode: 7,
        totalAmount: 500,
        ...overrides,
    });

    it('accepts a minimal item', async () => {
        expect(await validate(plainToInstance(InvoiceItemDto, item()))).toEqual([]);
    });

    it('accepts unit code 0, which is a marker rather than a unit', async () => {
        // `@Min(0)` rather than `@IsPositive()` for exactly this: an authority may reserve low codes to say
        // "no unit", and rejecting them here would make a legitimate line unsendable.
        expect(await validate(plainToInstance(InvoiceItemDto, item({unitOfMeasureCode: 0})))).toEqual([]);
    });

    it('accepts a negative total, which is how a discount line is expressed', async () => {
        // Which unit codes permit it is the entity's rule, so the DTO does not bound the sign.
        expect(
            await validate(plainToInstance(InvoiceItemDto, item({unitOfMeasureCode: 99, totalAmount: -50}))),
        ).toEqual([]);
    });

    it('still requires a description and a unit', async () => {
        const {description: _d, ...noDescription} = item();
        expect(JSON.stringify(await validate(plainToInstance(InvoiceItemDto, noDescription)))).toContain(
            'description',
        );
        const {unitOfMeasureCode: _u, ...noUnit} = item();
        expect(JSON.stringify(await validate(plainToInstance(InvoiceItemDto, noUnit)))).toContain(
            'unitOfMeasureCode',
        );
    });
});
