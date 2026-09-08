import {describe, expect, it} from '@jest/globals';
import {toConcepto, toTipoExpo} from './concept-codes.js';
import {ArcaValidationError} from '../../sdk/core/errors.js';
import {Concept, NEUTRAL_INVOICE_CONCEPTS} from '../../../provider/neutral-invoice.js';

describe('the catalogue itself', () => {
    it('derives its runtime list from the named members, so the two cannot drift', () => {
        // The reason `Concept` is a const object rather than four loose constants beside a literal array:
        // that shape declared each value twice, with nothing tying `4` in one to `4` in the other.
        expect(NEUTRAL_INVOICE_CONCEPTS).toEqual([1, 2, 3, 4]);
        expect(NEUTRAL_INVOICE_CONCEPTS).toEqual(Object.values(Concept));
    });

    it('holds numbers only, which is what lets the DTO validate with @IsIn', () => {
        // A numeric `enum` would reverse-map, so its value set is ['GOODS', 1, ...] -- and class-validator's
        // @IsEnum accepts exactly that set, taking the member NAME as a valid value and passing a string
        // through to the wire. A const object has no reverse mapping, so the list is safe to match against.
        for (const concept of NEUTRAL_INVOICE_CONCEPTS) {
            expect(typeof concept).toBe('number');
        }
        expect(Object.values(Concept)).not.toContain('GOODS');
    });
});

describe('toConcepto', () => {
    it('is the identity for every concept a domestic voucher can carry', () => {
        expect(toConcepto(Concept.GOODS)).toBe(1);
        expect(toConcepto(Concept.SERVICES)).toBe(2);
        expect(toConcepto(Concept.GOODS_AND_SERVICES)).toBe(3);
    });

    it('refuses OTHER, which WSFEv1 has no code for', () => {
        expect(() => toConcepto(Concept.OTHER)).toThrow(ArcaValidationError);
        expect(() => toConcepto(Concept.OTHER)).toThrow(/domestic voucher/);
        try {
            toConcepto(Concept.OTHER);
        } catch (err) {
            expect((err as ArcaValidationError).code).toBe('UNKNOWN_CODE');
        }
    });
});

describe('toTipoExpo', () => {
    it('is the identity for every concept an export voucher can carry', () => {
        // Including the gap: ARCA numbers "otros" 4, not 3, so the neutral code maps straight through.
        expect(toTipoExpo(Concept.GOODS)).toBe(1);
        expect(toTipoExpo(Concept.SERVICES)).toBe(2);
        expect(toTipoExpo(Concept.OTHER)).toBe(4);
    });

    it('refuses GOODS_AND_SERVICES, and says what to do instead', () => {
        // A real situation rather than a typo -- an export covering both has no code -- so the message has
        // to leave the caller somewhere to go.
        expect(() => toTipoExpo(Concept.GOODS_AND_SERVICES)).toThrow(/separate vouchers/);
        try {
            toTipoExpo(Concept.GOODS_AND_SERVICES);
        } catch (err) {
            expect((err as ArcaValidationError).code).toBe('UNKNOWN_CODE');
        }
    });
});

describe('the two together', () => {
    it('accept between them every code the catalogue publishes', () => {
        // Nothing is unusable: a caller reading §5 can reach each of the four somewhere.
        for (const concept of NEUTRAL_INVOICE_CONCEPTS) {
            const domestic = ((): boolean => {
                try {
                    toConcepto(concept);
                    return true;
                } catch {
                    return false;
                }
            })();
            const foreign = ((): boolean => {
                try {
                    toTipoExpo(concept);
                    return true;
                } catch {
                    return false;
                }
            })();
            expect(domestic || foreign).toBe(true);
        }
    });

    it('each reject exactly the member the other needs', () => {
        // The asymmetry these two exist to state. If a future ARCA release fills the gap at 3, this is the
        // test that should start failing.
        expect(() => toConcepto(Concept.OTHER)).toThrow();
        expect(() => toTipoExpo(Concept.OTHER)).not.toThrow();

        expect(() => toTipoExpo(Concept.GOODS_AND_SERVICES)).toThrow();
        expect(() => toConcepto(Concept.GOODS_AND_SERVICES)).not.toThrow();
    });
});
