import {arcaDayToUtcInstant, toArcaDay} from '../authority-day/authority-day.js';
import {FCE_OBLIGATED_RECEIVERS, FCE_REGISTRY_SNAPSHOT} from './obligated-receivers.generated.js';
import type {FceObligatedReceiver} from './fce-registry.types.js';
import type {ObligationAnswer} from '../../../../http/dto/credit-invoice-obligation-result.dto.js';

/**
 * Reading ARCA's vendored "empresas grandes" listing — the offline fallback for the FCE reception-obligation
 * lookup, used only when WSFECRED cannot be reached at all.
 *
 * The generated snapshot beside this file is the data; this is the judgement about when it may be applied.
 * Three rules, and each exists because the snapshot knows less than it looks like it knows:
 *
 * 1. **An empty snapshot cannot speak.** It has never been generated, so it knows nothing — which is a
 *    different thing from knowing that a CUIT is absent.
 * 2. **It cannot speak about a day before it was read.** Bajas take effect in July and a removed company is
 *    simply gone from the listing, so for an earlier voucher this cannot tell "never obligated" from "no
 *    longer obligated". The floor is `fetchedAt` rather than a publication date because ARCA publishes
 *    none — see {@link FceRegistrySnapshot.fetchedAt}.
 * 3. **A row does not mean obligated *yet*.** Each carries the day that company's obligation begins, and
 *    ARCA notifies the year's universe in May while its altas take effect in September. Between those
 *    months the listing contains companies that are not obligated for another four.
 *
 * Rules 1 and 2 answer `undefined` — the caller then re-raises the authority's own failure and the endpoint
 * answers `502`. Rule 3 is an ordinary `obligated: false`. Never a guess.
 */

/** One indexed row: the generated record, plus its start day already in ARCA's `yyyymmdd`. */
interface IndexedReceiver extends FceObligatedReceiver {
    /** `undefined` when the generated `since` is blank or does not parse. */
    readonly sinceDay: string | undefined;
}

let receivers: ReadonlyMap<string, IndexedReceiver> | undefined;

/**
 * The listing as a `Map`, built once on first use.
 *
 * Through a `Map` rather than by indexing the generated object directly, for two reasons. A plain object
 * answers for inherited keys — `receivers['constructor']` is a function, not a company — and while a CUIT
 * that reached here has already been narrowed to eleven digits by `assertCuit`, relying on a caller's
 * validation to keep a lookup sound is the coupling `faults.ts` avoids with `Object.hasOwn`. Building lazily
 * keeps the cost off every request that never falls back, which is almost all of them.
 *
 * Each row's `since` is parsed **here**, not per lookup. It is the same string every time, so parsing it on
 * every answer was work with no question behind it — and it is what lets the complaint below be made once
 * per process rather than once per request, which matters because the requests that reach this reader are
 * the ones happening during an outage somebody is already reading the log through.
 */
function obligatedReceivers(): ReadonlyMap<string, IndexedReceiver> {
    if (receivers === undefined) {
        const index = new Map<string, IndexedReceiver>();
        const unreadable: Array<string> = [];

        for (const [taxId, row] of Object.entries(FCE_OBLIGATED_RECEIVERS)) {
            const sinceDay = generatedDay(row.since, 'FCE_OBLIGATED_RECEIVERS');
            if (sinceDay === undefined && row.since !== '') {
                unreadable.push(`${taxId} (${JSON.stringify(row.since)})`);
            }
            index.set(taxId, {...row, sinceDay});
        }

        // A listed row whose start day will not parse is a corrupt generated file, not an ordinary absence:
        // it answers `false` for a company the listing does hold. Nothing on the wire can say so — the
        // answer omits `obligatedSince` rather than publishing a value this reader refused — so it is said
        // here, once, where an operator can act on it.
        if (unreadable.length > 0) {
            console.warn(
                `[fce-registry] ${String(unreadable.length)} listed row(s) carry a start day that does ` +
                    'not parse and are answered as not obligated. Regenerate with ' +
                    `\`node scripts/build-fce-registry.mjs\`: ${unreadable.slice(0, 10).join(', ')}`,
            );
        }
        receivers = index;
    }
    return receivers;
}

/**
 * A generated ISO day in ARCA's `yyyymmdd` spelling, or `undefined` when it does not parse.
 *
 * Through `toArcaDay` rather than by stripping dashes, so a malformed generated value is refused here
 * instead of comparing as a plausible-looking string.
 *
 * Refused means `undefined`, never a throw. This whole module is called from inside
 * `decideReceptionObligation`'s catch, where raising would discard the authority's own failure and answer a
 * `400` about our generated file for what is an outage — and would silently do it on every request. A
 * snapshot whose dates do not parse is a snapshot that cannot speak, which is a case this reader already
 * has an answer for.
 */
function generatedDay(value: string, field: string): string | undefined {
    if (value === '') {
        return undefined;
    }
    try {
        return toArcaDay(value, field);
    } catch {
        return undefined;
    }
}

/** The day the snapshot was read, in ARCA's `yyyymmdd`, or `undefined` when it is a placeholder. */
function readDay(): string | undefined {
    return generatedDay(FCE_REGISTRY_SNAPSHOT.fetchedAt, 'FCE_REGISTRY_SNAPSHOT.fetchedAt');
}

/**
 * The day the snapshot was read when it may be applied to `issueDay`, or `undefined` when it may not.
 *
 * Returns the day rather than a boolean so the answer below derives `asOf` from the same parse that decided
 * the question. Two readings could not disagree, but the second one was a second call to `toArcaDay` on
 * every lookup for a value already in hand.
 */
function answerableDay(issueDay: string): string | undefined {
    const read = readDay();
    if (read === undefined || FCE_REGISTRY_SNAPSHOT.rowCount === 0) {
        return undefined;
    }
    return issueDay >= read ? read : undefined;
}

/**
 * Whether the snapshot can answer about `issueDay` at all — exported for the tests, which pin the two
 * refusals ("never generated" and "before it was read") separately from the verdict they produce.
 *
 * No production caller today. `decideReceptionObligation` only checks whether `registry()` came back
 * `undefined`, so "there is no fallback" and "the fallback declined this day" reach its log as one line.
 * Telling them apart there would be a use for this; claiming it already does would not.
 */
export function canAnswerFor(issueDay: string): boolean {
    return answerableDay(issueDay) !== undefined;
}

/**
 * The offline verdict for `receiverTaxId` on `issueDay` (ARCA `yyyymmdd`), or `undefined` when this
 * snapshot cannot speak about that day.
 *
 * Returns a **whole** {@link ObligationAnswer}, already stamped `LOCAL_REGISTRY` with its snapshot dates.
 * That is not a convenience: it is what makes mixing structurally impossible. The decision function above
 * this one only ever picks a branch, so there is no shape in which a live `obligado` could end up beside
 * this file's threshold — the disagreement that would appear precisely when the régimen changes.
 *
 * Deliberately **no staleness expiry** beyond the floor. "If the snapshot is older than N days, decline"
 * would convert a working fallback into a `502` on a schedule nobody is watching, which is the failure
 * `refreshAfter`'s docblock already argues against: the dates are a fact about the data, not an instruction
 * about anyone's cron. Always answer, always publish the dates, and let the caller judge.
 *
 * Clock-free, and never throws: `asOf` comes from the day the snapshot was read, not from `now` — an answer
 * that said `asOf: <today>` would be claiming a currency it does not have — and a generated date that will
 * not parse is declined rather than raised, since this runs inside `decideReceptionObligation`'s catch.
 *
 * Referentially transparent for the same arguments. Not quite *pure*, and only in one direction worth
 * naming: the very first call builds the index, which may `console.warn` about a corrupt generated row. No
 * later call repeats it, and nothing about the answer depends on it.
 */
export function lookupObligatedReceiver(
    receiverTaxId: string,
    issueDay: string,
): ObligationAnswer | undefined {
    const read = answerableDay(issueDay);
    if (read === undefined) {
        return undefined;
    }

    const snapshot = FCE_REGISTRY_SNAPSHOT;
    const listed = obligatedReceivers().get(receiverTaxId);
    // Listed, but only from the day the authority says — a company notified in May is not obligated until
    // its alta takes effect in September, and answering `true` in between issues a credit invoice months
    // before the buyer owes one.
    //
    // A row with no start day, or one that does not parse, is treated as not obligated rather than as
    // obligated since forever: the snapshot cannot state when the obligation began, and the direction that
    // guesses `true` is the one that puts a credit invoice on a sale that did not need one.
    //
    // `sinceDay` was parsed when the index was built, and a row that failed was complained about there —
    // see {@link obligatedReceivers}.
    const since = listed?.sinceDay;
    const obligated = since !== undefined && issueDay >= since;

    return {
        obligated,
        // Present only when obligated: an unobligated receiver has no floor, and omitting it keeps the
        // held figure out of the great majority of answers.
        //
        // Not gated on `generalThreshold.effectiveFrom`, because it cannot be: `threshold` is present if
        // and only if `obligated` is true, so there is no shape here in which a not-yet-effective figure
        // could be withheld without breaking that. The build script refuses to vendor one instead.
        ...(obligated
            ? {
                  threshold: {
                      amount: snapshot.generalThreshold.amount,
                      currencyCode: snapshot.generalThreshold.currencyCode,
                  },
              }
            : {}),
        source: 'LOCAL_REGISTRY',
        // The instant the snapshot was read, in Argentina — not now, and not a publication date the
        // listing never states.
        asOf: arcaDayToUtcInstant(read),
        registrySnapshot: {
            fetchedAt: snapshot.fetchedAt,
            thresholdEffectiveFrom: snapshot.generalThreshold.effectiveFrom,
        },
        providerMetadata: {
            sourceUrl: snapshot.sourceUrl,
            instrument: snapshot.generalThreshold.instrument,
            rowCount: snapshot.rowCount,
            // Present only when the snapshot holds this receiver, so "we looked and it is not listed" is
            // distinguishable from "we found it and here is why". The name is what makes the answer
            // legible to whoever asks afterwards why a sale became a credit invoice.
            //
            // `obligatedSince` rides on the *parsed* day, not on `listed`: a start day the reader refused
            // is a value it decided nothing with, and publishing it beside `obligated: false` would offer a
            // caller a date that explains nothing about the verdict it sits next to. The name still travels
            // — naming the company is right either way, and its absence is what says the date was rejected.
            ...(listed === undefined
                ? {}
                : {
                      ...(since === undefined ? {} : {obligatedSince: listed.since}),
                      ...(listed.name === '' ? {} : {receiverName: listed.name}),
                  }),
        },
    };
}
