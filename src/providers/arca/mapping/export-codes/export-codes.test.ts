import {describe, expect, it} from '@jest/globals';
import {INCOTERMS, isKnownIncoterm, toIdiomaCbte, toIncoterms} from './export-codes.js';
import {ArcaValidationError} from '../../sdk/core/errors.js';

// `toTipoExpo` moved to `concept-codes/`, tested there. The case that used to sit here asserted the export
// vocabulary was NOT the concept one -- the conclusion this change overturned, so it is gone rather than
// reworded: ARCA's gap at 3 turned out to be the slot the export-only code occupies, not proof the two sets
// are unrelated.

describe('toIdiomaCbte', () => {
    it('maps ISO 639-1 onto ARCA 1/2/3', () => {
        expect(toIdiomaCbte('es')).toBe(1);
        expect(toIdiomaCbte('en')).toBe(2);
        expect(toIdiomaCbte('pt')).toBe(3);
    });
});

describe('incoterms', () => {
    it('is exactly the eleven ICC Incoterms 2020 clauses production publishes', () => {
        expect([...INCOTERMS].sort()).toEqual(
            ['CFR', 'CIF', 'CIP', 'CPT', 'DAP', 'DDP', 'DPU', 'EXW', 'FAS', 'FCA', 'FOB'].sort(),
        );
    });

    it('carries none of the legacy clauses, which ARCA has dropped', () => {
        for (const legacy of ['DAT', 'DAF', 'DES', 'DEQ', 'DDU']) {
            expect(isKnownIncoterm(legacy)).toBe(false);
        }
    });

    it('is case-tolerant on input and returns ARCA spelling', () => {
        expect(toIncoterms('cif')).toBe('CIF');
        expect(toIncoterms(' fob ')).toBe('FOB');
    });

    it('refuses a clause ARCA does not accept', () => {
        expect(() => toIncoterms('XXX')).toThrow(ArcaValidationError);
    });
});
