import {describe, expect, it} from '@jest/globals';
import {buildFexInvoiceRequest, toNeutralExportResult} from './export-invoice.mapper.js';
import {ArcaValidationError} from '../../sdk/core/errors.js';
import {Concept, type NeutralInvoice} from '../../../provider/neutral-invoice.js';
import type {FexInvoiceResult} from '../../sdk/invoicing/export/fex-invoice.types.js';

/** UC-2: an export of services, which is the shape with the fewest conditional fields switched on. */
const SERVICES: NeutralInvoice = {
    documentTypeCode: 19,
    pointOfSaleNumber: 3,
    voucherNumberFrom: 7,
    voucherNumberTo: 7,
    currencyCode: 'DOL',
    currencyRate: 1508,
    issueDate: '2026-09-04',
    concept: Concept.SERVICES,
    lines: [],
    items: [
        {description: 'Consultoría', quantity: 2, unitOfMeasureCode: 7, unitPrice: 250, totalAmount: 500},
    ],
    export: {
        destinationCode: '203',
        clientName: 'Joao Da Silva',
        clientAddress: 'Rua 76 km 34.5 Alagoas',
        clientTaxId: 'PJ54482221-l',
        language: 'es',
        paymentTerms: 'Contado',
        paymentDate: '2026-09-30',
    },
};

/** UC-1: goods into the Área Aduanera Especial, in pesos. */
const TIERRA_DEL_FUEGO: NeutralInvoice = {
    ...SERVICES,
    currencyCode: 'PES',
    currencyRate: 1,
    concept: Concept.GOODS,
    export: {
        destinationCode: '250',
        shippingPermitPresent: false,
        clientName: 'Electrónica Fueguina SA',
        clientAddress: 'Av. Perito Moreno 1234, Río Grande',
        clientTaxId: '30711111118',
        language: 'es',
        incoterm: 'DAP',
        paymentTerms: 'Cuenta corriente',
    },
};

describe('buildFexInvoiceRequest', () => {
    it('translates a services export', () => {
        const request = buildFexInvoiceRequest(SERVICES, 7, 41);

        expect(request).toMatchObject({
            requestId: 41,
            voucherType: 19,
            pointOfSaleNumber: 3,
            voucherNumber: 7,
            voucherDate: '20260904',
            exportType: 2,
            destinationCode: 203,
            clientName: 'Joao Da Silva',
            clientTaxId: 'PJ54482221-l',
            currencyId: 'DOL',
            currencyRate: 1508,
            language: 1,
            paymentTerms: 'Contado',
            paymentDate: '20260930',
            totalAmount: 500,
        });
    });

    it('translates the Tierra del Fuego case, whose destination ISO cannot name', () => {
        const request = buildFexInvoiceRequest(TIERRA_DEL_FUEGO, 7, 41);

        expect(request.destinationCode).toBe(250);
        expect(request.currencyId).toBe('PES');
        expect(request.exportType).toBe(1);
        expect(request.incoterm).toBe('DAP');
    });

    it('derives the total from the items, so the two cannot disagree', () => {
        // ARCA compares them (1610) and names neither side when they differ, so the only safe total is one
        // this service did not have a second chance to get wrong.
        const request = buildFexInvoiceRequest(
            {
                ...SERVICES,
                items: [
                    {description: 'a', unitOfMeasureCode: 7, totalAmount: 100.01},
                    {description: 'b', unitOfMeasureCode: 7, totalAmount: 50.1},
                ],
            },
            7,
            41,
        );

        expect(request.totalAmount).toBe(150.11);
    });

    it('rounds the derived total to two decimals, absorbing float drift', () => {
        // 0.1 + 0.2 is 0.30000000000000004 unrounded, which ARCA rejects on precision alone.
        const request = buildFexInvoiceRequest(
            {
                ...SERVICES,
                items: [
                    {description: 'a', unitOfMeasureCode: 7, totalAmount: 0.1},
                    {description: 'b', unitOfMeasureCode: 7, totalAmount: 0.2},
                ],
            },
            7,
            41,
        );

        expect(request.totalAmount).toBe(0.3);
    });

    describe('Permiso_existente, which ARCA wants only in one combination', () => {
        it('sends S/N for a goods Factura', () => {
            expect(buildFexInvoiceRequest(TIERRA_DEL_FUEGO, 7, 41).permitPresent).toBe('N');
            expect(
                buildFexInvoiceRequest(
                    {...TIERRA_DEL_FUEGO, export: {...TIERRA_DEL_FUEGO.export!, shippingPermitPresent: true}},
                    7,
                    41,
                ).permitPresent,
            ).toBe('S');
        });

        it('omits it for a services export, where informing it is a rejection (1730)', () => {
            expect(buildFexInvoiceRequest(SERVICES, 7, 41).permitPresent).toBeUndefined();
        });

        it('omits it on a nota, which never carries it', () => {
            const nota = {...TIERRA_DEL_FUEGO, documentTypeCode: 21};
            expect(buildFexInvoiceRequest(nota, 7, 41).permitPresent).toBeUndefined();
        });
    });

    describe('CanMisMonExt, which must not be sent in two cases (1605)', () => {
        it('passes the flag through on a foreign-currency Factura', () => {
            const request = buildFexInvoiceRequest(
                {...SERVICES, export: {...SERVICES.export!, settledInInvoiceCurrency: true}},
                7,
                41,
            );
            expect(request.settledInInvoiceCurrency).toBe('S');
        });

        it('drops it on a peso Factura even when the caller sent it', () => {
            // The one place this mapper overrides what it was told: sending the field at all is the
            // rejection, so relaying it would turn a caller slip into an ARCA error.
            const request = buildFexInvoiceRequest(
                {
                    ...TIERRA_DEL_FUEGO,
                    export: {...TIERRA_DEL_FUEGO.export!, settledInInvoiceCurrency: true},
                },
                7,
                41,
            );
            expect(request.settledInInvoiceCurrency).toBeUndefined();
        });

        it('drops it on a nota', () => {
            const request = buildFexInvoiceRequest(
                {
                    ...SERVICES,
                    documentTypeCode: 20,
                    export: {...SERVICES.export!, settledInInvoiceCurrency: true},
                },
                7,
                41,
            );
            expect(request.settledInInvoiceCurrency).toBeUndefined();
        });
    });

    it('drops Fecha_pago on a nota, where informing it is a rejection (1674)', () => {
        const request = buildFexInvoiceRequest({...SERVICES, documentTypeCode: 21}, 7, 41);
        expect(request.paymentDate).toBeUndefined();
    });

    it('maps associated vouchers and their issuer', () => {
        const request = buildFexInvoiceRequest(
            {
                ...SERVICES,
                documentTypeCode: 21,
                associatedVouchers: [
                    {documentTypeCode: 19, pointOfSaleNumber: 3, number: 6, issuerTaxId: '30711111118'},
                ],
            },
            8,
            41,
        );

        expect(request.associatedVouchers).toEqual([
            {voucherType: 19, pointOfSaleNumber: 3, number: 6, cuit: 30711111118},
        ]);
    });

    it('maps shipping permits through the same destination catalogue', () => {
        const request = buildFexInvoiceRequest(
            {
                ...TIERRA_DEL_FUEGO,
                export: {
                    ...TIERRA_DEL_FUEGO.export!,
                    shippingPermitPresent: true,
                    shippingPermits: [{permitId: '09052EC01006154G', destinationCode: '203'}],
                },
            },
            7,
            41,
        );

        expect(request.permits).toEqual([{permitId: '09052EC01006154G', destinationCode: 203}]);
    });

    describe('what it refuses rather than guessing', () => {
        it('refuses a voucher with no export block', () => {
            const {export: _dropped, ...rest} = SERVICES;
            expect(() => buildFexInvoiceRequest(rest, 7, 41)).toThrow(ArcaValidationError);
        });

        it('takes its idempotency key as an argument, never from the invoice', () => {
            // Withdrawn from the contract deliberately: the key is per-CUIT and its misuse is silent, so a
            // caller that never sees it cannot reuse it. See `mapping/request-id/`.
            expect(buildFexInvoiceRequest(SERVICES, 7, 41).requestId).toBe(41);
        });

        it('refuses a voucher with no items', () => {
            expect(() => buildFexInvoiceRequest({...SERVICES, items: []}, 7, 41)).toThrow(/items/);
        });

        it('refuses a currencyIso-only voucher rather than reaching the deprecated bridge', () => {
            const {currencyCode: _dropped, ...rest} = SERVICES;
            expect(() => buildFexInvoiceRequest({...rest, currencyIso: 'USD'}, 7, 41)).toThrow(/currencyCode/);
        });

        it('refuses an unknown destination, incoterm or unit with UNKNOWN_CODE', () => {
            expect(() =>
                buildFexInvoiceRequest({...SERVICES, export: {...SERVICES.export!, destinationCode: '999'}}, 7, 41),
            ).toThrow(ArcaValidationError);
            expect(() =>
                buildFexInvoiceRequest({...SERVICES, export: {...SERVICES.export!, incoterm: 'DDU'}}, 7, 41),
            ).toThrow(ArcaValidationError);
            expect(() =>
                buildFexInvoiceRequest(
                    {...SERVICES, items: [{description: 'a', unitOfMeasureCode: 12, totalAmount: 1}]},
                    7,
                    41,
                ),
            ).toThrow(ArcaValidationError);
        });

        it('refuses a country tax id the authority does not publish', () => {
            expect(() =>
                buildFexInvoiceRequest(
                    {...SERVICES, export: {...SERVICES.export!, clientCountryTaxId: '20111111112'}},
                    7,
                    41,
                ),
            ).toThrow(ArcaValidationError);
        });
    });
});

describe('toNeutralExportResult', () => {
    const authorized: FexInvoiceResult = {
        result: 'A',
        cae: '69000000000001',
        caeExpiration: '20261015',
        voucherNumber: 7,
        voucherDate: '20260904',
        requestId: 41,
        reprocessed: false,
        observations: [],
        raw: {},
    };

    it('maps an authorized voucher', () => {
        expect(toNeutralExportResult(authorized)).toEqual({
            authorizationCode: '69000000000001',
            expiration: new Date(Date.UTC(2026, 9, 15, 3, 0, 0)).toISOString(),
            authorizedNumber: 7,
            status: 'AUTHORIZED',
            observations: [],
            providerMetadata: {},
        });
    });

    it("reports no replay flag, the key being ours rather than the caller's", () => {
        // A caller that never supplied an idempotency key cannot have meant to retry with one, so the flag
        // has nothing to tell it. It survives on the SDK result as an internal alarm instead.
        expect(toNeutralExportResult({...authorized, reprocessed: true})).not.toHaveProperty('reprocessed');
    });

    it('emits no QR, RG 4892 being specified for the domestic voucher', () => {
        expect(toNeutralExportResult(authorized)).not.toHaveProperty('qr');
    });

    it('surfaces an unreadable expiration verbatim rather than throwing over a granted CAE', () => {
        expect(toNeutralExportResult({...authorized, caeExpiration: '20261345'}).expiration).toBe('20261345');
    });

    it('maps a rejection', () => {
        const rejected = toNeutralExportResult({
            ...authorized,
            result: 'R',
            cae: undefined,
            caeExpiration: undefined,
            observations: [{code: '', message: '1601 - Moneda_ctz debe ser 1'}],
        });

        expect(rejected).toMatchObject({
            authorizationCode: '',
            expiration: '',
            status: 'REJECTED',
            observations: [{code: '', message: '1601 - Moneda_ctz debe ser 1'}],
        });
    });
});

describe('the rules that need ARCA\'s own codes', () => {
    /** Every one of these is a 400 naming the field instead of a 502 relaying ARCA's Spanish rejection. */
    const codeOf = (build: () => unknown): string | undefined => {
        try {
            build();
        } catch (err) {
            expect(err).toBeInstanceOf(ArcaValidationError);
            return (err as ArcaValidationError).code;
        }
        throw new Error('expected a validation error');
    };

    it('requires the rate to be exactly 1 in pesos (1601)', () => {
        // Which code is the local currency is ARCA's, which is why the neutral DTO cannot state this.
        expect(codeOf(() => buildFexInvoiceRequest({...TIERRA_DEL_FUEGO, currencyRate: 1508}, 7, 41))).toBe(
            'CURRENCY_RATE_MISMATCH',
        );
        expect(() => buildFexInvoiceRequest(TIERRA_DEL_FUEGO, 7, 41)).not.toThrow();
    });

    it('leaves a foreign rate alone, band and all', () => {
        // The band is ARCA's -- it needs a reference this service did not read. Only the peso is decidable.
        expect(() => buildFexInvoiceRequest({...SERVICES, currencyRate: 0.01}, 7, 41)).not.toThrow();
    });

    it('refuses the one concept an export cannot express, and says what to do instead', () => {
        // Goods-and-services has no Tipo_expo. A real situation rather than a typo, so the message has to
        // leave the caller somewhere to go -- the DTO cannot catch it, deciding that type 19 means export
        // being ARCA's own numbering.
        expect(codeOf(() => buildFexInvoiceRequest({...SERVICES, concept: 3}, 7, 41))).toBe('UNKNOWN_CODE');
        expect(() => buildFexInvoiceRequest({...SERVICES, concept: 3}, 7, 41)).toThrow(/separate vouchers/);
    });

    it('accepts the export-only concept, which ARCA numbers 4 rather than 3', () => {
        const other: NeutralInvoice = {
            ...SERVICES,
            concept: Concept.OTHER,
            export: {...SERVICES.export!, paymentDate: '2026-09-30'},
        };
        expect(buildFexInvoiceRequest(other, 7, 41).exportType).toBe(4);
    });

    it('requires an incoterm on an invoice for goods, and only there (1640)', () => {
        const noIncoterm = {
            ...TIERRA_DEL_FUEGO,
            export: {...TIERRA_DEL_FUEGO.export!, incoterm: undefined},
        };
        expect(codeOf(() => buildFexInvoiceRequest(noIncoterm, 7, 41))).toBe('MISSING_INCOTERM');
        // A nota for the same goods needs none.
        expect(() =>
            buildFexInvoiceRequest({...noIncoterm, documentTypeCode: 21}, 7, 41),
        ).not.toThrow();
        // Neither does a services invoice.
        expect(() => buildFexInvoiceRequest(SERVICES, 7, 41)).not.toThrow();
    });

    it('requires a payment date on an invoice for services or other (1673)', () => {
        const unpaid = {...SERVICES, export: {...SERVICES.export!, paymentDate: undefined}};
        expect(codeOf(() => buildFexInvoiceRequest(unpaid, 7, 41))).toBe('MISSING_PAYMENT_DATE');
        expect(
            codeOf(() =>
                buildFexInvoiceRequest(
                    {...unpaid, concept: Concept.OTHER},
                    7,
                    41,
                ),
            ),
        ).toBe('MISSING_PAYMENT_DATE');
        // Goods are dated by the shipment instead, and a nota is forbidden from carrying one at all.
        expect(() => buildFexInvoiceRequest({...unpaid, documentTypeCode: 20}, 7, 41)).not.toThrow();
    });

    it('refuses a shipping permit on a nota rather than dropping it (1720/1730)', () => {
        // The bug this closes: the DTO short-circuits on GOODS, so a GOODS *nota* carrying permits used to
        // reach the wire with Permisos sent and Permiso_existente omitted -- the exact pair ARCA rejects.
        const notaWithPermit: NeutralInvoice = {
            ...TIERRA_DEL_FUEGO,
            documentTypeCode: 21,
            export: {
                ...TIERRA_DEL_FUEGO.export!,
                shippingPermits: [{permitId: '99999AAXX999999A', destinationCode: '250'}],
            },
        };
        expect(codeOf(() => buildFexInvoiceRequest(notaWithPermit, 7, 41))).toBe(
            'SHIPPING_PERMIT_NOT_ALLOWED',
        );
        // Refused, not silently discarded: authorizing a different document than the caller described
        // would be worse than the rejection.
        expect(() =>
            buildFexInvoiceRequest({...notaWithPermit, documentTypeCode: 19}, 7, 41),
        ).not.toThrow();
    });

    it('holds a mode line to zero quantity, price and discount (1775)', () => {
        const withMode = (overrides: Record<string, unknown>): NeutralInvoice => ({
            ...SERVICES,
            items: [
                {description: 'Consultoría', quantity: 2, unitOfMeasureCode: 7, unitPrice: 250, totalAmount: 500},
                {description: 'Bonificación', unitOfMeasureCode: 99, totalAmount: -50, ...overrides},
            ],
        });
        expect(codeOf(() => buildFexInvoiceRequest(withMode({quantity: 1}), 7, 41))).toBe(
            'INVALID_ITEM_AMOUNT',
        );
        expect(codeOf(() => buildFexInvoiceRequest(withMode({unitPrice: 50}), 7, 41))).toBe(
            'INVALID_ITEM_AMOUNT',
        );
        expect(codeOf(() => buildFexInvoiceRequest(withMode({discount: 5}), 7, 41))).toBe(
            'INVALID_ITEM_AMOUNT',
        );
        // An explicit zero is what the rule asks for, not an omission -- both pass.
        expect(() => buildFexInvoiceRequest(withMode({quantity: 0, unitPrice: 0}), 7, 41)).not.toThrow();
        expect(() => buildFexInvoiceRequest(withMode({}), 7, 41)).not.toThrow();
    });

    it('requires a discount line to subtract, and lets a deposit go either way (1815)', () => {
        const line = (unitOfMeasureCode: number, totalAmount: number): NeutralInvoice => ({
            ...SERVICES,
            items: [
                {description: 'Consultoría', quantity: 2, unitOfMeasureCode: 7, unitPrice: 250, totalAmount: 500},
                {description: 'Ajuste', unitOfMeasureCode, totalAmount},
            ],
        });
        expect(codeOf(() => buildFexInvoiceRequest(line(99, 50), 7, 41))).toBe('INVALID_ITEM_AMOUNT');
        expect(codeOf(() => buildFexInvoiceRequest(line(99, 0), 7, 41))).toBe('INVALID_ITEM_AMOUNT');
        expect(() => buildFexInvoiceRequest(line(99, -50), 7, 41)).not.toThrow();
        // 97 is a seña/anticipo, which ARCA leaves unrestricted.
        expect(() => buildFexInvoiceRequest(line(97, 50), 7, 41)).not.toThrow();
        expect(() => buildFexInvoiceRequest(line(97, -50), 7, 41)).not.toThrow();
    });

    it('says nothing about an ordinary unit, including the escape hatch', () => {
        // 98 "otras unidades" looks like a mode and is not one -- it is an ordinary unit with no extra rule.
        const ordinary: NeutralInvoice = {
            ...SERVICES,
            items: [{description: 'Servicio', quantity: 3, unitOfMeasureCode: 98, unitPrice: 100, totalAmount: 300}],
        };
        expect(() => buildFexInvoiceRequest(ordinary, 7, 41)).not.toThrow();
    });

    it('still leaves the authority its own rules', () => {
        // 1620 (forma de pago) and the 2040-2055 nota cross-checks need ARCA's state, not its codes, so a
        // voucher missing them is built and sent rather than refused here.
        const noTerms = {...SERVICES, export: {...SERVICES.export!, paymentTerms: undefined}};
        expect(() => buildFexInvoiceRequest(noTerms, 7, 41)).not.toThrow();
        const nota = {...SERVICES, documentTypeCode: 21, associatedVouchers: undefined};
        expect(() => buildFexInvoiceRequest(nota, 7, 41)).not.toThrow();
    });
});
