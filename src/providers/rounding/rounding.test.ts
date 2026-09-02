import {describe, expect, it} from '@jest/globals';
import {roundHalfUpTo, roundTo} from './rounding.js';

/**
 * The two roundings, and the gap between them.
 *
 * The gap is the point of these tests. Both forms existed in the codebase as separate one-liners, and it
 * would be natural for a later cleanup to notice the duplication and unify them — which would move money.
 */
describe('rounding', () => {
    it('differs on a decimal tie, which is why both exist', () => {
        // `1.005` is stored as 1.00499999999999989…, so the plain form rounds DOWN.
        expect(roundTo(1.005, 2)).toBe(1);
        expect(roundHalfUpTo(1.005, 2)).toBe(1.01);
    });

    it('agrees everywhere the representation is not on a boundary', () => {
        for (const value of [2.4969, 18000, 0.1, 1234.567, 29.3111114]) {
            expect(roundTo(value, 2)).toBe(roundHalfUpTo(value, 2));
        }
    });

    it('rounds at the requested precision', () => {
        expect(roundTo(1465.5555555, 6)).toBe(1465.555556);
        expect(roundTo(23.1638999999, 6)).toBe(23.1639);
        expect(roundHalfUpTo(2.4969, 2)).toBe(2.5);
    });

    it('leaves a value already at the precision untouched', () => {
        expect(roundTo(18000, 2)).toBe(18000);
        expect(roundHalfUpTo(18000, 2)).toBe(18000);
        expect(roundTo(0, 6)).toBe(0);
    });

    it('keeps the sign', () => {
        expect(roundTo(-1.239, 2)).toBe(-1.24);
        expect(roundHalfUpTo(-1.239, 2)).toBe(-1.24);
    });
});
