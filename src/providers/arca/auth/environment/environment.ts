import type {ArcaEnvironment} from '../../sdk/core/constants.js';
import type {GenericEnvironment} from '../../../provider/environment.js';

/**
 * Maps the neutral wire environment to ARCA's own vocabulary, kept inside the provider so
 * `homologacion`/`produccion` never leak into the contract.
 */
export function toArcaEnvironment(environment: GenericEnvironment): ArcaEnvironment {
    return environment === 'production' ? 'produccion' : 'homologacion';
}

/** The inverse mapping. */
export function toGenericEnvironment(environment: ArcaEnvironment): GenericEnvironment {
    return environment === 'produccion' ? 'production' : 'testing';
}
