import {describe, expect, it} from '@jest/globals';
import {isAcceptableAuthorityDate, isRealCalendarDay} from './authority-date.js';

/**
 * The boundary gate: which date forms a request may carry, decided before anything is dispatched to an
 * entity. Which DAY an accepted value lands on is a provider's answer and is pinned in
 * `providers/arca/mapping/authority-day` — this file only pins what gets through.
 */
describe('isAcceptableAuthorityDate', () => {
    it('accepts a calendar day and a zone-qualified instant', () => {
        expect(isAcceptableAuthorityDate('2026-08-25')).toBe(true);
        expect(isAcceptableAuthorityDate('  2026-08-25  ')).toBe(true);
        expect(isAcceptableAuthorityDate('2026-07-12T01:00:00Z')).toBe(true);
        expect(isAcceptableAuthorityDate('2026-07-11T22:00:00-03:00')).toBe(true);
        expect(isAcceptableAuthorityDate('2026-07-11T22:00:00-0300')).toBe(true);
    });

    it("refuses the bare-hour offset ISO allows but `Date` cannot read", () => {
        // The two checks doing different jobs, and the shape check being the looser one: the pattern
        // admits `±HH`, and the parse then refuses it because the ES Date Time String Format does not
        // include that form. Refusing is right — the alternative is hand-rolling offset arithmetic to
        // support a spelling nothing on this contract asks for.
        expect(isAcceptableAuthorityDate('2026-07-11T22:00:00-03')).toBe(false);
    });

    it('refuses a datetime with no zone, in either separator', () => {
        // Host-local per the ES spec, so the same request resolves to a different calendar day per
        // deployment — for `issueDate`, the voucher's legal date decided by where this runs.
        expect(isAcceptableAuthorityDate('2026-08-25T22:00:00')).toBe(false);
        expect(isAcceptableAuthorityDate('2026-08-25 22:00:00')).toBe(false);
    });

    it('refuses the ISO-8601 forms @IsISO8601 admits', () => {
        for (const value of ['2026-W01-1', '2026-366', '20260231', '25/08/2026', '']) {
            expect(isAcceptableAuthorityDate(value)).toBe(false);
        }
    });

    it('refuses anything that is not a string, rather than coercing it', () => {
        for (const value of [undefined, null, 20260825, new Date(), {}]) {
            expect(isAcceptableAuthorityDate(value)).toBe(false);
        }
    });

    it('refuses a day that does not exist, in BOTH accepted forms', () => {
        // The instant form is the one worth pinning. `new Date` rejects month 13 but rolls a day-of-month
        // past the end of its month, so each of these parses cleanly and names the following month — a
        // `Date`-is-valid check alone let them through while the identical date-only value was refused.
        for (const day of ['2026-02-31', '2026-04-31', '2025-02-29']) {
            expect(isAcceptableAuthorityDate(day)).toBe(false);
            expect(isAcceptableAuthorityDate(`${day}T12:00:00Z`)).toBe(false);
            expect(isAcceptableAuthorityDate(`${day}T12:00:00-03:00`)).toBe(false);
        }
        // The real days either side of them still pass in both forms.
        for (const day of ['2026-02-28', '2026-04-30', '2024-02-29']) {
            expect(isAcceptableAuthorityDate(day)).toBe(true);
            expect(isAcceptableAuthorityDate(`${day}T12:00:00Z`)).toBe(true);
        }
    });
});

describe('isRealCalendarDay', () => {
    it('knows month lengths and leap years', () => {
        expect(isRealCalendarDay(2026, 8, 25)).toBe(true);
        expect(isRealCalendarDay(2024, 2, 29)).toBe(true); // leap
        expect(isRealCalendarDay(2025, 2, 29)).toBe(false); // not
        expect(isRealCalendarDay(2000, 2, 29)).toBe(true); // century leap
        expect(isRealCalendarDay(1900, 2, 29)).toBe(false); // century non-leap
        expect(isRealCalendarDay(2026, 4, 31)).toBe(false);
        expect(isRealCalendarDay(2026, 13, 1)).toBe(false);
        expect(isRealCalendarDay(2026, 0, 1)).toBe(false);
        expect(isRealCalendarDay(2026, 1, 0)).toBe(false);
    });
});
