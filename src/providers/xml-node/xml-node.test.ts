import {describe, expect, it} from '@jest/globals';
import {asArray, decimal, firstOf, hasAnyContent, integer, text} from './xml-node.js';

/**
 * The parser's three shapes for one element, and the blank-is-absent reading. These held as six separate
 * copies across the SDK before being collected here, so the cases that matter are the ones a copy could
 * have got wrong: an absent element reading the same as an empty list, and a blank one never as a value.
 */
describe('asArray', () => {
    it('reads all three parser shapes as a list', () => {
        // A repeated element parses as an array, a single occurrence as a bare object, an absent one as
        // `undefined`. A caller branching on which would take a different path for one row than for three.
        expect(asArray([{a: 1}, {a: 2}])).toEqual([{a: 1}, {a: 2}]);
        expect(asArray({a: 1})).toEqual([{a: 1}]);
        expect(asArray(undefined)).toEqual([]);
        expect(asArray(null)).toEqual([]);
    });

    it('keeps an empty element, which is present but says nothing', () => {
        // `<impuesto/>` parses to `''`, which is not absence — the authority did send the element.
        expect(asArray('')).toEqual(['']);
    });
});

describe('firstOf', () => {
    it('takes the first of an array, the bare object itself, and undefined for absent', () => {
        expect(firstOf([{a: 1}, {a: 2}])).toEqual({a: 1});
        expect(firstOf({a: 1})).toEqual({a: 1});
        expect(firstOf(undefined)).toBeUndefined();
        expect(firstOf(null)).toBeUndefined();
    });

    it('is undefined for an empty array rather than throwing', () => {
        expect(firstOf([])).toBeUndefined();
    });
});

describe('text', () => {
    it('trims, and reads blank as absent', () => {
        expect(text('  20111111112 ')).toBe('20111111112');
        expect(text('')).toBeUndefined();
        expect(text('   ')).toBeUndefined();
        expect(text(undefined)).toBeUndefined();
        expect(text(null)).toBeUndefined();
    });

    it('stringifies a value the parser did coerce', () => {
        expect(text(42)).toBe('42');
        expect(text(0)).toBe('0');
        expect(text(false)).toBe('false');
    });

    it('reads a nested element as absent rather than as "[object Object]"', () => {
        // `String({})` is `'[object Object]'`, so a leaf that turns out to be a nested element would send
        // those fifteen characters onward as if the authority had said them.
        expect(text({nested: 'x'})).toBeUndefined();
        expect(text([{a: 1}])).toBeUndefined();
    });
});

describe('integer', () => {
    it('reads an integer, and absent for anything that is not one', () => {
        expect(integer('42')).toBe(42);
        expect(integer(' 42 ')).toBe(42);
        expect(integer('4.5')).toBeUndefined();
        expect(integer('abc')).toBeUndefined();
    });

    it('never turns a missing element into a silent zero', () => {
        // `Number('')` is a perfectly finite 0, which is how a field the authority never sent becomes a
        // confident wrong answer downstream.
        expect(integer('')).toBeUndefined();
        expect(integer(undefined)).toBeUndefined();
        expect(integer(0)).toBe(0);
    });
});

describe('decimal', () => {
    it('reads a decimal, and absent for anything that is not a finite number', () => {
        expect(decimal('1465.5')).toBe(1465.5);
        expect(decimal(' 1465.5 ')).toBe(1465.5);
        expect(decimal('1465')).toBe(1465);
        expect(decimal('abc')).toBeUndefined();
        expect(decimal('Infinity')).toBeUndefined();
    });

    it('never turns a missing or blank element into a silent zero', () => {
        // The two ways an authority says nothing, both of which a bare `Number()` turns into a value: an
        // absent element is `NaN`, a blank one a finite `0`. The second is the dangerous one.
        expect(decimal(undefined)).toBeUndefined();
        expect(decimal(null)).toBeUndefined();
        expect(decimal('')).toBeUndefined();
        expect(decimal('   ')).toBeUndefined();
        // A real zero still reads as one; deciding whether zero is sensible belongs to the caller.
        expect(decimal('0')).toBe(0);
    });
});

describe('hasAnyContent', () => {
    it('sees through containers that arrived empty', () => {
        // The case it exists for: an empty container parses into a record whose every field is `undefined`,
        // which a presence-only check would count as a populated member of the answer.
        expect(hasAnyContent({street: undefined, city: undefined})).toBe(false);
        expect(hasAnyContent([{a: undefined}, {b: ''}])).toBe(false);
        expect(hasAnyContent({})).toBe(false);
        expect(hasAnyContent([])).toBe(false);
    });

    it('finds content at any depth', () => {
        expect(hasAnyContent({a: {b: {c: 'x'}}})).toBe(true);
        expect(hasAnyContent([{a: undefined}, {b: 'x'}])).toBe(true);
    });

    it('counts a non-string primitive as content', () => {
        // A parsed 0 or false is something the authority said, unlike a blank string.
        expect(hasAnyContent(0)).toBe(true);
        expect(hasAnyContent(false)).toBe(true);
        expect(hasAnyContent('  ')).toBe(false);
    });
});
