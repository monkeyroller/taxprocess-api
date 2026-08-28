import {calculateTotals, roundToTwo, type InvoiceLineTax} from './invoice-totals.js';

describe('roundToTwo', () => {
    it('rounds to two decimals past float error', () => {
        expect(roundToTwo(1.005)).toBe(1.01);
        expect(roundToTwo(2.4969)).toBe(2.5);
        expect(roundToTwo(18000)).toBe(18000);
    });
});

describe('calculateTotals', () => {
    it('groups lines by VAT rate into ARCA alícuota subtotals', () => {
        const lines: Array<InvoiceLineTax> = [
            {vatRatePercent: 21, netAmount: 18000, vatAmount: 3780},
            {vatRatePercent: 21, netAmount: 1000, vatAmount: 210},
            {vatRatePercent: 27, netAmount: 500, vatAmount: 135},
        ];

        const totals = calculateTotals(lines);

        // Ascending by ARCA id: 21% -> 5, 27% -> 6.
        expect(totals.subtotals).toEqual([
            {Id: 5, BaseImp: 19000, Importe: 3990},
            {Id: 6, BaseImp: 500, Importe: 135},
        ]);
        expect(totals.netTaxed).toBe(19500);
        expect(totals.vat).toBe(4125);
    });

    it('keeps a 0% line as a base at alícuota id 3 (Importe 0)', () => {
        const totals = calculateTotals([{vatRatePercent: 0, netAmount: 1170, vatAmount: 0}]);
        expect(totals.subtotals).toEqual([{Id: 3, BaseImp: 1170, Importe: 0}]);
        expect(totals.netTaxed).toBe(1170);
        expect(totals.vat).toBe(0);
    });

    it('ignores fully-zero lines', () => {
        const totals = calculateTotals([{vatRatePercent: 21, netAmount: 0, vatAmount: 0}]);
        expect(totals.subtotals).toEqual([]);
        expect(totals.netTaxed).toBe(0);
        expect(totals.vat).toBe(0);
    });

    it('throws on an unknown VAT rate', () => {
        expect(() => calculateTotals([{vatRatePercent: 13, netAmount: 100, vatAmount: 13}])).toThrow();
    });
});
