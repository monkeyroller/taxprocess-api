import {ArcaValidationError} from './sdk/index.js';

/**
 * AR id→real-code maps: translate core's own generic ids into the codes ARCA's WSFEv1 expects. This
 * service is the sole owner of this mapping (core stops resolving ARCA codes and sends its ids instead).
 *
 * Seeded from an authoritative dump of core's `common` catalogs at migration time, so the translation
 * reproduces core's previous behavior exactly (core used to send `Number(document_type.arca_code)`,
 * `contributor_type.fiscal_condition_id`, and `Number(identification_type.iso_code)`):
 *   - documentTypeId       ← common.document_type.id      → Number(arca_code)   (→ CbteTipo)
 *   - fiscalConditionId    ← common.fiscal_condition.id                         (→ CondicionIVAReceptorId,
 *                                                                                 RG 5616; the PK equals
 *                                                                                 the AFIP code, so identity)
 *   - identificationTypeId ← common.identification_type.id → Number(iso_code)   (→ DocTipo)
 * See docs/tax-api-generalization-handoff.md (H2).
 */

/**
 * core `documentTypeId` → ARCA `CbteTipo`. Key is the `common.document_type` PK; value is that row's
 * `Number(arca_code)`. NOTE the id and the code are NOT equal in general (e.g. 17→19, 21→30, 36→80).
 * Only fiscal document types (rows with a non-null `arca_code`) are mapped; non-fiscal internal types
 * (remito, presupuesto, …) have no ARCA code and are intentionally absent (they never reach WSFEv1).
 * Both catalog id-sets that carry an `arca_code` are included — the legacy 1–213 rows and the 1xxx
 * rows — so whichever id core references resolves to the same CbteTipo it sent before.
 */
const DOCUMENT_TYPE_TO_CBTE_TIPO: Readonly<Record<number, number>> = {
    // --- legacy id-set (id == arca_code for A/B/C/M families; diverges for export/RG-3419/etc.) ---
    1: 1, //    FACTURA A
    2: 2, //    NOTA DE DÉBITO A
    3: 3, //    NOTA DE CRÉDITO A
    4: 4, //    RECIBO A
    5: 5, //    NOTA DE VENTA A
    6: 6, //    FACTURA B
    7: 7, //    NOTA DE DÉBITO B
    8: 8, //    NOTA DE CRÉDITO B
    9: 9, //    RECIBO B
    10: 10, //  NOTA DE VENTA B
    11: 11, //  FACTURA C
    12: 12, //  NOTA DE DÉBITO C
    13: 13, //  NOTA DE CRÉDITO C
    14: 14, //  DOCUMENTO ADUANERO
    15: 15, //  RECIBO C
    16: 16, //  NOTA DE VENTA AL CONTADO C
    17: 19, //  FACTURA DE EXPORTACIÓN            (id ≠ code)
    18: 20, //  NOTA DE DÉBITO OPERACIONES EXTERIOR (id ≠ code)
    19: 21, //  NOTA DE CRÉDITO OPERACIONES EXTERIOR (id ≠ code)
    20: 22, //  FACTURA - PERMISO EXPORTACIÓN SIMPLIFICADO (id ≠ code)
    21: 30, //  COMPROBANTE DE COMPRA DE BIENES USADOS (id ≠ code)
    22: 34, //  COMPROBANTE A ART.3 INC.E) RG 3419 (id ≠ code)
    23: 35, //  COMPROBANTE B ART.3 INC.E) RG 3419 (id ≠ code)
    24: 36, //  COMPROBANTE C ART.3 INC.E) RG 3419 (id ≠ code)
    25: 37, //  NC/ND EQUIVALENTE RG 3419 (id ≠ code)
    26: 38, //  NC/ND EQUIVALENTE RG 3419 (id ≠ code)
    27: 39, //  OTROS COMPROBANTES A RG 3419 (id ≠ code)
    28: 40, //  OTROS COMPROBANTES B RG 3419 (id ≠ code)
    29: 41, //  OTROS COMPROBANTES C RG 3419 (id ≠ code)
    30: 60, //  CUENTA VENTA Y LÍQUIDO PRODUCTO A (id ≠ code)
    31: 61, //  CUENTA VENTA Y LÍQUIDO PRODUCTO B (id ≠ code)
    32: 62, //  CUENTA VENTA Y LÍQUIDO PRODUCTO C (id ≠ code)
    33: 63, //  LIQUIDACIÓN A (id ≠ code)
    34: 64, //  LIQUIDACIÓN B (id ≠ code)
    35: 65, //  LIQUIDACIÓN C (id ≠ code)
    36: 80, //  COMPROBANTE DIARIO DE CIERRE (ZETA) (id ≠ code)
    37: 81, //  TIQUE-FACTURA A (id ≠ code)
    38: 82, //  TIQUE-FACTURA B (id ≠ code)
    39: 91, //  COMPROBANTE/FACTURA SERVICIOS PÚBLICOS (id ≠ code)
    40: 92, //  AJUSTE CONTABLE INCREMENTA DÉBITO FISCAL (id ≠ code)
    41: 93, //  AJUSTE CONTABLE DISMINUYE DÉBITO FISCAL (id ≠ code)
    42: 94, //  AJUSTE CONTABLE INCREMENTA CRÉDITO FISCAL (id ≠ code)
    43: 95, //  AJUSTE CONTABLE DISMINUYE CRÉDITO FISCAL (id ≠ code)
    51: 51, //  FACTURA M
    52: 52, //  NOTA DE DÉBITO M
    53: 53, //  NOTA DE CRÉDITO M
    54: 54, //  RECIBO M
    55: 55, //  NOTA DE VENTA M
    201: 201, // FACTURA CRED. ELECT. A (FCE A)
    202: 202, // NOTA DÉBITO ELECT. A
    203: 203, // NOTA CRÉDITO ELECT. A
    206: 206, // FACTURA CRED. ELECT. B (FCE B)
    207: 207, // NOTA DÉBITO ELECT. B
    208: 208, // NOTA CRÉDITO ELECT. B
    211: 211, // FACTURA CRED. ELECT. C (FCE C)
    212: 212, // NOTA DÉBITO ELECT. C
    213: 213, // NOTA CRÉDITO ELECT. C
    // --- 1xxx id-set (same ARCA codes, different core PKs) ---
    1001: 1, //   FACTURA A
    1002: 2, //   NOTA DE DÉBITO A
    1003: 3, //   NOTA DE CRÉDITO A
    1006: 6, //   FACTURA B
    1007: 7, //   NOTA DE DÉBITO B
    1008: 8, //   NOTA DE CRÉDITO B
    1011: 11, //  FACTURA C
    1012: 12, //  NOTA DE DÉBITO C
    1013: 13, //  NOTA DE CRÉDITO C
    1051: 51, //  FACTURA M
    1052: 52, //  NOTA DE DÉBITO M
    1053: 53, //  NOTA DE CRÉDITO M
    1201: 201, // FACTURA CRED. ELECT. A (FCE A)
    1202: 202, // NOTA DÉBITO ELECT. A
    1203: 203, // NOTA CRÉDITO ELECT. A
    1206: 206, // FACTURA CRED. ELECT. B (FCE B)
    1207: 207, // NOTA DÉBITO ELECT. B
    1208: 208, // NOTA CRÉDITO ELECT. B
    1211: 211, // FACTURA CRED. ELECT. C (FCE C)
    1212: 212, // NOTA DÉBITO ELECT. C
    1213: 213, // NOTA CRÉDITO ELECT. C
};

/**
 * core `fiscalConditionId` → ARCA `CondicionIVAReceptorId` (RG 5616). The `common.fiscal_condition` PKs
 * equal the AFIP `CondicionIVAReceptorId`, so this is an identity map over the seeded PK set.
 */
const FISCAL_CONDITION_TO_IVA_RECEPTOR: Readonly<Record<number, number>> = {
    1: 1, //   IVA Responsable Inscripto
    4: 4, //   IVA Sujeto Exento
    5: 5, //   Consumidor Final
    6: 6, //   Responsable Monotributo
    7: 7, //   Sujeto no Categorizado
    8: 8, //   Proveedor del Exterior
    9: 9, //   Cliente del Exterior
    10: 10, // IVA Liberado – Ley Nº 19.640
    13: 13, // Monotributista Social
    15: 15, // IVA No Alcanzado
    16: 16, // Monotributo Trabajador Independiente Promovido
};

/**
 * core `identificationTypeId` → ARCA `DocTipo`. The `common.identification_type` PKs equal their
 * `iso_code` (which is the AFIP DocTipo), so this is an identity map over the seeded PK set
 * (80 = CUIT, 96 = DNI, 99 = SIN IDENTIFICAR / consumidor final anónimo).
 */
const IDENTIFICATION_TYPE_TO_DOC_TIPO: Readonly<Record<number, number>> = {
    80: 80, // CUIT
    86: 86, // CUIL
    87: 87, // CDI
    89: 89, // LE
    90: 90, // LC
    91: 91, // CI EXTRANJERA
    94: 94, // PASAPORTE
    96: 96, // DNI
    99: 99, // SIN IDENTIFICAR (consumidor final anónimo)
};

function resolve(map: Readonly<Record<number, number>>, id: number, what: string): number {
    if (!Object.hasOwn(map, id)) {
        throw new ArcaValidationError(`No ARCA ${what} mapping for id ${id}`, 'UNMAPPED_ID');
    }
    return map[id];
}

/** Maps a core `documentTypeId` to the ARCA `CbteTipo`. Throws `ArcaValidationError` if unmapped. */
export function toCbteTipo(documentTypeId: number): number {
    return resolve(DOCUMENT_TYPE_TO_CBTE_TIPO, documentTypeId, 'CbteTipo (documentType)');
}

/** Maps a core `fiscalConditionId` to the ARCA `CondicionIVAReceptorId`. Throws if unmapped. */
export function toCondicionIvaReceptorId(fiscalConditionId: number): number {
    return resolve(FISCAL_CONDITION_TO_IVA_RECEPTOR, fiscalConditionId, 'CondicionIVAReceptorId (fiscalCondition)');
}

/** Maps a core `identificationTypeId` to the ARCA `DocTipo`. Throws if unmapped. */
export function toDocTipo(identificationTypeId: number): number {
    return resolve(IDENTIFICATION_TYPE_TO_DOC_TIPO, identificationTypeId, 'DocTipo (identificationType)');
}
