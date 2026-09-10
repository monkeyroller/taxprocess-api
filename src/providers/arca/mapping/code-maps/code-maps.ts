import {ArcaValidationError} from '../../sdk/core/errors.js';
import {
    ASSOCIABLE_ONLY_DOCUMENT_TYPES,
    TaxProcessDocumentTypeCode,
    TaxProcessFiscalConditionCode,
    TaxProcessIdentificationTypeCode,
} from '../canonical-codes.js';

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

/**
 * Maps a canonical `documentTypeCode` to the ARCA `CbteTipo` (identity). Throws if the code is unknown.
 *
 * **The voucher being authorized**, which is why it does not accept the associable-only remitos: `88` as a
 * `documentTypeCode` is a caller mistake worth a `400`, and letting it through here to be refused by the
 * authority is exactly what the canonical membership check exists to prevent.
 */
export function toCbteTipo(documentTypeCode: number): number {
    return assertKnownCode(TaxProcessDocumentTypeCode, documentTypeCode, 'CbteTipo (documentType)');
}

/**
 * The same translation for a code appearing in `associatedVouchers`, which admits a **wider** set.
 *
 * A referenced voucher may be an ordinary document — the invoice a credit note adjusts — or one of the
 * remitos of {@link ASSOCIABLE_ONLY_DOCUMENT_TYPES}, which no invoicing service authorizes and which
 * therefore are not document types a caller could ever send as the voucher's own.
 *
 * Separate from `toCbteTipo` rather than a widened version of it: collapsing the two would make `88` a
 * valid thing to authorize, and keeping only the narrow one is the bug this replaces — a tobacco remito,
 * which ARCA accepts and 10227 can *require*, was refused here before the request was ever built.
 *
 * **Which** remito may accompany **which** voucher is not checked. That grid turns on the referenced point
 * of sale being electronic and on the issuer's declared activities (10225–10229), neither of which this
 * service knows, so the pairing stays the authority's to reject.
 */
export function toAssociatedCbteTipo(documentTypeCode: number): number {
    if (ASSOCIABLE_ONLY_DOCUMENT_TYPES.has(documentTypeCode)) {
        return documentTypeCode;
    }
    return assertKnownCode(
        TaxProcessDocumentTypeCode,
        documentTypeCode,
        'CbteTipo (associatedVouchers[].documentType)',
    );
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
