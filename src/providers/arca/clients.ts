import {CommonInvoiceService, SoapClient, type ArcaEnvironment} from './sdk/index.js';
// Concrete padrón services are not re-exported from the SDK barrel — import them directly.
import {ConstanciaInscripcionService} from './sdk/taxpayer-registry/constancia-inscripcion.service.js';
import {TaxpayerIdentityService} from './sdk/taxpayer-registry/taxpayer-identity.service.js';

/**
 * Shared SDK clients. The `SoapClient` is stateless (native `fetch`) and safe to share process-wide;
 * service instances are cheap value objects constructed per request bound to `(soap, environment)`.
 * No WSAA client / ticket cache lives here — auth arrives as an `ArcaAuth` from the ticket store —
 * but the ticket store's `WsaaClient` reuses this same `soap` so the whole process has one transport.
 *
 * The padrón factories return their CONCRETE service types, not the base: each one owns operations the
 * other does not have (A13's document search), and its `service` getter is what the ticket store is
 * keyed on — so callers read the WSAA service id off the instance rather than from a parallel map that
 * could drift.
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
