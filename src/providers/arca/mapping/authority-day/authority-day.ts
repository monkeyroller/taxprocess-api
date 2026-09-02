import {ArcaValidationError} from '../../sdk/core/errors.js';
import {ARGENTINA_UTC_OFFSET, formatArcaDate} from '../../sdk/invoicing/arca-qr/arca-qr.js';
import {
    DATE_ONLY_PATTERN,
    ZONED_DATETIME_PATTERN,
    matchNamesRealDay,
} from '../../../../http/dto/authority-date/authority-date.js';

/**
 * Where a date crossing this contract becomes an ARCA calendar day.
 *
 * `http/dto/authority-date` owns which forms are acceptable — shape and timezone, checkable before a request
 * reaches any entity. This module owns which day an accepted value lands on, which only an authority's own
 * zone can answer. The patterns are imported rather than restated, so the two can never disagree about what
 * a caller may send.
 *
 * Not to be confused with `isoDate` in `padron-helpers.ts`, which slices a date part verbatim without
 * converting zones. That is right for ARCA-origin data and wrong here: slicing `2026-07-12T01:00:00Z`
 * verbatim yields the UTC day rather than the authority day `2026-07-11`.
 */

/** ARCA's own day spelling, capturing year/month/day so a match reads through `matchNamesRealDay`. */
const ARCA_DAY_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * Parses an accepted date into a `Date` the caller can do day arithmetic on. A date-only value is pinned to
 * noon AR, so rendering it back in Argentina time cannot shift it to the neighbouring day. An instant passes
 * through untouched, already naming a moment.
 *
 * Rejects both a zoneless datetime and anything the `Date` parser cannot read. The latter matters because
 * `@IsISO8601` is non-strict: an `Invalid Date` survives every arithmetic comparison, `NaN` comparing false,
 * and only surfaces inside `formatArcaDate` as an opaque `500`.
 */
export function parseAuthorityDate(value: string, field: string): Date {
    const trimmed = value.trim();
    const dateOnly = DATE_ONLY_PATTERN.exec(trimmed);
    if (dateOnly !== null) {
        if (!matchNamesRealDay(dateOnly)) {
            // `new Date('2026-02-31')` happily rolls forward to March 3rd. A day the caller did not name
            // is not a day to file a voucher under.
            throw notARealDay(value, field);
        }
        return new Date(`${trimmed}T12:00:00${ARGENTINA_UTC_OFFSET}`);
    }

    // Unreadable before zoneless, deliberately: `2026-W01-1` is not a timezone problem, and telling a caller
    // to add an offset to a week-form date would send them down the wrong path.
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
        throw new ArcaValidationError(
            `${field} "${value}" is not a usable ISO-8601 date`,
            'INVALID_ISSUE_DATE',
        );
    }
    const zoned = ZONED_DATETIME_PATTERN.exec(trimmed);
    if (zoned === null) {
        throw new ArcaValidationError(
            `${field} "${value}" is a datetime with no timezone, which resolves to a different ` +
                `calendar day per deployment — send a calendar day (YYYY-MM-DD) or add a UTC offset`,
            'INVALID_ISSUE_DATE',
        );
    }
    // Not redundant after the parse above: `Date` rejects month 13 but rolls a day-of-month past its month's
    // end, so `2026-02-31T12:00:00Z` arrives here as a valid instant naming March 3rd.
    if (!matchNamesRealDay(zoned)) {
        throw notARealDay(value, field);
    }
    return date;
}

/** The refusal both accepted forms share when they name a day the calendar does not have. */
function notARealDay(value: string, field: string): ArcaValidationError {
    return new ArcaValidationError(`${field} "${value}" is not a real calendar day`, 'INVALID_ISSUE_DATE');
}

/**
 * An accepted date as the ARCA `yyyymmdd` day it names. A date-only value is sliced rather than round-tripped
 * through an instant. An instant goes through `formatArcaDate`, which renders in Argentina time with an
 * explicit zone, so the answer does not depend on the container's `TZ`.
 */
export function toArcaDay(value: string, field: string): string {
    const trimmed = value.trim();
    const dateOnly = DATE_ONLY_PATTERN.exec(trimmed);
    if (dateOnly !== null) {
        // Guarded directly rather than by calling `parseAuthorityDate` for its side effect and discarding
        // the `Date` it built, which re-ran this same `exec` to reach a check the match already answers.
        if (!matchNamesRealDay(dateOnly)) {
            throw notARealDay(value, field);
        }
        return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`;
    }
    return formatArcaDate(parseAuthorityDate(value, field));
}

/**
 * An ARCA `yyyymmdd` day as `YYYY-MM-DD`, by slicing.
 *
 * Not `parseArcaDate(d).toISOString().slice(0, 10)`, which is right only because Argentina is UTC−3: the
 * identical code for a UTC+ authority emits the previous day.
 *
 * Demands a real ARCA day — narrow with `isArcaDay` first. Handing an unexpected format back verbatim cost
 * every caller a `?? ''` fallback on an unreachable branch, which read as though `rateDate` could ship blank.
 */
export function arcaDayToIsoDate(arcaDay: string): string {
    const match = arcaDayMatch(arcaDay);
    if (match === undefined) {
        throw new ArcaValidationError(
            `"${arcaDay}" is not an ARCA calendar day, so it cannot be rendered as one`,
            'INVALID_ISSUE_DATE',
        );
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * `value` as its `[, yyyy, mm, dd]` match, or `undefined` when it does not name an ARCA calendar day. The
 * single reading of an authority day, shared by the three functions that each need it in a different form.
 */
function arcaDayMatch(value: string | undefined): RegExpExecArray | undefined {
    if (value === undefined) {
        return undefined;
    }
    const match = ARCA_DAY_PATTERN.exec(value.trim());
    return match !== null && matchNamesRealDay(match) ? match : undefined;
}

/**
 * Whether `value` is an ARCA `yyyymmdd` day this service can treat as a day — the gate in front of
 * `arcaDayToIsoDate` and `shiftArcaDay`, both of which refuse anything this rejects. Anything answering
 * `false` (ARCA's `NULL` markers, a truncated field, `20261345`) is a day the authority did not state, and
 * no caller can key a rate by it.
 *
 * The real-calendar-day check is not pedantry: `20261345` passes a bare `\d{8}` and would surface as the
 * `rateDate` `2026-13-45`, which every downstream parser reads as garbage or silently rolls over.
 */
export function isArcaDay(value: string | undefined): value is string {
    return arcaDayMatch(value) !== undefined;
}

/**
 * A read authority day as the UTC instant naming its midnight, `offsetDays` from the day it names.
 *
 * The parts come off the match rather than from slicing the string again: a second set of offsets is a
 * second place to mis-count one. The single construction behind every calendar question this module and its
 * callers ask, so there is only ever one.
 */
function utcDateOf(match: RegExpExecArray, offsetDays: number): Date {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offsetDays));
}

/**
 * An ARCA `yyyymmdd` day as the UTC instant naming its midnight — a proxy for calendar arithmetic on a day
 * that already names one, so the container's `TZ` cannot shift which day, month or weekday it falls on.
 *
 * Exported for the callers that need a calendar property rather than another day, weekday being the one that
 * matters: reading it off a hand-sliced `yyyymmdd` answers confidently for a day the authority never stated
 * (`'2026091'` slices to the 1st of September), and refusing anything `isArcaDay` rejects is what routes
 * that through the same complaint every other reader here raises.
 */
export function arcaDayToUtcDate(day: string): Date {
    const match = arcaDayMatch(day);
    if (match === undefined) {
        throw new ArcaValidationError(
            `"${day}" is not an ARCA calendar day, so it cannot be placed on a calendar`,
            'INVALID_ISSUE_DATE',
        );
    }
    return utcDateOf(match, 0);
}

/**
 * The ARCA `yyyymmdd` day `count` days after `day`; negative counts walk backwards.
 *
 * Kept here rather than in a caller because a `yyyymmdd` looks like a number and is not one — `20260901 - 1`
 * is a day ARCA never had. Via UTC, so the container's `TZ` cannot shift the result: the input already names
 * an authority day, leaving only a calendar to step through.
 */
export function shiftArcaDay(day: string, count: number): string {
    const match = arcaDayMatch(day);
    if (match === undefined) {
        throw new ArcaValidationError(
            `"${day}" is not an ARCA calendar day, so it cannot be shifted`,
            'INVALID_ISSUE_DATE',
        );
    }
    const proxy = utcDateOf(match, count);
    // The year is padded like the other two. Unpadded it emitted seven characters for any year below 1000 —
    // `shiftArcaDay('09990101', -1)` was `"9981231"` — which is not an ARCA day, so the next reader refused
    // it and quoted a value the caller never sent. Above 9999 the width runs the other way and stays out of
    // range by construction: `clampToAuthorityToday` caps a requested day at today.
    const year = String(proxy.getUTCFullYear()).padStart(4, '0');
    const month = String(proxy.getUTCMonth() + 1).padStart(2, '0');
    const dayOfMonth = String(proxy.getUTCDate()).padStart(2, '0');
    return `${year}${month}${dayOfMonth}`;
}
