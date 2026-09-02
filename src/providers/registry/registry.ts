import {TaxEntityProvider} from '../provider/provider.js';
import {UnknownEntityError} from '../provider/faults.js';
import {ArcaProvider} from '../arca/arca-provider/arca.provider.js';

/** Maps an entity code to its provider. Adding a future entity means registering it here. */
const REGISTRY: ReadonlyMap<string, TaxEntityProvider> = new Map<string, TaxEntityProvider>([
    ['ARCA', new ArcaProvider()],
]);

/** The provider for `entityCode`; throws a `400` if unregistered. */
export function getProvider(entityCode: string): TaxEntityProvider {
    const provider = REGISTRY.get(entityCode);
    if (provider === undefined) {
        throw new UnknownEntityError(entityCode);
    }
    return provider;
}

/** The set of registered entity codes. */
export function registeredEntityCodes(): ReadonlyArray<string> {
    return [...REGISTRY.keys()];
}
