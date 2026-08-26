import {
    ArcaAuthError,
    ArcaServiceError,
    ArcaTaxpayerNotFoundError,
    ArcaValidationError,
    ServiceId,
    type ArcaAuth,
    type CommonInvoiceRequest,
    type CommonInvoiceResult,
    type ServiceIdValue,
    type TaxpayerData,
} from './sdk/index.js';
import {commonInvoiceService, constanciaService, taxpayerIdentityService} from './clients.js';
import {ticketStore} from './auth/ticket-store.js';
import {delegateCredentialStore, type DelegateCredentialStore} from './auth/delegate-credentials.js';
import {toArcaEnvironment} from './auth/environment.js';
import {toCbteTipo, toPadronService} from './mapping/code-maps.js';
import {
    isNoResults,
    isPadronTicketFault,
    isVoucherNotFound,
    notEnrolledError,
    translateDelegatedTokenError,
} from './faults.js';
import {
    isAlreadyAuthorizedError,
    isAlreadyAuthorizedRejection,
    recoverAuthorizedVoucher,
} from './voucher-recovery.js';
import {
    buildCommonInvoiceRequest,
    buildQrUrl,
    concept1DateWindowError,
    toNeutralResult,
    toNeutralPointOfSale,
} from './mapping/invoice.mapper.js';
import {toNeutralTaxpayerResult} from './mapping/taxpayer.mapper.js';
import {validateArcaCredentials} from './auth/credentials.js';
import {parseArcaId} from './mapping/identifiers.js';
import {
    DelegationNotConfiguredError,
    TaxEntityProvider,
    type AuthorityStatusResult,
    type CredentialValidationResult,
    type EntityAuthBlock,
    type GenericEnvironment,
    type NeutralInvoice,
    type NextNumbersResult,
    type PointsOfSaleResult,
    type TaxAuthorizationResult,
    TaxpayerNotFoundError,
    type TaxpayerResult,
    type ValidateCredentialsInput,
    VoucherNotFoundError,
} from '../provider.js';

/**
 * The entity code this provider is registered under. Requests that carry an issuer block take it from
 * there; the padron lookups have no issuer at all, yet still need it as the ticket-cache partition
 * segment - it is the same constant either way, since this provider only ever serves `ARCA`.
 */
const ENTITY_CODE = 'ARCA';

/**
 * The ARCA (Argentina/AFIP) tax entity provider — the sole owner of every AR-specific detail: WSAA ticket
 * minting (via the ticket store), canonical-code→ARCA-code translation (via code-maps + the invoice
 * mapper), the RG-4892 QR, and `production`/`testing` → `produccion`/`homologacion` naming.
 *
 * What lives here is orchestration: resolve a ticket, call the SDK, map the answer. Two concerns it used to
 * carry inline now sit beside it — `faults.ts` decides what an ARCA failure *is*, and `voucher-recovery.ts`
 * owns already-authorized reconciliation. This class keeps the policy that reacts to those decisions
 * (which ticket to evict, which outcome to surface), because that is the part that needs the request.
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
     * 2×2 in `docs/CONTRACT.md` §10) via {@link translateDelegatedTokenError}: a `601 CUIT representada no
     * incluida` — or an authorization-flavored overloaded `600` — → `DelegationNotAuthorizedError` (403, the
     * represented CUIT hasn't delegated to us); a genuine signature/hash/clock `600` → {@link ArcaAuthError}
     * (502 token error, our cert/clock — never a delegation error); anything else (ambiguous `600`, other
     * codes, non-delegated calls) passes through untouched. Applied at the SDK-call boundary so the existing
     * `10016`/`602` recovery — which keys on other codes — is unaffected.
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
            // The CUIT is a thunk: only a delegation verdict needs it, and reading it can cost a certificate
            // load — an error that passes through untouched must not pay for one.
            const translated = translateDelegatedTokenError(err, entity, () =>
                this.delegateCuit(entity.environment),
            );
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
     * Binds {@link recoverAuthorizedVoucher} to this request — the issuer whose CUIT signs the rebuilt QR,
     * and the delegation-aware wrapper the query runs under. Kept as a method so the three call sites in
     * {@link authorizeInvoice} read as one decision each.
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
            if (isVoucherNotFound(err)) {
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
            if (isNoResults(err)) {
                return {pointsOfSale: []};
            }
            throw err;
        }
    }

    async lookupTaxpayers(
        environment: GenericEnvironment,
        identificationTypeCode: number,
        identificationNumber: string,
    ): Promise<TaxpayerResult> {
        // Route first: an identification type no padrón service can answer for is a `400` the caller can
        // fix, and discovering that must not cost a WSAA login.
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
            // neutral error is what carries the caller's identification pair into the `404` body.
            if (err instanceof ArcaTaxpayerNotFoundError) {
                throw notFound(err.message);
            }
            throw err;
        }
    }

    /**
     * One clave (CUIT/CUIL/CDI), read from whichever padrón holds it.
     *
     * The constancia service answers first because it is the richer picture — registered taxes, monotributo,
     * and the fiscal condition derived from them. But it only reports claves that have a *current
     * inscripción*: a clave ARCA issued with nothing registered against it is simply absent there, and one
     * that is inactive or cancelled comes back as a complaint with every field empty — while A13 knows the
     * person behind it perfectly well (`getPersonaV2` reports an inactive clave in full). A13 is the
     * superset — a clave A13 does not hold is in no padrón — so an A13 miss is the only authoritative
     * "nobody", and a constancia miss is a reason to ask A13 rather than a `404`. There is deliberately no
     * fallback the other way: a clave the constancia holds is by definition in A13, so that lookup could
     * only ever come back empty-handed.
     *
     * A fallback that never *reached* A13 (no enrolment, token or transport fault) throws rather than
     * degrading to the constancia's not-found: with the superset unread we do not know that nobody is
     * registered, and a `404` would state something we cannot stand behind.
     */
    private async claveFor(environment: GenericEnvironment, taxpayerId: number): Promise<TaxpayerData> {
        try {
            return await this.constanciaFor(environment, taxpayerId);
        } catch (err) {
            // Only "no such clave" is worth a second registry. A malformed id, a credential fault or a
            // transport failure says nothing about which padrón to ask, and asking again would just cost a
            // second round trip before failing the same way.
            if (!(err instanceof ArcaTaxpayerNotFoundError)) {
                throw err;
            }
            try {
                return await this.identityFor(environment, taxpayerId);
            } catch (fallbackErr) {
                if (fallbackErr instanceof ArcaTaxpayerNotFoundError) {
                    // Both padrones missed, so this is a real not-found. The constancia's error is the one
                    // rethrown: it carries the authority's own wording ("No existe persona con ese Id"),
                    // where an A13 miss is a silent empty response with nothing but the SDK's default text.
                    throw err;
                }
                throw fallbackErr;
            }
        }
    }

    /** The registration picture for one clave (CUIT/CUIL/CDI), from the constancia service. */
    private async constanciaFor(environment: GenericEnvironment, taxpayerId: number): Promise<TaxpayerData> {
        const service = constanciaService(toArcaEnvironment(environment));
        const auth = await this.padronAuth(environment, service.service);
        return this.padronCall(environment, service.service, () => service.getTaxpayer(auth, taxpayerId));
    }

    /**
     * One clave read from the identity padrón (A13) — `constanciaFor`'s twin, minus the tax picture. Used
     * as the constancia's fallback, and it answers for any clave kind: `getPersonaV2` takes an `idPersona`,
     * whether that is a CUIT, a CUIL or a CDI.
     */
    private async identityFor(environment: GenericEnvironment, taxpayerId: number): Promise<TaxpayerData> {
        const service = taxpayerIdentityService(toArcaEnvironment(environment));
        const auth = await this.padronAuth(environment, service.service);
        return this.padronCall(environment, service.service, () => service.getTaxpayer(auth, taxpayerId));
    }

    /**
     * Everyone A13 has registered under an identity-document number. The document is not a clave, so it is
     * resolved to the claves ARCA issued for it (commonly two — a CUIL and a CUIT) and each is then read.
     * All of it runs on the one A13 ticket, and the per-clave reads are independent, so they go out
     * concurrently. Returns an empty list when the document matches nothing, which the caller turns into
     * the `404`.
     */
    private async identitiesForDocument(
        environment: GenericEnvironment,
        documentNumber: number,
    ): Promise<Array<TaxpayerData>> {
        const service = taxpayerIdentityService(toArcaEnvironment(environment));
        const auth = await this.padronAuth(environment, service.service);

        const claves = await this.padronCall(environment, service.service, () =>
            service.getIdPersonaList(auth, documentNumber),
        );
        if (claves.length === 0) {
            return [];
        }

        const people = await this.padronCall(environment, service.service, () =>
            Promise.all(
                claves.map(async (clave) => {
                    try {
                        return await service.getTaxpayer(auth, parseArcaId(clave, 'taxpayerId'));
                    } catch (err) {
                        // A clave the document search just returned but the person lookup cannot read is
                        // dropped rather than fatal: the remaining matches are still a truthful answer.
                        // Only an all-empty outcome becomes a `404`.
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
     * The delegate ticket a padrón lookup signs with. `Auth.Cuit` is our OWN delegate CUIT — the service acts
     * as itself, representing nobody (CONTRACT §10) — so there is no issuer to name and no represented
     * taxpayer to classify a rejection against.
     */
    private async padronAuth(environment: GenericEnvironment, service: ServiceIdValue): Promise<ArcaAuth> {
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
     * Runs a padrón SDK call under our delegate ticket.
     *
     * Deliberately NOT {@link ArcaProvider.delegationAware}. A registry lookup represents nobody
     * (CONTRACT §10): `Auth.Cuit` is our own delegate CUIT, so a `DelegationNotAuthorizedError` raised here
     * would name the same CUIT as both delegate and issuer and ask the caller to grant itself a delegation —
     * an error the contract promises this endpoint never returns. That classifier is inert on this path in
     * any case: it keys on `ArcaServiceError` (WSFEv1's in-payload `Errors` list), which the padrón services
     * never produce — they report every failure as an `ArcaSoapError` fault.
     *
     * What it keeps from that path is the eviction, which is the half that actually mattered here. One
     * delegate ticket serves every lookup, so a ticket ARCA has started rejecting would otherwise fail every
     * lookup until local expiry; dropping it lets the next request re-mint. Reported as an
     * {@link ArcaAuthError} (`502`, our credential) rather than the raw transport error, matching how the
     * invoicing path names the same condition.
     */
    private async padronCall<T>(
        environment: GenericEnvironment,
        service: ServiceIdValue,
        op: () => Promise<T>,
    ): Promise<T> {
        try {
            return await op();
        } catch (err) {
            if (isPadronTicketFault(err)) {
                ticketStore.invalidateDelegated(ENTITY_CODE, environment, service);
                throw new ArcaAuthError(`ARCA rejected the delegate ticket for "${service}": ${err.message}`);
            }
            throw err;
        }
    }
}
