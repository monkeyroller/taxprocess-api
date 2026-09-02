import {describe, expect, it} from '@jest/globals';
import {
    arcaBand,
    BAND_RULE,
    clampToAuthorityToday,
    isReferenceCurrency,
    nextRefreshAfter,
    partitionCurrencyCodes,
    rateDayCandidates,
    RATE_DAY_RULE,
    referenceBand,
    toRateDto,
    vintageOf,
    REFERENCE_MON_ID,
} from './cotizacion.js';

/**
 * The Argentine policy this service owns: the band around a published rate, the reference currency, and
 * which day a rate is asked for. Three properties are load-bearing beyond the arithmetic, and all three are
 * pinned here: nothing depends on the container's `TZ`, `refreshAfter` is never in the past, and the two
 * measurements (the band width, the day offset) carry the date they were taken on.
 */
describe('arcaBand', () => {
    it('resolves the MEASURED band and reports it as a tolerance, never as exact', () => {
        // `[0.02R, 5R]`: the two bounds take different forms, which is what the probe found. Saying `EXACT`
        // about a range is the one wrong answer — a caller told `EXACT` enforces strictly and would warn an
        // operator that ARCA will reject a rate it in fact accepts.
        expect(arcaBand(100)).toEqual({rate: 100, lowerLimit: 2, upperLimit: 500, bandBasis: 'TOLERANCE'});
    });

    it('brackets the exact rungs the probe measured', () => {
        // Homologación 2026-08-31, DOL at R = 1158.195: 0.0199R rejected, 0.02R authorized, 4.9997R
        // authorized, 5.0002R rejected. The band must contain what ARCA accepted and exclude what it did not.
        //
        // Compared at wire precision rather than raw float: `0.02 * 1158.195` is `23.163899999999998` but
        // leaves as `"23.163900"`, which is why the limits are rounded to six decimals. Comparing raw
        // products would fail by 2e-15 on a difference the authority can never see.
        const R = 1158.195;
        const onWire = (value: number): number => Number(value.toFixed(6));
        const {lowerLimit, upperLimit} = arcaBand(R);
        expect(onWire(0.0199 * R)).toBeLessThan(lowerLimit);
        expect(onWire(0.02 * R)).toBeGreaterThanOrEqual(lowerLimit);
        expect(onWire(4.9997 * R)).toBeLessThanOrEqual(upperLimit);
        expect(onWire(5.0002 * R)).toBeGreaterThan(upperLimit);
    });

    it('does not assume the two bounds share a form', () => {
        // The natural misreading, and it is wrong in both directions: one shared mode gives either
        // [0.02R, 4R] (ARCA authorized 4.01R) or [0.98R, 5R] (ARCA authorized 0.5R).
        expect(BAND_RULE.lower.mode).not.toBe(BAND_RULE.upper.mode);
        expect(arcaBand(100).upperLimit).not.toBe(400);
        expect(arcaBand(100).lowerLimit).not.toBe(98);
    });

    it('rounds limits to six decimals, the precision MonCotiz is sent at', () => {
        // A limit finer than `toFixed(6)` could never be hit exactly, so it would only ever be noise.
        const band = arcaBand(1465.5555555);
        expect(band.lowerLimit).toBe(29.311111);
        expect(band.rate).toBe(1465.555556);
    });

    it('records the date it was measured, so a stale reading is visible', () => {
        // `measuredOn` is the claim that these numbers came from ARCA rather than the manual's prose. ARCA
        // has rewritten the validation three times since 2023; re-run the probe rather than re-reading it.
        expect(BAND_RULE.measuredOn).toBe('2026-08-31');
    });
});

describe('the reference currency', () => {
    it('is 1/1/1 and says so', () => {
        expect(referenceBand()).toEqual({rate: 1, lowerLimit: 1, upperLimit: 1, bandBasis: 'REFERENCE'});
    });

    it('recognizes the authority code regardless of case or padding whitespace', () => {
        expect(isReferenceCurrency(REFERENCE_MON_ID)).toBe(true);
        expect(isReferenceCurrency(' pes ')).toBe(true);
        expect(isReferenceCurrency('DOL')).toBe(false);
    });
});

/**
 * The split both request shapes go through. What matters is that the three questions are asked once: the
 * explicit list and the catalogue used to run separate loops, only one of which normalized.
 */
describe('partitionCurrencyCodes', () => {
    it('sorts codes into the three answers', () => {
        expect(partitionCurrencyCodes(['PES', 'DOL', '060', 'DOLL'])).toEqual({
            toFetch: ['DOL', '060'],
            unsupported: ['DOLL'],
            namesReference: true,
        });
    });

    it('reads every bucket through the same normalization', () => {
        // The regression: one lower-cased code was recognized as the reference currency while an identical
        // spelling of a catalogue code was reported as drift — the two tests disagreed about casing.
        expect(partitionCurrencyCodes([' pes ', 'dol', ' 060'])).toEqual({
            toFetch: ['DOL', '060'],
            unsupported: [],
            namesReference: true,
        });
    });

    it('de-duplicates, keeping the order each code was first named in', () => {
        // ARCA echoes `MonId` back, so a repeated code would put two entries in a result keyed BY code.
        expect(partitionCurrencyCodes(['060', 'DOL', 'dol', '060', 'DOL'])).toEqual({
            toFetch: ['060', 'DOL'],
            unsupported: [],
            namesReference: false,
        });
    });

    it('drops a blank code rather than bucketing one', () => {
        // It names nothing, so there is no code to report it against under `unavailable`.
        expect(partitionCurrencyCodes(['', '   ', 'DOL'])).toEqual({
            toFetch: ['DOL'],
            unsupported: [],
            namesReference: false,
        });
    });

    it('never puts the reference currency in toFetch, which ARCA answers 602 for', () => {
        expect(partitionCurrencyCodes(['PES']).toFetch).toEqual([]);
    });

    it('reports nothing for an empty request', () => {
        expect(partitionCurrencyCodes([])).toEqual({
            toFetch: [],
            unsupported: [],
            namesReference: false,
        });
    });
});

describe('toRateDto', () => {
    it('flattens a band onto the wire shape', () => {
        expect(toRateDto('DOL', arcaBand(1000), '2026-08-27')).toEqual({
            currencyCode: 'DOL',
            rate: 1000,
            lowerLimit: 20,
            upperLimit: 5000,
            rateDate: '2026-08-27',
            bandBasis: 'TOLERANCE',
        });
    });
});

describe('nextRefreshAfter', () => {
    /** Runs `fn` with the process timezone forced, restoring it afterwards. */
    function withTimeZone<T>(tz: string, fn: () => T): T {
        const previous = process.env.TZ;
        process.env.TZ = tz;
        try {
            return fn();
        } finally {
            process.env.TZ = previous;
        }
    }

    it('is the start of the next authority day, not a publication hour', () => {
        // Wednesday 2026-08-26, 14:00 ART.
        expect(nextRefreshAfter(new Date('2026-08-26T17:00:00Z'))).toBe('2026-08-27T00:00:00-03:00');
    });

    it('does not move across the retired 19:00 publication hour', () => {
        // 14:00 and 20:00 ART on the same day. The old field changed meaning at 19:00, which made a cached
        // answer a different question depending on when the run fired.
        const before = nextRefreshAfter(new Date('2026-08-26T17:00:00Z'));
        const after = nextRefreshAfter(new Date('2026-08-26T23:00:00Z'));
        expect(after).toBe(before);
    });

    it('does not skip the weekend, because the answer changes on Saturday too', () => {
        // Friday 20:00 ART gives Saturday, not Monday. Three days that share a number are still three
        // distinct questions, and the old business-day skip claimed Saturday's could not change until
        // Monday.
        expect(nextRefreshAfter(new Date('2026-08-28T23:00:00Z'))).toBe('2026-08-29T00:00:00-03:00');
        expect(nextRefreshAfter(new Date('2026-08-29T13:00:00Z'))).toBe('2026-08-30T00:00:00-03:00');
    });

    it('crosses month and year boundaries correctly', () => {
        expect(nextRefreshAfter(new Date('2026-08-31T23:00:00Z'))).toBe('2026-09-01T00:00:00-03:00');
        // 2026-12-31, 21:00 ART.
        expect(nextRefreshAfter(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01-01T00:00:00-03:00');
    });

    it('is identical under TZ=UTC and TZ=America/Argentina/Buenos_Aires', () => {
        // Why the clock is read with an explicit zone: a container running UTC must not compute a different
        // authority day than one in Buenos Aires, or a caller's schedule drifts by a day depending on where
        // this service was deployed. 2026-08-26T23:00Z is the 26th in AR but already the 27th in Tokyo.
        const instant = new Date('2026-08-26T23:00:00Z');
        const utc = withTimeZone('UTC', () => nextRefreshAfter(instant));
        const ar = withTimeZone('America/Argentina/Buenos_Aires', () => nextRefreshAfter(instant));
        const tokyo = withTimeZone('Asia/Tokyo', () => nextRefreshAfter(instant));
        expect(utc).toBe(ar);
        expect(tokyo).toBe(ar);
    });

    it('is never in the past, and always states the authority offset', () => {
        for (const iso of [
            '2026-08-26T17:00:00Z',
            '2026-08-26T23:00:00Z',
            '2026-08-28T23:00:00Z',
            '2026-08-29T13:00:00Z',
            '2026-08-31T21:59:59Z',
            // 23:59 ART — the tightest case, and the one the retired clamp existed for.
            '2026-09-01T02:59:00Z',
        ]) {
            const now = new Date(iso);
            const refreshAfter = nextRefreshAfter(now);
            expect(new Date(refreshAfter).getTime()).toBeGreaterThan(now.getTime());
            // Never a UTC `Z` instant: a caller reading these out of a log should not hold two formats.
            expect(refreshAfter.endsWith('T00:00:00-03:00')).toBe(true);
        }
    });
});

describe('rateDayCandidates', () => {
    it('asks for the previous WORKING day, per the production measurement', () => {
        // ARCA labels a row by the business day it closed on: measured against production, every Saturday,
        // Sunday and feriado answers `602` and only business days have rows. So the day needing a rate is
        // one publication too new, and 10038 wants "el día hábil anterior a la fecha de emisión".
        expect(rateDayCandidates('20260901')[0]).toBe('20260831');
    });

    it('steps over the weekend instead of spending a 602 on it', () => {
        // What the weekend measurement buys: Monday reads Friday in one call, where walking calendar days
        // would pay two `602`s to learn what is already known.
        expect(rateDayCandidates('20260831')[0]).toBe('20260828');
        // A Sunday and a Saturday both price off the Friday before them, for the same reason.
        expect(rateDayCandidates('20260830')[0]).toBe('20260828');
        expect(rateDayCandidates('20260829')[0]).toBe('20260828');
        // And a Monday's fallbacks are working days too — never another weekend.
        expect(rateDayCandidates('20260831').slice(0, 3)).toEqual(['20260828', '20260827', '20260826']);
    });

    it('walks back one working day at a time, bounded by the rule', () => {
        expect(rateDayCandidates('20260901').slice(0, 4)).toEqual([
            '20260831',
            '20260828',
            '20260827',
            '20260826',
        ]);
        // Bounded, because the walk is paid for by the case it cannot help: a currency with no publication
        // at all answers `602` on every candidate. Counted in working days, so it covers consecutive
        // feriados only.
        expect(rateDayCandidates('20260901')).toHaveLength(RATE_DAY_RULE.walkBackLimit + 1);
    });

    it('never offers a weekend as a candidate at all', () => {
        // Every candidate must be a day ARCA could plausibly have closed on, so a `602` means "feriado"
        // rather than "Sunday". Checked across a whole week of starting points.
        for (const start of ['20260828', '20260829', '20260830', '20260831', '20260901', '20260902']) {
            for (const day of rateDayCandidates(start)) {
                const weekday = new Date(
                    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))),
                ).getUTCDay();
                expect(weekday).toBeGreaterThanOrEqual(1);
                expect(weekday).toBeLessThanOrEqual(5);
            }
        }
    });

    it('crosses month, year and leap boundaries', () => {
        // 2026-03-01 is a Sunday, so the previous working day is Friday the 27th of February.
        expect(rateDayCandidates('20260301')[0]).toBe('20260227');
        // 2027-01-01 is a Friday; the day before it is Thursday the 31st of December.
        expect(rateDayCandidates('20270101')[0]).toBe('20261231');
        // 2028-02-29 is a Tuesday, so a voucher on Wednesday the 1st of March prices off the leap day.
        expect(rateDayCandidates('20280301')[0]).toBe('20280229');
    });

    it('pins the run the rule was decided by', () => {
        // The same convention the band rule follows: a reading taken from the authority carries the day it
        // was taken, so a stale one is visible. `pnpm probe:cotizacion-day` re-takes it.
        expect(RATE_DAY_RULE.measuredOn).toBe('2026-09-01');
        expect(RATE_DAY_RULE.workingDaysBeforeVoucher).toBe(1);
        // Against PRODUCTION specifically: homologación generates its series, so a reading taken there
        // cannot decide this — which is how the offset briefly became 0.
        expect(RATE_DAY_RULE.measuredAgainst).toBe('production');
    });
});

describe('clampToAuthorityToday', () => {
    // 2026-09-01, 11:52 ART — the hour the day-semantics probe ran.
    const now = new Date('2026-09-01T14:52:00Z');

    it('leaves a past or present day alone', () => {
        expect(clampToAuthorityToday('20260825', now)).toBe('20260825');
        expect(clampToAuthorityToday('20260901', now)).toBe('20260901');
    });

    it('clamps a future day to today, per 10038 second clause', () => {
        expect(clampToAuthorityToday('20260902', now)).toBe('20260901');
        expect(clampToAuthorityToday('20271231', now)).toBe('20260901');
    });

    it('reads today in the authority calendar, not the container one', () => {
        // 2026-09-01T02:00Z is still the 31st at 23:00 in Buenos Aires, so reading the UTC day would clamp
        // to the 1st and price a voucher off a day ARCA has not closed.
        expect(clampToAuthorityToday('20260901', new Date('2026-09-01T02:00:00Z'))).toBe('20260831');
    });
});

describe('vintageOf', () => {
    it('reports the latest publication day in the batch', () => {
        // The max rather than a shared value: a thinly-traded currency may not publish every day, so its
        // answer legitimately carries an older day than the dollar's.
        expect(vintageOf(['20260826', '20260827', '20260825'])).toBe('2026-08-27');
    });

    it('is undefined when nothing was published, rather than a fabricated day', () => {
        // A caller compares vintages to tell a run that fired before the authority posted from one that
        // fired after. Inventing a day here would break exactly that comparison.
        expect(vintageOf([])).toBeUndefined();
        expect(vintageOf(['', 'NULL'])).toBeUndefined();
    });
});
