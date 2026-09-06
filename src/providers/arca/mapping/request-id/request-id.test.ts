import {describe, expect, it} from '@jest/globals';
import {nextRequestId} from './request-id.js';

/** ARCA types `Cmp.Id` as `Long(N15)`, so the value has to stay inside fifteen digits. */
const MAX_N15 = 999_999_999_999_999;

describe('nextRequestId', () => {
    it('stays inside the field ARCA declares, now and for centuries', () => {
        expect(nextRequestId(new Date('2026-09-06T12:00:00Z'), () => 0.99)).toBeLessThanOrEqual(MAX_N15);
        // Epoch milliseconds reaches fourteen digits in 2286; two entropy digits still fit under N15.
        expect(nextRequestId(new Date('2285-01-01T00:00:00Z'), () => 0.99)).toBeLessThanOrEqual(MAX_N15);
    });

    it('is a non-negative integer, which is the only rule ARCA states (1014)', () => {
        const id = nextRequestId(new Date('2026-09-06T12:00:00Z'), () => 0.5);
        expect(Number.isInteger(id)).toBe(true);
        expect(id).toBeGreaterThanOrEqual(0);
    });

    it('separates two ids drawn in the same millisecond', () => {
        // The case a counter cannot serve without a lock this service has nowhere to keep: two instances
        // issuing for one issuer at the same instant.
        const instant = new Date('2026-09-06T12:00:00.000Z');
        expect(nextRequestId(instant, () => 0.11)).not.toBe(nextRequestId(instant, () => 0.87));
    });

    it('separates two ids drawn a millisecond apart, whatever the entropy', () => {
        const entropy = (): number => 0.5;
        const first = nextRequestId(new Date('2026-09-06T12:00:00.000Z'), entropy);
        const second = nextRequestId(new Date('2026-09-06T12:00:00.001Z'), entropy);
        expect(second).toBe(first + 100);
    });

    it('keeps every id for one millisecond inside that millisecond, and spreads them across it', () => {
        // The invariant that matters: an id never borrows the next millisecond's space (which would collide
        // with a real one issued then), and the entropy is not decorative. Drawn with the real source, since
        // stubbing a ramp only measures float rounding in the test's own inputs.
        const instant = new Date('2026-09-06T12:00:00.000Z');
        const floor = instant.getTime() * 100;
        const drawn = new Set<number>();
        for (let i = 0; i < 500; i += 1) {
            const id = nextRequestId(instant, Math.random);
            expect(id).toBeGreaterThanOrEqual(floor);
            expect(id).toBeLessThan(floor + 100);
            drawn.add(id);
        }
        expect(drawn.size).toBeGreaterThan(50);
    });

    it('cannot overflow into the next millisecond, even when entropy returns 1', () => {
        // `Math.random` is documented as [0, 1), but a stub or a future source may not be, and an id that
        // borrowed the next millisecond's space would collide with a real one issued then.
        const instant = new Date('2026-09-06T12:00:00.000Z');
        expect(nextRequestId(instant, () => 1)).toBe(nextRequestId(instant, () => 0));
    });

    it('does not have to exceed what the authority has already seen', () => {
        // Uniqueness is the requirement; monotonicity is not. FEXGetLast_ID reports a maximum, but nothing
        // requires the next id to beat it -- which is what makes clock skew between instances harmless.
        const later = nextRequestId(new Date('2026-09-06T12:00:00.000Z'), () => 0.5);
        const earlier = nextRequestId(new Date('2026-09-06T11:59:59.000Z'), () => 0.5);
        expect(earlier).toBeLessThan(later);
        expect(earlier).toBeGreaterThanOrEqual(0);
    });
});
