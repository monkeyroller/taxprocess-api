import {ArcaValidationError} from '../../sdk/core/errors.js';
import {toCbteTipo, toCondicionIvaReceptorId, toDocTipo} from './code-maps.js';

describe('code-maps (canonical code → ARCA code)', () => {
    describe('toCbteTipo (documentTypeCode → CbteTipo)', () => {
        it('is identity over the canonical document-type codes', () => {
            // A/B/C/M families.
            expect(toCbteTipo(1)).toBe(1); //   FACTURA A
            expect(toCbteTipo(6)).toBe(6); //   FACTURA B
            expect(toCbteTipo(11)).toBe(11); // FACTURA C
            expect(toCbteTipo(51)).toBe(51); // FACTURA M
            // FCE (electronic credit) A/B/C.
            expect(toCbteTipo(201)).toBe(201);
            expect(toCbteTipo(206)).toBe(206);
            expect(toCbteTipo(211)).toBe(211);
            // Codes that used to diverge from core's PK are now the canonical code itself (identity).
            expect(toCbteTipo(19)).toBe(19); // FACTURA DE EXPORTACIÓN
            expect(toCbteTipo(30)).toBe(30); // COMPROBANTE DE COMPRA DE BIENES USADOS
            expect(toCbteTipo(80)).toBe(80); // COMPROBANTE DIARIO DE CIERRE (ZETA)
            expect(toCbteTipo(95)).toBe(95); // AJUSTE CONTABLE DISMINUYE CRÉDITO FISCAL
        });

        it('rejects retired core PKs that are not canonical codes', () => {
            // The old core primary keys are gone: core sends the canonical code directly, so these are
            // unknown.
            expect(() => toCbteTipo(17)).toThrow(ArcaValidationError);
            expect(() => toCbteTipo(43)).toThrow(ArcaValidationError);
            expect(() => toCbteTipo(1001)).toThrow(ArcaValidationError);
            expect(() => toCbteTipo(1201)).toThrow(ArcaValidationError);
        });
    });

    describe('toCondicionIvaReceptorId (fiscalConditionCode → CondicionIVAReceptorId)', () => {
        it('is identity over the canonical fiscal-condition codes (RG 5616)', () => {
            for (const code of [1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16]) {
                expect(toCondicionIvaReceptorId(code)).toBe(code);
            }
        });
    });

    describe('toDocTipo (identificationTypeCode → DocTipo)', () => {
        it('is identity over the canonical identification-type codes', () => {
            for (const code of [80, 86, 87, 89, 90, 91, 94, 96, 99]) {
                expect(toDocTipo(code)).toBe(code);
            }
            expect(toDocTipo(80)).toBe(80); // CUIT
            expect(toDocTipo(96)).toBe(96); // DNI
            expect(toDocTipo(99)).toBe(99); // SIN IDENTIFICAR (consumidor final)
        });
    });

    it('throws ArcaValidationError for an unknown code', () => {
        expect(() => toCbteTipo(99999)).toThrow(ArcaValidationError);
        expect(() => toCondicionIvaReceptorId(99999)).toThrow(ArcaValidationError);
        expect(() => toDocTipo(99999)).toThrow(ArcaValidationError);
        // codes that are not in the canonical enums must be rejected, not silently accepted.
        expect(() => toDocTipo(1)).toThrow(ArcaValidationError);
        expect(() => toDocTipo(2)).toThrow(ArcaValidationError);
        expect(() => toDocTipo(3)).toThrow(ArcaValidationError);
    });
});
