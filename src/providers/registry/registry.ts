import {TaxEntityProvider, UnknownEntityError} from '../provider/provider.js';
import {ArcaProvider} from '../arca/arca-provider/arca.provider.js';

/**
 * The provider registry: maps an entity code to its {@link TaxEntityProvider}. Controllers dispatch on
 * the request's `entityCode` via {@link getProvider}. Adding a future entity = register it here.
 */
const REGISTRY: ReadonlyMap<string, TaxEntityProvider> = new Map<string, TaxEntityProvider>([
    ['ARCA', new ArcaProvider()],
]);

/** Returns the provider for `entityCode`, or throws {@link UnknownEntityError} (→ `400`) if unregistered. */
export function getProvider(entityCode: string): TaxEntityProvider {
    const provider = REGISTRY.get(entityCode);
    if (provider === undefined) {
        throw new UnknownEntityError(entityCode);
    }
    return provider;
}

/** The set of registered entity codes (for diagnostics / listing). */
export function registeredEntityCodes(): ReadonlyArray<string> {
    return [...REGISTRY.keys()];
}
