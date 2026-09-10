import {describe, expect, it} from '@jest/globals';
import {REC20_SNAPSHOT, REC20_UNITS, normalizeRec20Code} from './rec20-units.js';
import {REC20_UNIT_ROWS} from './rec20-units.data.js';

describe('REC20_UNITS', () => {
    it('carries the subset the curation rule keeps', () => {
        expect(REC20_UNITS.size).toBe(208);
    });

    it('states its own size, so the stamp cannot go stale beside the rows', () => {
        // The reason the snapshot is code rather than a comment: a hand-edited row count is a comment that
        // lies, and this is the assertion that stops one.
        expect(REC20_SNAPSHOT.rows).toBe(REC20_UNITS.size);
        expect(REC20_SNAPSHOT.publishedRows).toBeGreaterThan(REC20_SNAPSHOT.activeRows);
        expect(REC20_SNAPSHOT.activeRows).toBeGreaterThan(REC20_SNAPSHOT.rows);
    });

    it('indexes every row exactly once, since the code is the key', () => {
        expect(REC20_UNITS.size).toBe(REC20_UNIT_ROWS.length);
        expect(new Set(REC20_UNIT_ROWS.map((unit) => unit.commonCode)).size).toBe(REC20_UNIT_ROWS.length);
    });

    it('names the revision it was taken at', () => {
        expect(REC20_SNAPSHOT.revision).toBe(17);
        expect(REC20_SNAPSHOT.published).toBe('2021');
    });
});

describe('the curation rule, spot-checked against the committed rows', () => {
    // Not the whole rule: rule A keys off the `Description` column, which the rows do not carry, so it is
    // unverifiable from here and widening it in the generator would pass every test below. What these do is
    // hold one representative of each branch, so a regex edit that drops a whole family is visible.

    it('keeps the units an invoice prices in', () => {
        // One from each family the rule admits, so a regex edit that quietly drops a whole branch fails here
        // rather than in production.
        for (const code of ['KGM', 'MTR', 'MTK', 'MTQ', 'LTR', 'HUR', 'DAY', 'CGM', 'PR', 'DZN', 'NMP']) {
            expect(REC20_UNITS.has(code)).toBe(true);
        }
    });

    it('drops the physics the recommendation also publishes, so the subset is a cut and not the whole table', () => {
        // All four are active level-1 normative units. Their absence is what makes this a curated catalogue
        // rather than 1756 rows with a smaller number written on it.
        for (const code of ['HTZ', 'C34', 'NEW', 'A24']) {
            expect(REC20_UNITS.has(code)).toBe(false);
        }
    });

    it('drops what the recommendation has withdrawn, even where it kept the same unit under another code', () => {
        // `KTM` is a kilometre too, flagged for deletion in favour of `KMT`. Selecting on the name alone
        // would have taken both, and shipping a withdrawn code puts one on a fiscal document.
        expect(REC20_UNITS.has('KMT')).toBe(true);
        expect(REC20_UNITS.has('KTM')).toBe(false);
        // `PK` (pack) moved to UN/ECE Rec 21 as a packaging code; `WW` and `NPR` are outright deleted.
        for (const code of ['PK', 'WW', 'NPR']) {
            expect(REC20_UNITS.has(code)).toBe(false);
        }
    });

    it('admits the six rows the rule names outright, which the ARCA mapping would otherwise not reach', () => {
        for (const code of ['C62', 'CTM', 'E4', 'MIL', 'MWH', 'ZZ']) {
            expect(REC20_UNITS.has(code)).toBe(true);
        }
    });
});

describe('the row shape', () => {
    it('publishes C62 as the countable one and ZZ as the agreed one', () => {
        // The two rows the ARCA mapping leans on hardest — 7 unidades and 98 otras unidades.
        expect(REC20_UNITS.get('C62')?.name).toBe('one');
        expect(REC20_UNITS.get('ZZ')?.name).toBe('mutually defined');
    });

    it('distinguishes a unit with no published symbol from one whose symbol is empty', () => {
        // `null` rather than `''`, so "the recommendation publishes none" is readable as itself.
        expect(REC20_UNITS.get('KGM')?.symbol).toBe('kg');
        expect(REC20_UNITS.get('ZZ')?.symbol).toBeNull();
        expect(REC20_UNIT_ROWS.some((unit) => unit.symbol === null)).toBe(true);
        expect(REC20_UNIT_ROWS.every((unit) => unit.symbol !== '')).toBe(true);
    });

    it('names and categorizes every row, since a blank column is a parse that went wrong', () => {
        expect(REC20_UNIT_ROWS.every((unit) => unit.name.length > 0)).toBe(true);
        expect(REC20_UNIT_ROWS.every((unit) => unit.levelCategory.length > 0)).toBe(true);
    });

    it('carries codes in the spelling the recommendation publishes, which is what normalizing targets', () => {
        expect(REC20_UNIT_ROWS.every((unit) => unit.commonCode === unit.commonCode.toUpperCase())).toBe(true);
    });
});

describe('normalizeRec20Code', () => {
    it('trims and upper-cases, so a hand-typed "kgm" is the same code as KGM', () => {
        expect(normalizeRec20Code('  kgm ')).toBe('KGM');
        expect(REC20_UNITS.has(normalizeRec20Code(' c62'))).toBe(true);
    });

    it('leaves a value that is not a code alone rather than inventing one', () => {
        // `HTZ` is a real, active, level-1 Rec 20 code this catalogue deliberately does not carry, and `KGX`
        // is nothing at all. Normalizing neither invents a row — the caller-facing half is UNKNOWN_CODE, not
        // a suggestion that hertz is not a unit.
        expect(normalizeRec20Code('KGX')).toBe('KGX');
        expect(REC20_UNITS.has(normalizeRec20Code('KGX'))).toBe(false);
        expect(REC20_UNITS.has(normalizeRec20Code(' htz '))).toBe(false);
    });
});
