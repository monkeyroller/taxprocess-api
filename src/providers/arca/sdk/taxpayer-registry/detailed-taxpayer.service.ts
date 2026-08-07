import {TaxpayerRegistryService, type RegistryLevel} from './taxpayer-registry.service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../core/constants.js';

/**
 * Padrón A5 (`ws_sr_padron_a5`) — detailed taxpayer data: identity, fiscal addresses, registered
 * taxes, monotributo category, activities. The richest general-purpose lookup.
 *
 * SEED: identity is wired; implement `parseTaxpayer` to map the A5 `personaReturn` shape.
 */
export class DetailedTaxpayerService extends TaxpayerRegistryService {
    protected readonly level: RegistryLevel = 'A5';
    protected readonly serviceId = ServiceId.PADRON_A5;
    protected readonly namespace = Namespaces.PADRON_A5;

    protected endpoint(): string {
        return ENDPOINTS[this.environment].padronA5;
    }
}
