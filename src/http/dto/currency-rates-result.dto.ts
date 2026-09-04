/**
 * The neutral exchange-rate batch: the authority's published rates, the band it accepts around each,
 * and the codes it had no rate for. A missing currency travels in `unavailable` rather than failing
 * the batch.
 */
import type {BandBasis} from '../../providers/provider/rate-band/rate-band.js';

/** Why a requested currency has no rate in the answer. All three are ordinary outcomes, not errors. */
export type CurrencyRateUnavailableReason =
    /** The authority has no publication for this code (AR: a `602 Sin Resultados`). */
    | 'NO_PUBLICATION'
    /**
     * The code is not one this entity can be asked about — either the authority does not recognize it (AR: a
     * `12000`) or it is outside the catalogue this service supports. One outcome for both, since either way
     * it means no rate now, a refused invoice later, and the same move by the caller.
     */
    | 'UNKNOWN_CODE'
    /**
     * The authority could not be reached for this code, or answered unintelligibly — including an answer
     * carrying a rate but no usable day, which there would be nothing to key by.
     */
    | 'UPSTREAM_ERROR';

/** One currency's published rate and the band the authority accepts around it. */
export class CurrencyRateDto {
    /**
     * The entity's own currency code (AR: `MonId`), in the authority's spelling rather than the request's —
     * read back off the answer, since the authority decides the canonical form. Requests are normalized
     * before being sent, so `"dol"` comes back as `DOL`; match a result to a request on the normalized code
     * rather than byte-for-byte. A code that produced no rate echoes the normalized request instead, there
     * having been no answer to read a spelling from.
     */
    currencyCode!: string;

    /** The authority's published rate, in local-currency units per unit of `currencyCode`. */
    rate!: number;

    /** Lowest rate the authority accepts, inclusive. */
    lowerLimit!: number;

    /** Highest rate the authority accepts, inclusive. */
    upperLimit!: number;

    /**
     * The day the rate is for — the authority's last published business day, which may be earlier than the
     * day asked for. Store this rather than the requested date, so a Monday sale is provably validated
     * against Friday's number.
     *
     * Always a real day here: an answer carrying a rate but no usable day is reported under `unavailable`
     * instead, so this field never needs an "if blank" branch. The fallback a caller would write there is
     * the requested date, which is the one value ruled out above.
     */
    rateDate!: string;

    /** Which rule produced `lowerLimit`/`upperLimit`. */
    bandBasis!: BandBasis;

    /**
     * Start of the period this rate applies to — an absolute instant, in UTC.
     *
     * The authority's applicability, not your entitlement to serve a cached copy. The two are easily
     * conflated and are not the same thing: this says which vouchers the number prices, and it is a property
     * of the entity, currency and day alone that never changes afterwards. For a backdated request the whole
     * window is therefore in the past, which is correct and permanent rather than expired — test it against
     * the voucher's instant, never against `now`, or every backdated answer reads as stale and is re-fetched
     * on every read.
     *
     * Keyed on the day asked for, so it is not derivable from `rateDate`, which may be several days earlier:
     * Saturday, Sunday and Monday all price off Friday's close and share one `rate` and one `rateDate`
     * between them, but carry three distinct one-day windows. `CONTRACT.md` §3 has why the alternative — the
     * true span of a close — is not something this service can state.
     */
    validFrom!: string;

    /**
     * End of the period this rate applies to, exclusive — an absolute instant, in UTC.
     *
     * The next authority midnight after `validFrom`, so the window is one authority day wide. An authority
     * that republished intraday would narrow it, which is why the pair travels per rate rather than per
     * batch; today every rate in one answer carries the same window.
     */
    validUntil!: string;
}

/** A requested code the authority had no rate for. */
export class CurrencyRateUnavailableDto {
    currencyCode!: string;
    reason!: CurrencyRateUnavailableReason;
}

/**
 * Result of `POST /currencies/rates` — the authority's published cotizaciones at one vintage.
 *
 * Answered under this service's own delegate identity, so there is no issuer and no credentials: a cotización
 * is a property of the entity, currency and day alone, which is what makes it centrally cacheable by a
 * caller serving many tenants.
 */
export class CurrencyRatesResultDto {
    entityCode!: string;

    environment!: string;

    /** One entry per code that had a publication. Empty is a legitimate answer, not a failure. */
    rates!: Array<CurrencyRateDto>;

    /** Codes with no rate, with a reason each. Omitted when every requested code answered. */
    unavailable?: Array<CurrencyRateUnavailableDto>;

    /**
     * Absolute instant meaning "this value cannot change before then" — an instant rather than a publication
     * clock, so a country-agnostic caller never hardcodes the authority's schedule. Always present, including
     * when everything is unavailable, and never in the past. In UTC, as every instant on this wire is.
     *
     * Formally the later of the earliest `validUntil` in the batch and the next authority midnight. Since a
     * requested day is clamped at today, the second term always wins, which leaves three cases worth telling
     * apart: on a live request it is identical to every rate's `validUntil`, so the ranges subsume it; on a
     * backdated one it is the only forward-looking instant in the payload, every window being legitimately
     * in the past; and with no rates at all it is the only refresh signal there is, since there are no
     * ranges to read one from. That last case — a client that would otherwise poll hot — is why the field
     * outlived the arrival of `validUntil` rather than being retired alongside it.
     *
     * Advisory: a fact about the data, not an instruction about a caller's cron. It used to carry ARCA's
     * publication hour and to tell callers to push their next run later but never earlier, which is unusable
     * by any caller whose cache validity ends at its next scheduled run. That incompatibility is gone now
     * that validity ends where the authority says rather than at a caller's next tick, and the field stays
     * advisory regardless. Store it as a record of what the answer claimed; nothing requires acting on it.
     */
    refreshAfter!: string;

    /**
     * The vintage of this batch — the latest `rateDate` it carries. Tells a run that fired before the
     * authority posted, carrying the same vintage as last time, from one that fired after. Absent rather
     * than fabricated when nothing was published at all.
     */
    publishedAt?: string;
}
