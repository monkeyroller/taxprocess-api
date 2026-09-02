import type {ArcaEnvironment} from './sdk/core/constants.js';
import {SoapClient} from './sdk/core/soap-client/soap-client.js';
import {CommonInvoiceService} from './sdk/invoicing/common/common-invoice-service/common-invoice.service.js';
import {ConstanciaInscripcionService} from './sdk/taxpayer-registry/constancia-inscripcion.service.js';
import {TaxpayerIdentityService} from './sdk/taxpayer-registry/taxpayer-identity.service.js';

/**
 * Shared SDK clients. The `SoapClient` is stateless and safe to share process-wide; service instances are
 * cheap value objects constructed per request. No ticket cache lives here — auth arrives from the ticket
 * store — but that store's WSAA client reuses this same `soap`, so the process has one transport.
 *
 * The padrón factories return their concrete service types rather than the base: each owns operations the
 * other does not, and its `service` getter is what the ticket store is keyed on, so callers read the WSAA
 * service id off the instance rather than a parallel map that could drift.
 */
export const soap = new SoapClient();

export function commonInvoiceService(environment: ArcaEnvironment): CommonInvoiceService {
    return new CommonInvoiceService(soap, environment);
}

/** Constancia de inscripción (ex-alcance 5) — the taxpayer's registration/tax picture. */
export function constanciaService(environment: ArcaEnvironment): ConstanciaInscripcionService {
    return new ConstanciaInscripcionService(soap, environment);
}

/** Padrón A13 — the taxpayer's identity, plus the identity-document → clave search. */
export function taxpayerIdentityService(environment: ArcaEnvironment): TaxpayerIdentityService {
    return new TaxpayerIdentityService(soap, environment);
}
