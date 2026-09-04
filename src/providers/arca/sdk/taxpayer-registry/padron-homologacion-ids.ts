import type {PadronService} from './padron.types.js';

/**
 * The CUITs ARCA's homologación padrón services will answer for. The testing padrón is not a copy of the
 * real one, so a production CUIT generally comes back as not found. These are ARCA's published cast rather
 * than the padrón's whole population — the testing A13 index answers for many claves outside the list, but
 * only these are documented. Meaningless in `produccion`.
 *
 * Digit-only strings, the form the SOAP `idPersona` parameter takes. The first eight are legal entities, the
 * rest individuals.
 */
export const PADRON_HOMOLOGACION_CUITS: ReadonlyArray<string> = [
    '33963854329',
    '30559049308',
    '33142683399',
    '30826489622',
    '30024784602',
    '30031502582',
    '30041098399',
    '30186959821',
    '24850833059',
    '27193248344',
    '27748088305',
    '27045987707',
    '20272901849',
    '24580701716',
    '20291465669',
    '24603578801',
    '24763322773',
    '23349933349',
    '20529424214',
    '24509940009',
];

/**
 * Identity-document numbers the homologación A13 index answers for, with how many claves each carries.
 * These exist because every CUIT above resolves to exactly one clave, so a document probe built from them
 * would never return a list. The five below cover one match, the smallest multi-match, and fan-outs wide
 * enough to matter, the lookup reading every returned clave concurrently.
 *
 * The counts are what ARCA returned on 2026-08-26, verified end to end — the index count and the claves the
 * per-clave read resolved were equal for all five. Testing-padrón data rather than a promise, so treat a
 * drifted count as something to re-record. The claves come back in a different order between calls; never
 * assert on position.
 *
 * A13 only: the constancia service has no document search.
 */
export const PADRON_HOMOLOGACION_DOCUMENTS: ReadonlyArray<string> = [
    // 1 clave — 20888888889 (CUIT). The single-match case.
    '88888888',
    // 2 claves — 27333333339 and 23333333333, both CUIT, both ACTIVE, both reporting this document.
    '33333333',
    // 5 claves, all CUIT — 20999999992, 24999999995, 27999999994, 20152493275, 27600054495.
    '99999999',
    // 10 claves, mixed kinds — 6 CUIT, 2 CUIL, 2 CDI.
    '12345678',
    // 37 claves — 20 CUIT, 14 CUIL, 3 CDI. The widest fan-out found: 37 concurrent person reads.
    '11111111',
];

/**
 * Per-service view of the same cast, so a caller keyed by service needs no branch. ARCA publishes identical
 * lists for both live services; if it ever diverges them, split the arrays here rather than adding a second
 * constant.
 */
export const PADRON_HOMOLOGACION_TAX_IDS: Record<PadronService, ReadonlyArray<string>> = {
    CONSTANCIA: PADRON_HOMOLOGACION_CUITS,
    A13: PADRON_HOMOLOGACION_CUITS,
};
