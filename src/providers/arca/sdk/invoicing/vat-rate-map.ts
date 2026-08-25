import {ArcaValidationError} from '../core/errors.js';

/**
 * ARCA VAT ("alícuota de IVA") catalog: percentage → ARCA `Iva.Id`.
 * These ids are fixed by ARCA and shared across WSFEv1/WSFEXv1.
 */
export const VAT_RATE_IDS: ReadonlyArray<{percent: number; id: number}> = [
    {percent: 0, id: 3},
    {percent: 10.5, id: 4},
    {percent: 21, id: 5},
    {percent: 27, id: 6},
    {percent: 5, id: 8},
    {percent: 2.5, id: 9},
];

const PERCENT_TO_ID = new Map<number, number>(VAT_RATE_IDS.map(({percent, id}) => [percent, id]));

/** Maps a VAT percentage (e.g. 21) to its ARCA `Iva.Id`. Throws for an unrecognized rate. */
export function vatRateIdForPercent(percent: number): number {
    const id = PERCENT_TO_ID.get(percent);
    if (id === undefined) {
        throw new ArcaValidationError(
            `Unknown VAT rate ${percent}% — no ARCA alícuota id. Valid rates: ${VAT_RATE_IDS.map((r) => r.percent).join(', ')}.`,
            'UNKNOWN_VAT_RATE',
        );
    }
    return id;
}
