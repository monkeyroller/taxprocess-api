import type {ArcaEnvironment} from '../sdk/index.js';
import type {GenericEnvironment} from '../../provider.js';

/**
 * Maps the neutral wire environment to ARCA's own vocabulary — kept inside the AR provider so
 * `homologacion`/`produccion` never leak into the contract (which speaks `production`/`testing`).
 */
export function toArcaEnvironment(environment: GenericEnvironment): ArcaEnvironment {
    return environment === 'production' ? 'produccion' : 'homologacion';
}

/** Inverse of {@link toArcaEnvironment}. */
export function toGenericEnvironment(environment: ArcaEnvironment): GenericEnvironment {
    return environment === 'produccion' ? 'production' : 'testing';
}
