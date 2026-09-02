import {ServiceId, type ServiceIdValue} from '../sdk/core/constants.js';
// `AUTHORIZATION_FAULT` names who is refused; `CRYPTO_CREDENTIAL_FAULT` names the credential itself. Where
// both are read, authorization is tested first: its phrases name a party, which no cryptographic fault
// message does, so they are the more specific signal even when the text also says a permission expired.
import {AUTHORIZATION_FAULT, CRYPTO_CREDENTIAL_FAULT} from '../sdk/core/fault-vocabulary.js';
import {
    ArcaAuthError,
    ArcaError,
    ArcaServiceError,
    ArcaSoapError,
    ArcaValidationError,
    NotImplementedError,
} from '../sdk/core/errors.js';
import {canonicalCuit} from '../mapping/identifiers.js';
import {DelegationNotAuthorizedError, DelegationNotConfiguredError, ProviderFault} from '../../provider/faults.js';
import type {EntityAuthBlock} from '../../provider/entity-auth.js';
import type {GenericEnvironment} from '../../provider/environment.js';

/**
 * How ARCA says a call failed, and which of those sayings mean what.
 *
 * Pure classification: given a thrown value, decide what it is and build the replacement where the answer is
 * a different error. Nothing here touches the ticket cache, retries, or makes a call — the eviction policy
 * that reacts to a token fault is the provider's, which is what lets both its wrappers share one classifier
 * without sharing a retry policy.
 */

/**
 * WSFEv1 `ValidacionDeToken` — one overloaded code covering both genuine token faults (bad signature/hash,
 * expired or skewed clock) and authorization problems. Only the message text disambiguates.
 */
const TOKEN_VALIDATION_CODE = '600';

/**
 * WSFEv1 `CUIT representada no incluida en token`: the delegate's token does not cover the CUIT in
 * `Auth.Cuit`. Unlike the overloaded `600` this is unambiguous, never a cryptographic fault, so a delegated
 * call that hits it always means a missing or insufficient delegation.
 */
const REPRESENTADO_NOT_IN_TOKEN_CODE = '601';

/**
 * A genuine token fault — for a delegated request this is our certificate or clock, never the represented
 * taxpayer's missing delegation. Matched on ARCA's specific crypto phrasing rather than the bare word
 * `firma`, since authorization rejections mention that too ("No se corresponden token y firma. Usuario no
 * autorizado…").
 *
 * Tested only after `AUTHORIZATION_FAULT`, because a delegation can expire as well ("la relación de
 * representación se encuentra vencida"). Matching that first would hide an actionable `403` behind a
 * retryable `502` and purge the delegate ticket every representado shares, for a condition re-minting cannot
 * fix.
 *
 * Local rather than shared with the other two vocabularies: this reads the tail of a `600` ARCA has already
 * prefixed `ValidacionDeToken:`, which is a narrower question.
 */
const TOKEN_FAULT_MESSAGE = /firma digital|no valid[óo]|hash|expir|caduc|vencid/i;

/**
 * `FEParamGetPtosVenta` returns this with message "Sin Resultados" when the issuer has no registered points
 * of sale — its way of expressing an empty list.
 */
const NO_RESULTS_CODE = '602';

/**
 * `FECompConsultar` reports a voucher that was never authorized with this code as a thrown `Errors` block
 * rather than an empty `200`. Translating exactly this to a `404` is what keeps a genuine not-found
 * distinguishable from an authority failure, which core's orphan reconciliation relies on to decide a
 * stuck-pending sale is safe to clear.
 *
 * Same literal as `NO_RESULTS_CODE`, but a different operation and meaning.
 */
const VOUCHER_NOT_FOUND_CODE = '602';

/** True when `err` is ARCA reporting that this issuer has no registered points of sale. */
export function isNoResults(err: unknown): boolean {
    return err instanceof ArcaServiceError && err.errors.some((e) => e.code === NO_RESULTS_CODE);
}

/**
 * `FEParamGetCotizacion` rejects a `MonId` outside its catalogue with this code. Distinct from a currency the
 * authority simply has no publication for today, which is the ordinary `602`.
 */
const UNKNOWN_CURRENCY_CODE = '12000';

/**
 * True when `err` is ARCA refusing a currency code it does not recognize. On a batched rate lookup this is
 * reported per code rather than failing the request, since one bad code must not cost the others.
 */
export function isUnknownCurrency(err: unknown): boolean {
    return err instanceof ArcaServiceError && err.errors.some((e) => e.code === UNKNOWN_CURRENCY_CODE);
}

/** True when `err` is ARCA reporting a voucher that was never authorized — a stable `404`, never a `502`. */
export function isVoucherNotFound(err: unknown): boolean {
    return err instanceof ArcaServiceError && err.errors.some((e) => e.code === VOUCHER_NOT_FOUND_CODE);
}

/**
 * Maps an ARCA token/representación error on a delegated call to a delegation or token error; passes others
 * through unchanged.
 *
 * `delegateCuit` is a thunk rather than a string: resolving it runs inside an error handler, so the caller
 * owns the degradation, and reading it can cost a certificate load only the delegation verdicts need.
 */
export function translateDelegatedTokenError(
    err: unknown,
    entity: EntityAuthBlock,
    delegateCuit: () => string,
): unknown {
    if (!(err instanceof ArcaServiceError)) {
        return err;
    }
    // `601` is unambiguous — always a missing delegation, no message needed.
    const representado = err.errors.find((e) => e.code === REPRESENTADO_NOT_IN_TOKEN_CODE);
    if (representado !== undefined) {
        return delegationNotAuthorized(entity, delegateCuit(), representado.code, representado.message);
    }
    const entry = err.errors.find((e) => e.code === TOKEN_VALIDATION_CODE);
    if (entry === undefined) {
        return err;
    }
    const message = entry.message;
    // Authorization first: a lapsed delegation is worded as an expiry too, and treating it as a token fault
    // would evict the shared delegate ticket on every retry without fixing the cause.
    if (AUTHORIZATION_FAULT.test(message)) {
        return delegationNotAuthorized(entity, delegateCuit(), TOKEN_VALIDATION_CODE, message);
    }
    if (TOKEN_FAULT_MESSAGE.test(message)) {
        return new ArcaAuthError(`WSFEv1 token validation failed (ARCA ${TOKEN_VALIDATION_CODE}): ${message}`);
    }
    return err; // ambiguous 600 → leave as the original authority error (502)
}

/** Carries our delegate CUIT and the represented issuer into the error. */
function delegationNotAuthorized(
    entity: EntityAuthBlock,
    delegateCuit: string,
    code: string,
    message: string,
): DelegationNotAuthorizedError {
    const issuer = canonicalCuit(entity.issuerTaxId) ?? entity.issuerTaxId;
    return new DelegationNotAuthorizedError(delegateCuit, issuer, code, message);
}

/**
 * True when a padrón failure names our delegate ticket. The padrón services report every failure as a SOAP
 * fault rather than WSFEv1's in-payload `Errors` list, so this reads the message against
 * `CRYPTO_CREDENTIAL_FAULT` — which excludes ARCA's authorization wording, so a missing enrolment cannot
 * evict a valid ticket.
 *
 * Never call this from a call path: it is calibrated for the padrón services' wording and is wrong on any
 * other. `isDelegateTicketFault` is the entry point.
 */
export function isPadronTicketFault(err: unknown): err is ArcaSoapError {
    return err instanceof ArcaSoapError && CRYPTO_CREDENTIAL_FAULT.test(err.message);
}

/**
 * True when a WSFEv1 `Errors` block names our ticket — the `wsfe` reading, where a credential failure
 * arrives in the payload rather than as a SOAP fault.
 *
 * Applies the same precedence `translateDelegatedTokenError` does: a `600` whose message names who is
 * refused is an authorization problem re-minting cannot fix, so it evicts nothing, and only the
 * cryptographic or expiry phrasing is a credential fault. An ambiguous `600` evicts nothing either — ARCA's
 * ~12h re-mint refusal makes a false positive far more expensive than a missed one.
 *
 * Reads `TOKEN_FAULT_MESSAGE` rather than `CRYPTO_CREDENTIAL_FAULT` because ARCA has already prefixed this
 * message with `ValidacionDeToken:`, so the bare word `token` carries no information and the broader
 * vocabulary would match every overloaded `600`.
 *
 * The delegated-issuing path asks a different question of the same `600` — is this a missing delegation? —
 * which is why that classifier stays separate. Both read the two message rules in the same order, and
 * neither may be reordered alone.
 */
export function isWsfeTicketFault(err: unknown): boolean {
    if (!(err instanceof ArcaServiceError)) {
        return false;
    }
    const entry = err.errors.find((e) => e.code === TOKEN_VALIDATION_CODE);
    if (entry === undefined || AUTHORIZATION_FAULT.test(entry.message)) {
        return false;
    }
    return TOKEN_FAULT_MESSAGE.test(entry.message);
}

/**
 * The invoice web services, whose failures arrive as an in-payload `Errors` block. Everything else this
 * provider calls under the delegate ticket is a padrón service, which reports a SOAP fault instead.
 */
const IN_PAYLOAD_ERROR_SERVICES: ReadonlySet<ServiceIdValue> = new Set<ServiceIdValue>([
    ServiceId.WSFEV1,
    ServiceId.WSFEXV1,
]);

/**
 * True when `service` is reporting that our delegate ticket is bad — the single signal `delegateCall` evicts
 * on, whichever web service made the call.
 *
 * Dispatched on the service rather than the error class, which is why this exists instead of OR-ing the two
 * classifiers at the call site. Scoping `isPadronTicketFault` to `ArcaSoapError` looks like it confines it to
 * the padrón and does not: WSFEv1 raises that too for genuine SOAP faults, so a `wsfe` transport fault whose
 * Spanish text merely contains `token` or `firma` would match the padrón vocabulary and evict the shared
 * `wsfe` delegate ticket ARCA refuses to re-mint for ~12h.
 *
 * The `wsfe` reading of a SOAP-level fault is therefore "not a ticket fault", which is correct: on that
 * service a credential rejection is an in-payload `600`, so a SOAP fault is a retryable transport failure.
 */
export function isDelegateTicketFault(err: unknown, service: ServiceIdValue): boolean {
    return IN_PAYLOAD_ERROR_SERVICES.has(service) ? isWsfeTicketFault(err) : isPadronTicketFault(err);
}

/**
 * WSAA refuses a login for a service the signing certificate is not enrolled in with `coe.notAuthorized`.
 * On the padrón path that is permanent: our delegate certificate has not been adhered to that web service
 * (AR: WSASS in homologación, Administrador de Relaciones in production). Reported as
 * `DELEGATION_NOT_CONFIGURED` rather than the transport error it arrives as, since a `502` reads as "retry
 * me" and no amount of retrying enrols a certificate.
 *
 * Scoped to this path: on an issuing call the same fault can mean a tenant's own certificate is not
 * enrolled, which is not our misconfiguration.
 */
export function notEnrolledError(
    err: unknown,
    environment: GenericEnvironment,
    service: ServiceIdValue,
): unknown {
    if (err instanceof ArcaError && /computador no autorizado|coe\.notAuthorized/i.test(err.message)) {
        return new DelegationNotConfiguredError(
            environment,
            `the delegate certificate is not enrolled in the "${service}" web service at the authority`,
        );
    }
    return err;
}

/** ARCA business-rejection codes that are stable and caller-actionable. */
const KNOWN_SERVICE_ERROR_CODES: Record<string, string> = {
    /** "Campo DocNro no puede ser igual al del emisor." — never transient, always caller-fixable. */
    '10069': 'RECEIVER_MATCHES_ISSUER',
};

/**
 * Translates any ARCA-native failure into a neutral fault — the provider's outbound boundary, applied by
 * `TaxEntityProvider`'s guard so no SDK error class can reach the HTTP layer.
 *
 * Anything already neutral passes through untouched: the provider raises its own not-found, delegation and
 * credential errors deliberately, and re-wrapping one would flatten a `403`, `404` or `409` into a `500`.
 *
 * `ArcaError` is tested last because every class above extends it.
 */
export function toProviderFault(err: unknown): unknown {
    if (err instanceof ArcaValidationError) {
        // Top-level `code` stays the stable category; the specific reason rides in `details.code` so callers
        // can branch on it without parsing the message.
        const details = err.code === undefined ? undefined : {code: err.code};
        return new ProviderFault('VALIDATION', 'ARCA_VALIDATION', err.message, details);
    }
    if (err instanceof NotImplementedError) {
        return new ProviderFault('NOT_IMPLEMENTED', 'NOT_IMPLEMENTED', err.message);
    }
    if (err instanceof ArcaAuthError) {
        return new ProviderFault('AUTHORITY_AUTH', 'ARCA_AUTH', err.message);
    }
    if (err instanceof ArcaServiceError) {
        // A known rejection gets its own stable category and `400`, so a caller can branch without parsing
        // ARCA's Spanish message. `arcaErrors` rides along so an unmapped sibling code is not dropped.
        // `Object.hasOwn` rather than `in`: codes come straight off ARCA's XML, and `in` would also match
        // inherited keys like `constructor`, yielding a bogus category.
        const known = err.errors.find((e) => Object.hasOwn(KNOWN_SERVICE_ERROR_CODES, e.code));
        if (known !== undefined) {
            return new ProviderFault('AUTHORITY_REJECTED', KNOWN_SERVICE_ERROR_CODES[known.code], known.message, {
                arcaCode: known.code,
                arcaErrors: err.errors,
            });
        }
        // Unclassified rejection: keep the `502`, but expose the full code list so a caller can branch and a
        // recurring code can later be promoted into `KNOWN_SERVICE_ERROR_CODES`.
        return new ProviderFault('AUTHORITY_SERVICE', 'ARCA_SERVICE', err.message, {arcaErrors: err.errors});
    }
    if (err instanceof ArcaSoapError) {
        return new ProviderFault('AUTHORITY_TRANSPORT', 'ARCA_SOAP', err.message);
    }
    if (err instanceof ArcaError) {
        return new ProviderFault('PROVIDER_INTERNAL', 'ARCA_ERROR', err.message);
    }
    return err;
}
