import {formatArcaDate} from '../../sdk/invoicing/arca-qr/arca-qr.js';
import {
    arcaDayToIsoDate,
    arcaDayToUtcDate,
    arcaDayToUtcInstant,
    isArcaDay,
    shiftArcaDay,
} from '../authority-day/authority-day.js';
import {isKnownCurrencyCode, normalizeCurrencyCode} from '../currency-codes/currency-codes.js';
import type {CurrencyRateDto} from '../../../../http/dto/currency-rates-result.dto.js';
import {toBand, type BandRule, type RateBand} from '../../../provider/rate-band/rate-band.js';

/**
 * ARCA's cotización policy: the accepted band around a published rate, the reference currency, and which
 * day a rate is asked for. All Argentine tax policy; none of it reaches the wire.
 */

/**
 * The authority's own currency. Asked for `PES`, ARCA answers `602 Sin Resultados`, so it has to be
 * resolved locally at `1/1/1` — otherwise a peso sale comes back with no rate at all. Validation
 * 10039/10040 requires `MonCotiz` to be exactly `1` for `PES` anyway.
 */
export const REFERENCE_MON_ID = 'PES';

/**
 * The band ARCA accepts around a published rate `R`: `[0.02R, 5R]`.
 *
 * Validation 10119 words the two bounds differently — "inferior al 2%" is a fraction of `R`, "superior en
 * un 400%" is an excess over it — which is why they are configured independently. Measured 2026-08-31
 * against homologación with `pnpm probe:band`: `0.0199R` and `5.0002R` are rejected, `0.02R` and
 * `4.9997R` are authorized.
 *
 * Validation 10240 ("no podra superar en 1 a la cotizacion oficial") did not bind in that run — `R + 1.5`
 * was authorized — so it is conditioned on `CanMisMonExt`. `PLUS_UNITS` is kept for the day that changes.
 *
 * ARCA has rewritten this sentence three times since 2023: re-run the probe rather than re-reading the PDF.
 */
export const BAND_RULE: BandRule = {
    lower: {mode: 'FRACTION_OF', value: 0.02},
    upper: {mode: 'EXCESS_OVER', value: 4.0},
    measuredOn: '2026-08-31',
};

/** ARCA's band around one published rate. */
export function arcaBand(rate: number): RateBand {
    return toBand(rate, BAND_RULE);
}

/** The reference currency's band: `1/1/1`, no authority call. */
export function referenceBand(): RateBand {
    return {rate: 1, lowerLimit: 1, upperLimit: 1, bandBasis: 'REFERENCE'};
}

/** Whether `currencyCode` is the authority's own currency, which is answered without the network. */
export function isReferenceCurrency(currencyCode: string): boolean {
    return normalizeCurrencyCode(currencyCode) === REFERENCE_MON_ID;
}

/**
 * Currency codes sorted into the three answers this endpoint has for one code.
 *
 * One function for both request shapes — an explicit list and the authority's enumerated catalogue — since
 * the questions are the same and only the meaning of the answers differs. Spelled out separately they had
 * already drifted: one side normalized the code and the other did not.
 */
export interface CurrencyCodePartition {
    /** Codes to ask the authority about, in the order they were first named. */
    readonly toFetch: Array<string>;
    /**
     * Codes outside the supported catalogue. Named by a caller they are an `UNKNOWN_CODE`; found in the
     * authority's own catalogue they are catalogue drift.
     */
    readonly unsupported: Array<string>;
    /** Whether the reference currency was among them — answered locally, never fetched. */
    readonly namesReference: boolean;
}

/**
 * Partitions `codes`, normalizing and de-duplicating as part of the split.
 *
 * Codes arrive raw from a JSON body or through a catalogue `Id`, so asking twice for one code would put two
 * entries in a result the caller keys by code. Insertion order is preserved. A blank code is dropped rather
 * than bucketed: there is no code to report it against.
 */
export function partitionCurrencyCodes(codes: Iterable<string>): CurrencyCodePartition {
    const toFetch: Array<string> = [];
    const unsupported: Array<string> = [];
    const seen = new Set<string>();
    let namesReference = false;

    for (const raw of codes) {
        const code = normalizeCurrencyCode(raw);
        if (code === '' || seen.has(code)) {
            continue;
        }
        seen.add(code);
        if (code === REFERENCE_MON_ID) {
            namesReference = true;
        } else if (isKnownCurrencyCode(code)) {
            toFetch.push(code);
        } else {
            unsupported.push(code);
        }
    }

    return {toFetch, unsupported, namesReference};
}

/** The instants between which a rate is the one that prices a voucher. Half-open: `validUntil` is excluded. */
export interface RateValidity {
    readonly validFrom: string;
    readonly validUntil: string;
}

/**
 * A rate as far as one code's own answer can determine it — everything but the window it applies to, which
 * is a property of the batch rather than of any row. {@link withValidity} completes it.
 *
 * Spelled as an `Omit` of the wire shape rather than as its own field list so the two cannot drift: a field
 * added to `RateValidity` leaves this type immediately, and a field added to the wire arrives in it.
 */
export type UnscopedRate = Omit<CurrencyRateDto, keyof RateValidity>;

/** A resolved band flattened into the wire's fields, less the window `withValidity` stamps on. */
export function toUnscopedRate(currencyCode: string, band: RateBand, rateDate: string): UnscopedRate {
    return {
        currencyCode,
        rate: band.rate,
        lowerLimit: band.lowerLimit,
        upperLimit: band.upperLimit,
        rateDate,
        bandBasis: band.bandBasis,
    };
}

/**
 * The period a rate applies to: the 24 hours of the day it was asked for, as absolute instants.
 *
 * **Keyed on the day requested, not on the day the rate closed on.** Those differ constantly — Saturday,
 * Sunday and Monday all price off Friday's close — so the three answers carry one `rate` and one
 * `rateDate` between them but three distinct, non-overlapping windows. That is deliberate, and the reason is
 * that the alternative cannot be computed. Inverting {@link RATE_DAY_RULE} would give the true span of a
 * close, `(D, nextWorkingDayAfter(D)]`, but its upper bound needs a walk FORWARD to know whether tomorrow is
 * a feriado — and feriados are not modelled here on purpose, they are discovered through ARCA's own `602`
 * after the fact. A per-day window needs no lookahead and cannot be wrong about a calendar it cannot see.
 *
 * This is the authority's applicability, NOT a caller's entitlement to serve a cached copy. For a backdated
 * request the window is entirely in the past, and that is correct and permanent rather than expired: the
 * rate that priced 2026-08-30 will always be the rate that priced it. A caller testing this range against
 * `now` will conclude every backdated answer is stale; the test belongs against the voucher's own instant.
 */
export function applicabilityRange(arcaDay: string): RateValidity {
    return {
        validFrom: arcaDayToUtcInstant(arcaDay),
        validUntil: arcaDayToUtcInstant(shiftArcaDay(arcaDay, 1)),
    };
}

/**
 * Stamps one batch's applicability window onto every rate in it, completing the wire shape.
 *
 * Applied to the batch rather than passed to each `toUnscopedRate` call, because that is what the window is:
 * an answer about the day that was *asked about*, not about the row that happened to answer any one code —
 * which is why every rate in a response carries the same one while their `rateDate`s may differ. Doing it in
 * one place makes that a rule the types keep rather than one every producer of a rate has to observe, an
 * `UnscopedRate` having no way to reach the wire except through here.
 *
 * Copies rather than stamping in place, so a rate can be built before the day it answers for is resolved and
 * neither caller has to care which ran first.
 */
export function withValidity(
    rates: ReadonlyArray<UnscopedRate>,
    validity: RateValidity,
): Array<CurrencyRateDto> {
    return rates.map((rate) => ({...rate, ...validity}));
}

/**
 * The start of the next authority day — the contract's advisory `refreshAfter`.
 *
 * A day-keyed answer cannot change before the day being asked about does, so the next authority midnight is
 * the nearest instant that is both true and still a lower bound. It is never in the past, and is present
 * even when every requested code came back unavailable — the case a client would otherwise poll hot, and
 * the one case no {@link applicabilityRange} can answer because there is no rate to carry one.
 *
 * Since 2026-09-02 a rate states its own applicability, and for a live request this field is that rate's
 * `validUntil` by construction: the field is `max(min(validUntil), next authority midnight)`, and a
 * requested day clamped at today makes the second term always the larger. What it still answers alone is the
 * backdated request — where every window is legitimately in the past — and the empty batch.
 *
 * It used to return ARCA's 19:00 publication hour, which made the field a schedule: a caller told to push
 * its next run "later, never earlier" reinstated the evening cadence it had just retired.
 */
export function nextRefreshAfter(now: Date): string {
    return arcaDayToUtcInstant(shiftArcaDay(formatArcaDate(now), 1));
}

/**
 * Which day's close prices a voucher, and how far to look back.
 *
 * `date` on the wire is the day that needs a valid rate — the voucher's own day. This module answers with
 * the closing rate of the previous working day, and `rateDate` reports the close that answered.
 *
 * Validation 10038 names that day, but its sentence opens with `CanMisMonExt = S`, which nothing on this
 * contract can set — so 10038 binds no voucher filed here today. What binds one is 10119's band, which is
 * wide enough that almost any day's close would pass. The previous-working-day resolution is therefore this
 * service declaring the right number rather than ARCA refusing the alternatives: do not tell a caller ARCA
 * will reject a rate from a different day.
 *
 * Rows are business-day closes, not rates in force. Measured 2026-09-01 against PRODUCTION with
 * `pnpm probe:cotizacion-day` over 24 days of `DOL`: every Saturday, Sunday, the 2026-08-17 feriado and
 * today all answer `602 Sin Resultados`, while an omitted `FchCotiz` returns the same row as the last
 * business day. If a row were the rate in force on its day, a Saturday would have to carry one.
 *
 * So asking for the voucher's own day would return a close one publication too new. That is invisible on a
 * same-day sale — today has no row, and the walk-back rescues it — but wrong on a backdated one, which is
 * what `date` exists for.
 *
 * Homologación disagrees with all of this and is deliberately ignored: it answers for every calendar day
 * with a smoothly compounding series, which is generated rather than market data. Nothing here branches on
 * environment, so a testing sale resolves its day exactly as a production sale does.
 *
 * Weekends are stepped over rather than asked about, so a Monday voucher reads Friday in one call. Feriados
 * are discovered through the authority's own `602` instead of modelled, since a feriado calendar would be
 * wrong the first year ARCA moves a puente.
 */
export const RATE_DAY_RULE = {
    /**
     * Working days back from the day needing a rate to the close that prices it. One — ARCA labels a row by
     * the business day it closed on, so the voucher's own day is one publication too new.
     */
    workingDaysBeforeVoucher: 1,
    /**
     * How many further working days a `602` may walk back. Weekends are skipped rather than counted, so this
     * covers consecutive feriados only — five is ample for Carnival, Semana Santa, or a puente. The bound
     * exists for a currency with no publication at all, which answers `602` on every candidate.
     */
    walkBackLimit: 5,
    measuredOn: '2026-09-01',
    /** Homologación's series is generated and cannot answer which day a row belongs to. */
    measuredAgainst: 'production',
} as const;

/**
 * Saturday or Sunday, from an ARCA `yyyymmdd` day. Read off `arcaDayToUtcDate` rather than a local slice, so
 * the day is placed on a calendar exactly once in this codebase and a day the authority never stated is
 * refused rather than answered for. Feriados are not modelled.
 */
function isAuthorityWeekend(arcaDay: string): boolean {
    const weekday = arcaDayToUtcDate(arcaDay).getUTCDay();
    return weekday === 0 || weekday === 6;
}

/** The working day before `arcaDay`, stepping over Saturdays and Sundays. */
function previousWorkingDay(arcaDay: string): string {
    let candidate = shiftArcaDay(arcaDay, -1);
    while (isAuthorityWeekend(candidate)) {
        candidate = shiftArcaDay(candidate, -1);
    }
    return candidate;
}

/**
 * The days to ask ARCA about for a voucher dated `voucherDay`, newest first — the first that answers wins.
 * Every candidate is a working day, so a `602` means "feriado" rather than "weekend".
 *
 * The day that answers is never the voucher's own day and is not always the first candidate, so `rateDate`
 * has to carry ARCA's echoed `FchCotiz` rather than any element of this list.
 *
 * Never called for a request that omitted `date`: an absent `FchCotiz` means "the latest row", so a `602`
 * against it is a fact about the currency rather than about a day.
 */
export function rateDayCandidates(voucherDay: string): ReadonlyArray<string> {
    let day = voucherDay;
    for (let step = 0; step < RATE_DAY_RULE.workingDaysBeforeVoucher; step += 1) {
        day = previousWorkingDay(day);
    }
    const candidates: Array<string> = [day];
    for (let back = 1; back <= RATE_DAY_RULE.walkBackLimit; back += 1) {
        day = previousWorkingDay(day);
        candidates.push(day);
    }
    return candidates;
}

/**
 * `arcaDay`, or today in ARCA's own calendar when it names a day that has not happened yet, per 10038's
 * second clause. Applied before `RATE_DAY_RULE`, so a voucher dated tomorrow prices off the same close as
 * one dated today.
 *
 * Not a validation error: a voucher dated tomorrow is legitimate to price, and refusing it would force
 * every caller to implement this clamp to avoid a `400`. Callers clamp on their own side too, but a bad
 * request would otherwise ask ARCA about 2027 and spend the whole walk-back finding out nothing is there.
 */
export function clampToAuthorityToday(arcaDay: string, now: Date): string {
    // Both sides are `yyyymmdd`, where lexical order is chronological order.
    const today = formatArcaDate(now);
    return arcaDay > today ? today : arcaDay;
}

/**
 * The batch's vintage — the contract's `publishedAt`, as the latest `rateDate` any code in it carries.
 *
 * A shared `rateDate` across the batch cannot be promised, since a thinly-traded currency may not publish
 * every day. The max identifies which publication a batch is, letting a caller tell a run that fired just
 * before the authority posted from one that fired after. `undefined` when nothing was published at all.
 */
export function vintageOf(arcaDays: ReadonlyArray<string>): string | undefined {
    // Same day check the provider uses for `rateDate`, so a value too poor to ship cannot become
    // `publishedAt` either.
    const days = arcaDays.filter(isArcaDay);
    if (days.length === 0) {
        return undefined;
    }
    return arcaDayToIsoDate(days.reduce((max, d) => (d > max ? d : max)));
}
