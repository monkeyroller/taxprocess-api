/**
 * Public SDK surface — the ARCA client library's barrel. Framework-agnostic: consumers construct the
 * service classes directly (bound to a shared, stateless `SoapClient` + an environment) and pass an
 * `ArcaAuth` — obtained from `WsaaClient` — into each call. There is no per-issuer orchestrator here;
 * auth policy (ticket caching, credential handshakes) is the consumer's concern.
 */
export {SoapClient} from './core/soap-client/soap-client.js';
export {WsaaClient} from './core/wsaa-client/wsaa-client.js';
export {ENDPOINTS, Namespaces, ServiceId} from './core/constants.js';
export type {ArcaEnvironment, ServiceIdValue} from './core/constants.js';
export type {ArcaConfig} from './core/arca-config.js';
export type {ArcaAuth, AccessTicket, ServerStatus, PointOfSaleInfo} from './core/types.js';
export {
    ArcaError,
    ArcaAuthError,
    ArcaSoapError,
    ArcaServiceError,
    ArcaValidationError,
    ArcaTaxpayerNotFoundError,
    NotImplementedError,
    type ArcaErrorEntry,
} from './core/errors.js';
export {
    normalizePem,
    ensureCertificatePem,
    ensurePrivateKeyPem,
    isValidCertificate,
    isValidPrivateKey,
    isCertificateSigningRequest,
    certificateSubjectSerialNumber,
    canonicalizeCertificatePem,
    canonicalizePrivateKeyPem,
    keyMatchesCertificatePem,
} from './core/pem/pem.js';
export {
    calculateTotals, roundToTwo, type InvoiceLineTax, type InvoiceTotals, type VatSubtotal
} from './invoicing/invoice-totals/invoice-totals.js';
export {vatRateIdForPercent, VAT_RATE_IDS} from './invoicing/vat-rate-map.js';
export {
    buildArcaQrUrl, formatArcaDate, parseArcaDate, argentinaDateParts, type ArcaQrParams
} from './invoicing/arca-qr/arca-qr.js';
export {CommonInvoiceService} from './invoicing/common/common-invoice-service/common-invoice.service.js';
export type {
    CommonInvoiceRequest,
    CommonInvoiceResult,
    InvoiceConcept,
    AssociatedVoucher,
    InvoiceOptional,
    ArcaObservation,
} from './invoicing/common/common-invoice.types.js';
export {InvoiceWebService} from './invoicing/invoice-web-service.base.js';
export {TaxpayerRegistryService} from './taxpayer-registry/taxpayer-registry.service.base.js';
// The two concrete padrón services, exported alongside their base: each owns operations the other does not
// (A13's identity-document search), and a consumer binding one to a `SoapClient` needs the concrete type.
export {ConstanciaInscripcionService} from './taxpayer-registry/constancia-inscripcion.service.js';
export {TaxpayerIdentityService} from './taxpayer-registry/taxpayer-identity.service.js';
export {
    PADRON_HOMOLOGACION_CUITS, PADRON_HOMOLOGACION_DOCUMENTS, PADRON_HOMOLOGACION_TAX_IDS
} from './taxpayer-registry/padron-homologacion-ids.js';
export type {
    PadronService,
    PadronDetail,
    PadronAddress,
    PadronActivity,
    PadronTax,
    PersonType,
    RegistrationStatus,
    TaxpayerData,
} from './taxpayer-registry/padron.types.js';
