import {arcaDayToUtcInstant, toArcaDay} from '../authority-day/authority-day.js';
import {
    FCE_OBLIGATED_RECEIVER_ROWS,
    FCE_REGISTRY_SNAPSHOT,
} from './obligated-receivers.generated.js';
import type {ObligationAnswer} from '../../../../http/dto/credit-invoice-obligation-result.dto.js';

/**
 * Reading ARCA's vendored "empresas grandes" listing — the offline fallback for the FCE reception-obligation
 * lookup, used only when WSFECRED cannot be reached at all.
 *
 * The generated snapshot beside this file is the data; this is the judgement about when it may be applied.
 * Two rules, and they are what keep a dated observation from quietly becoming a constant:
 *
 * 1. An empty snapshot cannot speak. It has never been generated, so it knows nothing — which is different
 *    from knowing that a CUIT is absent.
 * 2. A snapshot cannot speak about any day before it took effect.
 *
 * In both cases the answer is `undefined`, the caller re-raises the authority's own failure, and the
 * endpoint answers `502`. Never a guess.
 */

/**
 * The listing's effective day in ARCA's `yyyymmdd` spelling, or `undefined` when the snapshot is a
 * placeholder. Derived through `toArcaDay` rather than by stripping dashes, so a malformed generated value
 * is refused here instead of comparing as a plausible-looking string.
 *
 * Refused means `undefined`, never a throw. This whole module is called from inside
 * `decideReceptionObligation`'s catch, where raising would discard the authority's own failure and answer a
 * `400` about our generated file for what is an outage — and would silently do it on every request. A
 * snapshot whose date does not parse is a snapshot that cannot speak, which is a case this reader already
 * has an answer for.
 */
function publishedDay(): string | undefined {
    const publishedAt = FCE_REGISTRY_SNAPSHOT.publishedAt;
    if (publishedAt === '') {
        return undefined;
    }
    try {
        return toArcaDay(publishedAt, 'FCE_REGISTRY_SNAPSHOT.publishedAt');
    } catch {
        return undefined;
    }
}

/**
 * The obligated CUITs, built once on first use.
 *
 * Lazy so a request that never falls back pays nothing — module load stays free, which matters because the
 * overwhelmingly common path is the authority answering. Same shape as the INDEC reader's index.
 */
let receivers: ReadonlySet<string> | undefined;

function obligatedReceivers(): ReadonlySet<string> {
    receivers ??= new Set(
            FCE_OBLIGATED_RECEIVER_ROWS.split('\n')
                .map((row) => row.trim())
            .filter((row) => row !== ''),
    );
    return receivers;
}

/**
 * The listing's effective day when it may be applied to `issueDay`, or `undefined` when it may not.
 *
 * Returns the day rather than a boolean so the answer below derives `asOf` from the same parse that decided
 * the question. Two readings could not disagree, but the second one was a second call to `toArcaDay` on
 * every lookup for a value already in hand.
 */
function answerableDay(issueDay: string): string | undefined {
    const published = publishedDay();
    if (published === undefined || FCE_REGISTRY_SNAPSHOT.rowCount === 0) {
        return undefined;
    }
    return issueDay >= published ? published : undefined;
}

/**
 * Whether the snapshot can answer about `issueDay` at all — exported for the tests, which pin the two
 * refusals ("never generated" and "before it took effect") separately from the verdict they produce.
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
 * Deliberately **no staleness expiry**. "If the snapshot is older than N days, decline" would convert a
 * working fallback into a `502` on a schedule nobody is watching, which is the failure `refreshAfter`'s
 * docblock already argues against: the dates are a fact about the data, not an instruction about anyone's
 * cron. Always answer, always publish the snapshot, and let the caller judge.
 *
 * Pure and clock-free: `asOf` comes from the listing's own effective day, not from `now`. An answer that
 * said `asOf: <today>` would be claiming a currency it does not have.
 */
export function lookupObligatedReceiver(
    receiverTaxId: string,
    issueDay: string,
): ObligationAnswer | undefined {
    const published = answerableDay(issueDay);
    if (published === undefined) {
        return undefined;
    }

    const obligated = obligatedReceivers().has(receiverTaxId);
    const snapshot = FCE_REGISTRY_SNAPSHOT;

    return {
        obligated,
        // Present only when obligated: an unobligated receiver has no floor, and omitting it keeps the
        // held figure out of the great majority of answers.
        ...(obligated
            ? {
                  threshold: {
                      amount: snapshot.generalThreshold.amount,
                      currencyCode: snapshot.generalThreshold.currencyCode,
                  },
              }
            : {}),
        source: 'LOCAL_REGISTRY',
        // The instant the listing took effect, in Argentina — when the fact became true, not when we read
        // the page and not now.
        asOf: arcaDayToUtcInstant(published),
        registrySnapshot: {
            publishedAt: snapshot.publishedAt,
            fetchedAt: snapshot.fetchedAt,
        },
        providerMetadata: {
            sourceUrl: snapshot.sourceUrl,
            instrument: snapshot.generalThreshold.instrument,
            rowCount: snapshot.rowCount,
        },
    };
}
