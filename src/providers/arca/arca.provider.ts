import {
    ArcaAuthError,
    ArcaServiceError,
    ArcaValidationError,
    ServiceId,
    type ArcaAuth,
    type CommonInvoiceRequest,
    type CommonInvoiceResult,
    type RegistryLevel,
    type ServiceIdValue,
} from './sdk/index.js';
import {commonInvoiceService, padronService, padronServiceId} from './clients.js';
import {ticketStore} from './ticket-store.js';
import {delegateCredentialStore, type DelegateCredentialStore} from './delegate-credentials.js';
import {toArcaEnvironment} from './environment.js';
import {toCbteTipo} from './code-maps.js';
import {
    buildCommonInvoiceRequest,
    buildQrUrl,
    concept1DateWindowError,
    toNeutralResult,
    toNeutralPointOfSale,
} from './ar-invoice.mapper.js';
import {validateArcaCredentials} from './credentials.js';
import {canonicalCuit, parseArcaId} from './ar-identifiers.js';
import {
    DelegationNotAuthorizedError,
    TaxEntityProvider,
    type AuthorityStatusResult,
    type CredentialValidationResult,
    type EntityAuthBlock,
    type GenericEnvironment,
    type NeutralInvoice,
    type NextNumbersResult,
    type PointsOfSaleResult,
    type TaxAuthorizationResult,
    type TaxpayerResult,
    type ValidateCredentialsInput,
    VoucherNotFoundError,
} from '../provider.js';

/**
 * ARCA observation code returned by `FECAESolicitar` when `CbteDesde` is not the next number to
 * authorize — which includes the case where core re-sends a number ARCA has already authorized (e.g. after
 * a persistence failure on core's side). The code is ambiguous (it also fires for a number too far ahead of
 * the sequence), so it only flags a *candidate* for recovery; `queryVoucher` is the arbiter.
 */
const ALREADY_AUTHORIZED_CODE = '10016';

/**
 * ARCA `FEParamGetPtosVenta` returns this code with message "Sin Resultados" when the issuer has no
 * registered points of sale — its way of expressing an empty list. `pointsOfSale` normalizes it to `[]`.
 */
const NO_RESULTS_CODE = '602';

/**
 * ARCA `FECompConsultar` reports a voucher that was never authorized with this code (message "No existe el
 * comprobante que se solicita…") as a thrown `Errors` block, not an empty `200`. `queryVoucher` translates
 * exactly this to a neutral {@link VoucherNotFoundError} (→ `404`) so a genuine not-found is distinguishable
 * from an authority/token/transport failure (which stays a `502`) — the distinction core's orphan
 * reconciliation relies on to decide a stuck-PENDING sale is safe to clear and re-authorize. (Same literal as
 * {@link NO_RESULTS_CODE}, but a different operation and meaning; named separately to keep the intent local.)
 */
const VOUCHER_NOT_FOUND_CODE = '602';

/** True when an authorize result is a `10016` rejection — the signal to reconcile against ARCA. */
function isAlreadyAuthorizedRejection(result: CommonInvoiceResult): boolean {
    return result.result === 'R' && result.observations.some((o) => o.code === ALREADY_AUTHORIZED_CODE);
}

/**
 * True when a thrown service error carries the `10016` code — AFIP surfacing an already-authorized number as
 * an `Errors` block instead of a soft rejection. This is the thrown-path analogue of
 * {@link isAlreadyAuthorizedRejection}: recovery is attempted only for this specific conflict, never for an
 * unrelated business rejection (which must be re-thrown verbatim, not reconciled against a coincidentally
 * authorized voucher).
 */
function isAlreadyAuthorizedError(err: ArcaServiceError): boolean {
    return err.errors.some((e) => e.code === ALREADY_AUTHORIZED_CODE);
}

/**
 * Guards against core reusing a voucher number for a *different* sale: several identifying fields stored
 * against the already-authorized voucher must match what we just tried to authorize, or returning its CAE
 * would hand back a fiscal document for the wrong invoice. `ImpTotal` is the strongest single amount
 * signal and avoids false positives from rounding differences; `DocTipo`/`DocNro`/`Concepto`/`MonId`/
 * `CbteFch`/`CondicionIVAReceptorId` are discrete values with no rounding ambiguity, so an exact mismatch on
 * any of them is unambiguous. `CbteFch` compares the date core actually sent: the mapper no longer rewrites
 * an out-of-window concept-1 date to `now`, so a resend of the same invoice carries the same `CbteFch` —
 * which does mean core must resend the ORIGINAL `issueDate`, not a freshly stamped one (documented in
 * `docs/CONTRACT.md` §3). Deliberately excludes the net/VAT/exempt breakdown (redundant with `ImpTotal`,
 * same rounding-drift risk) and the associated-vouchers/tributes/optionals arrays (too fragile to compare
 * against ARCA's own wire representation). A missing stored value, or one that doesn't parse as expected, is
 * never treated as a mismatch — this guard only rejects a *confirmed* difference.
 */
function assertRecoveredVoucherMatches(request: CommonInvoiceRequest, queried: CommonInvoiceResult): void {
    const raw = queried.raw as {
        ImpTotal?: unknown;
        DocTipo?: unknown;
        DocNro?: unknown;
        Concepto?: unknown;
        MonId?: unknown;
        CbteFch?: unknown;
        CondicionIVAReceptorId?: unknown;
    };

    const mismatch = (label: string, sent: string | number, stored: string | number): never => {
        throw new ArcaValidationError(
            `Voucher ${request.voucherNumberFrom} is already authorized for a different ${label} ` +
                `(sent ${sent}, stored ${stored}); refusing to return its CAE.`,
            'VOUCHER_ALREADY_AUTHORIZED_MISMATCH',
        );
    };

    /**
     * The stored value, or `undefined` when the authority returned nothing usable. The SOAP parser runs with
     * `parseTagValue: false`, so every field arrives as a string and an EMPTY element (`<CbteFch/>`, common
     * for fields a voucher predates) reads as `''` — which `Number('')` would silently turn into a perfectly
     * finite `0` and report as a confirmed mismatch. Blank is "not returned", never a difference.
     */
    const present = (value: unknown): string | undefined => {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? String(value) : undefined;
        }
        if (typeof value !== 'string' || value.trim() === '') {
            return undefined;
        }
        return value.trim();
    };
    const storedNumber = (value: unknown): number | undefined => {
        const text = present(value);
        if (text === undefined) {
            return undefined;
        }
        const parsed = Number(text);
        return Number.isFinite(parsed) ? parsed : undefined;
    };

    const storedTotal = storedNumber(raw.ImpTotal);
    if (storedTotal !== undefined && Math.abs(storedTotal - request.totalAmount) > 0.01) {
        mismatch('amount', request.totalAmount, storedTotal);
    }

    const storedDocType = storedNumber(raw.DocTipo);
    if (storedDocType !== undefined && storedDocType !== request.docType) {
        mismatch('receiver doc type', request.docType, storedDocType);
    }

    const storedDocNumber = storedNumber(raw.DocNro);
    if (storedDocNumber !== undefined && storedDocNumber !== request.docNumber) {
        mismatch('receiver doc number', request.docNumber, storedDocNumber);
    }

    const storedConcept = storedNumber(raw.Concepto);
    if (storedConcept !== undefined && storedConcept !== request.concept) {
        mismatch('concept', request.concept, storedConcept);
    }

    const storedCurrency = present(raw.MonId);
    if (storedCurrency !== undefined && storedCurrency !== request.currencyId) {
        mismatch('currency', request.currencyId, storedCurrency);
    }

    const storedVoucherDate = present(raw.CbteFch);
    if (storedVoucherDate !== undefined && storedVoucherDate !== request.voucherDate) {
        mismatch('voucher date', request.voucherDate, storedVoucherDate);
    }

    const storedIvaCondition = storedNumber(raw.CondicionIVAReceptorId);
    if (
        request.receiverIvaConditionId !== undefined &&
        storedIvaCondition !== undefined &&
        storedIvaCondition !== request.receiverIvaConditionId
    ) {
        mismatch('receiver IVA condition', request.receiverIvaConditionId, storedIvaCondition);
    }
}

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
 * Matching that first would both hide the actionable `403` behind a retryable `502` and — via
 * {@link ArcaProvider.delegationAware}'s eviction — purge the delegate ticket every representado shares, for
 * a condition re-minting cannot fix.
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
 * The ARCA (Argentina/AFIP) tax entity provider — the sole owner of every AR-specific detail: WSAA ticket
 * minting (via the ticket store), canonical-code→ARCA-code translation (via code-maps + the invoice
 * mapper), the RG-4892 QR, and `production`/`testing` → `produccion`/`homologacion` naming.
 */
export class ArcaProvider extends TaxEntityProvider {
    /**
     * The delegate certificate store is injected so the `403` can name our real delegate CUIT — the one
     * field the caller acts on — instead of reading a module singleton that a test (or a future second
     * provider instance) may not share.
     */
    constructor(private readonly delegate: DelegateCredentialStore = delegateCredentialStore) {
        super();
    }

    /**
     * Runs a delegated SDK call and, on failure, classifies a WSFEv1 token/representación rejection (see the
     * 2×2 in `docs/CONTRACT.md` §10): a `601 CUIT representada no incluida` — or an authorization-flavored
     * overloaded `600` — → {@link DelegationNotAuthorizedError} (403, the represented CUIT hasn't delegated to
     * us); a genuine signature/hash/clock `600` → {@link ArcaAuthError} (502 token error, our cert/clock —
     * never a delegation error); anything else (ambiguous `600`, other codes, non-delegated calls) passes
     * through untouched. Applied at the SDK-call boundary so the existing `10016`/`602` recovery — which keys
     * on other codes — is unaffected.
     *
     * `service` is the WSAA service the call consumed; a token fault evicts only that service's delegate
     * ticket, never the delegate identity's tickets for other services (which ARCA would then refuse to
     * re-mint until they expire).
     */
    private async delegationAware<T>(
        entity: EntityAuthBlock,
        service: ServiceIdValue,
        op: () => Promise<T>,
    ): Promise<T> {
        if (entity.delegated !== true) {
            return op();
        }
        try {
            return await op();
        } catch (err) {
            const translated = this.translateDelegatedTokenError(err, entity);
            if (translated instanceof ArcaAuthError) {
                // A genuine token fault on OUR delegate ticket — evict it so the next delegated request
                // re-mints, rather than every represented CUIT sharing the one bad ticket until local expiry.
                // (A delegation/authorization rejection leaves the ticket cached: it is valid, the delegation
                // is what's missing, so re-minting the same ticket would change nothing.)
                ticketStore.invalidateDelegated(entity.entityCode, entity.environment, service);
            }
            throw translated;
        }
    }

    /** Maps an ARCA token/representación error on a delegated call to a delegation/token error; passes others through. */
    private translateDelegatedTokenError(err: unknown, entity: EntityAuthBlock): unknown {
        if (!(err instanceof ArcaServiceError)) {
            return err;
        }
        // `601` is representación-specific and unambiguous — always a missing delegation, no message needed.
        const representado = err.errors.find((e) => e.code === REPRESENTADO_NOT_IN_TOKEN_CODE);
        if (representado !== undefined) {
            return this.delegationNotAuthorized(entity, representado.code, representado.message);
        }
        const entry = err.errors.find((e) => e.code === TOKEN_VALIDATION_CODE);
        if (entry === undefined) {
            return err;
        }
        const message = entry.message;
        // Authorization first: a lapsed *delegation* is worded as an expiry too, and treating it as a token
        // fault would evict the shared delegate ticket on every retry without ever fixing the cause.
        if (AUTHORIZATION_MESSAGE.test(message)) {
            return this.delegationNotAuthorized(entity, TOKEN_VALIDATION_CODE, message);
        }
        if (TOKEN_FAULT_MESSAGE.test(message)) {
            return new ArcaAuthError(`WSFEv1 token validation failed (ARCA ${TOKEN_VALIDATION_CODE}): ${message}`);
        }
        return err; // ambiguous 600 → leave as the original authority error (502)
    }

    /** Builds a {@link DelegationNotAuthorizedError} carrying our delegate CUIT + the represented issuer. */
    private delegationNotAuthorized(entity: EntityAuthBlock, code: string, message: string): DelegationNotAuthorizedError {
        const issuer = canonicalCuit(entity.issuerTaxId) ?? entity.issuerTaxId;
        return new DelegationNotAuthorizedError(this.delegateCuit(entity.environment), issuer, code, message);
    }

    /**
     * Our delegate CUIT for `environment` — the CUIT the user must grant the web service to. Reading it runs
     * inside an error handler, so a delegate store that throws (a certificate that became unreadable after
     * boot) degrades to a placeholder rather than replacing the actionable `403` with a config error. A
     * delegated call cannot reach here unconfigured: `resolve` would have failed with
     * `DELEGATION_NOT_CONFIGURED` before the SDK call.
     */
    private delegateCuit(environment: GenericEnvironment): string {
        try {
            return this.delegate.get(environment)?.delegateCuit ?? '(delegate)';
        } catch {
            return '(delegate)';
        }
    }

    validateCredentials(input: ValidateCredentialsInput): Promise<CredentialValidationResult> {
        return Promise.resolve(validateArcaCredentials(input));
    }

    async authorizeInvoice(entity: EntityAuthBlock, invoice: NeutralInvoice): Promise<TaxAuthorizationResult> {
        // Single-voucher flow only (contract §3): the mapper authorizes exactly `voucherNumberFrom` and
        // sets CbteHasta to it, so a differing `voucherNumberTo` would be silently truncated. Reject it up
        // front — before minting a WSAA ticket — rather than authorize a number the caller did not ask for.
        if (invoice.voucherNumberFrom !== invoice.voucherNumberTo) {
            throw new ArcaValidationError(
                `Single-voucher flow requires voucherNumberFrom === voucherNumberTo ` +
                    `(got ${invoice.voucherNumberFrom}..${invoice.voucherNumberTo})`,
                'VOUCHER_RANGE_UNSUPPORTED',
            );
        }

        const auth = await ticketStore.resolve(
            entity.entityCode,
            entity.issuerTaxId,
            ServiceId.WSFEV1,
            entity.environment,
            entity.credentials,
            entity.delegated,
        );
        const service = commonInvoiceService(toArcaEnvironment(entity.environment));

        // Core is the source of truth for the voucher number (contract 2026-08-10): authorize exactly the
        // number it sent. The service never computes the next correlative for authorize anymore.
        const request = buildCommonInvoiceRequest(invoice, invoice.voucherNumberFrom);

        // Concept-1 `CbteFch` window (contract 2026-08-20). ARCA would refuse an out-of-window date anyway,
        // so we refuse it ourselves with an actionable code — but only AFTER giving idempotent recovery its
        // chance: a resend of a voucher ARCA already authorized (core's CAE lost to a persistence failure,
        // replayed days later) must still get that CAE back, not a date rejection for a sale that is
        // already filed. Recovery reconciles against the stored voucher, which the date never affects.
        const dateWindowError = concept1DateWindowError(invoice, new Date());
        if (dateWindowError !== undefined) {
            const recovered = await this.recoverAuthorizedVoucher(entity, service, auth, invoice, request);
            if (recovered !== undefined) {
                return recovered;
            }
            throw dateWindowError;
        }

        let result: CommonInvoiceResult;
        try {
            result = await this.delegationAware(entity, ServiceId.WSFEV1, () =>
                service.requestAuthorization(auth, request),
            );
        } catch (err) {
            // AFIP may surface an already-authorized number as a thrown `10016` `Errors` block rather than a
            // soft rejection. Reconcile ONLY that conflict (mirroring the soft-rejection path); any other
            // business rejection is the truthful outcome and must be re-thrown, never reconciled against a
            // coincidentally authorized voucher. If the number isn't actually authorized, re-throw as well.
            if (err instanceof ArcaServiceError && isAlreadyAuthorizedError(err)) {
                const recovered = await this.recoverAuthorizedVoucher(entity, service, auth, invoice, request);
                if (recovered !== undefined) {
                    return recovered;
                }
            }
            throw err;
        }

        // A `10016` rejection means the number is not the next to authorize — including the case where core
        // is re-sending a number ARCA already authorized. Reconcile: if the voucher is genuinely authorized,
        // return its stored CAE (idempotent recovery) instead of the rejection.
        if (isAlreadyAuthorizedRejection(result)) {
            const recovered = await this.recoverAuthorizedVoucher(entity, service, auth, invoice, request);
            if (recovered !== undefined) {
                return recovered;
            }
        }

        // Build the QR only for an approved voucher; the guard narrows `result.cae` to a string.
        const qr =
            result.result === 'A' && result.cae !== undefined && result.caeExpiration !== undefined
                ? buildQrUrl(entity.issuerTaxId, request, result.cae)
                : undefined;
        return toNeutralResult(result, qr);
    }

    /**
     * Recovers an already-authorized voucher's CAE via `FECompConsultar` (`queryVoucher`) — the only ARCA
     * call that returns a stored CAE; `requestAuthorization` never echoes a prior one. Returns the neutral
     * result (QR rebuilt from `request`, which the standalone `/query` endpoint cannot do without the invoice
     * body) when `invoice.voucherNumberFrom` is genuinely authorized, or `undefined` when it is not — leaving
     * the caller to surface the original authorize outcome. A not-found query (ARCA ~602, thrown as
     * `ArcaServiceError`) counts as "not recoverable", not an error.
     *
     * The query is delegation-aware like every other SDK call: on a delegated request a token/representación
     * rejection here is the true cause of the failure, so it propagates (403/502) instead of being flattened
     * into "not recoverable" and reported as the original `10016`.
     */
    private async recoverAuthorizedVoucher(
        entity: EntityAuthBlock,
        service: ReturnType<typeof commonInvoiceService>,
        auth: ArcaAuth,
        invoice: NeutralInvoice,
        request: CommonInvoiceRequest,
    ): Promise<TaxAuthorizationResult | undefined> {
        let queried: CommonInvoiceResult;
        try {
            queried = await this.delegationAware(entity, ServiceId.WSFEV1, () =>
                service.queryVoucher(
                    auth,
                    invoice.pointOfSaleNumber,
                    toCbteTipo(invoice.documentTypeCode),
                    invoice.voucherNumberFrom,
                ),
            );
        } catch (err) {
            if (err instanceof ArcaServiceError) {
                return undefined; // voucher not found → nothing to recover
            }
            throw err;
        }

        if (
            queried.result !== 'A' ||
            queried.cae === undefined ||
            queried.voucherNumberFrom !== invoice.voucherNumberFrom
        ) {
            return undefined;
        }

        assertRecoveredVoucherMatches(request, queried);
        const qr = buildQrUrl(entity.issuerTaxId, request, queried.cae);
        return toNeutralResult(queried, qr);
    }

    async lastAuthorized(
        entity: EntityAuthBlock,
        pointOfSaleNumber: number,
        documentTypeCode: number,
    ): Promise<{number: number}> {
        const auth = await ticketStore.resolve(
            entity.entityCode,
            entity.issuerTaxId,
            ServiceId.WSFEV1,
            entity.environment,
            entity.credentials,
            entity.delegated,
        );
        const service = commonInvoiceService(toArcaEnvironment(entity.environment));
        const number = await this.delegationAware(entity, ServiceId.WSFEV1, () =>
            service.getLastAuthorizedNumber(auth, pointOfSaleNumber, toCbteTipo(documentTypeCode)),
        );
        return {number};
    }

    async nextNumbers(
        entity: EntityAuthBlock,
        pointOfSaleNumber: number,
        documentTypeCodes: ReadonlyArray<number>,
    ): Promise<NextNumbersResult> {
        // Validate every canonical code up front (before minting a ticket or any SOAP call): an unmapped code
        // throws ArcaValidationError('UNKNOWN_CODE') → 400, surfacing as an error envelope, never a silent
        // omission. WSFEv1 has no batch operation, so we fan out FECompUltimoAutorizado per code on a single
        // ticket + service instance and return the authority's next expected number (last + 1) for each.
        const mapped = documentTypeCodes.map((code) => ({code, cbteTipo: toCbteTipo(code)}));

        const auth = await ticketStore.resolve(
            entity.entityCode,
            entity.issuerTaxId,
            ServiceId.WSFEV1,
            entity.environment,
            entity.credentials,
            entity.delegated,
        );
        const service = commonInvoiceService(toArcaEnvironment(entity.environment));

        // The per-code lookups are independent read-only calls sharing one ticket, so issue them concurrently.
        // `Promise.all` preserves input order, so `numbers` still echoes `documentTypeCodes` positionally.
        const numbers = await this.delegationAware(entity, ServiceId.WSFEV1, () =>
            Promise.all(
                mapped.map(async ({code, cbteTipo}) => {
                    const last = await service.getLastAuthorizedNumber(auth, pointOfSaleNumber, cbteTipo);
                    // Never-authorized (PtoVta, CbteTipo) → CbteNro 0 → nextNumber 1.
                    return {documentTypeCode: code, nextNumber: last + 1};
                }),
            ),
        );
        return {numbers};
    }

    async queryVoucher(
        entity: EntityAuthBlock,
        pointOfSaleNumber: number,
        documentTypeCode: number,
        voucherNumber: number,
    ): Promise<TaxAuthorizationResult> {
        const auth = await ticketStore.resolve(
            entity.entityCode,
            entity.issuerTaxId,
            ServiceId.WSFEV1,
            entity.environment,
            entity.credentials,
            entity.delegated,
        );
        const service = commonInvoiceService(toArcaEnvironment(entity.environment));
        try {
            const result = await this.delegationAware(entity, ServiceId.WSFEV1, () =>
                service.queryVoucher(auth, pointOfSaleNumber, toCbteTipo(documentTypeCode), voucherNumber),
            );
            return toNeutralResult(result);
        } catch (err) {
            // ARCA surfaces a never-issued voucher as a 602 `Errors` block (thrown ArcaServiceError), not an
            // empty 200. Translate ONLY that to a neutral not-found (→ 404); every other service error
            // (auth/token/transport) propagates unchanged as a 502, so core keeps the sale PENDING and retries
            // rather than clearing an orphan it cannot prove was never issued.
            if (err instanceof ArcaServiceError && err.errors.some((e) => e.code === VOUCHER_NOT_FOUND_CODE)) {
                throw new VoucherNotFoundError(entity.entityCode, pointOfSaleNumber, documentTypeCode, voucherNumber);
            }
            throw err;
        }
    }

    async authorityStatus(environment: GenericEnvironment): Promise<AuthorityStatusResult> {
        return commonInvoiceService(toArcaEnvironment(environment)).getServerStatus();
    }

    async pointsOfSale(entity: EntityAuthBlock): Promise<PointsOfSaleResult> {
        const auth = await ticketStore.resolve(
            entity.entityCode,
            entity.issuerTaxId,
            ServiceId.WSFEV1,
            entity.environment,
            entity.credentials,
            entity.delegated,
        );
        const service = commonInvoiceService(toArcaEnvironment(entity.environment));
        try {
            const points = await this.delegationAware(entity, ServiceId.WSFEV1, () => service.getPointsOfSale(auth));
            return {pointsOfSale: points.map(toNeutralPointOfSale)};
        } catch (err) {
            // ARCA signals "this issuer has no registered points of sale" with a `602 Sin Resultados` error on
            // FEParamGetPtosVenta rather than an empty ResultGet. That is the documented empty case, not a
            // failure — normalize it to an empty list (any other service error propagates unchanged).
            if (err instanceof ArcaServiceError && err.errors.some((e) => e.code === NO_RESULTS_CODE)) {
                return {pointsOfSale: []};
            }
            throw err;
        }
    }

    async lookupTaxpayer(
        entity: EntityAuthBlock,
        taxpayerId: string,
        level?: string,
    ): Promise<TaxpayerResult> {
        const lvl = (level ?? 'A5') as RegistryLevel;
        const serviceId = padronServiceId(lvl);
        const auth = await ticketStore.resolve(
            entity.entityCode,
            entity.issuerTaxId,
            serviceId,
            entity.environment,
            entity.credentials,
            entity.delegated,
        );
        const data = await this.delegationAware(entity, serviceId, () =>
            padronService(toArcaEnvironment(entity.environment), lvl).getTaxpayer(
                auth,
                parseArcaId(taxpayerId, 'taxpayerId'),
            ),
        );
        return {idPersona: data.idPersona, taxId: data.taxId, name: data.name};
    }
}
