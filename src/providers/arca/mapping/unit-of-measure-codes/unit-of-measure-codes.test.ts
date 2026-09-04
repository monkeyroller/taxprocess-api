import {describe, expect, it} from '@jest/globals';
import {
    UNITS_OF_MEASURE,
    UNIT_DEPOSIT,
    UNIT_DISCOUNT,
    UNIT_NONE,
    isKnownUnitOfMeasureCode,
    isUnitModeCode,
    toProUmed,
} from './unit-of-measure-codes.js';
import {ArcaValidationError} from '../../sdk/core/errors.js';

describe('UNITS_OF_MEASURE', () => {
    it('carries the whole production table', () => {
        expect(UNITS_OF_MEASURE.size).toBe(49);
        expect(UNITS_OF_MEASURE.get('1')).toBe('kilogramos');
        expect(UNITS_OF_MEASURE.get('7')).toBe('unidades');
    });
});

describe('the three ids that are not units', () => {
    it('names them by what they mean, in ARCA\'s own wording', () => {
        expect(UNITS_OF_MEASURE.get(String(UNIT_DEPOSIT))).toBe('seña/anticipo');
        expect(UNITS_OF_MEASURE.get(String(UNIT_DISCOUNT))).toBe('bonificación');
        // `0` genuinely has no description in ARCA's table -- it is the "no unit" marker.
        expect(UNITS_OF_MEASURE.get(String(UNIT_NONE))).toBe('');
    });

    it('reports them as modes rather than units', () => {
        expect([UNIT_NONE, UNIT_DEPOSIT, UNIT_DISCOUNT].every(isUnitModeCode)).toBe(true);
    });

    it('does not include 98, which is an ordinary escape hatch', () => {
        // `otras unidades` is a unit the catalogue does not name, not a line mode: no special validation.
        expect(UNITS_OF_MEASURE.get('98')).toBe('otras unidades');
        expect(isUnitModeCode(98)).toBe(false);
    });
});

describe('toProUmed', () => {
    it('is the identity for a known code', () => {
        expect(toProUmed(7)).toBe(7);
        expect(toProUmed(UNIT_DISCOUNT)).toBe(99);
    });

    it('refuses a code the authority does not publish', () => {
        // The catalogue is sparse -- it runs 0..11, then jumps -- so an absent code is a plausible typo
        // rather than an obviously silly value, which is what makes the membership check worth keeping.
        expect(isKnownUnitOfMeasureCode(12)).toBe(false);
        expect(isKnownUnitOfMeasureCode(94)).toBe(false);
        expect(() => toProUmed(12)).toThrow(ArcaValidationError);
    });

    it('repairs the one row ARCA publishes double-encoded', () => {
        expect(UNITS_OF_MEASURE.get('95')).toBe('anulación/devolución');
    });
});
