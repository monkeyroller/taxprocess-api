import {ArcaError, ArcaTaxpayerNotFoundError, ArcaValidationError} from '../core/errors.js';

/**
 * How the padrón services say "something went wrong", and which of those sayings are stable, caller-visible
 * outcomes rather than authority failures.
 *
 * Shared by every padrón service on purpose. Both live services are the same ARCA `sr-padron` webapp behind
 * different alcances, so they share a fault vocabulary — and they report the SAME condition through different
 * channels (constancia nests a not-found in its `errorConstancia` payload on a `200`; A13 raises it as a SOAP
 * fault). Classifying in one place is what stops the two from drifting into different HTTP answers for the
 * same authority verdict.
 */

/**
 * "Nobody is registered under this identifier", in the two spellings the services use: constancia's
 * `No existe persona con ese Id` and A13's `La Clave (CUIT/CUIL) consultada es inexistente`.
 *
 * The verdict AND the subject it is about are both required. `errorConstancia` doubles as a data-quality
 * channel for a taxpayer who very much exists (manual §5.3: `Domicilio Incompleto`, `Nombre erróneo`, …), so a
 * bare `no existe` test would let a complaint about a missing *address* throw away an otherwise complete
 * registration as a `404`.
 */
const TAXPAYER_MISSING =
    /no existe\s+(?:un[ao]?\s+|l[ao]\s+|el\s+)?(?:persona|clave|cuit|cuil|cdi|contribuyente)|(?:persona|clave|cuit|cuil|cdi|contribuyente)\b[^.]{0,40}\binexistente/i;

/**
 * "The clave is not one this padrón will report a registration for", in the spellings ARCA uses for a clave
 * that is inactive or has been cancelled: `La clave se encuentra inactiva` and `La CUIT fue cancelada de
 * acuerdo a: CLAVES INVALIDAS.` — both observed live against homologación.
 *
 * A DIFFERENT verdict from {@link TAXPAYER_MISSING}: the person is in the padrón, the constancia simply has
 * no inscripción to show for them. It needs the same treatment all the same, because the answer is at the
 * other service — A13's `getPersonaV2` reports an inactive clave in full, and does not hold a cancelled one
 * at all, which is the authoritative "nobody".
 *
 * Subject and verdict must appear together, as above — but unlike `no existe`, "cancelada"/"inactiva" is
 * vocabulary the data-quality channel shares ("La CUIT registra impuestos cancelados" is a complaint about a
 * live taxpayer), and no proximity rule separates the two readings. The caller is what makes this safe: the
 * constancia service consults it only for an answer that reports nothing about the taxpayer, where there is
 * no registration to throw away — and only to pick the error's MESSAGE, never to decide that it is one. Do
 * not reuse it against a populated response.
 */
const CLAVE_INACTIVE =
    /(?:persona|clave|cuit|cuil|cdi|contribuyente)\b[^.]{0,40}\b(?:inactiv[ao]|cancelad[ao])|claves?\s+inv[aá]lidas?/i;

/**
 * Faults about the CALLER'S credentials rather than about the identifier: WSAA token/signature/certificate
 * problems, and ARCA's authorization wording. Matched first and passed through untouched, for the provider's
 * own ticket handling to classify (see `arca.provider.ts`).
 *
 * Testing these BEFORE the verdicts is what makes the classifier safe, because the padrón services word a
 * rejected ticket and a rejected identifier identically — `El token no es válido` against `El Id de la persona
 * no es valido`. A bare `no es válido` test would report a stale delegate ticket to core as
 * `400 ARCA_VALIDATION / INVALID_ID`, telling it to correct a number that was never wrong while hiding a
 * retryable authority failure behind a caller error.
 */
const CREDENTIAL_FAULT = /token|ticket|firma|\bsign\b|certificad|no autoriz|computador|relaci[oó]n|represent/i;

/**
 * The subject of a fault that really is about the identifier we sent. Required alongside a verdict, so a
 * complaint about some OTHER thing ARCA could not read is never reported as this taxpayer's problem.
 */
const ID_SUBJECT = /clave|cuit|cuil|cdi|documento|persona|\bid\b/i;

/**
 * Why an EMPTY constancia response is empty: either nobody is registered under the clave we asked about
 * ({@link TAXPAYER_MISSING}) or the clave is inactive/cancelled ({@link CLAVE_INACTIVE}). Ask it only of a
 * response that names no taxpayer — see {@link CLAVE_INACTIVE} for why the wording alone does not settle it.
 *
 * **This no longer decides whether an empty answer is a miss; it only names it** — which is why it is not
 * exported: {@link registrationUnavailableMessage} is the whole of what a caller may do with it. The
 * constancia service raises its not-found on the shape of the mapped record (`identifiesNoTaxpayer`), so a
 * wording ARCA changes without notice costs the operator a sentence, not the fallback. A match is still
 * worth having: it is the authority's own words, and the frontend renders them to tell "nobody registered"
 * from "clave cancelada".
 *
 * The two verdicts share a treatment because they share a remedy: the constancia has no answer and A13 does.
 * The `ArcaTaxpayerNotFoundError` this names is read by the provider as "ask the other padrón", not as a
 * `404` — only an A13 miss is authoritative (`arca.provider.ts`, `claveFor`). Unraised, an inactive clave
 * comes back as a `200` carrying a taxpayer with no name, no `personType` and no `registrationStatus`: an
 * answer about the taxpayer that the authority never gave.
 *
 * Deliberately NOT extended to the SOAP-fault path ({@link translatePadronFault}). The inactive/cancelled
 * wording has only ever been seen in constancia's `errorConstancia` payload, and A13 — the service that
 * reports through faults — answers for an inactive clave rather than refusing, which is why the SDK calls
 * `getPersonaV2`. Classifying a fault we have never observed would assert "nobody" about a clave that exists.
 */
function isRegistrationUnavailable(message: string): boolean {
    if (CREDENTIAL_FAULT.test(message)) {
        return false;
    }
    return TAXPAYER_MISSING.test(message) || CLAVE_INACTIVE.test(message);
}

/**
 * ARCA's own sentence for a constancia answer that names no taxpayer, to carry into the not-found — or
 * `undefined` when there is nothing quotable and the SDK's default text should stand.
 *
 * A recognized verdict ({@link isRegistrationUnavailable}) is preferred because it is the one wording a
 * caller can act on. But an UNRECOGNIZED complaint is still the authority's own words and the only
 * diagnostic that survives being raised — the record it arrived on, `providerMetadata.constanciaErrors` and
 * all, is discarded — so it is quoted rather than dropped. That matters most for a wording that is not a
 * verdict at all ("Servicio no disponible momentaneamente"): the miss is unavoidable, and the message is
 * what tells an operator the constancia was unhappy rather than empty.
 *
 * A complaint about our CREDENTIALS is the one thing never quoted here. It would tell the caller a clave is
 * unknown when the ticket was the problem, and the provider's `padronCall` classifies by message text
 * (`isPadronTicketFault`) — quoting one would evict a delegate ticket ARCA will not re-issue for ~12h, on
 * the strength of a sentence we merely copied.
 */
export function registrationUnavailableMessage(errors: ReadonlyArray<string>): string | undefined {
    return errors.find(isRegistrationUnavailable) ?? errors.find((message) => !CREDENTIAL_FAULT.test(message));
}

/**
 * Translates a padrón SOAP fault into the SDK's own errors. Two of the documented conditions are stable,
 * caller-visible outcomes that must not surface as a generic `502`: an unknown clave/document is a `404`, and
 * a malformed identifier is a `400`. Everything else — credential faults, and any wording we cannot read —
 * passes through unchanged, because an authority error is the honest answer for a fault we did not recognize.
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
