import {
    CommonInvoiceService,
    ServiceId,
    SoapClient,
    type ArcaEnvironment,
    type RegistryLevel,
    type ServiceIdValue,
    type TaxpayerRegistryService,
} from './arca/index.js';
// Concrete padrón services are not re-exported from the SDK barrel — import them directly.
import {BasicTaxpayerService} from './arca/taxpayer-registry/basic-taxpayer.service.js';
import {DetailedTaxpayerService} from './arca/taxpayer-registry/detailed-taxpayer.service.js';
import {TaxpayerRelationsService} from './arca/taxpayer-registry/taxpayer-relations.service.js';
import {RegistrationStatusService} from './arca/taxpayer-registry/registration-status.service.js';

/**
 * Shared SDK clients. The `SoapClient` is stateless (native `fetch`) and safe to share; service
 * instances are cheap value objects constructed per request bound to `(soap, environment)`. No WSAA
 * client / ticket cache lives in the SDK here — auth arrives as an `ArcaAuth` from the ticket store.
 */
const soap = new SoapClient();

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
