import {TaxpayerRegistryService, type RegistryLevel} from './taxpayer-registry.service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../core/constants.js';

/**
 * Padrón A13 (`ws_sr_padron_a13`) — "constancia de inscripción" lookup, the common default for
 * validating a customer's CUIT before invoicing.
 *
 * SEED: identity is wired; implement `parseTaxpayer` to map the A13 `personaReturn` shape.
 */
export class RegistrationStatusService extends TaxpayerRegistryService {
    protected readonly level: RegistryLevel = 'A13';
    protected readonly serviceId = ServiceId.PADRON_A13;
    protected readonly namespace = Namespaces.PADRON_A13;

    protected endpoint(): string {
        return ENDPOINTS[this.environment].padronA13;
    }
}
