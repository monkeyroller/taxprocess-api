/**
 * The Spanish wording ARCA uses when a fault is about the caller rather than the request, named once.
 *
 * This file holds vocabulary rather than a classifier because two modules ask different questions of it.
 * `faults.ts` asks whether our cached ticket is bad, and must answer no for an authorization problem, since
 * the ticket is valid when an enrolment is missing and evicting it would purge one ARCA will not re-mint for
 * ~12h. `padron-faults.ts` asks whether a fault is about our credentials at all, and must answer yes for
 * both, since the padrón services word a rejected ticket and a rejected identifier identically.
 *
 * Both answers are right, and neither classifier may be merged into the other. Spelled out independently,
 * the second was the first's union minus `hash` — a gap nothing would have caught.
 *
 * Not every credential-fault pattern belongs here: `TOKEN_FAULT_MESSAGE` stays local to `faults.ts`, since
 * it reads the tail of a `600` already prefixed `ValidacionDeToken:`, where the bare word `token` carries no
 * information. A term added here must not be assumed to belong there.
 *
 * Kept inside `arca/` because every term is Argentine: another authority will refuse a caller in its own
 * language.
 */

/**
 * Words naming the credential itself — the ticket, its signature, or the certificate behind it. Deliberately
 * narrow, never ARCA's authorization vocabulary: `token` is what separates the two where ARCA mixes them, as
 * in `No autorizado, par token/sign invalido`. `hash` belongs here because a `VerificacionDeHash` fault is
 * the CMS signature failing to verify.
 *
 * `\\b` rather than `\b`: these terms are strings fed to `new RegExp`, so every backslash has to survive the
 * string escape first. `'\b'` is the backspace character U+0008 and compiles to a pattern that can never
 * match, silently killing the `sign` alternative.
 */
const CRYPTO_CREDENTIAL_TERMS = 'token|ticket|firma|\\bsign\\b|certificad|hash';

/**
 * Words naming who is refused — a missing enrolment or a lapsed delegation. The credential is intact in both
 * cases, and no cryptographic fault message mentions a party, which is what makes these the more specific
 * signal even when the text also says a permission expired.
 */
const AUTHORIZATION_TERMS = 'no autoriz|computador|relaci[oó]n|represent';

/** A fault naming the credential itself. */
export const CRYPTO_CREDENTIAL_FAULT = new RegExp(CRYPTO_CREDENTIAL_TERMS, 'i');

/** A fault naming who is refused rather than what is wrong with the credential. */
export const AUTHORIZATION_FAULT = new RegExp(AUTHORIZATION_TERMS, 'i');

/**
 * A fault about the caller in either sense. Built as the union rather than a hand-copied alternation, so a
 * term added to either group above reaches this too.
 */
export const ANY_CALLER_FAULT = new RegExp(`${CRYPTO_CREDENTIAL_TERMS}|${AUTHORIZATION_TERMS}`, 'i');
