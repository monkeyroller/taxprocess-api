/**
 * The idempotency key WSFEX requires on every export authorization (`Cmp.Id`).
 *
 * **Generated here rather than asked of the caller**, and that is a contract decision, not a convenience.
 * Re-sending an id ARCA has already stored returns the *stored voucher* — a different sale, with a real CAE,
 * under a `200`. Nothing downstream catches it: when the authority finds a stored id it replays the answer
 * without validating the submitted document, so the voucher-number sequence rule (1535) never runs. A key
 * whose only failure mode is silent should not be a caller's responsibility, and a caller that never sees it
 * cannot reuse it.
 *
 * **Uniqueness is the whole requirement — not monotonicity.** Validation 1014 is the only rule ARCA states
 * on the field: a number greater than or equal to zero. `FEXGetLast_ID` reports the maximum it has seen, but
 * nothing requires the next id to exceed it, so clock skew between instances is harmless and no instance
 * needs to know what any other has issued.
 *
 * **Why time-derived rather than a counter.** A counter would have to be read before it is written, and this
 * service holds no database to serialize that against (contract §1). Two instances issuing for one CUIT
 * would read the same maximum and send the same id — the exact collision above, manufactured internally
 * where it is worse, since the caller at least knows which sale it asked about. A numeric datetime needs no
 * read and no lock, and is one of the two generators the WSFEX manual itself suggests.
 *
 * The residual failure is a generator that repeats. `reprocessed` on the result is the alarm for it — on an
 * id this service produced, a replay should be impossible — and `FEXGetLast_ID` is the external confirmation.
 */

/**
 * ARCA types the field `Long(N15)`. Epoch milliseconds is 13 digits until 2286, so two more digits fit
 * inside the width and are spent on entropy: two instances must collide within the same millisecond *for
 * the same issuer* and then draw the same suffix.
 */
const ENTROPY_RANGE = 100;

/**
 * A fresh `Cmp.Id`.
 *
 * `now` and `entropy` are parameters rather than imports so a test can freeze both — the shape
 * `rateDayCandidates` and `clampToAuthorityToday` already use for the clock.
 */
export function nextRequestId(now: Date, entropy: () => number): number {
    const suffix = Math.floor(entropy() * ENTROPY_RANGE) % ENTROPY_RANGE;
    return now.getTime() * ENTROPY_RANGE + suffix;
}
