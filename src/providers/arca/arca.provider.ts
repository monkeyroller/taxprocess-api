import {
    ArcaServiceError,
    ArcaValidationError,
    ServiceId,
    type ArcaAuth,
    type CommonInvoiceRequest,
    type CommonInvoiceResult,
    type RegistryLevel,
} from './sdk/index.js';
import {commonInvoiceService, padronService, padronServiceId} from './clients.js';
import {ticketStore} from './ticket-store.js';
import {toArcaEnvironment} from './environment.js';
import {toCbteTipo} from './code-maps.js';
import {buildCommonInvoiceRequest, buildQrUrl, toNeutralResult, toNeutralPointOfSale} from './ar-invoice.mapper.js';
import {validateArcaCredentials} from './credentials.js';
import {parseArcaId} from './ar-identifiers.js';
import {
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
 * Guards against core reusing a voucher number for a *different* sale: the amount stored against the
 * already-authorized voucher must match the one we just tried to authorize, or returning its CAE would hand
 * back a fiscal document for the wrong invoice. `ImpTotal` is the strongest single signal and avoids false
 * positives from date/rounding differences. A missing/non-numeric stored total is not treated as a mismatch.
 */
function assertRecoveredVoucherMatches(request: CommonInvoiceRequest, queried: CommonInvoiceResult): void {
    const storedTotal = Number((queried.raw as {ImpTotal?: unknown}).ImpTotal);
    if (Number.isFinite(storedTotal) && Math.abs(storedTotal - request.totalAmount) > 0.01) {
        throw new ArcaValidationError(
            `Voucher ${request.voucherNumberFrom} is already authorized for a different amount ` +
                `(sent ${request.totalAmount}, stored ${storedTotal}); refusing to return its CAE.`,
            'VOUCHER_ALREADY_AUTHORIZED_MISMATCH',
        );
    }
}

/**
 * The ARCA (Argentina/AFIP) tax entity provider — the sole owner of every AR-specific detail: WSAA ticket
 * minting (via the ticket store), canonical-code→ARCA-code translation (via code-maps + the invoice
 * mapper), the RG-4892 QR, and `production`/`testing` → `produccion`/`homologacion` naming.
 */
export class ArcaProvider extends TaxEntityProvider {
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
        );
        const service = commonInvoiceService(toArcaEnvironment(entity.environment));

        // Core is the source of truth for the voucher number (contract 2026-08-10): authorize exactly the
        // number it sent. The service never computes the next correlative for authorize anymore.
        const request = buildCommonInvoiceRequest(invoice, invoice.voucherNumberFrom, new Date());

        let result: CommonInvoiceResult;
        try {
            result = await service.requestAuthorization(auth, request);
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
            queried = await service.queryVoucher(
                auth,
                invoice.pointOfSaleNumber,
                toCbteTipo(invoice.documentTypeCode),
                invoice.voucherNumberFrom,
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
        );
        const number = await commonInvoiceService(toArcaEnvironment(entity.environment)).getLastAuthorizedNumber(
            auth,
            pointOfSaleNumber,
            toCbteTipo(documentTypeCode),
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
        );
        const service = commonInvoiceService(toArcaEnvironment(entity.environment));

        // The per-code lookups are independent read-only calls sharing one ticket, so issue them concurrently.
        // `Promise.all` preserves input order, so `numbers` still echoes `documentTypeCodes` positionally.
        const numbers = await Promise.all(
            mapped.map(async ({code, cbteTipo}) => {
                const last = await service.getLastAuthorizedNumber(auth, pointOfSaleNumber, cbteTipo);
                // Never-authorized (PtoVta, CbteTipo) → CbteNro 0 → nextNumber 1.
                return {documentTypeCode: code, nextNumber: last + 1};
            }),
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
        );
        try {
            const result = await commonInvoiceService(toArcaEnvironment(entity.environment)).queryVoucher(
                auth,
                pointOfSaleNumber,
                toCbteTipo(documentTypeCode),
                voucherNumber,
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
        );
        try {
            const points = await commonInvoiceService(toArcaEnvironment(entity.environment)).getPointsOfSale(auth);
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
        );
        const data = await padronService(toArcaEnvironment(entity.environment), lvl).getTaxpayer(
            auth,
            parseArcaId(taxpayerId, 'taxpayerId'),
        );
        return {idPersona: data.idPersona, taxId: data.taxId, name: data.name};
    }
}
