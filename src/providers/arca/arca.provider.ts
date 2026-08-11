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
import {buildCommonInvoiceRequest, buildQrUrl, toNeutralResult} from './ar-invoice.mapper.js';
import {validateArcaCredentials} from './credentials.js';
import {parseArcaId} from './ar-identifiers.js';
import {
    TaxEntityProvider,
    type AuthorityStatusResult,
    type CredentialValidationResult,
    type EntityAuthBlock,
    type GenericEnvironment,
    type NeutralInvoice,
    type TaxAuthorizationResult,
    type TaxpayerResult,
    type ValidateCredentialsInput,
} from '../provider.js';

/**
 * ARCA observation code returned by `FECAESolicitar` when `CbteDesde` is not the next number to
 * authorize — which includes the case where core re-sends a number ARCA has already authorized (e.g. after
 * a persistence failure on core's side). The code is ambiguous (it also fires for a number too far ahead of
 * the sequence), so it only flags a *candidate* for recovery; `queryVoucher` is the arbiter.
 */
const ALREADY_AUTHORIZED_CODE = '10016';

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
 * minting (via the ticket store), id→ARCA-code translation (via code-maps + the invoice mapper), the
 * RG-4892 QR, and `production`/`testing` → `produccion`/`homologacion` naming.
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
                invoice.salesPointNumber,
                toCbteTipo(invoice.documentTypeId),
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
        salesPointNumber: number,
        documentTypeId: number,
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
            salesPointNumber,
            toCbteTipo(documentTypeId),
        );
        return {number};
    }

    async queryVoucher(
        entity: EntityAuthBlock,
        salesPointNumber: number,
        documentTypeId: number,
        voucherNumber: number,
    ): Promise<TaxAuthorizationResult> {
        const auth = await ticketStore.resolve(
            entity.entityCode,
            entity.issuerTaxId,
            ServiceId.WSFEV1,
            entity.environment,
            entity.credentials,
        );
        const result = await commonInvoiceService(toArcaEnvironment(entity.environment)).queryVoucher(
            auth,
            salesPointNumber,
            toCbteTipo(documentTypeId),
            voucherNumber,
        );
        return toNeutralResult(result);
    }

    async authorityStatus(environment: GenericEnvironment): Promise<AuthorityStatusResult> {
        return commonInvoiceService(toArcaEnvironment(environment)).getServerStatus();
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
