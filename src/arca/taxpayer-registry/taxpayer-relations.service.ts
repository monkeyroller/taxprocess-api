import {TaxpayerRegistryService, type RegistryLevel} from './taxpayer-registry.service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../core/constants.js';

/**
 * Padrón A10 (`ws_sr_padron_a10`) — relaciones/roles associated with a CUIT (legal representatives,
 * apoderados), i.e. representation data rather than plain identity.
 *
 * SEED: identity is wired; implement `parseTaxpayer` to map the A10 `personaReturn` shape.
 */
export class TaxpayerRelationsService extends TaxpayerRegistryService {
    protected readonly level: RegistryLevel = 'A10';
    protected readonly serviceId = ServiceId.PADRON_A10;
    protected readonly namespace = Namespaces.PADRON_A10;

    protected endpoint(): string {
        return ENDPOINTS[this.environment].padronA10;
    }
}
