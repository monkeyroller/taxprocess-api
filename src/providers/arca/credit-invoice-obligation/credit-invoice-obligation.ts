import {ArcaAuthError, ArcaServiceError, ArcaSoapError} from '../sdk/core/errors.js';
import type {ObligationAnswer} from '../../../http/dto/credit-invoice-obligation-result.dto.js';

/**
 * Deciding one FCE reception-obligation answer from two independent sources: WSFECRED, and the vendored
 * "empresas grandes" listing.
 *
 * The régimen's requirement is that the web service is the primary and the local list is the fallback,
 * never the reverse, and that the answer says which one spoke. The requirement underneath that one is
 * subtler and is what shapes this module: **`obligated` and its threshold must come from the same place.**
 * A live `obligado` beside a cached or constant threshold disagrees precisely when the régimen changes,
 * which is the only moment the answer matters at all.
 *
 * So this is enforced structurally rather than by discipline. Each source returns a *whole*
 * {@link ObligationAnswer}, already stamped with its own `source`, `asOf` and snapshot. This function picks
 * a branch and returns it untouched — there is no intermediate shape in which a blend could even be
 * written, and producing one later would mean changing this return type rather than slipping in a `??`.
 *
 * It must also not fail in either direction. Answering `obligated: false` because the service was down
 * would issue an ordinary factura the authority later refuses, off the numerator, with nothing naming the
 * cause. But failing closed on every outage would stop a tenant invoicing, and the universe of empresas
 * grandes changes twice a year rather than hourly — a day-old list is much the smaller harm.
 */

/** The two sources, as thunks, so this function needs no network, no clock and no cache to be tested. */
export interface ObligationSources {
    /** Asks the authority. Resolves a whole answer or rejects; never resolves a partial one. */
    readonly authority: () => Promise<ObligationAnswer>;
    /** The offline snapshot. Synchronous, clock-free, never throws. `undefined` means "cannot speak". */
    readonly registry: () => ObligationAnswer | undefined;
    /** Whether an authority failure is eligible for fallback. Defaults to {@link isAuthorityUnavailable}. */
    readonly eligibleForFallback?: (err: unknown) => boolean;
}

/**
 * Whether a failure is the authority being unreachable rather than the caller being wrong.
 *
 * The rule, stated as a rule so the next error class is covered by it rather than by a list: **fall back on
 * a failure of the authority or of the transport to it; propagate a failure of the caller's credentials or
 * of our own configuration.** A fallback exists for failures nobody can act on — hiding an actionable one
 * behind a `200` makes it permanent and invisible.
 *
 * The two live cases are `DelegationNotConfiguredError` — our own delegate certificate missing, or not
 * enrolled in `wsfecred`, which is a broken deploy no retry clears — and `ArcaValidationError`, raised
 * before any call is even made. Both travel straight through and become their own status codes.
 *
 * `CredentialsRequiredError` and `DelegationNotAuthorizedError` cannot arise on this path: the lookup reads
 * under our own delegated identity, so there is no tenant credential to ask for and no represented party to
 * have failed to authorize us. They are named here, and asserted in the test beside the live pair, for the
 * reason `faults.ts` records the delegation translator it deleted — an allow-list is judged by what it
 * refuses to swallow, and the day either becomes reachable again the rule should already hold.
 *
 * An **allow-list**, deliberately, not a deny-list. A deny-list would silently swallow whatever neutral
 * error class is added next, which is the direction that turns a new actionable failure into a stale
 * `200` nobody investigates.
 *
 * `ArcaAuthError` is the borderline member and is included: it is arguably our configuration, but at this
 * layer it is indistinguishable from a WSAA outage and it is what a ticket ARCA has started rejecting
 * becomes. The caller logs it specifically, so a persistent one is visible rather than only degraded.
 *
 * ## `ArcaServiceError` is the known-imprecise member
 *
 * It covers two things this layer cannot yet tell apart: an answer we could not read (`toAuthorityAnswer`
 * raises it for an absent `obligado`) and an `arrayErrores` the authority deliberately sent. Falling back
 * is right for the first and is right for the unknown-receiver case of the second — "not registered" and
 * "not obligated" are one outcome, which is why `faults.ts` keeps no receiver-unknown code list.
 *
 * It is **not** obviously right for every other rejection. Once the offline snapshot is populated, a
 * refusal about something else — the asking CUIT not permitted to query an arbitrary receiver, a rate
 * limit, a date the régimen rejects — is answered from the list and labelled `LOCAL_REGISTRY`, which on
 * the wire is indistinguishable from a fallback taken during an outage. Splitting them needs the
 * `arrayErrores` codes `pnpm probe:fecred` has yet to measure; until then the caller logs this branch so
 * it is at least visible, and the failure stays in the safe direction: a dated, labelled answer rather
 * than a confident wrong one.
 */
export function isAuthorityUnavailable(err: unknown): boolean {
    return err instanceof ArcaSoapError || err instanceof ArcaServiceError || err instanceof ArcaAuthError;
}

/**
 * One answer, from whichever source can give a whole one.
 *
 * On a double failure the authority's **original error is rethrown verbatim**, not wrapped. `translateFault`
 * keys on the SDK's own error classes to decide the HTTP status, so wrapping would erase the distinction
 * between `ARCA_SOAP`, `ARCA_SERVICE` and `ARCA_AUTH` and flatten three separately-diagnosable failures
 * into one opaque code. Same reasoning as `rethrowIfSystemic`.
 */
export async function decideReceptionObligation(sources: ObligationSources): Promise<ObligationAnswer> {
    try {
        return await sources.authority();
    } catch (err) {
        const eligible = sources.eligibleForFallback ?? isAuthorityUnavailable;
        if (!eligible(err)) {
            throw err;
        }

        if (err instanceof ArcaAuthError) {
            // Named separately from the generic outage: a recurring one is our certificate, our clock or an
            // enrolment, and degrading quietly to the list would leave nothing saying so.
            console.warn(
                '[fce-obligation] WSFECRED refused our ticket; falling back to the offline registry. ' +
                    `A persistent one is a certificate, clock or wsfecred enrolment problem: ${String(err)}`,
            );
        } else if (err instanceof ArcaServiceError) {
            // **The authority was reached and said no.** That is not an outage, and the fallback below
            // cannot tell the difference — see {@link isAuthorityUnavailable} for why it is still the right
            // branch today and what would let us stop taking it. Logged because it is the one case where a
            // `LOCAL_REGISTRY` answer goes out over a live refusal, and nothing on the wire says so.
            console.warn(
                '[fce-obligation] WSFECRED answered and refused, or answered unreadably; falling back to ' +
                    'the offline registry, so the verdict that goes out comes from the list rather than ' +
                    `from the authority: ${String(err)}`,
            );
        }

        const fallback = sources.registry();
        if (fallback === undefined) {
            console.warn(
                '[fce-obligation] WSFECRED was unreachable and the offline registry could not answer ' +
                    'either, so the sale is refused rather than guessed at. Regenerate the registry with ' +
                    '`node scripts/build-fce-registry.mjs` to make this rare.',
            );
            // Verbatim, so the classification that decides the status survives.
            throw err;
        }
        return fallback;
    }
}
