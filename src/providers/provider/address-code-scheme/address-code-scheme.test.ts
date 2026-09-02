import {describe, expect, it} from '@jest/globals';
import {AddressCodeScheme} from './address-code-scheme.js';

/**
 * The shared address-scheme vocabulary. A caller resolves an address level by matching the code and scheme
 * against its own catalogs, so these values are join keys — and a bad one fails silently, matching no row
 * and leaving the field null. These assertions are the only place that failure mode can be caught.
 */

describe('AddressCodeScheme', () => {
    const values = Object.values(AddressCodeScheme);

    it('is key-safe: nothing a stray space or a lowercase letter could break', () => {
        // The reason the values are tokens rather than prose. `"ISO 3166-1 alpha-2"` and
        // `"ISO 3166-1 Alpha-2"` are different keys and neither side would ever be told.
        for (const value of values) {
            expect(value).toMatch(/^[A-Z0-9-]+$/);
        }
    });

    it('never repeats a token across coding systems', () => {
        // Pair-matching depends on this. Sharing a bare `ISO` between country and region would make
        // `(code, scheme)` ambiguous and leave the level to disambiguate what the pair is supposed to.
        expect(new Set(values).size).toBe(values.length);
    });

    it('names the ISO forms precisely enough to tell them apart', () => {
        // ISO 3166-1 defines three codes for the same country (alpha-2 AR, alpha-3 ARG, numeric 032), so
        // the country scheme has to say which — core stores alpha-2. ISO 3166-2 has one code form, so no
        // variant is named there.
        expect(AddressCodeScheme.ISO_3166_1_ALPHA_2).toBe('ISO-3166-1-ALPHA-2');
        expect(AddressCodeScheme.ISO_3166_2).toBe('ISO-3166-2');
        expect(AddressCodeScheme.ISO_3166_1_ALPHA_2).not.toBe(AddressCodeScheme.ISO_3166_2);
    });

    it('pins the values as the contract, since a change to one is breaking for every caller', () => {
        // Member NAMES are free to be renamed; these strings are not — a caller has them in its schema.
        expect(values.sort()).toEqual(['INDEC', 'ISO-3166-1-ALPHA-2', 'ISO-3166-2']);
    });
});
