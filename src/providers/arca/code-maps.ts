import {ArcaValidationError} from './sdk/index.js';

/**
 * Canonical taxprocess codes → real ARCA codes. Core sends a **provider-agnostic canonical code** for
 * each of the three fiscal ids (no longer its own DB primary keys); this service is the sole owner of the
 * translation to each provider's real codes.
 *
 * The canonical set is expressed as in-code enums (this service has no DB). For ARCA the canonical code
 * **equals** ARCA's own code, so all three translations are the identity — each function only validates
 * that the code is a known member of its domain and returns it unchanged:
 *   - documentTypeCode       → CbteTipo               (WSFEv1)
 *   - fiscalConditionCode    → CondicionIVAReceptorId (RG 5616)
 *   - identificationTypeCode → DocTipo
 * The functions are kept as the per-provider extension point: a future non-ARCA provider supplies a real
 * (non-identity) map from the same canonical enum to its own codes. See
 * docs/contract-changes/2026-08-11_taxprocess-canonical-codes.md.
 */

/**
 * Canonical document-type codes — provider-agnostic. Member **values** are the contract (core's
 * `common.document_type.fiscal_code`); member names are non-normative. For ARCA the value is already the
 * `CbteTipo`. The legacy-vs-`1xxx` core-PK duplication is gone: one entry per code.
 */
export enum TaxProcessDocumentTypeCode {
    FACTURA_A = 1,
    NOTA_DEBITO_A = 2,
    NOTA_CREDITO_A = 3,
    RECIBO_A = 4,
    NOTA_VENTA_A = 5,
    FACTURA_B = 6,
    NOTA_DEBITO_B = 7,
    NOTA_CREDITO_B = 8,
    RECIBO_B = 9,
    NOTA_VENTA_B = 10,
    FACTURA_C = 11,
    NOTA_DEBITO_C = 12,
    NOTA_CREDITO_C = 13,
    DOCUMENTO_ADUANERO = 14,
    RECIBO_C = 15,
    NOTA_VENTA_CONTADO_C = 16,
    FACTURA_EXPORTACION = 19,
    NOTA_DEBITO_EXTERIOR = 20,
    NOTA_CREDITO_EXTERIOR = 21,
    FACTURA_PERMISO_EXPORTACION_SIMPLIFICADO = 22,
    COMPRA_BIENES_USADOS = 30,
    COMPROBANTE_A_3419 = 34,
    COMPROBANTE_B_3419 = 35,
    COMPROBANTE_C_3419 = 36,
    NOTA_DEBITO_3419 = 37,
    NOTA_CREDITO_3419 = 38,
    OTROS_A_3419 = 39,
    OTROS_B_3419 = 40,
    OTROS_C_3419 = 41,
    CUENTA_VENTA_LIQUIDO_A = 60,
    CUENTA_VENTA_LIQUIDO_B = 61,
    CUENTA_VENTA_LIQUIDO_C = 62,
    LIQUIDACION_A = 63,
    LIQUIDACION_B = 64,
    LIQUIDACION_C = 65,
    CIERRE_ZETA = 80,
    TIQUE_FACTURA_A = 81,
    TIQUE_FACTURA_B = 82,
    FACTURA_SERVICIOS_PUBLICOS = 91,
    AJUSTE_INCREMENTA_DEBITO = 92,
    AJUSTE_DISMINUYE_DEBITO = 93,
    AJUSTE_INCREMENTA_CREDITO = 94,
    AJUSTE_DISMINUYE_CREDITO = 95,
    FACTURA_M = 51,
    NOTA_DEBITO_M = 52,
    NOTA_CREDITO_M = 53,
    RECIBO_M = 54,
    NOTA_VENTA_M = 55,
    FCE_FACTURA_A = 201,
    FCE_NOTA_DEBITO_A = 202,
    FCE_NOTA_CREDITO_A = 203,
    FCE_FACTURA_B = 206,
    FCE_NOTA_DEBITO_B = 207,
    FCE_NOTA_CREDITO_B = 208,
    FCE_FACTURA_C = 211,
    FCE_NOTA_DEBITO_C = 212,
    FCE_NOTA_CREDITO_C = 213,
}

/** Canonical identification-type codes — provider-agnostic. For ARCA the value is already the `DocTipo`. */
export enum TaxProcessIdentificationTypeCode {
    CUIT = 80,
    CUIL = 86,
    CDI = 87,
    LE = 89,
    LC = 90,
    CI_EXTRANJERA = 91,
    PASAPORTE = 94,
    DNI = 96,
    SIN_IDENTIFICAR = 99,
}

/**
 * Canonical fiscal-condition codes — provider-agnostic. For ARCA the value is already the
 * `CondicionIVAReceptorId` (RG 5616).
 */
export enum TaxProcessFiscalConditionCode {
    RESPONSABLE_INSCRIPTO = 1,
    SUJETO_EXENTO = 4,
    CONSUMIDOR_FINAL = 5,
    MONOTRIBUTO = 6,
    NO_CATEGORIZADO = 7,
    PROVEEDOR_EXTERIOR = 8,
    CLIENTE_EXTERIOR = 9,
    IVA_LIBERADO = 10,
    MONOTRIBUTISTA_SOCIAL = 13,
    IVA_NO_ALCANZADO = 15,
    MONOTRIBUTO_INDEP_PROMOVIDO = 16,
}

/**
 * Validates that `code` is a known member of the numeric enum `values` and returns it. Throws
 * `ArcaValidationError` (`UNKNOWN_CODE`) otherwise. Numeric TS enums are reverse-mapped, so a plain
 * membership test filters the value half of the object.
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
