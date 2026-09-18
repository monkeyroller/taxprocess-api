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

/**
 * The voucher types of the credit-invoice régimen (AR: Factura de Crédito Electrónica MiPyME), across all
 * three letters.
 *
 * A membership list for the same reason {@link NON_VAT_DISCRIMINATING_CBTE_TIPOS} is one: the régimen
 * attaches a rule to a set of types rather than to a property a caller states. Here the rule is that these
 * types, and only these, carry the `Opcionales` an FCE needs — which is what lets `mapping/credit-invoice`
 * refuse the two pairings ARCA would otherwise reject in Spanish.
 *
 * `204`, `205`, `209`, `210` are absent because ARCA does not use them; the régimen numbers each letter's
 * factura, nota de débito and nota de crédito and leaves the gaps.
 */
export const FCE_CBTE_TIPOS: ReadonlySet<number> = new Set<number>([
    TaxProcessDocumentTypeCode.FCE_FACTURA_A,
    TaxProcessDocumentTypeCode.FCE_NOTA_DEBITO_A,
    TaxProcessDocumentTypeCode.FCE_NOTA_CREDITO_A,
    TaxProcessDocumentTypeCode.FCE_FACTURA_B,
    TaxProcessDocumentTypeCode.FCE_NOTA_DEBITO_B,
    TaxProcessDocumentTypeCode.FCE_NOTA_CREDITO_B,
    TaxProcessDocumentTypeCode.FCE_FACTURA_C,
    TaxProcessDocumentTypeCode.FCE_NOTA_DEBITO_C,
    TaxProcessDocumentTypeCode.FCE_NOTA_CREDITO_C,
]);

/** Whether `cbteTipo` is a credit-invoice voucher, which must carry the `creditInvoice` block. */
export function isFceDocumentType(cbteTipo: number): boolean {
    return FCE_CBTE_TIPOS.has(cbteTipo);
}

/**
 * The FCE types exempt from stating a payment due date: the notas de crédito, across all three letters.
 *
 * The split the régimen draws is between **what falls due and what cancels**, not between facturas and
 * notas. A factura is the instrument being financed and has to say when it falls due. A nota de débito adds
 * to the same financed amount — interest, a charge — so it falls due too, and a tenant issuing one can
 * always state when. Only a nota de crédito cancels an FCE rather than extending it, so there may be
 * nothing of its own to fall due, and refusing one would cost a tenant the ability to undo a voucher.
 *
 * 10163 has been measured against a factura only. The two directions are not symmetric, which is what
 * settles the unmeasured middle: refusing wrongly is a `400` the caller clears by sending a date, while
 * letting a voucher through wrongly spends a voucher number on a relayed Spanish rejection. So an
 * unmeasured type that plausibly falls due is refused, and only the case with a real argument against it is
 * exempt. Empty this the day `pnpm probe:fecred` measures 10163 against a nota de crédito.
 */
const FCE_PAYMENT_DUE_DATE_EXEMPT_CBTE_TIPOS: ReadonlySet<number> = new Set<number>([
    TaxProcessDocumentTypeCode.FCE_NOTA_CREDITO_A,
    TaxProcessDocumentTypeCode.FCE_NOTA_CREDITO_B,
    TaxProcessDocumentTypeCode.FCE_NOTA_CREDITO_C,
]);

/**
 * The régimen's types that must state a payment due date, and the one set ARCA's `FchVtoPago` rule (10163)
 * is enforced against on our side.
 *
 * **Derived** from {@link FCE_CBTE_TIPOS} rather than listed again, so it is a subset by construction. The
 * two are read together in `invoice.mapper`, which *carries* the date for anything in `FCE_CBTE_TIPOS` and
 * *demands* it for anything in here: a type that reached this set without being in that one would have its
 * date dropped before the demand could read it, and every such voucher would be refused for a field the
 * caller did send. A hand-copied list could be walked into that; this cannot.
 *
 * It also means a future FCE code joins by being added to {@link FCE_CBTE_TIPOS} alone — and joins the
 * demanding side, which is the safe default per the exempt set's docblock.
 */
export const FCE_PAYMENT_DUE_DATE_CBTE_TIPOS: ReadonlySet<number> = new Set<number>(
    [...FCE_CBTE_TIPOS].filter((cbteTipo) => !FCE_PAYMENT_DUE_DATE_EXEMPT_CBTE_TIPOS.has(cbteTipo)),
);

/** Whether `cbteTipo` is a credit-invoice voucher ARCA requires `FchVtoPago` on (10163). */
export function requiresFcePaymentDueDate(cbteTipo: number): boolean {
    return FCE_PAYMENT_DUE_DATE_CBTE_TIPOS.has(cbteTipo);
}
