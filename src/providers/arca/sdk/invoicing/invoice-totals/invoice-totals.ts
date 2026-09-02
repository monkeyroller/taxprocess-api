import {vatRateIdForPercent} from '../vat-rate-map.js';
import {roundHalfUpTo} from '../../../../rounding/rounding.js';

/**
 * VAT and total aggregation for invoice authorization: line-level tax data in, the `Iva[]` breakdown ARCA
 * expects plus the rolled-up taxed net and VAT out. Every intermediate is rounded to two decimals so the
 * summed subtotals reconcile with the header totals ARCA validates.
 */

/**
 * Rounds to two decimals, the precision every amount reaches ARCA at. Half-up on a decimal tie, because an
 * operator checking the invoice by hand adds the same column.
 */
export function roundToTwo(value: number): number {
    return roundHalfUpTo(value, 2);
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
 * Groups lines by ARCA VAT id, summing base and VAT per group. Lines with a zero net and zero VAT are
 * ignored, so a 0% group appears only when a line carries a real base at 0%.
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
