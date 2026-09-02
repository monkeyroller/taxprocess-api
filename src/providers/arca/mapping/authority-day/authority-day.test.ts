import {describe, expect, it} from '@jest/globals';
import {ArcaValidationError} from '../../sdk/core/errors.js';
import {arcaDayToIsoDate, isArcaDay, parseAuthorityDate, shiftArcaDay, toArcaDay} from './authority-day.js';

/**
 * The contract's date rule, in the one place it is implemented. Three forms in, `yyyymmdd` out, and the
 * two directions that used to be able to drift a day: a caller-supplied instant, and an ARCA day coming
 * back out.
 */
describe('toArcaDay', () => {
    it('takes a calendar day as the authority day it already names', () => {
        expect(toArcaDay('2026-08-25', 'date')).toBe('20260825');
    });

    it('places a zone-qualified instant on the AUTHORITY day, not the UTC one', () => {
        // Why instants are accepted at all: 01:00Z on the 12th is 22:00 on the 11th in Buenos Aires, and
        // slicing the string verbatim would yield the 12th, quoting a band from the wrong day.
        expect(toArcaDay('2026-07-12T01:00:00Z', 'date')).toBe('20260711');
        expect(toArcaDay('2026-07-11T22:00:00-03:00', 'date')).toBe('20260711');
        // ...and an instant that is the same day in both zones still lands on that day.
        expect(toArcaDay('2026-07-12T15:00:00Z', 'date')).toBe('20260712');
    });

    it('refuses a datetime with no timezone', () => {
        // `new Date('2026-08-26T01:00:00')` is host-local per the ES spec, so this would resolve to a
        // different calendar day per deployment. For `issueDate` that is the voucher's legal date.
        expect(() => toArcaDay('2026-08-26T01:00:00', 'issueDate')).toThrow(ArcaValidationError);
        expect(() => toArcaDay('2026-08-26T01:00:00', 'issueDate')).toThrow(/no timezone/);
        expect(() => toArcaDay('2026-08-05 12:00:00', 'issueDate')).toThrow(/no timezone/);
    });

    it('names the field it refused, since a request carries four dates', () => {
        expect(() => toArcaDay('2026-08-26T01:00:00', 'serviceDateFrom')).toThrow(/serviceDateFrom/);
    });

    it('refuses a day that does not exist', () => {
        // `new Date('2026-02-31')` rolls forward to March 3rd. Filing under a day the caller never named
        // is worse than refusing.
        expect(() => toArcaDay('2026-02-31', 'date')).toThrow(/not a real calendar day/);
        expect(() => toArcaDay('2026-13-01', 'date')).toThrow(/not a real calendar day/);
    });

    it('refuses a day that does not exist in the INSTANT form too', () => {
        // The form that looks already checked and is not: `new Date` rejects month 13 but rolls a
        // day-of-month past its month's end, so each of these is a valid `Date` naming the following month.
        // Left through, `2026-02-31T12:00:00Z` filed a legal voucher date the caller never named.
        for (const value of ['2026-02-31T12:00:00Z', '2026-04-31T12:00:00-03:00', '2025-02-29T12:00:00Z']) {
            expect(new Date(value).getTime()).not.toBeNaN(); // the premise: `Date` accepts all three
            expect(() => toArcaDay(value, 'issueDate')).toThrow(/not a real calendar day/);
        }
        // A real day in the same form still passes, and still lands on the AUTHORITY's day.
        expect(toArcaDay('2026-02-28T12:00:00Z', 'issueDate')).toBe('20260228');
    });

    it('refuses the ISO-8601 forms @IsISO8601 admits but ARCA cannot use', () => {
        // Reported as unreadable rather than as a zone problem: telling a caller to add an offset to a
        // week-form date would send them down the wrong path.
        for (const value of ['2026-W01-1', '2026-366', '20260231']) {
            expect(() => toArcaDay(value, 'date')).toThrow(/not a usable ISO-8601 date/);
        }
    });

    it('reports every refusal under the documented wire code', () => {
        // `INVALID_ISSUE_DATE` is already on the contract. Kept for every date field rather
        // than renamed, because renaming it would break a caller's `details.code` for no gain.
        for (const value of ['2026-W01-1', '2026-02-31', '2026-08-26T01:00:00']) {
            let thrown: unknown;
            try {
                toArcaDay(value, 'date');
            } catch (err) {
                thrown = err;
            }
            expect(thrown).toBeInstanceOf(ArcaValidationError);
            expect((thrown as ArcaValidationError).code).toBe('INVALID_ISSUE_DATE');
        }
    });

    it('tolerates surrounding whitespace', () => {
        expect(toArcaDay('  2026-08-25  ', 'date')).toBe('20260825');
    });
});

describe('parseAuthorityDate', () => {
    it('pins a calendar day to noon AR so rendering it back cannot shift the day', () => {
        // Twelve hours of margin either side of any offset ARCA has used.
        expect(parseAuthorityDate('2026-08-25', 'date').toISOString()).toBe('2026-08-25T15:00:00.000Z');
    });

    it('passes an instant through untouched', () => {
        expect(parseAuthorityDate('2026-07-12T01:00:00Z', 'date').toISOString()).toBe(
            '2026-07-12T01:00:00.000Z',
        );
    });
});

describe('arcaDayToIsoDate', () => {
    it('slices an ARCA day rather than routing it through an instant', () => {
        // NOT `parseArcaDate(d).toISOString().slice(0, 10)`, which is right only because Argentina is
        // UTC-3 — the identical code for a UTC+ authority emits the previous day.
        expect(arcaDayToIsoDate('20260827')).toBe('2026-08-27');
    });

    it('refuses anything that is not an ARCA day, rather than copying it through', () => {
        // It used to hand these back verbatim, for a copied field no caller turned out to have: every one
        // had already run `isArcaDay`, so the leniency only cost each a `?? ''` on an unreachable branch —
        // which read as though the wire's `rateDate` could ship blank.
        for (const notADay of ['', '   ', '2026-08-27', 'whenever', 'NULL', '2026082']) {
            expect(() => arcaDayToIsoDate(notADay)).toThrow(ArcaValidationError);
        }
    });

    it('refuses eight digits that are not a real day, as isArcaDay does', () => {
        // The two must agree: a value `isArcaDay` rejects can never reach here, so accepting `20261345`
        // would only make the pair disagree about what a day is.
        expect(() => arcaDayToIsoDate('20261345')).toThrow(ArcaValidationError);
    });
});

/**
 * The gate in front of `arcaDayToIsoDate` and `shiftArcaDay`. It answers whether a value can be used as a
 * day, which decides whether a cotización is publishable at all — a rate with no day is a row a caller
 * cannot key — and narrows the type so neither of those need accept an absent one.
 */
describe('isArcaDay', () => {
    it('accepts a real ARCA day', () => {
        expect(isArcaDay('20260827')).toBe(true);
        expect(isArcaDay(' 20260827 ')).toBe(true);
        // A leap day the calendar actually has, so the check cannot be a bare month/day range test.
        expect(isArcaDay('20280229')).toBe(true);
    });

    it("rejects ARCA's empty markers, which the SDK already reduces to an empty string", () => {
        expect(isArcaDay(undefined)).toBe(false);
        expect(isArcaDay('')).toBe(false);
        expect(isArcaDay('   ')).toBe(false);
    });

    it('rejects eight digits that are not a real date', () => {
        // The reason this is not a bare `\d{8}` test: these would surface as the `rateDate`s `2026-13-45`
        // and `2026-02-30`, which downstream parsers either reject or silently roll forward.
        expect(isArcaDay('20261345')).toBe(false);
        expect(isArcaDay('20260230')).toBe(false);
        expect(isArcaDay('20270229')).toBe(false);
    });

    it('rejects anything that is not the ARCA day shape at all', () => {
        expect(isArcaDay('2026-08-27')).toBe(false);
        expect(isArcaDay('202608')).toBe(false);
        expect(isArcaDay('whenever')).toBe(false);
    });
});

describe('shiftArcaDay', () => {
    it('steps forwards and backwards within a month', () => {
        expect(shiftArcaDay('20260901', -1)).toBe('20260831');
        expect(shiftArcaDay('20260901', 1)).toBe('20260902');
        expect(shiftArcaDay('20260901', 0)).toBe('20260901');
    });

    it('crosses month, year and leap-day boundaries', () => {
        // The whole reason this is not `Number(day) - 1`: 20260901 − 1 = 20260900, a day ARCA never had.
        expect(shiftArcaDay('20260301', -1)).toBe('20260228');
        expect(shiftArcaDay('20280301', -1)).toBe('20280229');
        expect(shiftArcaDay('20270101', -1)).toBe('20261231');
        expect(shiftArcaDay('20261231', 1)).toBe('20270101');
    });

    it('walks several days at once', () => {
        expect(shiftArcaDay('20260901', -5)).toBe('20260827');
    });

    it('refuses a value that is not an authority day', () => {
        // A caller that cannot state the day it steps from cannot mean anything by the day it lands on, and
        // `20261345 − 1` would produce a plausible-looking `20261344`.
        expect(() => shiftArcaDay('20261345', -1)).toThrow(ArcaValidationError);
        expect(() => shiftArcaDay('2026-09-01', -1)).toThrow(ArcaValidationError);
        expect(() => shiftArcaDay('', -1)).toThrow(ArcaValidationError);
    });
});
