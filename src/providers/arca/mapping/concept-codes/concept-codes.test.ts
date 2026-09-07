import {describe, expect, it} from '@jest/globals';
import {toConcepto, toTipoExpo} from './concept-codes.js';
import {ArcaValidationError} from '../../sdk/core/errors.js';
import {
    CONCEPT_GOODS,
    CONCEPT_GOODS_AND_SERVICES,
    CONCEPT_OTHER,
    CONCEPT_SERVICES,
    NEUTRAL_INVOICE_CONCEPTS,
} from '../../../provider/neutral-invoice.js';

describe('toConcepto', () => {
    it('is the identity for every concept a domestic voucher can carry', () => {
        expect(toConcepto(CONCEPT_GOODS)).toBe(1);
        expect(toConcepto(CONCEPT_SERVICES)).toBe(2);
        expect(toConcepto(CONCEPT_GOODS_AND_SERVICES)).toBe(3);
    });

    it('refuses OTHER, which WSFEv1 has no code for', () => {
        expect(() => toConcepto(CONCEPT_OTHER)).toThrow(ArcaValidationError);
        expect(() => toConcepto(CONCEPT_OTHER)).toThrow(/domestic voucher/);
        try {
            toConcepto(CONCEPT_OTHER);
        } catch (err) {
            expect((err as ArcaValidationError).code).toBe('UNKNOWN_CODE');
        }
    });
});

describe('toTipoExpo', () => {
    it('is the identity for every concept an export voucher can carry', () => {
        // Including the gap: ARCA numbers "otros" 4, not 3, so the neutral code maps straight through.
        expect(toTipoExpo(CONCEPT_GOODS)).toBe(1);
        expect(toTipoExpo(CONCEPT_SERVICES)).toBe(2);
        expect(toTipoExpo(CONCEPT_OTHER)).toBe(4);
    });

    it('refuses GOODS_AND_SERVICES, and says what to do instead', () => {
        // A real situation rather than a typo -- an export covering both has no code -- so the message has
        // to leave the caller somewhere to go.
        expect(() => toTipoExpo(CONCEPT_GOODS_AND_SERVICES)).toThrow(/separate vouchers/);
        try {
            toTipoExpo(CONCEPT_GOODS_AND_SERVICES);
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
        expect(() => toConcepto(CONCEPT_OTHER)).toThrow();
        expect(() => toTipoExpo(CONCEPT_OTHER)).not.toThrow();

        expect(() => toTipoExpo(CONCEPT_GOODS_AND_SERVICES)).toThrow();
        expect(() => toConcepto(CONCEPT_GOODS_AND_SERVICES)).not.toThrow();
    });
});
