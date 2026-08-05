import {vatRateIdForPercent} from './vat-rate-map.js';

/**
 * Pure VAT/total aggregation for invoice authorization. No I/O — the application layer feeds it
 * line-level tax data extracted from a sale, and it returns the `Iva[]` breakdown ARCA expects plus
 * the rolled-up taxed net and VAT amounts. Every intermediate is rounded to two decimals so the
 * summed subtotals reconcile with the header totals ARCA validates.
 */

/** Rounds to two decimals, nudging past binary-float representation error. */
export function roundToTwo(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** One taxable line's contribution: its net (base imponible) and VAT amount at a given rate. */
export interface InvoiceLineTax {
    /** VAT percentage, e.g. 21 or 10.5. */
    vatRatePercent: number;
    /** Net (pre-VAT) amount for this line. */
    netAmount: number;
    /** VAT amount for this line. */
    vatAmount: number;
}

/** An ARCA `Iva` subtotal entry (one per distinct alícuota). */
export interface VatSubtotal {
    Id: number;
    BaseImp: number;
    Importe: number;
}

export interface InvoiceTotals {
    /** `ImpNeto` — total taxed net. */
    netTaxed: number;
    /** `ImpIVA` — total VAT. */
    vat: number;
    /** `Iva[]` — one subtotal per VAT rate present, ascending by ARCA id. */
    subtotals: Array<VatSubtotal>;
}

/**
 * Groups lines by ARCA VAT id, summing base and VAT per group, and returns the subtotals and header
 * roll-ups. Lines with a zero net and zero VAT are ignored so a 0% group only appears when a line
 * actually carries a base at 0% (as ARCA requires for exempt-but-declared bases).
 */
export function calculateTotals(lines: ReadonlyArray<InvoiceLineTax>): InvoiceTotals {
    const byId = new Map<number, {base: number; vat: number}>();

    for (const line of lines) {
        if (line.netAmount === 0 && line.vatAmount === 0) {
            continue;
        }
        const id = vatRateIdForPercent(line.vatRatePercent);
        const acc = byId.get(id) ?? {base: 0, vat: 0};
        acc.base += line.netAmount;
        acc.vat += line.vatAmount;
        byId.set(id, acc);
    }

    const subtotals: Array<VatSubtotal> = [...byId.entries()]
        .sort(([a], [b]) => a - b)
        .map(([id, {base, vat}]) => ({
            Id: id,
            BaseImp: roundToTwo(base),
            Importe: roundToTwo(vat),
        }));

    const netTaxed = roundToTwo(subtotals.reduce((sum, s) => sum + s.BaseImp, 0));
    const vat = roundToTwo(subtotals.reduce((sum, s) => sum + s.Importe, 0));

    return {netTaxed, vat, subtotals};
}
