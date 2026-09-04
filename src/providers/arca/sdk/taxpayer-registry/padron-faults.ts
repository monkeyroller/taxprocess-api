import {ArcaError, ArcaTaxpayerNotFoundError, ArcaValidationError} from '../core/errors.js';
import {ANY_CALLER_FAULT} from '../core/fault-vocabulary.js';

/**
 * How the padrón services say "something went wrong", and which of those sayings are stable, caller-visible
 * outcomes rather than authority failures.
 *
 * Shared by every padrón service: both live services are the same ARCA `sr-padron` webapp behind different
 * alcances, so they share a vocabulary while reporting the same condition through different channels —
 * constancia nests a not-found in its `errorConstancia` payload on a `200`, A13 raises it as a SOAP fault.
 * Classifying in one place is what stops the two drifting into different HTTP answers.
 */

/**
 * "Nobody is registered under this identifier", in the two spellings the services use: constancia's
 * `No existe persona con ese Id` and A13's `La Clave (CUIT/CUIL) consultada es inexistente`.
 *
 * Both the verdict and its subject are required, because `errorConstancia` doubles as a data-quality channel
 * for a taxpayer who does exist (`Domicilio Incompleto`, `Nombre erróneo`). A bare `no existe` test would let
 * a complaint about a missing address throw away an otherwise complete registration as a `404`.
 */
const TAXPAYER_MISSING =
    /no existe\s+(?:un[ao]?\s+|l[ao]\s+|el\s+)?(?:persona|clave|cuit|cuil|cdi|contribuyente)|(?:persona|clave|cuit|cuil|cdi|contribuyente)\b[^.]{0,40}\binexistente/i;

/**
 * A clave that is inactive or cancelled, in the two spellings observed live against homologación:
 * `La clave se encuentra inactiva` and `La CUIT fue cancelada de acuerdo a: CLAVES INVALIDAS.`
 *
 * A different verdict from `TAXPAYER_MISSING` — the person is in the padrón, the constancia simply has no
 * inscripción to show for them — but it needs the same treatment, because the answer is at the other
 * service: A13 reports an inactive clave in full and does not hold a cancelled one at all.
 *
 * Unlike `no existe`, this vocabulary is shared with the data-quality channel ("La CUIT registra impuestos
 * cancelados" is a complaint about a live taxpayer), and no proximity rule separates the two readings. The
 * caller is what makes it safe: the constancia service consults it only for an answer that reports nothing
 * about the taxpayer, and only to pick the error's message. Do not reuse it against a populated response.
 */
const CLAVE_INACTIVE =
    /(?:persona|clave|cuit|cuil|cdi|contribuyente)\b[^.]{0,40}\b(?:inactiv[ao]|cancelad[ao])|claves?\s+inv[aá]lidas?/i;

/**
 * Faults about the caller's credentials rather than the identifier. Matched first and passed through
 * untouched, for the provider's own ticket handling to classify.
 *
 * Testing these before the verdicts is what makes the classifier safe, because the padrón services word a
 * rejected ticket and a rejected identifier identically — `El token no es válido` against `El Id de la
 * persona no es valido`. A bare `no es válido` test would report a stale delegate ticket as `INVALID_ID`,
 * telling core to correct a number that was never wrong.
 */
const CREDENTIAL_FAULT = ANY_CALLER_FAULT;

/**
 * The subject of a fault that really is about the identifier we sent. Required alongside a verdict, so a
 * complaint about some OTHER thing ARCA could not read is never reported as this taxpayer's problem.
 */
const ID_SUBJECT = /clave|cuit|cuil|cdi|documento|persona|\bid\b/i;

/**
 * Why an empty constancia response is empty: either nobody is registered under the clave, or the clave is
 * inactive or cancelled. Ask it only of a response that names no taxpayer.
 *
 * This only names an empty answer; it does not decide that one is a miss, which is why it is unexported. The
 * constancia service raises its not-found on the shape of the mapped record instead, so a wording ARCA
 * changes without notice costs the operator a sentence rather than the fallback. A match is still worth
 * having, being the authority's own words: the frontend renders them to tell "nobody registered" from
 * "clave cancelada".
 *
 * The two verdicts share a treatment because they share a remedy — the constancia has no answer and A13
 * does, and the provider reads this not-found as "ask the other padrón" rather than as a `404`.
 *
 * Deliberately not extended to the SOAP-fault path: the inactive wording has only been seen in constancia's
 * `errorConstancia` payload, and A13 answers for an inactive clave rather than refusing. Classifying a fault
 * we have never observed would assert "nobody" about a clave that exists.
 */
function isRegistrationUnavailable(message: string): boolean {
    if (CREDENTIAL_FAULT.test(message)) {
        return false;
    }
    return TAXPAYER_MISSING.test(message) || CLAVE_INACTIVE.test(message);
}

/**
 * ARCA's own sentence for a constancia answer that names no taxpayer, to carry into the not-found, or
 * `undefined` when there is nothing quotable.
 *
 * A recognized verdict is preferred, being the one wording a caller can act on, but an unrecognized
 * complaint is still the only diagnostic that survives being raised — the record it arrived on is discarded
 * — so it is quoted rather than dropped. That matters most for a wording that is not a verdict at all
 * ("Servicio no disponible momentaneamente"), where the message is what tells an operator the constancia was
 * unhappy rather than empty.
 *
 * A complaint about our credentials is never quoted: it would tell the caller a clave is unknown when the
 * ticket was the problem, and since the provider classifies by message text, quoting one would evict a
 * delegate ticket ARCA will not re-issue for ~12h.
 */
export function registrationUnavailableMessage(errors: ReadonlyArray<string>): string | undefined {
    return errors.find(isRegistrationUnavailable) ?? errors.find((message) => !CREDENTIAL_FAULT.test(message));
}

/**
 * Translates a padrón SOAP fault into the SDK's own errors. Two conditions are caller-visible outcomes that
 * must not surface as a generic `502`: an unknown clave or document is a `404`, and a malformed identifier a
 * `400`. Everything else passes through unchanged, an authority error being the honest answer for a fault we
 * did not recognize.
 */
export function translatePadronFault(err: unknown, id: string): unknown {
    if (!(err instanceof ArcaError) || err instanceof ArcaTaxpayerNotFoundError || err instanceof ArcaValidationError) {
        return err;
    }
    const message = err.message;
    if (CREDENTIAL_FAULT.test(message)) {
        return err;
    }
    if (TAXPAYER_MISSING.test(message)) {
        return new ArcaTaxpayerNotFoundError(id, message);
    }
    if (ID_SUBJECT.test(message) && /no es v[aá]lido/i.test(message)) {
        return new ArcaValidationError(message, 'INVALID_ID');
    }
    return err;
}
