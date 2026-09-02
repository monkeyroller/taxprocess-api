import {getProvider, registeredEntityCodes} from './registry.js';
import {TaxEntityProvider} from '../provider/provider.js';
import {UnknownEntityError} from '../provider/faults.js';
import {ArcaProvider} from '../arca/arca-provider/arca.provider.js';

describe('provider registry', () => {
    it('resolves the ARCA provider', () => {
        const provider = getProvider('ARCA');
        expect(provider).toBeInstanceOf(ArcaProvider);
        expect(provider).toBeInstanceOf(TaxEntityProvider);
    });

    it('throws UnknownEntityError for an unregistered code', () => {
        expect(() => getProvider('XX')).toThrow(UnknownEntityError);
    });

    it('lists registered entity codes', () => {
        expect(registeredEntityCodes()).toContain('ARCA');
    });
});
