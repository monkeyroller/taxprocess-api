import {ArcaValidationError} from '../../sdk/core/errors.js';
import type {FexExportType, FexLanguage} from '../../sdk/invoicing/export/fex-invoice.types.js';

/**
 * The three export fields a standard *can* express, and their translation to ARCA's codes.
 *
 * The test applied to every WSFEX field was whether a standard covers the whole domain losslessly. For
 * destinations and units of measure it does not, so those travel as the authority's own codes. These three
 * are the ones where it does, so they travel neutral and are mapped here — the same split as `idProvincia`
 * → ISO 3166-2 elsewhere in this directory.
 */

/** What is being exported. Semantic rather than a catalogue, so it neutralizes as an enum. */
export type ExportType = 'GOODS' | 'SERVICES' | 'OTHER';

export const EXPORT_TYPES = ['GOODS', 'SERVICES', 'OTHER'] as const;

/**
 * `Tipo_expo`. Verified against production `FEXGetPARAM_Tipo_Expo` on 2026-09-04: exactly three rows, and
 * **ARCA skips 3** — the gap is the authority's own numbering, not something to fill in.
 *
 * Deliberately *not* the existing `concept` (1 productos / 2 servicios / **3 productos y servicios**): that
 * is a different set, with a "both" WSFEX has no code for and no "otros". Reusing it would make two
 * unrelated vocabularies assignable to each other right up until one gained a member.
 */
const EXPORT_TYPE_IDS: Readonly<Record<ExportType, FexExportType>> = {
    GOODS: 1,
    SERVICES: 2,
    OTHER: 4,
};

/**
 * ARCA's `Tipo_expo` for a neutral `exportType`.
 *
 * Worth knowing which one a caller picks, because the choice moves three other rules: `GOODS` requires the
 * emitter to be in the DGA exporter registry (1668) and makes `incoterm` mandatory on a Factura (1640),
 * while `SERVICES` and `OTHER` skip both and instead make `paymentDate` mandatory (1673). This service
 * chooses none of that — the caller does.
 */
export function toTipoExpo(exportType: ExportType): FexExportType {
    return EXPORT_TYPE_IDS[exportType];
}

/** The language the comprobante is written in, as ISO 639-1. */
export type InvoiceLanguage = 'es' | 'en' | 'pt';

export const INVOICE_LANGUAGES = ['es', 'en', 'pt'] as const;

/**
 * `Idioma_cbte`. Verified against production `FEXGetPARAM_Idiomas` on 2026-09-04: Español, Inglés,
 * Portugués and nothing else — a closed three-member set that ISO 639-1 covers exactly, which is why this
 * one is neutral on the wire where the destination code is not.
 */
const LANGUAGE_IDS: Readonly<Record<InvoiceLanguage, FexLanguage>> = {es: 1, en: 2, pt: 3};

/**
 * ARCA's `Idioma_cbte` for an ISO 639-1 language.
 *
 * Total over the union, so there is nothing to reject: unlike the destination and unit catalogues, an
 * unknown value cannot reach here — the DTO validates against `INVOICE_LANGUAGES`, and the union and that
 * array are declared together for exactly that reason.
 */
export function toIdiomaCbte(language: InvoiceLanguage): FexLanguage {
    return LANGUAGE_IDS[language];
}

/**
 * `Incoterms` — the one field on this document that is already an international standard.
 *
 * Verified against production `FEXGetPARAM_Incoterms` on 2026-09-04: exactly the eleven ICC Incoterms 2020
 * three-letter codes, and **none of the legacy ones** (no DAT, DAF, DES, DEQ or DDU), so there is no
 * mapping table to keep — the code a caller sends is the code ARCA wants. A future ICC revision is one line
 * here.
 *
 * Kept as a membership check anyway, for the reason the currency catalogue is: it buys a `400` naming the
 * field instead of a `502` relaying ARCA's `1640`.
 */
export const INCOTERMS: ReadonlySet<string> = new Set([
    'EXW',
    'FCA',
    'FAS',
    'FOB',
    'CFR',
    'CIF',
    'CPT',
    'CIP',
    'DAP',
    'DPU',
    'DDP',
]);

/** Whether `incoterm` is one of the ICC clauses ARCA publishes, in any casing. */
export function isKnownIncoterm(incoterm: string): boolean {
    return INCOTERMS.has(incoterm.trim().toUpperCase());
}

/** ARCA's `Incoterms`, which is the ICC code itself — upper-cased, since ARCA publishes it that way. */
export function toIncoterms(incoterm: string): string {
    const candidate = incoterm.trim().toUpperCase();
    if (!INCOTERMS.has(candidate)) {
        throw new ArcaValidationError(`"${incoterm}" is not an ICC incoterm ARCA accepts`, 'UNKNOWN_CODE');
    }
    return candidate;
}

/** How the receiver is constituted, which is what `Cuit_pais_cliente` is keyed by alongside the country. */
export type ReceiverPersonType = 'INDIVIDUAL' | 'LEGAL_ENTITY' | 'OTHER';

export const RECEIVER_PERSON_TYPES = ['INDIVIDUAL', 'LEGAL_ENTITY', 'OTHER'] as const;
