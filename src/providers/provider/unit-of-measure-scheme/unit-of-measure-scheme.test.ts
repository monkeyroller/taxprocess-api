import {describe, expect, it} from '@jest/globals';
import {UnitOfMeasureCodeScheme} from './unit-of-measure-scheme.js';
import {AddressCodeScheme} from '../address-code-scheme/address-code-scheme.js';

describe('UnitOfMeasureCodeScheme', () => {
    it('names the one catalogue units are drawn from', () => {
        expect(Object.values(UnitOfMeasureCodeScheme)).toEqual(['UN-ECE-REC20']);
    });

    it('spells every member key-safe, so a near-miss matches no row rather than erroring', () => {
        expect(Object.values(UnitOfMeasureCodeScheme).every((value) => /^[A-Z0-9-]+$/.test(value))).toBe(
            true,
        );
    });

    it("offers no member for an authority's own numbering, which is the point of the field", () => {
        // A scheme member for ARCA would make `Pro_umed` reachable again and undo the standardization. What
        // an authority cannot express in Rec 20 is refused, not smuggled through under its own name.
        expect(Object.values(UnitOfMeasureCodeScheme).some((value) => /ARCA|AFIP|AR-/.test(value))).toBe(
            false,
        );
    });

    it('stays separate from the address vocabulary, whose guarantee is about address levels', () => {
        const addresses = new Set<string>(Object.values(AddressCodeScheme));
        expect(Object.values(UnitOfMeasureCodeScheme).some((value) => addresses.has(value))).toBe(false);
    });
});
