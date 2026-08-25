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

/** Whether an authority message means "no taxpayer is registered under the identifier we asked about". */
export function isTaxpayerMissing(message: string): boolean {
    return !CREDENTIAL_FAULT.test(message) && TAXPAYER_MISSING.test(message);
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
