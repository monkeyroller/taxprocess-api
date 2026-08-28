import {ArcaValidationError, type CommonInvoiceResult} from '../../sdk/index.js';
import type {NeutralInvoice} from '../../../provider/provider.js';
import {
    buildCommonInvoiceRequest,
    buildQrUrl,
    concept1DateWindowError,
    toNeutralResult,
} from './invoice.mapper.js';

function invoice(overrides: Partial<NeutralInvoice> = {}): NeutralInvoice {
    return {
        documentTypeCode: 1,
        concept: 1,
        pointOfSaleNumber: 1,
        voucherNumberFrom: 1,
        voucherNumberTo: 1,
        receiver: {identificationTypeCode: 80, identificationNumber: '20111111112', fiscalConditionCode: 1},
        currencyIso: 'ARS',
        currencyRate: 1,
        issueDate: '2026-08-05',
        lines: [{netAmount: 100, taxRatePercent: 21, taxAmount: 21}],
        ...overrides,
    };
}

const NOW = new Date('2026-08-05T15:00:00-03:00');

describe('buildCommonInvoiceRequest', () => {
    it('rolls up totals and defaults currency to PES', () => {
        const req = buildCommonInvoiceRequest(invoice(), 10);
        expect(req.netTaxed).toBe(100);
        expect(req.vatAmount).toBe(21);
        expect(req.totalAmount).toBe(121);
        expect(req.currencyId).toBe('PES');
        expect(req.voucherNumberFrom).toBe(10);
        expect(req.voucherNumberTo).toBe(10);
        expect(req.voucherDate).toBe('20260805');
        expect(req.vatSubtotals).toHaveLength(1);
        expect(req.vatSubtotals[0]?.BaseImp).toBe(100);
        expect(req.vatSubtotals[0]?.Importe).toBe(21);
        expect(req.tributes).toBeUndefined();
    });

    it('resolves canonical codes to ARCA codes', () => {
        const req = buildCommonInvoiceRequest(invoice(), 1);
        expect(req.voucherType).toBe(1); // documentTypeCode 1 → CbteTipo 1
        expect(req.docType).toBe(80); // identificationTypeCode 80 → DocTipo 80 (CUIT)
        expect(req.docNumber).toBe(20_111_111_112); // identificationNumber string → number
        expect(req.receiverIvaConditionId).toBe(1); // fiscalConditionCode 1 → CondicionIVAReceptorId 1
    });

    it('maps perceptions to a single Otros (99) tribute', () => {
        const req = buildCommonInvoiceRequest(invoice({totals: {perceptions: 50}}), 1);
        expect(req.tributesAmount).toBe(50);
        expect(req.totalAmount).toBe(171);
        expect(req.tributes).toHaveLength(1);
        expect(req.tributes?.[0]).toMatchObject({id: 99, amount: 50, rate: 50, baseAmount: 100});
    });

    it('maps ISO currency to ARCA MonId and rejects an unmapped currency', () => {
        expect(buildCommonInvoiceRequest(invoice({currencyIso: 'USD'}), 1).currencyId).toBe('DOL');
        expect(() => buildCommonInvoiceRequest(invoice({currencyIso: 'xyz'}), 1)).toThrow(ArcaValidationError);
    });

    it('rejects a non-numeric receiver identification number instead of sending NaN', () => {
        expect(() =>
            buildCommonInvoiceRequest(invoice({receiver: {identificationTypeCode: 80, identificationNumber: '20-1111111-2', fiscalConditionCode: 1}}), 1),
        ).toThrow(ArcaValidationError);
    });

    it("sends an out-of-window concept-1 date as-is — the window is the caller's check, not the builder's", () => {
        // The builder stays clock-free so idempotent recovery can still reconcile a stale resend against
        // the stored voucher; rejecting the date is `concept1DateWindowError`'s job.
        expect(buildCommonInvoiceRequest(invoice({issueDate: '2020-01-01'}), 1).voucherDate).toBe('20200101');
    });

    it('rejects an ISO-8601 form the Date parser cannot read instead of crashing in formatArcaDate', () => {
        // `@IsISO8601` is non-strict, so week/ordinal/basic forms reach the mapper. Left unchecked they
        // yield an Invalid Date that survives every comparison and throws RangeError → an opaque 500.
        for (const issueDate of ['2026-W01-1', '2026-366', '20260231', '2026-08-05 12:00:00']) {
            expect(() => buildCommonInvoiceRequest(invoice({issueDate}), 1)).toThrow(ArcaValidationError);
            expect(() => buildCommonInvoiceRequest(invoice({issueDate}), 1)).toThrow(/not a usable ISO-8601 date/);
        }
    });
});

describe('concept1DateWindowError', () => {
    it('rejects an out-of-window concept-1 date instead of silently substituting now', () => {
        const err = concept1DateWindowError(invoice({issueDate: '2020-01-01'}), NOW);
        expect(err).toBeInstanceOf(ArcaValidationError);
        expect(err?.message).toMatch(/outside ARCA's ±5-day window/);
        expect(err?.code).toBe('VOUCHER_DATE_OUT_OF_WINDOW');
    });

    it('accepts a date exactly 5 calendar days out regardless of the hour of the request', () => {
        // Measured in AR calendar days, not raw milliseconds: a noon-anchored issueDate 5 days back is
        // 5.25 raw days away at 18:00 AR, and must NOT flip to a rejection just because of the clock.
        for (const hour of ['00:01', '11:59', '18:00', '23:59']) {
            const now = new Date(`2026-08-10T${hour}:00-03:00`);
            expect(concept1DateWindowError(invoice({issueDate: '2026-08-05'}), now)).toBeUndefined();
            expect(concept1DateWindowError(invoice({issueDate: '2026-08-15'}), now)).toBeUndefined();
            expect(concept1DateWindowError(invoice({issueDate: '2026-08-04'}), now)).toBeInstanceOf(
                ArcaValidationError,
            );
        }
    });

    it('does not enforce the ±5-day window for concept 2/3 (services)', () => {
        const services = invoice({
            concept: 2,
            issueDate: '2020-01-01',
            serviceDateFrom: '2020-01-01',
            serviceDateTo: '2020-01-31',
        });
        expect(concept1DateWindowError(services, NOW)).toBeUndefined();
        expect(buildCommonInvoiceRequest(services, 1).voucherDate).toBe('20200101');
    });
});

describe('buildQrUrl', () => {
    it('encodes the RG-4892 payload with the CAE', () => {
        const req = buildCommonInvoiceRequest(invoice(), 10);
        const url = buildQrUrl('20999999993', req, '75123456789012');
        expect(url.startsWith('https://www.arca.gob.ar/fe/qr/?p=')).toBe(true);
        const encoded = url.split('?p=')[1] ?? '';
        const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<string, unknown>;
        expect(payload['cuit']).toBe(20_999_999_993);
        expect(payload['codAut']).toBe(75_123_456_789_012);
        expect(payload['nroCmp']).toBe(10);
        expect(payload['importe']).toBe(121);
    });
});

describe('toNeutralResult', () => {
    const approved: CommonInvoiceResult = {
        result: 'A',
        cae: '75123456789012',
        caeExpiration: '20260815',
        voucherNumberFrom: 10,
        voucherNumberTo: 10,
        observations: [],
        raw: {},
    };

    it('maps an approved result', () => {
        const r = toNeutralResult(approved, 'qr-url');
        expect(r.status).toBe('AUTHORIZED');
        expect(r.authorizationCode).toBe('75123456789012');
        expect(r.authorizedNumber).toBe(10);
        expect(r.qr).toBe('qr-url');
        expect(r.expiration).toContain('2026-08-15');
        expect(r.providerMetadata).toEqual({});
    });

    /**
     * ARCA authorizes with observations more often than it rejects with them. The mapper must forward them on
     * the AUTHORIZED path unchanged — a status-conditional `observations` here would strip the authority's
     * only notice about an accepted voucher before core ever sees it (`docs/CONTRACT.md`, `/invoices/authorize`).
     */
    it('keeps observations on an approved result, alongside the CAE and QR', () => {
        const r = toNeutralResult(
            {
                ...approved,
                observations: [
                    {code: '10063', message: 'El comprobante fue autorizado con observaciones'},
                    {code: '10192', message: 'segunda observacion'},
                ],
            },
            'qr-url',
        );

        expect(r.status).toBe('AUTHORIZED');
        expect(r.authorizationCode).toBe('75123456789012');
        expect(r.qr).toBe('qr-url');
        expect(r.observations).toEqual([
            {code: '10063', message: 'El comprobante fue autorizado con observaciones'},
            {code: '10192', message: 'segunda observacion'},
        ]);
    });

    it('maps a rejected result with observations and no CAE', () => {
        const r = toNeutralResult({
            ...approved,
            result: 'R',
            cae: undefined,
            caeExpiration: undefined,
            observations: [{code: '10016', message: 'bad'}],
        });
        expect(r.status).toBe('REJECTED');
        expect(r.authorizationCode).toBe('');
        expect(r.qr).toBeUndefined();
        expect(r.observations).toHaveLength(1);
        expect(r.providerMetadata).toEqual({});
    });
});

describe('buildCommonInvoiceRequest — letter-C vouchers report no VAT', () => {
    /** Sale 409's shape: a FACTURA C whose lines still carry a 21% breakdown, plus perceptions. */
    function facturaC(overrides: Partial<NeutralInvoice> = {}): NeutralInvoice {
        return invoice({
            documentTypeCode: 11,
            receiver: {identificationTypeCode: 80, identificationNumber: '20273896520', fiscalConditionCode: 5},
            lines: [
                {netAmount: 6564.44, taxRatePercent: 21, taxAmount: 1378.53},
                {netAmount: 17000.06, taxRatePercent: 21, taxAmount: 3570.01},
            ],
            totals: {untaxed: 0, exempt: 0, perceptions: 871.29},
            ...overrides,
        });
    }

    it('folds the VAT into ImpNeto and reports no Iva array (ARCA 10047 / 10071)', () => {
        const req = buildCommonInvoiceRequest(facturaC(), 1);

        expect(req.vatAmount).toBe(0);
        expect(req.vatSubtotals).toEqual([]);
        // 6564.44 + 1378.53 + 17000.06 + 3570.01
        expect(req.netTaxed).toBe(28513.04);
    });

    it('levies the perception over the collapsed net, which is the real sale amount', () => {
        const req = buildCommonInvoiceRequest(facturaC(), 1);

        // Not the 23564.50 an A/B would report: a type-C issuer has no débito fiscal, so the net/VAT split is
        // core's internal costing and the perception was levied on the whole 28513.04.
        expect(req.tributes?.[0]).toMatchObject({id: 99, baseAmount: 28513.04, amount: 871.29});
        expect(req.tributes?.[0]?.rate).toBe(3.06);
    });

    it('satisfies ImpTotal = ImpNeto + ImpTrib even with perceptions (ARCA 10048)', () => {
        const req = buildCommonInvoiceRequest(facturaC(), 1);

        expect(req.totalAmount).toBe(roundTwo(req.netTaxed + req.tributesAmount));
        // The legacy implementation set ImpNeto = ImpTotal, which overstates the net by exactly the
        // tributes and re-triggers 10048 the moment perceptions exist.
        expect(req.netTaxed).not.toBe(req.totalAmount);
        expect(req.totalAmount).toBe(29384.33);
    });

    it('zeroes ImpTotConc and ImpOpEx, folding them into the net', () => {
        const req = buildCommonInvoiceRequest(
            facturaC({totals: {untaxed: 50, exempt: 25, perceptions: 0}}),
            1,
        );

        expect(req.netUntaxed).toBe(0);
        expect(req.exempt).toBe(0);
        expect(req.netTaxed).toBe(28588.04);
        expect(req.totalAmount).toBe(28588.04);
    });

    it('never reaches the alícuota map, so a coefficient-derived rate cannot fail here', () => {
        // 13.5% has no ARCA id; on an A/B voucher this throws UNKNOWN_VAT_RATE. On a C it is irrelevant,
        // because the collapse happens before any lookup.
        const req = buildCommonInvoiceRequest(
            facturaC({lines: [{netAmount: 100, taxRatePercent: 13.5, taxAmount: 13.5}]}),
            1,
        );

        expect(req.vatSubtotals).toEqual([]);
        expect(req.netTaxed).toBe(113.5);
    });

    it('handles an already-zero-rated C sale, which is the normal case after the coefficient', () => {
        const req = buildCommonInvoiceRequest(
            facturaC({
                lines: [{netAmount: 23564.5, taxRatePercent: 0, taxAmount: 0}],
                totals: {untaxed: 0, exempt: 0, perceptions: 871.29},
            }),
            1,
        );

        expect(req.vatAmount).toBe(0);
        expect(req.vatSubtotals).toEqual([]);
        expect(req.netTaxed).toBe(23564.5);
        expect(req.totalAmount).toBe(24435.79);
    });

    it.each([
        ['NOTA DE DEBITO C', 12],
        ['NOTA DE CREDITO C', 13],
        ['RECIBO C', 15],
        ['FCE FACTURA C', 211],
    ])('applies to %s (code %i) as well as the factura', (_name, documentTypeCode) => {
        const req = buildCommonInvoiceRequest(facturaC({documentTypeCode}), 1);

        expect(req.vatAmount).toBe(0);
        expect(req.vatSubtotals).toEqual([]);
    });

    it.each([
        ['FACTURA A', 1],
        ['FACTURA B', 6],
        ['FACTURA M', 51],
    ])('leaves %s (code %i) discriminating VAT exactly as before', (_name, documentTypeCode) => {
        // B does not PRINT the VAT but still reports it; M discriminates like an A.
        const req = buildCommonInvoiceRequest(facturaC({documentTypeCode}), 1);

        expect(req.vatAmount).toBe(4948.54);
        expect(req.netTaxed).toBe(23564.5);
        expect(req.vatSubtotals).toHaveLength(1);
        expect(req.vatSubtotals[0]?.Id).toBe(5);
    });
});

/** Local 2-dp rounding, mirroring the SDK's, so the assertions do not depend on float noise. */
function roundTwo(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

describe('buildCommonInvoiceRequest — an invoice with no taxed lines', () => {
    it('accepts an empty lines array, carrying the money in the header totals', () => {
        // Core sends TAXED lines only, so a sale whose every line is zero-rated arrives with none at all.
        // This is the normal shape for a Monotributo issuer once the line-tax coefficient zeroes each rate.
        const req = buildCommonInvoiceRequest(
            invoice({
                documentTypeCode: 11,
                lines: [],
                totals: {untaxed: 23564.5, exempt: 0, perceptions: 871.29},
            }),
            1,
        );

        expect(req.vatAmount).toBe(0);
        expect(req.vatSubtotals).toEqual([]);
        // Letter C folds ImpTotConc into ImpNeto, so nothing is lost and nothing is counted twice.
        expect(req.netTaxed).toBe(23564.5);
        expect(req.netUntaxed).toBe(0);
        expect(req.totalAmount).toBe(24435.79);
    });

    it('keeps an untaxed-only A/B voucher reporting ImpTotConc rather than ImpNeto', () => {
        const req = buildCommonInvoiceRequest(
            invoice({documentTypeCode: 6, lines: [], totals: {untaxed: 500, exempt: 100, perceptions: 0}}),
            1,
        );

        expect(req.netTaxed).toBe(0);
        expect(req.netUntaxed).toBe(500);
        expect(req.exempt).toBe(100);
        expect(req.vatAmount).toBe(0);
        expect(req.totalAmount).toBe(600);
    });
});
