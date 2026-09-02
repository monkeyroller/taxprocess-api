/**
 * Decimal rounding at a given precision. Two functions because the difference is observable at exactly the
 * magnitudes that matter: `1.005` rounds to `1.01` under `roundHalfUpTo` and to `1.00` under `roundTo`.
 * Which precision to use is the caller's, being a property of the wire it writes to.
 */

/** Rounds to `decimals` decimal places, on the binary value as stored. */
export function roundTo(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

/**
 * As `roundTo`, but nudged by one epsilon first, so a value that is a tie as written in decimal rounds up.
 * `1.005` is not stored as `1.005` — the nearest double is `1.00499999999999989…` — so a plain round takes
 * it down, which reads as a bug to anyone checking an invoice by hand. Use this for money.
 *
 * A correction for representation error rather than a general round-half-up guarantee: the nudge is a fixed
 * absolute amount, so it stops mattering once one epsilon falls below `value`'s ULP.
 */
export function roundHalfUpTo(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}
