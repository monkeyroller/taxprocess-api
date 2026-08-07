import {SoapClient} from '../core/soap-client.js';
import {NotImplementedError} from '../core/errors.js';
import type {ArcaEnvironment} from '../core/constants.js';
import type {ArcaAuth} from '../core/types.js';

/**
 * Shared base for the ARCA padrón "consulta de persona" web services (levels A4/A5/A10/A13).
 *
 * All four expose the same SOAP operation shape — `getPersona(token, sign, cuitRepresentada,
 * idPersona)` — and differ only in how much taxpayer data they return, which is exactly why they
 * belong under one base parameterized by {@link RegistryLevel}. The base owns the SOAP call; each
 * level fills its identity (`level`, `serviceId`, `namespace`, `endpoint`) and its `parseTaxpayer`.
 *
 * Each level also requires its own delegated permission on the certificate in ARCA's Administrador
 * de Relaciones, and its own WSAA ticket (keyed by `serviceId`).
 */

export type RegistryLevel = 'A4' | 'A5' | 'A10' | 'A13';

/** Normalized taxpayer data. `raw` carries the full level-specific response for callers that need more. */
export interface TaxpayerData {
    idPersona: number;
    /** CUIT/CUIL as returned by the service. */
    taxId?: string;
    /** Legal or full name, when the level returns it. */
    name?: string;
    raw: Record<string, unknown>;
}

export abstract class TaxpayerRegistryService {
    protected abstract readonly level: RegistryLevel;
    /** ARCA service id, e.g. `"ws_sr_padron_a5"`. */
    protected abstract readonly serviceId: string;
    protected abstract readonly namespace: string;

    constructor(
        protected readonly soap: SoapClient,
        protected readonly environment: ArcaEnvironment,
    ) {}

    protected abstract endpoint(): string;

    /** ARCA service id this instance authenticates against — used to request the WSAA ticket. */
    get service(): string {
        return this.serviceId;
    }

    /** Looks up a taxpayer by CUIT/CUIL. All levels use the SOAP `getPersona` operation. */
    async getTaxpayer(auth: ArcaAuth, taxpayerId: number): Promise<TaxpayerData> {
        const response = await this.soap.call(this.endpoint(), this.namespace, 'getPersona', {
            token: auth.token,
            sign: auth.sign,
            cuitRepresentada: auth.cuit,
            idPersona: taxpayerId,
        });
        return this.parseTaxpayer(response);
    }

    protected parseTaxpayer(_result: Record<string, unknown>): TaxpayerData {
        throw new NotImplementedError(`${this.constructor.name}.getTaxpayer`);
    }
}
