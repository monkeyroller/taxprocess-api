import {toArcaEnvironment, toGenericEnvironment} from './environment.js';

describe('environment mapping', () => {
    it('maps generic → ARCA', () => {
        expect(toArcaEnvironment('production')).toBe('produccion');
        expect(toArcaEnvironment('testing')).toBe('homologacion');
    });

    it('maps ARCA → generic', () => {
        expect(toGenericEnvironment('produccion')).toBe('production');
        expect(toGenericEnvironment('homologacion')).toBe('testing');
    });

    it('round-trips', () => {
        expect(toGenericEnvironment(toArcaEnvironment('production'))).toBe('production');
        expect(toGenericEnvironment(toArcaEnvironment('testing'))).toBe('testing');
    });
});
