import {registerDecorator, type ValidationOptions} from 'class-validator';

/**
 * Which date forms this contract accepts — shape only, no timezone.
 *
 * Every date on this contract names a calendar day in the authority's own calendar, not the caller's and not
 * UTC. A date-only value already names one; a zone-qualified instant is placed in the authority's zone and
 * reduced to its day; a zoneless datetime is refused. Either accepted form must also name a day that
 * exists.
 *
 * The zoneless form is refused rather than defaulted because `new Date('2026-08-26T01:00:00')` is host-local
 * per the ES spec, so the identical request resolves to a different day on a `TZ=UTC` container than on one
 * in Buenos Aires. For `issueDate` that is the voucher's legal date decided by deployment.
 *
 * This lives in the HTTP layer rather than a provider because it knows no zone: whether a date is acceptable
 * can be answered before a request is dispatched. Which day an accepted instant lands on is the provider's
 * answer alone.
 */

/** `YYYY-MM-DD` and nothing else — no time, no offset. */
export const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A datetime carrying a zone: a trailing `Z`, or a `±HH:MM` / `±HHMM` / `±HH` offset. Anything with a `T`
 * separator but no zone is the refused case.
 *
 * Deliberately the looser of the two checks — a value matching this still has to be one `Date` can read. The
 * bare-hour `±HH` offset is where they part: ISO 8601 allows it and the ES Date Time String Format does not,
 * so it matches here and is refused at the parse, which beats hand-rolling offset arithmetic for a spelling
 * nothing on this contract sends.
 *
 * Captures the same three leading groups as `DATE_ONLY_PATTERN`, so one reader can check the day either
 * form names.
 */
export const ZONED_DATETIME_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})[T ].+(?:Z|z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Whether `year-month-day` is a real calendar day. Rejects `2026-02-31` and `2026-13-01`, which the
 * non-strict `@IsISO8601` admits alongside week, ordinal, basic and space-separated forms.
 */
export function isRealCalendarDay(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return false;
    }
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
        probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
    );
}

/**
 * Whether the year/month/day a pattern captured in its first three groups names a day that exists. Takes a
 * match rather than three numbers, so every date-leading pattern in this contract reads to one rule.
 *
 * Applied to both accepted forms, which is why it is a named function: the check looks unnecessary on an
 * instant, because an instant looks like a moment the parser must already have validated. It has not —
 * `new Date` rejects month 13 but rolls a day-of-month past its month's end, so `2026-02-31T12:00:00Z` is a
 * valid `Date` naming March 3rd, and on `issueDate` that is a voucher filed under a day nobody named.
 */
export function matchNamesRealDay(match: RegExpExecArray): boolean {
    return isRealCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Whether `value` is a date this contract accepts: date-only or zone-qualified, naming a real day. */
export function isAcceptableAuthorityDate(value: unknown): boolean {
    if (typeof value !== 'string') {
        return false;
    }
    const trimmed = value.trim();
    const dateOnly = DATE_ONLY_PATTERN.exec(trimmed);
    if (dateOnly !== null) {
        return matchNamesRealDay(dateOnly);
    }
    const zoned = ZONED_DATETIME_PATTERN.exec(trimmed);
    if (zoned === null) {
        return false;
    }
    return matchNamesRealDay(zoned) && !Number.isNaN(new Date(trimmed).getTime());
}

/**
 * Validates a date field. Replaces `@IsISO8601` rather than sitting beside it: the point is to be narrower
 * than ISO-8601, and a field carrying both would still admit the zoneless form ISO-8601 considers valid.
 */
export function IsAuthorityDate(options?: ValidationOptions): PropertyDecorator {
    return (target: object, propertyName: string | symbol): void => {
        registerDecorator({
            name: 'isAuthorityDate',
            target: target.constructor,
            propertyName: propertyName as string,
            constraints: [],
            options: options ?? {},
            validator: {
                validate: (value: unknown): boolean => isAcceptableAuthorityDate(value),
                // `args` is optional in class-validator's signature, so the field name is recovered from
                // the decorator's own closure rather than assumed present.
                defaultMessage: () =>
                    `${String(propertyName)} must be a calendar day (YYYY-MM-DD) in the tax authority's ` +
                    `own calendar, or an instant carrying a UTC offset (2026-07-12T01:00:00Z). A datetime ` +
                    `with no zone is ambiguous — it would resolve to a different day per deployment.`,
            },
        });
    };
}
