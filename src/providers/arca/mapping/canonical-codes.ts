/**
 * The provider-agnostic canonical code vocabulary. Core sends one of these for each of the three fiscal ids,
 * and this service is the sole owner of translating them to each provider's real codes:
 *
 *   - documentTypeCode       → CbteTipo               (WSFEv1)
 *   - fiscalConditionCode    → CondicionIVAReceptorId (RG 5616)
 *   - identificationTypeCode → DocTipo
 *
 * In-code enums because this service has no DB, and here rather than beside a provider because the set
 * belongs to none: `code-maps.ts` holds ARCA's translation of it, the identity, and a non-ARCA provider
 * supplies a real map from these same enums. The fourth canonical code, `currencyCode`, is a string
 * catalogue rather than an enum.
 */

/**
 * Canonical document-type codes. Member values are the contract; member names are non-normative. For ARCA
 * the value is already the `CbteTipo`.
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

/** Canonical identification-type codes. For ARCA the value is already the `DocTipo`. */
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

/** Canonical fiscal-condition codes. For ARCA the value is already the `CondicionIVAReceptorId`. */
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
