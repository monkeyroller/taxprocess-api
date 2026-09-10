import {ArcaValidationError} from '../../sdk/core/errors.js';
import {toAssociatedCbteTipo, toCbteTipo, toCondicionIvaReceptorId, toDocTipo} from './code-maps.js';

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
            expect(toCbteTipo(49)).toBe(49); // COMPRA DE BIENES USADOS A CONSUMIDOR FINAL
            expect(toCbteTipo(80)).toBe(80); // COMPROBANTE DIARIO DE CIERRE (ZETA)
            expect(toCbteTipo(95)).toBe(95); // AJUSTE CONTABLE DISMINUYE CRÉDITO FISCAL
        });

        it('numbers the used-goods voucher 49, which is what the authority publishes', () => {
            // It was 30 here, a code `FEParamGetTiposCbte` does not return — measured against production,
            // where the row reads `49 Comprobante de Compra de Bienes Usados a Consumidor Final`. Wrong in
            // both directions: 30 passed this check and ARCA refused it, 49 was refused before ARCA saw it.
            expect(toCbteTipo(49)).toBe(49);
            expect(() => toCbteTipo(30)).toThrow(ArcaValidationError);
        });

        it('refuses a remito, which is referenced and never authorized', () => {
            // `91` sat in the document-type enum as `FACTURA_SERVICIOS_PUBLICOS`, which it is not: WSFEX
            // 1754 names it Remito R. Authorizing one is not a thing, so the narrow check refuses all of
            // them and `toAssociatedCbteTipo` is where they belong.
            for (const remito of [88, 89, 91, 993, 994, 995]) {
                expect(() => toCbteTipo(remito)).toThrow(ArcaValidationError);
            }
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

    describe('toAssociatedCbteTipo (associatedVouchers[].documentTypeCode → CbteTipo)', () => {
        it('accepts the remitos a voucher may reference', () => {
            // The bug this replaces: each of these is associable per WSFEv1 10120/10157 and WSFEX 1749, and
            // every one of them was refused locally with UNKNOWN_CODE before the request was built — so the
            // tobacco association 10227 can *require* could not be sent at all.
            for (const remito of [88, 89, 91, 988, 990, 991, 993, 994, 995, 996, 997]) {
                expect(toAssociatedCbteTipo(remito)).toBe(remito);
            }
        });

        it('still accepts an ordinary document, which is the common case', () => {
            // A credit note references the invoice it adjusts; that is a document type like any other.
            expect(toAssociatedCbteTipo(1)).toBe(1);
            expect(toAssociatedCbteTipo(19)).toBe(19);
            expect(toAssociatedCbteTipo(201)).toBe(201);
        });

        it('is wider than toCbteTipo, not a replacement for it', () => {
            // If these two ever agree on 88, authorizing a remito has become expressible.
            expect(toAssociatedCbteTipo(88)).toBe(88);
            expect(() => toCbteTipo(88)).toThrow(ArcaValidationError);
        });

        it('rejects a code that is neither', () => {
            expect(() => toAssociatedCbteTipo(30)).toThrow(ArcaValidationError);
            expect(() => toAssociatedCbteTipo(99999)).toThrow(ArcaValidationError);
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
