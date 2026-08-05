import {TaxpayerRegistryService, type RegistryLevel} from './taxpayer-registry.service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../core/constants.js';

/**
 * Padrón A4 (`ws_sr_padron_a4`) — legacy/basic taxpayer lookup by CUIT (name, tax status).
 * Largely superseded by A5; kept for completeness.
 *
 * SEED: identity is wired; implement `parseTaxpayer` to map the A4 `personaReturn` shape.
 */
export class BasicTaxpayerService extends TaxpayerRegistryService {
    protected readonly level: RegistryLevel = 'A4';
    protected readonly serviceId = ServiceId.PADRON_A4;
    protected readonly namespace = Namespaces.PADRON_A4;

    protected endpoint(): string {
        return ENDPOINTS[this.environment].padronA4;
    }
}
