import {describe, expect, it} from '@jest/globals';
import {
    INCOTERMS,
    isKnownIncoterm,
    toIdiomaCbte,
    toIncoterms,
    toTipoExpo,
} from './export-codes.js';
import {ArcaValidationError} from '../../sdk/core/errors.js';
import {NEUTRAL_INVOICE_CONCEPTS} from '../../../provider/neutral-invoice.js';

describe('toTipoExpo', () => {
    it('maps the three export types onto ARCA 1/2/4', () => {
        expect(toTipoExpo('GOODS')).toBe(1);
        expect(toTipoExpo('SERVICES')).toBe(2);
        expect(toTipoExpo('OTHER')).toBe(4);
    });

    it('is not the concept vocabulary, whose 3 means something WSFEX has no code for', () => {
        // Reusing `concept` would make two unrelated sets assignable until one gained a member. ARCA's own
        // gap at 3 is the tell: `Tipo_expo` has no "productos y servicios".
        expect(NEUTRAL_INVOICE_CONCEPTS).toContain(3);
        expect(Object.values({GOODS: 1, SERVICES: 2, OTHER: 4})).not.toContain(3);
    });
});

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
