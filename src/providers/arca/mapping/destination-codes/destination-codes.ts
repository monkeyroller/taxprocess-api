import {ArcaValidationError} from '../../sdk/core/errors.js';
import {DESTINATION_NAMES} from './destination-codes.data.js';
import {COUNTRY_TAX_IDS} from './country-tax-ids.data.js';

/**
 * ARCA's customs-destination catalogue (`Dst_cmp`, `Dst_merc`) — the fifth canonical fiscal code.
 *
 * On the wire as the authority's own three-digit code, for the same reason `currencyCode` is: **ISO 3166-1
 * cannot express this table.** Measured against production, 60 of its 310 rows have no ISO expression at
 * all:
 *
 * - **35 free zones.** `250` AAE Tierra del Fuego, `251`–`275` Argentine zonas francas, `280`–`291` foreign
 *   ones. Not refinements of a country either: `280 ZF Colonia - URUGUAY` and `225 URUGUAY` are separate
 *   destinations for customs purposes, and goods sent to one are not sent to the other.
 * - **11 territory aggregates.** `227 TERRIT.VINCULADO AL R.UNIDO`, `230 TERRIT. HOLANDESES`,
 *   `509 TERRITORIOS VINCULADOS A FRANCIA` — one code covering many ISO entries.
 * - **9 catch-alls and geographic zones.** `297 RESTO AMERICA`, `298 INDETERMINADO (AMERICA)`,
 *   `265 SECTOR ANTARTICO ARG.`, `295 MAR ARG ZONA ECO.EX`, `700 ZONA LIBRE DE OSTRAVA`.
 *
 * The row the Tierra del Fuego case exists for is in that unmappable set, so an ISO-keyed input would make
 * the feature it was built for unreachable. This is the mistake `ISO_TO_ARCA_CURRENCY` already records:
 * three entries against ARCA's forty-nine, and every value a caller could not name was a change to this
 * service.
 *
 * **No ISO annotation is published either**, even for the ~250 rows that would map. Two reasons: it is not
 * needed — a picker has the authority's own name, which is what the caller must reconcile against anyway —
 * and one row makes the cost concrete. `254 ARGENTINA - ISLAS MALVINAS` is a destination ISO assigns to
 * `FK`; annotating it would have this service state a sovereignty position in a lookup table, and a bulk
 * transcription would do exactly that without anyone deciding to.
 *
 * WSFEv1 publishes the same domain as `FEParamGetTiposPaises`, so this one table serves both services.
 */

/** Every destination the authority publishes, code → its own wording. */
export const DESTINATIONS: ReadonlyMap<string, string> = new Map(DESTINATION_NAMES);

/**
 * The Área Aduanera Especial de Tierra del Fuego (Ley 19.640).
 *
 * Named because it is the destination the export-invoicing work exists for and the one most likely to be
 * confused with something else: goods leaving the mainland for the AAE are legally an export and take a
 * Factura E, whereas a *domestic* sale to a Tierra del Fuego buyer exempt under the same law is an ordinary
 * voucher carrying `fiscalConditionCode` 10 (`IVA_LIBERADO`). Both say "Tierra del Fuego" and "19.640", and
 * they are different documents.
 */
export const DESTINATION_AAE_TIERRA_DEL_FUEGO = '250';

/** Argentina itself — not a valid export destination, and here so a caller's mistake reads clearly. */
export const DESTINATION_ARGENTINA = '200';

/** Trimmed, and zero-padded to the three digits the catalogue is keyed by, so `"25"` never matches `250`. */
export function normalizeDestinationCode(destinationCode: string): string {
    const trimmed = destinationCode.trim();
    return /^\d{1,3}$/.test(trimmed) ? trimmed.padStart(3, '0') : trimmed;
}

/** Whether `destinationCode` names a destination this service supports, in any padding of whitespace. */
export function isKnownDestinationCode(destinationCode: string): boolean {
    return DESTINATIONS.has(normalizeDestinationCode(destinationCode));
}

/**
 * The authority's `Dst_cmp` for a canonical `destinationCode`, which is the identity. Throws if unknown, so
 * a caller gets a `400` naming the field instead of a `502` relaying ARCA's own rejection.
 */
export function toDstCmp(destinationCode: string): number {
    const candidate = normalizeDestinationCode(destinationCode);
    if (!DESTINATIONS.has(candidate)) {
        throw new ArcaValidationError(
            `No ARCA destination (Dst_cmp) for canonical code "${destinationCode}"`,
            'UNKNOWN_CODE',
        );
    }
    return Number(candidate);
}

/**
 * Every generic per-country CUIT `FEXGetPARAM_DST_CUIT` publishes.
 *
 * A membership set and nothing more, because **`Cuit_pais_cliente` cannot be derived from a destination.**
 * ARCA publishes no key joining the two tables:
 *
 * - `DST_CUIT` rows carry only a CUIT and a description (`"BRASIL - Persona Jurídica"`). There is no país
 *   code on them.
 * - The CUIT does not encode one either. `ESTADOS UNIDOS` is `50000002124`, whose body is its país code
 *   `212`; but `URUGUAY` is `50000000016`, `BRASIL` `50000000059` and `CHILE` `50000000032` — a legacy
 *   sequence unrelated to their país codes 225, 203 and 208.
 * - Joining on the description matches 157 of 310 rows: the two tables spell countries differently
 *   (`KENYA`/`Kenia`, `TUNEZ`/`Túnez`, `SUDAFRICA`/`Sudáfrica`).
 *
 * And 92 país codes have no `DST_CUIT` row at all — every AAE, every zona franca, `254`, and the catch-alls.
 * So for the Tierra del Fuego case there is no country CUIT to resolve even in principle, which is why
 * `clientTaxId` (`Id_impositivo`) is the primary identification and this stays a pass-through a caller
 * supplies when it has one. Rule 1580 wants at least one of the two.
 */
const KNOWN_COUNTRY_TAX_IDS: ReadonlySet<string> = new Set(COUNTRY_TAX_IDS);

/** Whether `countryTaxId` is one of the authority's published per-country CUITs. */
export function isKnownCountryTaxId(countryTaxId: string): boolean {
    return KNOWN_COUNTRY_TAX_IDS.has(countryTaxId.trim());
}

/**
 * The authority's `Cuit_pais_cliente`, validated against its own published set. Throws if unknown, buying a
 * `400` naming the field rather than ARCA's `1570`.
 */
export function toCountryTaxId(countryTaxId: string): number {
    const candidate = countryTaxId.trim();
    if (!KNOWN_COUNTRY_TAX_IDS.has(candidate)) {
        throw new ArcaValidationError(
            `"${countryTaxId}" is not one of ARCA's per-country CUITs (Cuit_pais_cliente)`,
            'UNKNOWN_CODE',
        );
    }
    return Number(candidate);
}
