import {ArcaValidationError} from './sdk/index.js';
import {toCbteTipo, toCondicionIvaReceptorId, toDocTipo} from './code-maps.js';

describe('code-maps (id → ARCA code)', () => {
    describe('toCbteTipo (documentType → CbteTipo)', () => {
        it('maps the core document_type PK to Number(arca_code)', () => {
            // A/B/C/M families where the legacy id equals the code.
            expect(toCbteTipo(1)).toBe(1); //   FACTURA A
            expect(toCbteTipo(6)).toBe(6); //   FACTURA B
            expect(toCbteTipo(11)).toBe(11); // FACTURA C
            expect(toCbteTipo(51)).toBe(51); // FACTURA M
            // FCE (electronic credit) A/B/C.
            expect(toCbteTipo(201)).toBe(201);
            expect(toCbteTipo(206)).toBe(206);
            expect(toCbteTipo(211)).toBe(211);
        });

        it('maps ids whose PK differs from the ARCA code', () => {
            expect(toCbteTipo(17)).toBe(19); // FACTURA DE EXPORTACIÓN
            expect(toCbteTipo(21)).toBe(30); // COMPROBANTE DE COMPRA DE BIENES USADOS
            expect(toCbteTipo(36)).toBe(80); // COMPROBANTE DIARIO DE CIERRE (ZETA)
            expect(toCbteTipo(43)).toBe(95); // AJUSTE CONTABLE DISMINUYE CRÉDITO FISCAL
        });

        it('maps the 1xxx catalog id-set to the same ARCA codes', () => {
            expect(toCbteTipo(1001)).toBe(1); //    FACTURA A
            expect(toCbteTipo(1006)).toBe(6); //    FACTURA B
            expect(toCbteTipo(1011)).toBe(11); //   FACTURA C
            expect(toCbteTipo(1201)).toBe(201); //  FCE A
            expect(toCbteTipo(1213)).toBe(213); //  NC ELECT. C
        });
    });

    describe('toCondicionIvaReceptorId (fiscalCondition → CondicionIVAReceptorId)', () => {
        it('is identity over the seeded fiscal_condition PKs (RG 5616)', () => {
            for (const id of [1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16]) {
                expect(toCondicionIvaReceptorId(id)).toBe(id);
            }
        });
    });

    describe('toDocTipo (identificationType → DocTipo)', () => {
        it('is identity over the seeded identification_type PKs (== iso_code)', () => {
            for (const id of [80, 86, 87, 89, 90, 91, 94, 96, 99]) {
                expect(toDocTipo(id)).toBe(id);
            }
            expect(toDocTipo(80)).toBe(80); // CUIT
            expect(toDocTipo(96)).toBe(96); // DNI
            expect(toDocTipo(99)).toBe(99); // SIN IDENTIFICAR (consumidor final)
        });
    });

    it('throws ArcaValidationError for an unmapped id', () => {
        expect(() => toCbteTipo(99999)).toThrow(ArcaValidationError);
        expect(() => toCondicionIvaReceptorId(99999)).toThrow(ArcaValidationError);
        expect(() => toDocTipo(99999)).toThrow(ArcaValidationError);
        // ids that do NOT exist in the real catalogs must be rejected, not silently accepted.
        expect(() => toDocTipo(1)).toThrow(ArcaValidationError); // old provisional guess
        expect(() => toDocTipo(2)).toThrow(ArcaValidationError);
        expect(() => toDocTipo(3)).toThrow(ArcaValidationError);
    });
});
