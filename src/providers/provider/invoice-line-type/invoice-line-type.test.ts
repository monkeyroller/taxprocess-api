import {describe, expect, it} from '@jest/globals';
import {InvoiceLineType, NON_PRODUCT_LINE_TYPES, isNonProductLine} from './invoice-line-type.js';
import {AddressCodeScheme} from '../address-code-scheme/address-code-scheme.js';

describe('InvoiceLineType', () => {
    it('names what a line is, never how it is measured', () => {
        expect(Object.values(InvoiceLineType).sort()).toEqual(['DEPOSIT', 'DISCOUNT', 'LUMP_SUM', 'PRODUCT']);
    });

    it('spells every member key-safe, so a near-miss matches no row rather than erroring', () => {
        expect(Object.values(InvoiceLineType).every((value) => /^[A-Z0-9_]+$/.test(value))).toBe(true);
    });

    it('carries no authority code, which is the whole reason it exists', () => {
        // ARCA says these three through `Pro_umed` 0/97/99. If one of those numbers ever appears here, the
        // separation this vocabulary was created for has been undone.
        expect(Object.values(InvoiceLineType).every((value) => !/\d/.test(value))).toBe(true);
    });

    it('shares no token with the address vocabulary, since a token names one catalogue', () => {
        const addresses = new Set<string>(Object.values(AddressCodeScheme));
        expect(Object.values(InvoiceLineType).some((value) => addresses.has(value))).toBe(false);
    });
});

describe('NON_PRODUCT_LINE_TYPES', () => {
    it('derives itself by excluding the product line, so a member added later lands in exactly one group', () => {
        expect(NON_PRODUCT_LINE_TYPES).toEqual(
            new Set([InvoiceLineType.LUMP_SUM, InvoiceLineType.DISCOUNT, InvoiceLineType.DEPOSIT]),
        );
        expect(NON_PRODUCT_LINE_TYPES.size).toBe(Object.values(InvoiceLineType).length - 1);
    });
});

describe('isNonProductLine', () => {
    it('reads an absent line type as an ordinary product line', () => {
        // Saying nothing is how a caller says "ordinary", which is what keeps the field optional.
        expect(isNonProductLine(undefined)).toBe(false);
        expect(isNonProductLine(InvoiceLineType.PRODUCT)).toBe(false);
    });

    it('reports the three that describe the line rather than the goods', () => {
        expect(
            [InvoiceLineType.LUMP_SUM, InvoiceLineType.DISCOUNT, InvoiceLineType.DEPOSIT].every(
                isNonProductLine,
            ),
        ).toBe(true);
    });
});
