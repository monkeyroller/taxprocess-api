import {buildArcaQrUrl, formatArcaDate, parseArcaDate} from './arca-qr.js';

describe('ARCA date format', () => {
    it('formats and parses yyyymmdd in Argentina local time', () => {
        // 2026-08-04 03:00Z is still 2026-08-04 00:00 in Buenos Aires (UTC-3).
        expect(formatArcaDate(new Date('2026-08-04T03:00:00Z'))).toBe('20260804');
        // 2026-08-04 02:00Z is 2026-08-03 23:00 in Buenos Aires — previous day.
        expect(formatArcaDate(new Date('2026-08-04T02:00:00Z'))).toBe('20260803');

        const parsed = parseArcaDate('20260804');
        expect(parsed.toISOString()).toBe('2026-08-04T03:00:00.000Z');
    });
});

describe('buildArcaQrUrl', () => {
    it('encodes the RG 4892 payload as base64 JSON on the ARCA QR URL', () => {
        const url = buildArcaQrUrl({
            date: new Date('2026-08-04T12:00:00Z'),
            cuit: 20111111112,
            salesPointNumber: 3,
            voucherType: 6,
            voucherNumber: 145,
            totalAmount: 121.0,
            currencyId: 'PES',
            currencyRate: 1,
            docType: 80,
            docNumber: 30712345678,
            cae: '75123456789012',
        });

        expect(url.startsWith('https://www.arca.gob.ar/fe/qr/?p=')).toBe(true);

        const base64 = url.split('?p=')[1];
        const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
        expect(payload).toEqual({
            ver: 1,
            fecha: '2026-08-04',
            cuit: 20111111112,
            ptoVta: 3,
            tipoCmp: 6,
            nroCmp: 145,
            importe: 121.0,
            moneda: 'PES',
            ctz: 1,
            tipoDocRec: 80,
            nroDocRec: 30712345678,
            tipoCodAut: 'E',
            codAut: 75123456789012,
        });
    });
});
