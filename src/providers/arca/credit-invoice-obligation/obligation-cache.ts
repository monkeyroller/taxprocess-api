import {ExpiringCache} from '../../expiring-cache/expiring-cache.js';
import type {GenericEnvironment} from '../../provider/environment.js';
import type {ObligationAnswer} from '../../../http/dto/credit-invoice-obligation-result.dto.js';

/**
 * Memoizing the authority's FCE reception-obligation answers.
 *
 * The answer does not depend on the voucher's amount, but a sale form re-decides the document type on every
 * change to the invoice total — so across one editing session the same (receiver, day) pair is asked about
 * repeatedly. Uncached, that is a WSFECRED round-trip per keystroke. Single-flight matters for the same
 * reason: without it, concurrent edits fire concurrent calls for an answer already in flight.
 *
 * ## What this cache deliberately cannot hold
 *
 * **It wraps the authority thunk only.** It never sees a composed answer and never sees a fallback, and
 * that is structural rather than conventional: the decision function takes no cache, so a `LOCAL_REGISTRY`
 * answer has no code path into here at all. Two reasons it matters:
 *
 * - A cached fallback extends an outage. Cache the composed answer and a thirty-second ARCA blip becomes a
 *   TTL-long degradation for that pair — and an undiagnosable one, since the next reader sees a cache hit
 *   rather than a failure.
 * - `source` must be re-decided every request. Describing *this* answer's provenance is its entire job.
 *
 * Failures are never cached either. Negative-caching an outage extends it by the TTL.
 */

/**
 * How long an authority answer is trusted.
 *
 * An obligation is a property of (receiver, day, régimen). A past day is settled; today's can flip when a
 * receiver's status changes, and the régimen itself moves by resolución rather than by the hour. So nothing
 * here needs to be tight — this exists to collapse a burst of sale-form edits, not to track the authority
 * closely.
 */
const OBLIGATION_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedObligation {
    readonly answer: ObligationAnswer;
    readonly expiresAt: Date;
}

/**
 * In-memory only — `cachePath` is omitted.
 *
 * The ticket cache persists because WSAA refuses to re-issue while a prior ticket lives, so a restarted
 * process would be locked out. There is no such pressure on a data answer, and writing buyers' CUITs to
 * disk is a surface with no upside. A separate instance from the ticket cache, so nothing here can
 * interfere with ticket eviction whatever the keys look like.
 *
 * `expiryMarginMs: 0`: the margin exists so a credential is never handed out with too little life left to
 * finish the call it was fetched for. A data answer has no such deadline.
 */
const cache = new ExpiringCache<CachedObligation, CachedObligation>({
    expiryMarginMs: 0,
    expiresAt: (value): Date => value.expiresAt,
    // Identity: required by the interface, never called while there is no `cachePath`.
    serialize: (value): CachedObligation => value,
    deserialize: (stored): CachedObligation => stored,
});

/**
 * The cache partition.
 *
 * **Not keyed on the asking tenant, and that is now a fact rather than an optimisation.** Every request
 * reaches WSFECRED under this service's own delegate identity, so the authority is answering the same
 * question on behalf of nobody in particular — the answer cannot vary by who asked, because it never learns
 * who asked. One cached answer therefore serves every tenant, which is the same argument `currencyRates`
 * makes for being cacheable platform-wide.
 *
 * Respects `keyOf`'s grammar invariant: no owner key may be another owner key followed by `:` and more. The
 * environment is a closed set and the segment after it is a fixed word.
 */
function ownerKey(environment: GenericEnvironment): string {
    return `ARCA:${environment}:obligation`;
}

/** `{receiver}:{yyyymmdd}` — both fixed-width, so the pair is unambiguous. */
function scopeKey(receiverCuit: number, issueDay: string): string {
    return `${String(receiverCuit)}:${issueDay}`;
}

/**
 * `ask()`'s answer for this (environment, receiver, day), calling it only on a miss. Not the asking tenant
 * — see {@link ownerKey} for why one answer serves all of them.
 *
 * `ask` must resolve an `AUTHORITY` answer or reject, and that is **checked here rather than assumed**. It
 * holds by construction today — the decision function takes no cache, so a `LOCAL_REGISTRY` answer has no
 * code path in — but construction is what an "optimisation" changes. Move the cache above the branch
 * decision and this throws by name on the first fallback, instead of the endpoint quietly serving a stale
 * `LOCAL_REGISTRY` answer for a TTL that the next reader sees as a cache hit rather than as an outage.
 *
 * Throwing rather than declining to store: a silent pass-through would leave the same wrong answer on the
 * wire, just uncached, which is the bug without the symptom that finds it.
 */
export async function cachedAuthorityObligation(
    environment: GenericEnvironment,
    receiverCuit: number,
    issueDay: string,
    ask: () => Promise<ObligationAnswer>,
    now: Date = new Date(),
): Promise<ObligationAnswer> {
    const entry = await cache.getOrCreate(
        ownerKey(environment),
        scopeKey(receiverCuit, issueDay),
        async () => {
            const answer = await ask();
            if (answer.source !== 'AUTHORITY') {
                throw new Error(
                    `the obligation cache may hold only AUTHORITY answers, and was handed a ` +
                        `"${answer.source}" one. Caching a fallback turns a brief outage into a TTL-long ` +
                        `degradation that reads as a cache hit; cache the authority call, not the ` +
                        `composed answer.`,
                );
            }
            return {answer, expiresAt: new Date(now.getTime() + OBLIGATION_TTL_MS)};
        },
    );
    return entry.answer;
}

/** Test seam: forget everything. Never called on a request path. */
export function clearObligationCache(): void {
    cache.clear();
}
