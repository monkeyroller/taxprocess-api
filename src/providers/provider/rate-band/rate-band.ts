/**
 * The accepted band around an authority's published exchange rate: the vocabulary, and the arithmetic that
 * resolves one rate against one entity's rule.
 *
 * Shape and mechanism only — no entity's numbers live here. Which band an authority accepts is that
 * authority's tax policy and belongs in its provider. What is shared is the form of such a rule — a bound
 * expressed as a fraction of the rate, an excess over it, or a flat number of currency units — and the
 * arithmetic turning the pair into two inclusive limits.
 *
 * This module must never import from `http/dto`, directly or transitively. The currency-rates DTO imports
 * `BandBasis` from here and `neutral-results.ts` imports that DTO back, so a path from here into `http/dto`
 * would close a cycle through the decorated DTO classes and evaluate against a half-initialized module.
 * Another dependency-free leaf is fine; a DTO is not.
 */
import {roundTo} from '../../rounding/rounding.js';

/**
 * How a band was derived, as the wire reports it. Informational — a caller enforces the limits, it does not
 * branch on this.
 */
export type BandBasis = 'EXACT' | 'TOLERANCE' | 'REFERENCE';

/**
 * How one bound is derived from the published rate `R`.
 *
 * - `FRACTION_OF` — the bound *is* a fraction of the rate: `value × R`
 * - `EXCESS_OVER` — the bound is the rate moved by a multiple of itself: `R ± value × R`
 * - `PLUS_UNITS` — the bound is the rate moved by a flat amount, in currency units: `R ± value`
 *
 * The distinction is why a bound is data rather than arithmetic: authorities write these rules in prose, and
 * the same sentence read the two obvious ways can differ by a factor of fifty. Whichever reading an
 * authority actually enforces is a measurement, so it belongs in that authority's provider.
 */
export type BandBoundMode = 'FRACTION_OF' | 'EXCESS_OVER' | 'PLUS_UNITS';

/** One bound of a band, as a rule rather than a number, so it survives the authority re-wording it. */
export interface BandBound {
    readonly mode: BandBoundMode;
    readonly value: number;
}

/**
 * One authority's band policy. The two bounds are configured independently on purpose — nothing requires an
 * authority to express its floor and its ceiling in the same form, and assuming they match is the natural
 * misreading.
 */
export interface BandRule {
    readonly lower: BandBound;
    readonly upper: BandBound;
    /**
     * ISO date the rule was last confirmed against the authority itself. `undefined` means the value is a
     * reading of the authority's documentation, not a measurement of its behaviour.
     */
    readonly measuredOn?: string;
}

/** A resolved band around a published rate. Both bounds are inclusive. */
export interface RateBand {
    readonly rate: number;
    readonly lowerLimit: number;
    readonly upperLimit: number;
    readonly bandBasis: BandBasis;
}

/**
 * The wire carries a rate and its limits at six decimals, so a finer limit could never be hit exactly. An
 * entity whose authority takes a different precision should carry it on its `BandRule` rather than fork
 * this function. Plain rounding rather than the half-up form money uses: a band limit is an advisory bound,
 * not an amount anyone adds up.
 */
const WIRE_DECIMALS = 6;

function roundToWire(value: number): number {
    return roundTo(value, WIRE_DECIMALS);
}

/** One bound resolved against `rate`. `direction` is `-1` for the floor and `1` for the ceiling. */
function resolveBound(rate: number, bound: BandBound, direction: -1 | 1): number {
    switch (bound.mode) {
        case 'FRACTION_OF':
            return rate * bound.value;
        case 'EXCESS_OVER':
            return rate + direction * rate * bound.value;
        case 'PLUS_UNITS':
            return rate + direction * bound.value;
    }
}

/**
 * The band around one published rate, per `rule`. `bandBasis` is `TOLERANCE` for any rule that produces a
 * range and `EXACT` only where the rule collapses to a point — never invented, since a caller told `EXACT`
 * enforces strictly.
 *
 * The floor is clamped at zero: a negative lower bound is reachable with a value wider than the rate itself,
 * and would be nonsense on the wire rather than merely unreachable.
 */
export function toBand(rate: number, rule: BandRule): RateBand {
    const lowerLimit = roundToWire(Math.max(0, resolveBound(rate, rule.lower, -1)));
    const upperLimit = roundToWire(resolveBound(rate, rule.upper, 1));
    return {
        rate: roundToWire(rate),
        lowerLimit,
        upperLimit,
        bandBasis: lowerLimit === upperLimit ? 'EXACT' : 'TOLERANCE',
    };
}
