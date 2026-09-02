import {ArcaValidationError} from '../../sdk/core/errors.js';
import {
    ARCA_CURRENCY_CODES,
    isKnownCurrencyCode,
    normalizeCurrencyCode,
    toMonId,
} from './currency-codes.js';

describe('currency-codes (canonical currencyCode → ARCA MonId)', () => {
    describe('toMonId — the fourth canonical code', () => {
        it('is the identity for ARCA, like the other three', () => {
            expect(toMonId('PES')).toBe('PES');
            expect(toMonId('DOL')).toBe('DOL');
        });

        it('keeps zero padding, which is part of the code', () => {
            // `002` is NOT `2`. This is why the catalogue is a set of strings and not a numeric enum.
            expect(toMonId('002')).toBe('002');
            expect(toMonId('060')).toBe('060');
        });

        it('holds both dollars separately — the case ISO could not express', () => {
            // `DOL` and `002` (the blue) are both USD at different published rates, so the old ISO table
            // silently declared the official code for a caller pricing at the blue.
            expect(toMonId('DOL')).toBe('DOL');
            expect(toMonId('002')).toBe('002');
        });

        it('holds a code with no ISO equivalent at all', () => {
            // Gramos de Oro Fino. Unreachable under an ISO-keyed table.
            expect(toMonId('049')).toBe('049');
        });

        it('normalizes case and whitespace but returns the catalogue spelling', () => {
            // So a caller sending "dol" gets `DOL` on the wire rather than ARCA's 12000 back.
            expect(toMonId(' dol ')).toBe('DOL');
        });

        it('rejects an unknown code as UNKNOWN_CODE rather than letting ARCA answer 12000', () => {
            expect(() => toMonId('DOLL')).toThrow(ArcaValidationError);
            expect(() => toMonId('DOLL')).toThrow(/UNKNOWN|mapping/i);
            expect(() => toMonId('')).toThrow(ArcaValidationError);
        });

        it("carries ARCA's published catalogue, seeded from the same source as core", () => {
            // A count rather than a full listing: it catches an accidental deletion during a merge without
            // restating the table.
            expect(ARCA_CURRENCY_CODES.size).toBe(49);
            expect(ARCA_CURRENCY_CODES.has('RUB')).toBe(true);
            expect(ARCA_CURRENCY_CODES.has('NZD')).toBe(true);
        });
    });

    /**
     * The one spelling rule, a function because the inlined copies had drifted: the whole-table sync asked
     * two questions about one catalogue entry on adjacent lines, and only the first normalized.
     */
    describe('normalizeCurrencyCode / isKnownCurrencyCode', () => {
        it('trims and upper-cases, leaving zero padding alone', () => {
            expect(normalizeCurrencyCode(' dol ')).toBe('DOL');
            expect(normalizeCurrencyCode('002')).toBe('002');
            // Digits have no case; the padding must survive the round trip regardless.
            expect(normalizeCurrencyCode(' 060 ')).toBe('060');
        });

        it('answers membership in any casing, so both callers read a code the same way', () => {
            expect(isKnownCurrencyCode('dol')).toBe(true);
            expect(isKnownCurrencyCode(' DOL ')).toBe(true);
            expect(isKnownCurrencyCode('002')).toBe(true);
            expect(isKnownCurrencyCode('DOLL')).toBe(false);
            expect(isKnownCurrencyCode('')).toBe(false);
        });

        it('agrees with toMonId on exactly which codes are known', () => {
            // The two must never disagree: one decides whether a rate is served and the other whether an
            // invoice naming that currency is accepted.
            for (const code of ['dol', ' 002 ', 'RUB', 'DOLL', 'xyz']) {
                const known = isKnownCurrencyCode(code);
                let accepted = true;
                try {
                    toMonId(code);
                } catch {
                    accepted = false;
                }
                expect(known).toBe(accepted);
            }
        });
    });
});
