import {ArcaValidationError} from '../../sdk/core/errors.js';
import {TaxProcessDocumentTypeCode, TaxProcessFiscalConditionCode, TaxProcessIdentificationTypeCode} from '../canonical-codes.js';

/**
 * Canonical taxprocess codes → real ARCA codes. For ARCA every translation is the identity, so each function
 * only validates that the code is a known member of its canonical domain. The functions are the per-provider
 * extension point: a non-ARCA provider supplies a real map.
 */

/**
 * Validates that `code` is a known member of the numeric enum `values` and returns it. Numeric TS enums are
 * reverse-mapped, so a plain membership test filters the value half of the object.
 */
function assertKnownCode(values: Record<string, string | number>, code: number, what: string): number {
    const known = Object.values(values).some((v) => v === code);
    if (!known) {
        throw new ArcaValidationError(`No ARCA ${what} mapping for canonical code ${code}`, 'UNKNOWN_CODE');
    }
    return code;
}

/** Maps a canonical `documentTypeCode` to the ARCA `CbteTipo` (identity). Throws if the code is unknown. */
export function toCbteTipo(documentTypeCode: number): number {
    return assertKnownCode(TaxProcessDocumentTypeCode, documentTypeCode, 'CbteTipo (documentType)');
}

/** Maps a canonical `fiscalConditionCode` to the ARCA `CondicionIVAReceptorId` (identity). Throws if unknown. */
export function toCondicionIvaReceptorId(fiscalConditionCode: number): number {
    return assertKnownCode(
        TaxProcessFiscalConditionCode,
        fiscalConditionCode,
        'CondicionIVAReceptorId (fiscalCondition)',
    );
}

/** Maps a canonical `identificationTypeCode` to the ARCA `DocTipo` (identity). Throws if the code is unknown. */
export function toDocTipo(identificationTypeCode: number): number {
    return assertKnownCode(TaxProcessIdentificationTypeCode, identificationTypeCode, 'DocTipo (identificationType)');
}

/**
 * Voucher types that must not discriminate VAT — the letter-C class, issued by Monotributo and Exento
 * taxpayers, who have no débito fiscal to report.
 *
 * For these ARCA requires `ImpIVA`, `ImpTotConc` and `ImpOpEx` all zero, no `Iva` element, and
 * `ImpTotal = ImpNeto + ImpTrib`, the whole pre-tributes amount being reported as net. Sending a breakdown
 * anyway is rejected with 10047, 10048 and 10071.
 *
 * Letter M is absent: an M voucher discriminates VAT exactly like an A. So is letter B — a Factura B does
 * not print the VAT but still reports it.
 */
export const NON_VAT_DISCRIMINATING_CBTE_TIPOS: ReadonlySet<number> = new Set<number>([
    TaxProcessDocumentTypeCode.FACTURA_C,
    TaxProcessDocumentTypeCode.NOTA_DEBITO_C,
    TaxProcessDocumentTypeCode.NOTA_CREDITO_C,
    TaxProcessDocumentTypeCode.RECIBO_C,
    TaxProcessDocumentTypeCode.NOTA_VENTA_CONTADO_C,
    TaxProcessDocumentTypeCode.COMPROBANTE_C_3419,
    TaxProcessDocumentTypeCode.OTROS_C_3419,
    TaxProcessDocumentTypeCode.CUENTA_VENTA_LIQUIDO_C,
    TaxProcessDocumentTypeCode.LIQUIDACION_C,
    TaxProcessDocumentTypeCode.FCE_FACTURA_C,
    TaxProcessDocumentTypeCode.FCE_NOTA_DEBITO_C,
    TaxProcessDocumentTypeCode.FCE_NOTA_CREDITO_C,
]);

/** Whether `cbteTipo` is a letter-C voucher, which must report no VAT breakdown at all. */
export function isNonVatDiscriminating(cbteTipo: number): boolean {
    return NON_VAT_DISCRIMINATING_CBTE_TIPOS.has(cbteTipo);
}
