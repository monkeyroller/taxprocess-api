import {SoapClient} from './core/soap-client.js';
import {WsaaClient} from './core/wsaa-client.js';
import {CommonInvoiceService} from './invoicing/common/common-invoice.service.js';
import {ExportInvoiceService} from './invoicing/export/export-invoice.service.js';
import {CreditInvoiceService} from './invoicing/credit/credit-invoice.service.js';
import {RegistrationStatusService} from './taxpayer-registry/registration-status.service.js';
import {DetailedTaxpayerService} from './taxpayer-registry/detailed-taxpayer.service.js';
import {TaxpayerRelationsService} from './taxpayer-registry/taxpayer-relations.service.js';
import {BasicTaxpayerService} from './taxpayer-registry/basic-taxpayer.service.js';
import type {ArcaConfig} from './core/arca-config.js';
import type {ArcaAuth} from './core/types.js';

/**
 * The dependencies an {@link Arca} instance shares across requests. The SOAP client and the WSAA
 *  client are long-lived singletons so the ~12h ticket cache survives between requests.
 */
export interface ArcaDeps {
    soap: SoapClient;
    wsaa: WsaaClient;
}

const sharedSoap = new SoapClient();
const sharedWsaa = new WsaaClient(sharedSoap);

/** Default shared dependencies (singletons). Override in tests to inject fakes. */
export const defaultArcaDeps: ArcaDeps = {soap: sharedSoap, wsaa: sharedWsaa};

/**
 * Per-issuer orchestrator: binds one {@link ArcaConfig} to the SDK's service clients and handles
 * WSAA authentication (ticket caching lives in the shared {@link WsaaClient}). Construct one per
 * issuing CUIT/request via {@link createArca}; the underlying clients are stateless w.r.t. auth.
 */
export class Arca {
    readonly commonInvoice: CommonInvoiceService;
    readonly exportInvoice: ExportInvoiceService;
    readonly creditInvoice: CreditInvoiceService;
    readonly registrationStatus: RegistrationStatusService;
    readonly detailedTaxpayer: DetailedTaxpayerService;
    readonly taxpayerRelations: TaxpayerRelationsService;
    readonly basicTaxpayer: BasicTaxpayerService;

    constructor(
        private readonly config: ArcaConfig,
        private readonly deps: ArcaDeps = defaultArcaDeps,
    ) {
        const {soap} = deps;
        const env = config.environment;
        this.commonInvoice = new CommonInvoiceService(soap, env);
        this.exportInvoice = new ExportInvoiceService(soap, env);
        this.creditInvoice = new CreditInvoiceService(soap, env);
        this.registrationStatus = new RegistrationStatusService(soap, env);
        this.detailedTaxpayer = new DetailedTaxpayerService(soap, env);
        this.taxpayerRelations = new TaxpayerRelationsService(soap, env);
        this.basicTaxpayer = new BasicTaxpayerService(soap, env);
    }

    /**
     * Obtains a (cached) WSAA access ticket for `serviceId` and returns the {@link ArcaAuth} to pass
     * into that service's calls, e.g. `arca.authenticate(arca.commonInvoice.service)`.
     */
    async authenticate(serviceId: string): Promise<ArcaAuth> {
        const ticket = await this.deps.wsaa.getAccessTicket(this.config, serviceId);
        return {token: ticket.token, sign: ticket.sign, cuit: this.config.cuit};
    }
}

/** Builds an {@link Arca} orchestrator for a resolved issuer configuration. */
export function createArca(config: ArcaConfig, deps: ArcaDeps = defaultArcaDeps): Arca {
    return new Arca(config, deps);
}

// ---- Public SDK surface ----
export {SoapClient} from './core/soap-client.js';
export {WsaaClient} from './core/wsaa-client.js';
export {ENDPOINTS, Namespaces, ServiceId} from './core/constants.js';
export type {ArcaEnvironment, ServiceIdValue} from './core/constants.js';
export type {ArcaConfig} from './core/arca-config.js';
export type {ArcaAuth, AccessTicket, ServerStatus} from './core/types.js';
export {
    ArcaError,
    ArcaAuthError,
    ArcaSoapError,
    ArcaServiceError,
    ArcaValidationError,
    NotImplementedError,
    type ArcaErrorEntry,
} from './core/errors.js';
export {encryptSecret, decryptSecret, CURRENT_KEY_VERSION, type EncryptedSecret} from './core/key-crypto.js';
export {
    normalizePem,
    ensureCertificatePem,
    ensurePrivateKeyPem,
    isValidCertificate,
    isValidPrivateKey,
    isCertificateSigningRequest,
    canonicalizeCertificatePem,
    canonicalizePrivateKeyPem,
    keyMatchesCertificatePem,
} from './core/pem.js';
export {
    calculateTotals, roundToTwo, type InvoiceLineTax, type InvoiceTotals, type VatSubtotal
} from './invoicing/invoice-totals.js';
export {vatRateIdForPercent, VAT_RATE_IDS} from './invoicing/vat-rate-map.js';
export {
    buildArcaQrUrl, formatArcaDate, parseArcaDate, argentinaDateParts, type ArcaQrParams
} from './invoicing/arca-qr.js';
export {CommonInvoiceService} from './invoicing/common/common-invoice.service.js';
export type {
    CommonInvoiceRequest,
    CommonInvoiceResult,
    InvoiceConcept,
    AssociatedVoucher,
    InvoiceOptional,
    ArcaObservation,
} from './invoicing/common/common-invoice.types.js';
export {InvoiceWebService} from './invoicing/invoice-web-service.base.js';
export {
    TaxpayerRegistryService, type RegistryLevel, type TaxpayerData
} from './taxpayer-registry/taxpayer-registry.service.base.js';
