import {formatArcaDate, type CommonInvoiceResult} from '../../arca/index.js';
import type {ArgentinaInvoiceDto} from '../dto/invoice.dto.js';
import {buildCommonInvoiceRequest, buildQrUrl, toNeutralResult} from './ar-invoice.mapper.js';

function invoice(overrides: Partial<ArgentinaInvoiceDto> = {}): ArgentinaInvoiceDto {
    return {
        voucherType: 1,
        concept: 1,
        salesPointNumber: 1,
        receiverIvaConditionId: 1,
        receiverDocType: 80,
        receiverDocNumber: 20_111_111_112,
        currency: 'ARS',
        currencyRate: 1,
        issueDate: '2026-08-05',
        lines: [{netAmount: 100, vatRatePercent: 21, vatAmount: 21}],
        ...overrides,
    };
}

const NOW = new Date('2026-08-05T15:00:00-03:00');

describe('buildCommonInvoiceRequest', () => {
    it('rolls up totals and defaults currency to PES', () => {
        const req = buildCommonInvoiceRequest(invoice(), 10, NOW);
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

    it('maps perceptions to a single Otros (99) tribute', () => {
        const req = buildCommonInvoiceRequest(invoice({perceptionsTotal: 50}), 1, NOW);
        expect(req.tributesAmount).toBe(50);
        expect(req.totalAmount).toBe(171);
        expect(req.tributes).toHaveLength(1);
        expect(req.tributes?.[0]).toMatchObject({id: 99, amount: 50, rate: 50, baseAmount: 100});
    });

    it('maps ISO currency to ARCA MonId (unknown falls back to PES)', () => {
        expect(buildCommonInvoiceRequest(invoice({currency: 'USD'}), 1, NOW).currencyId).toBe('DOL');
        expect(buildCommonInvoiceRequest(invoice({currency: 'xyz'}), 1, NOW).currencyId).toBe('PES');
    });

    it('clamps an out-of-window concept-1 date to now', () => {
        const req = buildCommonInvoiceRequest(invoice({issueDate: '2020-01-01'}), 1, NOW);
        expect(req.voucherDate).toBe(formatArcaDate(NOW));
    });
});

describe('buildQrUrl', () => {
    it('encodes the RG-4892 payload with the CAE', () => {
        const req = buildCommonInvoiceRequest(invoice(), 10, NOW);
        const url = buildQrUrl(20_999_999_993, req, '75123456789012');
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
    });
});
