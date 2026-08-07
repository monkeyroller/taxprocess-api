import {
    CommonInvoiceService,
    ServiceId,
    SoapClient,
    type ArcaEnvironment,
    type RegistryLevel,
    type ServiceIdValue,
    type TaxpayerRegistryService,
} from './sdk/index.js';
// Concrete padrón services are not re-exported from the SDK barrel — import them directly.
import {BasicTaxpayerService} from './sdk/taxpayer-registry/basic-taxpayer.service.js';
import {DetailedTaxpayerService} from './sdk/taxpayer-registry/detailed-taxpayer.service.js';
import {TaxpayerRelationsService} from './sdk/taxpayer-registry/taxpayer-relations.service.js';
import {RegistrationStatusService} from './sdk/taxpayer-registry/registration-status.service.js';

/**
 * Shared SDK clients. The `SoapClient` is stateless (native `fetch`) and safe to share process-wide;
 * service instances are cheap value objects constructed per request bound to `(soap, environment)`.
 * No WSAA client / ticket cache lives here — auth arrives as an `ArcaAuth` from the ticket store —
 * but the ticket store's `WsaaClient` reuses this same `soap` so the whole process has one transport.
 */
export const soap = new SoapClient();

export function commonInvoiceService(environment: ArcaEnvironment): CommonInvoiceService {
    return new CommonInvoiceService(soap, environment);
}

/** ARCA WSAA service id for a padrón level (the ticket-store key for lookups). */
const PADRON_SERVICE_ID: Readonly<Record<RegistryLevel, ServiceIdValue>> = {
    A4: ServiceId.PADRON_A4,
    A5: ServiceId.PADRON_A5,
    A10: ServiceId.PADRON_A10,
    A13: ServiceId.PADRON_A13,
};

export function padronServiceId(level: RegistryLevel): ServiceIdValue {
    return PADRON_SERVICE_ID[level];
}

export function padronService(environment: ArcaEnvironment, level: RegistryLevel): TaxpayerRegistryService {
    switch (level) {
        case 'A4':
            return new BasicTaxpayerService(soap, environment);
        case 'A5':
            return new DetailedTaxpayerService(soap, environment);
        case 'A10':
            return new TaxpayerRelationsService(soap, environment);
        case 'A13':
            return new RegistrationStatusService(soap, environment);
    }
}
