import {ArcaValidationError} from '../../sdk/core/errors.js';
import {identificationTypeForClaveKind, toPadronService} from './padron-routing.js';

describe('padron-routing (identification type → padrón service)', () => {
    describe('toPadronService', () => {
        it('sends a clave tributaria to the constancia service', () => {
            for (const code of [80, 86, 87]) {
                expect(toPadronService(code)).toBe('CONSTANCIA');
            }
        });

        it('sends an identity document to A13, the only service that can resolve one', () => {
            for (const code of [96, 89, 90]) {
                expect(toPadronService(code)).toBe('A13');
            }
        });

        it('refuses the identification types no padrón service can answer for', () => {
            // ARCA's document search takes a bare number with no type, so a passport or foreign CI cannot
            // be routed; 99 names no person at all. Caller-fixable, hence its own reason code.
            for (const code of [91, 94, 99]) {
                expect(() => toPadronService(code)).toThrow(ArcaValidationError);
                expect(() => toPadronService(code)).toThrow(/padrón service/);
            }
        });

        it('reports an entirely unknown code as UNKNOWN_CODE, not as an unroutable type', () => {
            try {
                toPadronService(1234);
                throw new Error('expected a validation error');
            } catch (err) {
                expect((err as {code?: string}).code).toBe('UNKNOWN_CODE');
            }
        });
    });

    describe('identificationTypeForClaveKind (tipoClave → identificationTypeCode)', () => {
        it('maps the three clave kinds ARCA reports', () => {
            expect(identificationTypeForClaveKind('CUIT')).toBe(80);
            expect(identificationTypeForClaveKind('CUIL')).toBe(86);
            expect(identificationTypeForClaveKind('CDI')).toBe(87);
        });

        it('tolerates the spacing and casing of a free-text field', () => {
            expect(identificationTypeForClaveKind(' cuit ')).toBe(80);
        });

        it('reports nothing instead of throwing — this reads registry data, not caller input', () => {
            // The mirror of toDocTipo: an unknown code from a CALLER is their error, but an unexpected
            // string from ARCA must not fail a lookup that otherwise succeeded.
            expect(identificationTypeForClaveKind(undefined)).toBeUndefined();
            expect(identificationTypeForClaveKind('')).toBeUndefined();
            expect(identificationTypeForClaveKind('DNI')).toBeUndefined();
        });
    });

});
