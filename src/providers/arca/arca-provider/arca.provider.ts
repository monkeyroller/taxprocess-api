import {ServiceId, type ServiceIdValue} from '../sdk/core/constants.js';
import {
    ArcaAuthError,
    ArcaServiceError,
    ArcaTaxpayerNotFoundError,
    ArcaValidationError,
} from '../sdk/core/errors.js';
import type {ArcaAuth} from '../sdk/core/types.js';
import {formatArcaDate} from '../sdk/invoicing/arca-qr/arca-qr.js';
import type {
    CommonInvoiceRequest,
    CommonInvoiceResult,
} from '../sdk/invoicing/common/common-invoice.types.js';
import type {TaxpayerData} from '../sdk/taxpayer-registry/padron.types.js';
import {commonInvoiceService, constanciaService, taxpayerIdentityService} from '../clients.js';
import {ticketStore} from '../auth/ticket-store/ticket-store.js';
import {delegateCredentialStore, type DelegateCredentialStore} from '../auth/delegate-credentials/delegate-credentials.js';
import {toArcaEnvironment} from '../auth/environment/environment.js';
import {toCbteTipo} from '../mapping/code-maps/code-maps.js';
import {toPadronService} from '../mapping/padron-routing/padron-routing.js';
import {toArcaDay, arcaDayToIsoDate, isArcaDay} from '../mapping/authority-day/authority-day.js';
import {
    applicabilityRange,
    arcaBand,
    clampToAuthorityToday,
    nextRefreshAfter,
    partitionCurrencyCodes,
    rateDayCandidates,
    referenceBand,
    toUnscopedRate,
    vintageOf,
    withValidity,
    REFERENCE_MON_ID,
    type RateValidity,
    type UnscopedRate,
} from '../mapping/cotizacion/cotizacion.js';
import {mapWithConcurrency} from '../../concurrency/concurrency.js';
import type {CommonInvoiceService} from '../sdk/invoicing/common/common-invoice-service/common-invoice.service.js';
import type {CurrencyRateUnavailableDto} from '../../../http/dto/currency-rates-result.dto.js';
import {
    isDelegateTicketFault,
    isNoResults,
    isUnknownCurrency,
    isVoucherNotFound,
    notEnrolledError,
    translateDelegatedTokenError,
    toProviderFault,
} from '../faults/faults.js';
import {
    isAlreadyAuthorizedError,
    isAlreadyAuthorizedRejection,
    recoverAuthorizedVoucher,
} from '../voucher-recovery.js';
import {
    buildCommonInvoiceRequest,
    buildQrUrl,
    concept1DateWindowError,
    toNeutralResult,
    toNeutralPointOfSale,
} from '../mapping/invoice-mapper/invoice.mapper.js';
import {toNeutralTaxpayerResult} from '../mapping/taxpayer-mapper/taxpayer.mapper.js';
import {validateArcaCredentials} from '../auth/credentials/credentials.js';
import {parseArcaId} from '../mapping/identifiers.js';
import {TaxEntityProvider} from '../../provider/provider.js';
import {
    DelegationNotConfiguredError,
    TaxpayerNotFoundError,
    VoucherNotFoundError,
} from '../../provider/faults.js';
import type {GenericEnvironment} from '../../provider/environment.js';
import type {EntityAuthBlock} from '../../provider/entity-auth.js';
import type {NeutralInvoice} from '../../provider/neutral-invoice.js';
import type {
    AuthorityStatusResult,
    CurrencyRatesResult,
    LastAuthorizedResult,
    NextNumbersResult,
    PointsOfSaleResult,
    TaxAuthorizationResult,
    TaxpayerResult,
} from '../../provider/neutral-results.js';
import type {
    CredentialValidationResult,
    ValidateCredentialsInput,
} from '../../provider/credential-validation.js';

/**
 * The entity code this provider is registered under. The padrón lookups have no issuer block but still need
 * it as the ticket-cache partition segment.
 */
const ENTITY_CODE = 'ARCA';

/**
 * How many `FEParamGetCotizacion` calls the whole-table fan-out keeps in flight. A currency table is ~49
 * codes; eight keeps a full sync inside a few seconds without looking like a burst.
 *
 * Also bounds what a refused ticket costs: `mapWithConcurrency` starts no further item once one has thrown,
 * so an `ArcaAuthError` stops the batch after at most this many calls.
 */
export const CURRENCY_FAN_OUT_LIMIT = 8;

/**
 * What one code's rate lookup produced. A discriminated union rather than two object shapes, since
 * property-presence narrowing does not survive inference through the generic fan-out helper.
 */
type RateOutcome =
    | {kind: 'RATE'; rate: UnscopedRate; rateDay: string}
    | {kind: 'UNAVAILABLE'; unavailable: CurrencyRateUnavailableDto};

/**
 * One code's attempt: what to report for it, plus the failure behind an `UPSTREAM_ERROR` when there was one.
 *
 * The error travels back with the outcome rather than in a variable the workers close over, so "the first
 * tolerated failure" is picked by request order rather than by whichever socket died first.
 */
interface RateAttempt {
    readonly outcome: RateOutcome;
    readonly tolerated?: unknown;
}

/**
 * What the whole fan-out produced. Separate from `CurrencyRatesResult` because `vintage` is the raw latest
 * ARCA day rather than the wire's `publishedAt`, and because its rates still lack the batch's applicability
 * window — a fact about the question rather than about anything this fan-out asked.
 */
interface RateFanOut {
    readonly rates: Array<UnscopedRate>;
    readonly unavailable: Array<CurrencyRateUnavailableDto>;
    readonly vintage: string | undefined;
    /**
     * The first tolerated failure by request order. Reported rather than acted on: whether it means an
     * outage is a question about the whole batch, including the codes this fan-out never sees, so
     * `rethrowIfSystemic` decides it after the two halves are merged.
     */
    readonly tolerated: unknown;
}

/**
 * The ARCA (Argentina/AFIP) tax entity provider — the sole owner of every AR-specific detail: WSAA ticket
 * minting, canonical-code→ARCA-code translation, the RG-4892 QR, and `production`/`testing` →
 * `produccion`/`homologacion` naming.
 *
 * What lives here is orchestration: resolve a ticket, call the SDK, map the answer. `faults.ts` decides what
 * an ARCA failure is and `voucher-recovery.ts` owns already-authorized reconciliation; this class keeps the
 * policy that reacts to those decisions, since that is the part that needs the request.
 */
export class ArcaProvider extends TaxEntityProvider {
    /**
     * The delegate store is injected so the `403` can name our real delegate CUIT rather than reading a
     * module singleton a test may not share.
     */
    constructor(private readonly delegate: DelegateCredentialStore = delegateCredentialStore) {
        super();
    }

    /**
     * Translates any ARCA-native failure into a neutral fault on the way out of every public method (applied
     * by the base class). The SDK's error classes and ARCA's business codes stop here, so the HTTP layer sees
     * only a neutral category plus the wire `code`/`details`.
     */
    protected override translateFault(err: unknown): unknown {
        return toProviderFault(err);
    }

    /**
     * Runs a delegated SDK call and classifies a WSFEv1 token/representación rejection on failure: a
     * `601 CUIT representada no incluida` (or an authorization-flavoured `600`) becomes a `403`, a genuine
     * signature/hash/clock `600` becomes an `ArcaAuthError` (`502`, our cert or clock), and anything else
     * passes through untouched. Applied at the SDK-call boundary, so the `10016`/`602` recovery is unaffected.
     *
     * A token fault evicts only `service`'s delegate ticket, never the delegate identity's tickets for other
     * services — ARCA would refuse to re-mint those until they expire.
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
            // The CUIT is a thunk: only a delegation verdict needs it, and reading it can cost a certificate
            // load.
            const translated = translateDelegatedTokenError(err, entity, () =>
                this.delegateCuit(entity.environment),
            );
            if (translated instanceof ArcaAuthError) {
                // Evict our delegate ticket so the next request re-mints, rather than every represented CUIT
                // sharing the one bad ticket until local expiry. A delegation rejection leaves it cached: the
                // ticket is valid, the delegation is what's missing.
                ticketStore.invalidateDelegated(entity.entityCode, entity.environment, service);
            }
            throw translated;
        }
    }

    /**
     * Our delegate CUIT for `environment` — the CUIT the user must grant the web service to. Reading it runs
     * inside an error handler, so a store that throws degrades to a placeholder rather than replacing the
     * actionable `403` with a config error.
     */
    private delegateCuit(environment: GenericEnvironment): string {
        try {
            return this.delegate.get(environment)?.delegateCuit ?? '(delegate)';
        } catch {
            return '(delegate)';
        }
    }

    protected validateCredentialsImpl(input: ValidateCredentialsInput): Promise<CredentialValidationResult> {
        return Promise.resolve(validateArcaCredentials(input));
    }

    protected async authorizeInvoiceImpl(entity: EntityAuthBlock, invoice: NeutralInvoice): Promise<TaxAuthorizationResult> {
        // Single-voucher flow only: the mapper sets CbteHasta to `voucherNumberFrom`, so a differing
        // `voucherNumberTo` would be silently truncated. Rejected before minting a WSAA ticket.
        if (invoice.voucherNumberFrom !== invoice.voucherNumberTo) {
            throw new ArcaValidationError(
                `Single-voucher flow requires voucherNumberFrom === voucherNumberTo ` +
                    `(got ${invoice.voucherNumberFrom}..${invoice.voucherNumberTo})`,
                'VOUCHER_RANGE_UNSUPPORTED',
            );
        }

        // Core owns the voucher number: authorize exactly the one it sent, never a computed correlative.
        //
        // Built before the ticket, not after, because building is where every canonical code is translated —
        // currency, document type, receiver identification and IVA condition. Resolving first made an
        // unmapped code cost a `409 CREDENTIALS_REQUIRED`, a re-send carrying the issuer's certificate and a
        // full WSAA login before the `400` that was decidable from the body alone. The mapper is pure and
        // clock-free, so nothing here needs the ticket, and this is the same order every other method on
        // this class states: validate what the body says before spending a credential on it.
        const request = buildCommonInvoiceRequest(invoice, invoice.voucherNumberFrom);

        const auth = await ticketStore.resolve(
            entity.entityCode,
            entity.issuerTaxId,
            ServiceId.WSFEV1,
            entity.environment,
            entity.credentials,
            entity.delegated,
        );
        const service = commonInvoiceService(toArcaEnvironment(entity.environment));

        // ARCA would refuse an out-of-window concept-1 `CbteFch` anyway, so refuse it ourselves with an
        // actionable code — but only after giving idempotent recovery its chance. A resend of a voucher ARCA
        // already authorized must still get that CAE back, and recovery reconciles against the stored
        // voucher, which the date never affects.
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
            // soft rejection. Reconcile only that conflict; any other business rejection is the truthful
            // outcome and is re-thrown.
            if (err instanceof ArcaServiceError && isAlreadyAuthorizedError(err)) {
                const recovered = await this.recoverAuthorizedVoucher(entity, service, auth, invoice, request);
                if (recovered !== undefined) {
                    return recovered;
                }
            }
            throw err;
        }

        // A `10016` rejection means the number is not the next to authorize, which includes core re-sending
        // one ARCA already authorized. If the voucher is genuinely authorized, return its stored CAE.
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
     * Binds `recoverAuthorizedVoucher` to this request: the issuer whose CUIT signs the rebuilt QR, and the
     * delegation-aware wrapper the query runs under.
     */
    private recoverAuthorizedVoucher(
        entity: EntityAuthBlock,
        service: ReturnType<typeof commonInvoiceService>,
        auth: ArcaAuth,
        invoice: NeutralInvoice,
        request: CommonInvoiceRequest,
    ): Promise<TaxAuthorizationResult | undefined> {
        return recoverAuthorizedVoucher({
            service,
            auth,
            invoice,
            request,
            issuerTaxId: entity.issuerTaxId,
            run: (op) => this.delegationAware(entity, ServiceId.WSFEV1, op),
        });
    }

    protected async lastAuthorizedImpl(
        entity: EntityAuthBlock,
        pointOfSaleNumber: number,
        documentTypeCode: number,
    ): Promise<LastAuthorizedResult> {
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

    protected async nextNumbersImpl(
        entity: EntityAuthBlock,
        pointOfSaleNumber: number,
        documentTypeCodes: ReadonlyArray<number>,
    ): Promise<NextNumbersResult> {
        // Every canonical code is validated before any ticket or SOAP call, so an unmapped code is a `400`
        // rather than a silent omission. De-duplicated because a repeated code would spend a SOAP call per
        // copy and put two entries in a `numbers` array core maps back by `documentTypeCode`; insertion order
        // is preserved, and every distinct code still reaches `toCbteTipo`.
        const mapped = [...new Set(documentTypeCodes)].map((code) => ({code, cbteTipo: toCbteTipo(code)}));

        const auth = await ticketStore.resolve(
            entity.entityCode,
            entity.issuerTaxId,
            ServiceId.WSFEV1,
            entity.environment,
            entity.credentials,
            entity.delegated,
        );
        const service = commonInvoiceService(toArcaEnvironment(entity.environment));

        // WSFEv1 has no batch operation, so the per-code lookups fan out concurrently on one ticket.
        // `numbers` follows `mapped` — the distinct codes in the order first named — and is deliberately not
        // positional against `documentTypeCodes`: `[1, 6, 1, 1]` answers with two entries, keyed by code.
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

    protected async queryVoucherImpl(
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
            // ARCA surfaces a never-issued voucher as a `602` error block, not an empty `200`. Only that
            // becomes a `404`; every other service error stays a `502`, so core keeps the sale pending and
            // retries rather than clearing an orphan it cannot prove was never issued.
            if (isVoucherNotFound(err)) {
                throw new VoucherNotFoundError(entity.entityCode, pointOfSaleNumber, documentTypeCode, voucherNumber);
            }
            throw err;
        }
    }

    protected async authorityStatusImpl(environment: GenericEnvironment): Promise<AuthorityStatusResult> {
        const status = await commonInvoiceService(toArcaEnvironment(environment)).getServerStatus();
        // Mapped field by field rather than returned as-is: `ServerStatus` is what `FEDummy` parses into and
        // this is the wire shape. They coincide today, and returning one as the other would let an ARCA
        // manual that adds a fourth tier change the contract by accident.
        return {appServer: status.appServer, dbServer: status.dbServer, authServer: status.authServer};
    }

    protected async pointsOfSaleImpl(entity: EntityAuthBlock): Promise<PointsOfSaleResult> {
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
            // ARCA signals "no registered points of sale" with a `602 Sin Resultados` on FEParamGetPtosVenta
            // rather than an empty ResultGet. That is the empty case, not a failure.
            if (isNoResults(err)) {
                return {pointsOfSale: []};
            }
            throw err;
        }
    }

    /**
     * The authority's published cotizaciones, with the band ARCA accepts around each. Credential-free under
     * our delegate identity. Four things this method decides:
     *
     * - `PES` never costs a call, so a request for it alone resolves no ticket and cannot fail as an outage.
     * - Omitting `currencyCodes` means the whole table. `FEParamGetCotizacion` takes one `MonId`, so the
     *   catalogue is enumerated first and the rates fanned out behind one answer — batched for consistency
     *   rather than call volume, since separate calls could straddle a publication boundary. The enumeration
     *   is intersected with the supported catalogue, so a rate is never offered for a currency
     *   `/invoices/authorize` would turn away.
     * - One missing currency never costs the others: it lands in `unavailable` with a reason.
     * - `date` is the day that needs a valid rate, not the day of the publication. This method resolves the
     *   day, clamps a future one, and hands the candidates to `fetchRate`.
     */
    protected async currencyRatesImpl(
        environment: GenericEnvironment,
        currencyCodes?: ReadonlyArray<string>,
        date?: string,
    ): Promise<CurrencyRatesResult> {
        const now = new Date();
        // Resolved before any I/O so it is present on every outcome, including the all-unavailable one.
        const refreshAfter = nextRefreshAfter(now);

        // Validated before any WSAA login, so a bad `date` is a cheap `400`.
        //
        // Both optional inputs are tested with `!= null` rather than `!== undefined`: `@IsOptional()` skips a
        // property's validators for `null` too, so an explicit `{"date": null}` arrives unvalidated and would
        // throw a `TypeError` off `.trim()` for what the contract calls the omitted case.
        const requestedDay = date == null ? undefined : toArcaDay(date, 'date');
        const arcaDay = requestedDay === undefined ? undefined : clampToAuthorityToday(requestedDay, now);
        // The day this answer is ABOUT — the one asked for, or today when none was. Hoisted because two
        // things read it and must not drift: what `PES` reports as its day, and the window every rate in the
        // batch is valid for.
        const answeredDay = arcaDay ?? formatArcaDate(now);
        // What `PES` reports as its day. Deliberately not walked back the way a fetched row is: the peso is 1
        // on the day of the voucher itself, with nothing to publish. For the same reason it does not feed
        // `publishedAt`. A batch where `PES` carries a later `rateDate` than `DOL` is the contract working as
        // written — a shared `rateDate` across a batch is not promised.
        const referenceDay = arcaDayToIsoDate(answeredDay);
        // Keyed on the day asked for rather than on the day a row closed on, so every rate in one answer
        // carries the same window even where their `rateDate`s differ. `applicabilityRange` has why. Stamped
        // onto the rates in `assembleRates`, once, rather than carried down through the fan-out.
        const validity = applicabilityRange(answeredDay);

        const localRates: Array<UnscopedRate> = [];
        const localUnavailable: Array<CurrencyRateUnavailableDto> = [];
        let toFetch: Array<string>;
        let auth: ArcaAuth;
        // One instance for the whole request: the catalogue read and every rate read share it.
        const service = commonInvoiceService(toArcaEnvironment(environment));

        if (currencyCodes == null) {
            // Whole table. Enumerating costs one call on the same ticket the rates then use.
            auth = await this.delegateAuth(environment, ServiceId.WSFEV1);
            const catalogue = await this.delegateCall(environment, ServiceId.WSFEV1, () =>
                service.getCurrencyTypes(auth),
            );
            // The one place the whole-table answer is not an intersection with what ARCA returned. The
            // reference row is our own answer rather than a catalogue entry, and `toMonId` accepts `PES` on
            // `/invoices/authorize` regardless, so the two endpoints still agree. Conditioning it would let a
            // short catalogue read silently drop the currency most vouchers are in. The partition below skips
            // it, so a catalogue that does list it still produces one row.
            localRates.push(this.referenceRate(referenceDay));

            // Fetching only the codes this service can also bill in is what stops the two endpoints
            // disagreeing. Unfiltered, a sync would surface a rate for a code `/invoices/authorize` then
            // refuses with `400 UNKNOWN_CODE` — a currency a caller can offer in a picker but never invoice
            // in. `namesReference` is ignored here alone, since the reference row is pushed above.
            const catalogued = partitionCurrencyCodes(catalogue.map((entry) => entry.id));
            toFetch = catalogued.toFetch;

            // A catalogue entry we do not know is the only signal that `ARCA_CURRENCY_CODES` has fallen
            // behind, and it arrives on the daily sync — so it is logged rather than dropped in silence.
            if (catalogued.unsupported.length > 0) {
                console.warn(
                    `ARCA currency catalogue (${environment}) holds ${catalogued.unsupported.length} code(s) ` +
                        `this service does not know: ${catalogued.unsupported.join(', ')}. Rates for them ` +
                        `are not served and invoices naming them are refused — add them to ` +
                        `ARCA_CURRENCY_CODES.`,
                );
            }
        } else {
            // An explicit list, split by the same rule the catalogue is. Only the meaning of the two
            // non-fetchable buckets differs once a caller named them rather than the authority.
            const requested = partitionCurrencyCodes(currencyCodes);
            toFetch = requested.toFetch;

            if (requested.namesReference) {
                localRates.push(this.referenceRate(referenceDay));
            }
            // Caught locally rather than relayed as ARCA's `12000`, so an unknown code costs neither a ticket
            // nor a round trip.
            for (const code of requested.unsupported) {
                localUnavailable.push({currencyCode: code, reason: 'UNKNOWN_CODE'});
            }

            // Every code answered without the authority, so resolve no ticket at all: the peso-only till
            // must not be able to fail because ARCA was unreachable.
            if (toFetch.length === 0) {
                return this.assembleRates(
                    environment,
                    localRates,
                    validity,
                    localUnavailable,
                    refreshAfter,
                    undefined,
                );
            }
            auth = await this.delegateAuth(environment, ServiceId.WSFEV1);
        }

        const fetched = await this.fetchRates(environment, service, auth, toFetch, arcaDay);
        this.rethrowIfSystemic(fetched);
        return this.assembleRates(
            environment,
            [...localRates, ...fetched.rates],
            validity,
            [...localUnavailable, ...fetched.unavailable],
            refreshAfter,
            fetched.vintage,
        );
    }

    /**
     * Rethrows a tolerated failure when the authority told us nothing at all — the outage case, and the only
     * one where reporting per-code absences would be a lie a caller might cache.
     *
     * Systemic means: no code produced a rate, every code came back `UPSTREAM_ERROR`, and at least one of
     * them failed before any answer arrived. One `602` or `12000` among them is a per-code fact.
     *
     * That last clause is the whole of why this keys on a tolerated failure, and it is a contract decision
     * rather than an oversight: an answer that arrived and could not be read is listed on the wire as an
     * ordinary per-code outcome ("answered unintelligibly"), so `fetchRate`'s unusable-answer branch hands
     * back no failure and a batch of nothing but those answers `200` with each code `UPSTREAM_ERROR`. The
     * price is that a response-shape change at ARCA empties every rate at once and is still reported that
     * way, including on a whole-table sync. Widening this to cover unusable answers would read as a
     * tightening and is not one — it turns a documented per-code outcome into a `502`, so change
     * `CurrencyRateUnavailableReason` with core first.
     *
     * Asked of the fetched half alone, because the locally-answered rows are not things the batch learned.
     * Counting them would disable the check where it matters most: the whole-table sync always emits the
     * reference row, so a total outage would return `200` with one peso row and forty-eight errors, which a
     * caller then caches until tomorrow. The peso's independence is unaffected — a request naming only codes
     * we answer ourselves returns before a ticket is ever resolved.
     *
     */
    private rethrowIfSystemic({rates, unavailable, tolerated}: RateFanOut): void {
        // No failure to raise means every code was answered, however unusably — see above.
        if (tolerated === undefined) {
            return;
        }
        const systemic = rates.length === 0 && unavailable.every((u) => u.reason === 'UPSTREAM_ERROR');
        if (systemic) {
            // Rethrown verbatim rather than wrapped: `translateFault` keys on the SDK's own error classes, so
            // wrapping would erase the classification that decides the HTTP status.
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- a caught value, re-raised as-is
            throw tolerated;
        }
    }

    /** The reference currency's row: `1/1/1`, no authority call. */
    private referenceRate(rateDate: string): UnscopedRate {
        return toUnscopedRate(REFERENCE_MON_ID, referenceBand(), rateDate);
    }

    /**
     * Fans `FEParamGetCotizacion` out over `codes` on one ticket, reporting per-code failures instead of
     * rejecting. Which failures are tolerated turns on whether one tells us about a code or about the
     * request:
     *
     * - a `602` (no publication) or a `12000` (unrecognized code) is a per-code fact → `unavailable`;
     * - an `ArcaAuthError` is never per-code: it is our ticket and would fail every code identically, so it
     *   propagates as the `502` it is;
     * - anything else is tolerated per code as `UPSTREAM_ERROR`, with the first such failure handed back.
     *
     * Whether those failures add up to an outage is `rethrowIfSystemic`'s question, since this method sees
     * only the codes that went to the authority.
     */
    private async fetchRates(
        environment: GenericEnvironment,
        service: CommonInvoiceService,
        auth: ArcaAuth,
        codes: ReadonlyArray<string>,
        arcaDay: string | undefined,
    ): Promise<RateFanOut> {
        if (codes.length === 0) {
            return {rates: [], unavailable: [], vintage: undefined, tolerated: undefined};
        }

        // Resolved once for the whole batch so every code is asked in the same order, and one currency's
        // missing row cannot leave the batch straddling two publications. An omitted `date` has exactly one
        // candidate — `undefined`, the wire's "latest row".
        const days = arcaDay === undefined ? [undefined] : rateDayCandidates(arcaDay);

        const attempts = await mapWithConcurrency<string, RateAttempt>(codes, CURRENCY_FAN_OUT_LIMIT, (code) =>
            this.fetchRate(environment, service, auth, code, days),
        );

        const rates: Array<UnscopedRate> = [];
        const unavailable: Array<CurrencyRateUnavailableDto> = [];
        const rateDays: Array<string> = [];
        // `mapWithConcurrency` preserves input order, so the first tolerated failure found here is the first
        // by request order rather than by whichever call settled first.
        let tolerated: unknown;
        for (const attempt of attempts) {
            if (attempt.tolerated !== undefined && tolerated === undefined) {
                tolerated = attempt.tolerated;
            }
            if (attempt.outcome.kind === 'RATE') {
                rates.push(attempt.outcome.rate);
                rateDays.push(attempt.outcome.rateDay);
            } else {
                unavailable.push(attempt.outcome.unavailable);
            }
        }
        return {rates, unavailable, vintage: vintageOf(rateDays), tolerated};
    }

    /**
     * One code's rate, asking each candidate day in turn and stopping at the first one ARCA answers.
     *
     * `days` arrives resolved; what remains is that ARCA may hold no row for the day named, and a
     * `602 Sin Resultados` is the only trustworthy statement of that since ARCA does not publish its
     * calendar. So a missing row advances to the day before, and `rateDate` carries ARCA's echoed
     * `FchCotiz` — the only record of which publication priced the voucher.
     *
     * Only a missing row walks. A `12000` or a transport failure says nothing about the day, and an
     * `ArcaAuthError` would fail every candidate identically, so it propagates untouched.
     *
     * A request that omitted `date` has one candidate, so a `602` against it is `NO_PUBLICATION` on the first
     * call: with no day named, "no results" is a fact about the currency.
     */
    private async fetchRate(
        environment: GenericEnvironment,
        service: CommonInvoiceService,
        auth: ArcaAuth,
        code: string,
        days: ReadonlyArray<string | undefined>,
    ): Promise<RateAttempt> {
        for (const day of days) {
            try {
                const info = await this.delegateCall(environment, ServiceId.WSFEV1, () =>
                    service.getCurrencyRate(auth, code, day),
                );
                // A shippable rate needs both a usable day and a positive rate, and the authority can leave
                // out either.
                //
                // The day matters because the answered day and the day asked for are allowed to differ, so
                // it is the only record of which publication priced the voucher — shipping a rate without
                // one would invite the fallback to the request date the contract forbids.
                //
                // The rate is checked rather than trusted for being typed a number: `MonCotiz` comes off a
                // wire the SOAP client does not coerce. A `0` is the more dangerous of the two, since `NaN`
                // at least serializes to `null` while `0` resolves to the band `[0, 0]` — the wire stating
                // that ARCA accepts exactly zero.
                //
                // Reported as `UPSTREAM_ERROR`, and it ends the walk rather than advancing it: an unreadable
                // answer is not a day with no row.
                //
                // Carries no `tolerated` failure, deliberately: an answer that arrived is a fact about this
                // code, so it stays reportable however many codes it happens to. See `rethrowIfSystemic`,
                // which reads the absence of one as "this batch was answered".
                if (info.rate === undefined || info.rate <= 0 || !isArcaDay(info.rateDate)) {
                    return {
                        outcome: {
                            kind: 'UNAVAILABLE',
                            unavailable: {currencyCode: code, reason: 'UPSTREAM_ERROR'},
                        },
                    };
                }
                return {
                    outcome: {
                        kind: 'RATE',
                        // Prefer ARCA's echoed spelling of the code, falling back to ours if it sends none.
                        rate: toUnscopedRate(
                            info.monId === '' ? code : info.monId,
                            arcaBand(info.rate),
                            arcaDayToIsoDate(info.rateDate),
                        ),
                        rateDay: info.rateDate,
                    },
                };
            } catch (err) {
                if (err instanceof ArcaAuthError) {
                    throw err;
                }
                if (isNoResults(err)) {
                    continue; // no row for this day — try the day before, if there is one left
                }
                const reason: CurrencyRateUnavailableDto['reason'] = isUnknownCurrency(err)
                    ? 'UNKNOWN_CODE'
                    : 'UPSTREAM_ERROR';
                return {
                    outcome: {kind: 'UNAVAILABLE', unavailable: {currencyCode: code, reason}},
                    ...(reason === 'UPSTREAM_ERROR' ? {tolerated: err} : {}),
                };
            }
        }
        // Every candidate answered "no results", so the currency has no publication anywhere in the window.
        return {
            outcome: {kind: 'UNAVAILABLE', unavailable: {currencyCode: code, reason: 'NO_PUBLICATION'}},
        };
    }

    /**
     * The wire result, from the locally-answered and fetched halves already merged by the caller. Its own
     * method because both exits from `currencyRatesImpl` go through it — the ordinary one and the peso-only
     * short-circuit — and the two must not drift on which keys are omitted.
     */
    private assembleRates(
        environment: GenericEnvironment,
        rates: Array<UnscopedRate>,
        validity: RateValidity,
        unavailable: Array<CurrencyRateUnavailableDto>,
        refreshAfter: string,
        publishedAt: string | undefined,
    ): CurrencyRatesResult {
        return {
            entityCode: ENTITY_CODE,
            environment,
            rates: withValidity(rates, validity),
            // Optional keys are omitted rather than sent empty or `null`.
            ...(unavailable.length > 0 ? {unavailable} : {}),
            refreshAfter,
            ...(publishedAt === undefined ? {} : {publishedAt}),
        };
    }

    protected async lookupTaxpayersImpl(
        environment: GenericEnvironment,
        identificationTypeCode: number,
        identificationNumber: string,
    ): Promise<TaxpayerResult> {
        // Routed first, so an identification type no padrón can answer for is a `400` without a WSAA login.
        const route = toPadronService(identificationTypeCode);
        const number = parseArcaId(identificationNumber, 'identificationNumber');
        const notFound = (message?: string): TaxpayerNotFoundError =>
            new TaxpayerNotFoundError(ENTITY_CODE, identificationTypeCode, identificationNumber, message);

        try {
            const found =
                route === 'CONSTANCIA'
                    ? [await this.claveFor(environment, number)]
                    : await this.identitiesForDocument(environment, number);
            if (found.length === 0) {
                throw notFound();
            }
            return toNeutralTaxpayerResult(ENTITY_CODE, found);
        } catch (err) {
            // The SDK raises its own not-found so each service can recognize its authority's wording; the
            // neutral error carries the caller's identification pair into the `404` body.
            if (err instanceof ArcaTaxpayerNotFoundError) {
                throw notFound(err.message);
            }
            throw err;
        }
    }

    /**
     * One clave (CUIT/CUIL/CDI), read from whichever padrón holds it.
     *
     * The constancia service answers first, being the richer picture: registered taxes, monotributo, and the
     * fiscal condition derived from them. But it only reports claves with a current inscripción — one with
     * nothing registered against it is absent there, and an inactive or cancelled one comes back as an empty
     * complaint, while A13 reports it in full. A13 is the superset, so an A13 miss is the only authoritative
     * "nobody" and a constancia miss is a reason to ask A13 rather than a `404`. There is no fallback the
     * other way: a clave the constancia holds is by definition in A13.
     *
     * A constancia miss is deliberately wide, because the service reports having nothing as a `200` in
     * several spellings — no `datosGenerales`, one carrying only an `idPersona` echo, a recognizable
     * complaint, an unrecognizable one, or a dangling `impuesto` with nobody attached. That cannot
     * manufacture a false negative, since the widened miss lands on this fallback rather than on a `404`,
     * and it costs one extra A13 round trip.
     *
     * A fallback that never reached A13 throws rather than degrading to the constancia's not-found: with the
     * superset unread, a `404` would state something we cannot stand behind.
     */
    private async claveFor(environment: GenericEnvironment, taxpayerId: number): Promise<TaxpayerData> {
        try {
            return await this.constanciaFor(environment, taxpayerId);
        } catch (err) {
            // Only "no such clave" is worth a second registry. A malformed id, a credential fault or a
            // transport failure says nothing about which padrón to ask.
            if (!(err instanceof ArcaTaxpayerNotFoundError)) {
                throw err;
            }
            try {
                return await this.identityFor(environment, taxpayerId);
            } catch (fallbackErr) {
                if (fallbackErr instanceof ArcaTaxpayerNotFoundError) {
                    // Both padrones missed, so this is a real not-found. The constancia's error is rethrown
                    // because when it carries the authority's wording it is the only sentence either service
                    // gave us — an A13 miss is a silent empty response.
                    throw err;
                }
                throw fallbackErr;
            }
        }
    }

    /** The registration picture for one clave (CUIT/CUIL/CDI), from the constancia service. */
    private async constanciaFor(environment: GenericEnvironment, taxpayerId: number): Promise<TaxpayerData> {
        const service = constanciaService(toArcaEnvironment(environment));
        const auth = await this.delegateAuth(environment, service.service);
        return this.delegateCall(environment, service.service, () => service.getTaxpayer(auth, taxpayerId));
    }

    /**
     * One clave read from the identity padrón (A13) — `constanciaFor` minus the tax picture. Answers for any
     * clave kind: `getPersonaV2` takes an `idPersona`, be it a CUIT, a CUIL or a CDI.
     */
    private async identityFor(environment: GenericEnvironment, taxpayerId: number): Promise<TaxpayerData> {
        const service = taxpayerIdentityService(toArcaEnvironment(environment));
        const auth = await this.delegateAuth(environment, service.service);
        return this.delegateCall(environment, service.service, () => service.getTaxpayer(auth, taxpayerId));
    }

    /**
     * Everyone A13 has registered under an identity-document number. The document is not a clave, so it is
     * resolved to the claves ARCA issued for it — commonly two, a CUIL and a CUIT — and each is read
     * concurrently on the one A13 ticket. An empty list is the caller's `404`.
     */
    private async identitiesForDocument(
        environment: GenericEnvironment,
        documentNumber: number,
    ): Promise<Array<TaxpayerData>> {
        const service = taxpayerIdentityService(toArcaEnvironment(environment));
        const auth = await this.delegateAuth(environment, service.service);

        const claves = await this.delegateCall(environment, service.service, () =>
            service.getIdPersonaList(auth, documentNumber),
        );
        if (claves.length === 0) {
            return [];
        }

        const people = await this.delegateCall(environment, service.service, () =>
            Promise.all(
                claves.map(async (clave) => {
                    try {
                        return await service.getTaxpayer(auth, parseArcaId(clave, 'taxpayerId'));
                    } catch (err) {
                        // A clave the document search returned but the person lookup cannot read is dropped
                        // rather than fatal: the remaining matches are still a truthful answer, and only an
                        // all-empty outcome becomes a `404`.
                        if (err instanceof ArcaTaxpayerNotFoundError) {
                            return undefined;
                        }
                        throw err;
                    }
                }),
            ),
        );
        return people.filter((person): person is TaxpayerData => person !== undefined);
    }

    /**
     * The delegate ticket a credential-free lookup signs with. `Auth.Cuit` is our own delegate CUIT — the
     * service acts as itself, representing nobody — so there is no issuer to name and no represented
     * taxpayer to classify a rejection against.
     *
     * Parameterized by `service` because the padrón lookups and the cotización batch share it: both read
     * information belonging to the authority rather than to any tenant, so neither has an issuer block on
     * the wire. For the cotización the service is `wsfe`, reached as ourselves.
     */
    private async delegateAuth(environment: GenericEnvironment, service: ServiceIdValue): Promise<ArcaAuth> {
        const delegate = this.delegate.get(environment);
        if (delegate === undefined) {
            throw new DelegationNotConfiguredError(environment, 'no delegate certificate is configured');
        }
        try {
            return await ticketStore.resolve(ENTITY_CODE, delegate.delegateCuit, service, environment, undefined, true);
        } catch (err) {
            throw notEnrolledError(err, environment, service);
        }
    }

    /**
     * Runs a credential-free SDK call under our delegate ticket.
     *
     * Deliberately not `delegationAware`: these calls represent nobody, so a delegation error raised here
     * would name the same CUIT as both delegate and issuer and ask the caller to grant itself a delegation.
     *
     * What it keeps is the eviction. One delegate ticket serves every call, so a ticket ARCA has started
     * rejecting would otherwise fail all of them until local expiry. Reported as an `ArcaAuthError` (`502`,
     * our credential) rather than the raw transport error.
     *
     * `isDelegateTicketFault` decides which failures count, per web service: the padrón services and `wsfe`
     * report a ticket fault in different shapes, and applying the padrón wording to a `wsfe` failure would
     * evict a shared delegate ticket ARCA will not re-mint for ~12h, taking delegated invoicing down for
     * every tenant.
     */
    private async delegateCall<T>(
        environment: GenericEnvironment,
        service: ServiceIdValue,
        op: () => Promise<T>,
    ): Promise<T> {
        try {
            return await op();
        } catch (err) {
            if (isDelegateTicketFault(err, service)) {
                ticketStore.invalidateDelegated(ENTITY_CODE, environment, service);
                const message = err instanceof Error ? err.message : String(err);
                throw new ArcaAuthError(`ARCA rejected the delegate ticket for "${service}": ${message}`);
            }
            throw err;
        }
    }
}
