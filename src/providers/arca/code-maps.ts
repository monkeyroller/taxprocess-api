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
 * (non-identity) map from the same canonical enum to its own codes. See the canonical-code glossary in
 * docs/CONTRACT.md.
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

/**
 * Voucher types that must NOT discriminate VAT — the "letter C" class, issued by Monotributo and Exento
 * taxpayers, who have no débito fiscal to report.
 *
 * For these ARCA requires `ImpIVA = 0`, `ImpTotConc = 0`, `ImpOpEx = 0`, no `Iva` element at all, and
 * `ImpTotal = ImpNeto + ImpTrib` — i.e. the whole pre-tributes amount is reported as net, because for a
 * type C there is no VAT to separate out. Sending a breakdown anyway is rejected with observations 10047
 * (ImpIVA must be zero), 10048 (ImpTotal must equal ImpNeto + ImpTrib) and 10071 (the Iva object must not
 * be reported).
 *
 * Derived from the letter-C members of {@link TaxProcessDocumentTypeCode}. Letter M is deliberately absent:
 * an M voucher discriminates VAT exactly like an A. Letter B is absent too — a Factura B does not PRINT the
 * VAT but still reports it.
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
 * ARCA's `tipoClave` wording → the canonical `identificationTypeCode`, so a taxpayer row can say which
 * kind of identifier it is keyed by (core's CONTRACT-REQUESTS ask 5). This runs the **opposite** direction
 * from {@link toDocTipo}: that one validates a code a caller sent us, this one interprets a string the
 * registry sent back.
 *
 * It therefore never throws. An unrecognized or missing `tipoClave` yields `undefined` and the key is
 * omitted — the row keeps its `identificationNumber`, and claiming a type ARCA did not state would be
 * worse than leaving core to its existing fallback.
 */
const IDENTIFICATION_TYPE_BY_CLAVE_KIND: ReadonlyMap<string, TaxProcessIdentificationTypeCode> = new Map([
    ['CUIT', TaxProcessIdentificationTypeCode.CUIT],
    ['CUIL', TaxProcessIdentificationTypeCode.CUIL],
    ['CDI', TaxProcessIdentificationTypeCode.CDI],
]);

/** The canonical identification type for an ARCA `tipoClave` (`"CUIT"`/`"CUIL"`/`"CDI"`), if it names one. */
export function identificationTypeForClaveKind(
    claveKind: string | undefined,
): TaxProcessIdentificationTypeCode | undefined {
    if (claveKind === undefined) {
        return undefined;
    }
    return IDENTIFICATION_TYPE_BY_CLAVE_KIND.get(claveKind.trim().toUpperCase());
}

/**
 * Routes a canonical `identificationTypeCode` to the ARCA padrón service that can answer for it — the
 * padrón analogue of the code translations above, and the reason `/taxpayers/lookup` needs no explicit
 * "which service" knob on the wire.
 *
 * A **clave tributaria** (CUIT/CUIL/CDI) can be asked of a padrón as it stands, and goes to the constancia
 * service, which returns the registration picture. What this returns is where a clave lookup *begins*, not
 * which padrón ends up answering: the constancia holds only claves with an inscripción, so a miss there
 * falls back to A13 (`ArcaProvider.claveFor`), and the reply can come back as either `detail`.
 *
 * An **identity document** (DNI/LE/LC) is not a clave at all, so it goes to A13, the only padrón service
 * that can resolve a document number to the claves issued for it.
 *
 * Passport, foreign CI and "sin identificar" are refused: ARCA's `getIdPersonaListByDocumento` takes a
 * bare number with no document type, so there is no way to ask it about a passport — and code 99 names
 * no person at all. That is a caller-fixable `400`, not an authority failure.
 */
export function toPadronService(identificationTypeCode: number): 'CONSTANCIA' | 'A13' {
    // Validate first, so an entirely unknown code keeps the shared `UNKNOWN_CODE` reason rather than being
    // reported as an identification type ARCA merely cannot look up.
    const code = toDocTipo(identificationTypeCode);
    if (CLAVE_IDENTIFICATION_TYPES.has(code)) {
        return 'CONSTANCIA';
    }
    if (DOCUMENT_IDENTIFICATION_TYPES.has(code)) {
        return 'A13';
    }
    throw new ArcaValidationError(
        `No ARCA padrón service can look up identification type ${code}`,
        'UNSUPPORTED_IDENTIFICATION_TYPE',
    );
}

/** Identification types that ARE a clave tributaria, so the constancia service can be asked directly. */
const CLAVE_IDENTIFICATION_TYPES: ReadonlySet<number> = new Set([
    TaxProcessIdentificationTypeCode.CUIT,
    TaxProcessIdentificationTypeCode.CUIL,
    TaxProcessIdentificationTypeCode.CDI,
]);

/**
 * Identification types that are a plain numeric identity document, which A13 can resolve to the claves
 * issued for it. Passport and foreign CI are deliberately absent: ARCA's document search takes a bare
 * number with no document type, so there is no way to ask it about them.
 */
const DOCUMENT_IDENTIFICATION_TYPES: ReadonlySet<number> = new Set([
    TaxProcessIdentificationTypeCode.DNI,
    TaxProcessIdentificationTypeCode.LE,
    TaxProcessIdentificationTypeCode.LC,
]);
