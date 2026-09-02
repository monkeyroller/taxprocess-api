import {describe, expect, it} from '@jest/globals';
import {toBand, type BandRule} from './rate-band.js';

/**
 * The band arithmetic across all three bound modes. Every case passes its rule in explicitly, which is the
 * point of the module: while the rule was a module-level constant only ARCA's own combination was
 * reachable, so two of the three modes had no test and the `EXACT` collapse no caller.
 */
describe('toBand', () => {
    const rule = (lower: BandRule['lower'], upper: BandRule['upper']): BandRule => ({lower, upper});

    it('reads FRACTION_OF as a fraction of the rate', () => {
        const band = toBand(100, rule({mode: 'FRACTION_OF', value: 0.02}, {mode: 'FRACTION_OF', value: 4}));
        expect(band).toEqual({rate: 100, lowerLimit: 2, upperLimit: 400, bandBasis: 'TOLERANCE'});
    });

    it('reads EXCESS_OVER as the rate moved by a multiple of itself', () => {
        // `R ± value × R`, so an upper of 4 is 5R and NOT 4R — the distinction that separates the two
        // readings of a "superior en un 400%" style rule.
        const band = toBand(100, rule({mode: 'EXCESS_OVER', value: 0.02}, {mode: 'EXCESS_OVER', value: 4}));
        expect(band).toEqual({rate: 100, lowerLimit: 98, upperLimit: 500, bandBasis: 'TOLERANCE'});
    });

    it('reads PLUS_UNITS as a flat number of currency units', () => {
        const band = toBand(100, rule({mode: 'PLUS_UNITS', value: 1}, {mode: 'PLUS_UNITS', value: 1.5}));
        expect(band).toEqual({rate: 100, lowerLimit: 99, upperLimit: 101.5, bandBasis: 'TOLERANCE'});
    });

    it('resolves the two bounds independently, each in its own form', () => {
        // Nothing requires an authority to express its floor and ceiling the same way, and the mixed rule
        // is not hypothetical: it is what ARCA was measured to enforce.
        const band = toBand(1158.195, rule({mode: 'FRACTION_OF', value: 0.02}, {mode: 'EXCESS_OVER', value: 4}));
        expect(band.lowerLimit).toBe(23.1639);
        expect(band.upperLimit).toBe(5790.975);
    });

    it('reports EXACT, not TOLERANCE, when a rule collapses to a point', () => {
        // Unreachable while the rule was a constant. A caller told `EXACT` enforces strictly, so it must be
        // reported only when the band really is a point — and must be reported when it is.
        const band = toBand(42, rule({mode: 'PLUS_UNITS', value: 0}, {mode: 'PLUS_UNITS', value: 0}));
        expect(band).toEqual({rate: 42, lowerLimit: 42, upperLimit: 42, bandBasis: 'EXACT'});
    });

    it('clamps the floor at zero rather than reporting a negative limit', () => {
        // Reachable under PLUS_UNITS or EXCESS_OVER wider than the rate itself. A negative bound would be
        // nonsense on the wire rather than merely unreachable.
        const flat = toBand(10, rule({mode: 'PLUS_UNITS', value: 25}, {mode: 'PLUS_UNITS', value: 1}));
        expect(flat.lowerLimit).toBe(0);
        const proportional = toBand(10, rule({mode: 'EXCESS_OVER', value: 3}, {mode: 'EXCESS_OVER', value: 1}));
        expect(proportional.lowerLimit).toBe(0);
    });

    it('rounds the rate and both limits to the six decimals the wire carries', () => {
        // A limit finer than the wire's precision could never be hit exactly, and comparing an unrounded
        // product against it fails on differences no authority can see.
        const band = toBand(1465.5555555, rule({mode: 'FRACTION_OF', value: 0.02}, {mode: 'EXCESS_OVER', value: 4}));
        expect(band.rate).toBe(1465.555556);
        expect(band.lowerLimit).toBe(29.311111);
    });

    it('ignores measuredOn, which is provenance for a human rather than an input', () => {
        const bare = rule({mode: 'FRACTION_OF', value: 0.02}, {mode: 'EXCESS_OVER', value: 4});
        expect(toBand(100, {...bare, measuredOn: '2026-08-31'})).toEqual(toBand(100, bare));
    });
});
