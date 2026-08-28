import {
    ArcaAuthError,
    ArcaError,
    ArcaServiceError,
    ArcaSoapError,
    ArcaValidationError,
    NotImplementedError,
} from '../sdk/index.js';
import type {ServiceIdValue} from '../sdk/index.js';
import {canonicalCuit} from '../mapping/identifiers.js';
import {
    DelegationNotAuthorizedError,
    DelegationNotConfiguredError,
    ProviderFault,
    type EntityAuthBlock,
    type GenericEnvironment,
} from '../../provider/provider.js';

/**
 * How ARCA says a call failed, and which of those sayings mean what.
 *
 * Everything here is **pure classification**: given a thrown value, decide what it is and (where the answer
 * is a different error) build the replacement. Nothing in this module touches the ticket cache, retries, or
 * makes a call. That division is deliberate — the eviction policy that reacts to a token fault is the
 * provider's (`delegationAware`, `padronCall`), and keeping the *decision* separate from the *reaction* is
 * what lets both wrappers share one classifier without sharing a retry policy.
 */

/**
 * WSFEv1 `ValidacionDeToken` — one overloaded code covering BOTH genuine token faults (bad signature/hash,
 * expired/skewed clock) AND authorization/relationship problems; only the message text disambiguates.
 * Returned inside the response `Errors` block, so it surfaces as an {@link ArcaServiceError}.
 */
const TOKEN_VALIDATION_CODE = '600';

/**
 * WSFEv1 `CUIT representada no incluida en token` — the representación-SPECIFIC rejection: the delegate's
 * token does not cover the CUIT in `Auth.Cuit`. Unlike the overloaded `600`, this code is unambiguous (never
 * a cryptographic token fault), so a delegated call that hits it is always a missing/insufficient delegation.
 * WSAA's own `coe.notAuthorized` "computador no autorizado a acceder al servicio" is a DIFFERENT failure
 * (our cert isn't enrolled to the service) that surfaces at login, before this classifier ever runs.
 */
const REPRESENTADO_NOT_IN_TOKEN_CODE = '601';

/**
 * A genuine token/authentication fault (bad signature/hash, expired/clock-skewed ticket) — for a delegated
 * request this is OUR certificate/clock, not the represented taxpayer's missing delegation, so it stays a
 * token error in both modes and is NEVER reported as a delegation problem. Matched on the specific crypto
 * phrasing ARCA uses (`firma digital`, `VerificacionDeHash`, `no validó`, expiry) rather than the bare word
 * `firma`, because authorization rejections also mention it (e.g. `No se corresponden token y firma. Usuario
 * no autorizado…`) and must NOT be misrouted here.
 *
 * Tested only AFTER {@link AUTHORIZATION_MESSAGE}: the expiry alternatives are deliberately broad, and a
 * *delegation* can expire too (`la relación de representación se encuentra vencida; usuario no autorizado`).
 * Matching that first would both hide the actionable `403` behind a retryable `502` and — via the delegate
 * ticket eviction the provider's `delegationAware` performs on an {@link ArcaAuthError} — purge the delegate
 * ticket every representado shares, for a condition re-minting cannot fix.
 */
const TOKEN_FAULT_MESSAGE = /firma digital|no valid[óo]|hash|expir|caduc|vencid/i;

/**
 * An authorization/relationship problem inside an overloaded `600`: the token/relationship does not authorize
 * this operation (e.g. `Usuario no autorizado a realizar esta operación`, `CUIT representada no incluida`).
 * On a delegated request that means the represented taxpayer has not delegated the web service to our CUIT —
 * the actionable {@link DelegationNotAuthorizedError}.
 *
 * Tested BEFORE {@link TOKEN_FAULT_MESSAGE}: these phrases name *who* is refused, which no cryptographic
 * fault message mentions, so they are the more specific signal even when the text also says the permission
 * expired.
 */
const AUTHORIZATION_MESSAGE = /no autoriz|computador|relaci[oó]n|represent/i;

/**
 * ARCA `FEParamGetPtosVenta` returns this code with message "Sin Resultados" when the issuer has no
 * registered points of sale — its way of expressing an empty list. `pointsOfSale` normalizes it to `[]`.
 */
const NO_RESULTS_CODE = '602';

/**
 * ARCA `FECompConsultar` reports a voucher that was never authorized with this code (message "No existe el
 * comprobante que se solicita…") as a thrown `Errors` block, not an empty `200`. `queryVoucher` translates
 * exactly this to a neutral `VoucherNotFoundError` (→ `404`) so a genuine not-found is distinguishable
 * from an authority/token/transport failure (which stays a `502`) — the distinction core's orphan
 * reconciliation relies on to decide a stuck-PENDING sale is safe to clear and re-authorize. (Same literal as
 * {@link NO_RESULTS_CODE}, but a different operation and meaning; named separately to keep the intent local.)
 */
const VOUCHER_NOT_FOUND_CODE = '602';

/** True when `err` is ARCA reporting "this issuer has no registered points of sale" — the documented empty case. */
export function isNoResults(err: unknown): boolean {
    return err instanceof ArcaServiceError && err.errors.some((e) => e.code === NO_RESULTS_CODE);
}

/** True when `err` is ARCA reporting a voucher that was never authorized — a stable `404`, never a `502`. */
export function isVoucherNotFound(err: unknown): boolean {
    return err instanceof ArcaServiceError && err.errors.some((e) => e.code === VOUCHER_NOT_FOUND_CODE);
}

/**
 * Maps an ARCA token/representación error on a delegated call to a delegation/token error; passes others
 * through unchanged.
 *
 * `delegateCuit` is supplied as a **thunk**, not a string, for two reasons: resolving it runs inside an error
 * handler, so the caller owns the degradation (a delegate store that throws must not replace the actionable
 * `403` with a config error); and reading it can cost a certificate load, which only the delegation verdicts
 * below actually need. An error that passes through must not pay for it.
 */
export function translateDelegatedTokenError(
    err: unknown,
    entity: EntityAuthBlock,
    delegateCuit: () => string,
): unknown {
    if (!(err instanceof ArcaServiceError)) {
        return err;
    }
    // `601` is representación-specific and unambiguous — always a missing delegation, no message needed.
    const representado = err.errors.find((e) => e.code === REPRESENTADO_NOT_IN_TOKEN_CODE);
    if (representado !== undefined) {
        return delegationNotAuthorized(entity, delegateCuit(), representado.code, representado.message);
    }
    const entry = err.errors.find((e) => e.code === TOKEN_VALIDATION_CODE);
    if (entry === undefined) {
        return err;
    }
    const message = entry.message;
    // Authorization first: a lapsed *delegation* is worded as an expiry too, and treating it as a token
    // fault would evict the shared delegate ticket on every retry without ever fixing the cause.
    if (AUTHORIZATION_MESSAGE.test(message)) {
        return delegationNotAuthorized(entity, delegateCuit(), TOKEN_VALIDATION_CODE, message);
    }
    if (TOKEN_FAULT_MESSAGE.test(message)) {
        return new ArcaAuthError(`WSFEv1 token validation failed (ARCA ${TOKEN_VALIDATION_CODE}): ${message}`);
    }
    return err; // ambiguous 600 → leave as the original authority error (502)
}

/** Builds a {@link DelegationNotAuthorizedError} carrying our delegate CUIT + the represented issuer. */
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
 * A fault naming the CREDENTIAL itself — the ticket, its signature, or the certificate behind it. Kept
 * deliberately narrow: only words that name the credential, never ARCA's authorization vocabulary. A missing
 * enrolment (`computador no autorizado`) or a lapsed relationship (`la relación … se encuentra vencida`) must
 * NOT match, because the cached ticket is valid in both cases and evicting it would purge a good ticket ARCA
 * will not re-issue for ~12h. `token` is what separates the two where ARCA mixes them, as in its
 * `No autorizado, par token/sign invalido`.
 */
const PADRON_TICKET_FAULT = /token|ticket|firma|\bsign\b|certificad|hash/i;

/**
 * True when a padrón failure names our delegate ticket — the signal the provider's `padronCall` evicts on.
 * The padrón services report every failure as an `ArcaSoapError` fault (never WSFEv1's in-payload `Errors`
 * list), so this reads the message rather than an error code.
 */
export function isPadronTicketFault(err: unknown): err is ArcaError {
    return err instanceof ArcaError && PADRON_TICKET_FAULT.test(err.message);
}

/**
 * WSAA refuses a login for a service the signing certificate is not enrolled in with `coe.notAuthorized`
 * / "Computador no autorizado a acceder al servicio". On the padrón path that is unambiguous and
 * permanent: OUR delegate certificate has not been adhered to that web service at the authority (AR:
 * WSASS in homologación, Administrador de Relaciones in production). Reported as
 * `DELEGATION_NOT_CONFIGURED` (500) rather than the transport error it arrives as, because a `502` reads
 * as "retry me" and no amount of retrying enrols a certificate.
 *
 * Deliberately scoped to this path: on an issuing call the same fault can mean a tenant's own certificate
 * is not enrolled, which is not our misconfiguration, so that path keeps reporting it verbatim.
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

/**
 * ARCA business-rejection codes (`Errors.Err[].Code`) that are stable and caller-actionable —
 * given the same input, ARCA rejects the same way every time, so these get their own wire category
 * and a `400` (never the generic `502 ARCA_SERVICE`, which reads as "retry me"). Add an entry
 * here once a code is confirmed to recur and worth a dedicated, translated message downstream.
 *
 * - `10069` — "Campo DocNro no puede ser igual al del emisor.": the receiver's identification
 *   number is the same as the issuing company's own — never transient, always caller-fixable.
 */
const KNOWN_SERVICE_ERROR_CODES: Record<string, string> = {
    '10069': 'RECEIVER_MATCHES_ISSUER',
};

/**
 * Translates any ARCA-native failure into a neutral {@link ProviderFault} — the provider's outbound
 * boundary, applied by `TaxEntityProvider`'s guard so no SDK error class can reach the HTTP layer.
 *
 * The `code` strings are the ones CONTRACT §8 documents and core branches on (`ARCA_VALIDATION`,
 * `ARCA_SERVICE`, `ARCA_AUTH`, `ARCA_SOAP`, `ARCA_ERROR`, `RECEIVER_MATCHES_ISSUER`), and the `details`
 * shapes (`{code}`, `{arcaCode, arcaErrors}`) likewise — so this is a pure relocation of the mapping that
 * used to live in `http/error-mapper/error-mapper.ts`, not a new wire format.
 *
 * Anything already neutral passes through untouched: the provider raises `VoucherNotFoundError`,
 * `TaxpayerNotFoundError`, `DelegationNotAuthorizedError`, `DelegationNotConfiguredError` and
 * `CredentialsRequiredError` deliberately, and re-wrapping one as a generic fault would flatten a `403`,
 * `404` or `409` into a `500`.
 *
 * `ArcaError` is tested LAST because every class above extends it — the subclass checks are the
 * classification, and the base is only the fallback for an SDK error that is none of them.
 */
export function toProviderFault(err: unknown): unknown {
    if (err instanceof ArcaValidationError) {
        // Top-level `code` stays the stable category (§8); the specific reason (e.g.
        // `VOUCHER_ALREADY_AUTHORIZED_MISMATCH`, `UNMAPPED_CURRENCY`) rides in `details.code` so callers can
        // branch on it without parsing the message. Absent when the validation error carried no code.
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
        // A known, recurring rejection gets its own stable category + `400` so the caller can branch on
        // `code` without parsing the (Spanish, ARCA-authored) message. `arcaErrors` still rides along so
        // an unmapped sibling code in the same response isn't silently dropped.
        // `Object.hasOwn`, not `in`: codes come straight off ARCA's XML with no validation, and `in` would
        // also match inherited keys (`constructor`, `toString`), yielding a bogus category downstream.
        const known = err.errors.find((e) => Object.hasOwn(KNOWN_SERVICE_ERROR_CODES, e.code));
        if (known !== undefined) {
            return new ProviderFault('AUTHORITY_REJECTED', KNOWN_SERVICE_ERROR_CODES[known.code], known.message, {
                arcaCode: known.code,
                arcaErrors: err.errors,
            });
        }
        // Unclassified business rejection: keep the transport-agnostic 502, but expose the full
        // `{code, message}` list so a caller can branch on it, and so a future recurring code can be
        // promoted into `KNOWN_SERVICE_ERROR_CODES` above.
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
