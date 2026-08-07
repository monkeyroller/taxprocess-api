import {ServiceId, type RegistryLevel} from './sdk/index.js';
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
 * The ARCA (Argentina/AFIP) tax entity provider — the sole owner of every AR-specific detail: WSAA ticket
 * minting (via the ticket store), id→ARCA-code translation (via code-maps + the invoice mapper), the
 * RG-4892 QR, and `production`/`testing` → `produccion`/`homologacion` naming.
 */
export class ArcaProvider extends TaxEntityProvider {
    validateCredentials(input: ValidateCredentialsInput): Promise<CredentialValidationResult> {
        return Promise.resolve(validateArcaCredentials(input));
    }

    async authorizeInvoice(entity: EntityAuthBlock, invoice: NeutralInvoice): Promise<TaxAuthorizationResult> {
        const auth = await ticketStore.resolve(
            entity.entityCode,
            entity.issuerTaxId,
            ServiceId.WSFEV1,
            entity.environment,
            entity.credentials,
        );
        const service = commonInvoiceService(toArcaEnvironment(entity.environment));

        // ARCA is the source of truth for the voucher number: last-authorized + 1 keeps it correlative.
        const lastAuthorized = await service.getLastAuthorizedNumber(
            auth,
            invoice.salesPointNumber,
            toCbteTipo(invoice.documentTypeId),
        );
        const voucherNumber = lastAuthorized + 1;

        const request = buildCommonInvoiceRequest(invoice, voucherNumber, new Date());
        const result = await service.requestAuthorization(auth, request);

        // Build the QR only for an approved voucher; the guard narrows `result.cae` to a string.
        const qr =
            result.result === 'A' && result.cae !== undefined && result.caeExpiration !== undefined
                ? buildQrUrl(entity.issuerTaxId, request, result.cae)
                : undefined;
        return toNeutralResult(result, qr);
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
