import {ArcaValidationError} from '../../sdk/core/errors.js';

/**
 * ARCA's currency catalogue (`MonId`) — the fourth canonical fiscal code. For ARCA the value is already the
 * `MonId`, so `toMonId` is the identity like the other three.
 *
 * A `Set` of strings rather than an enum for two reasons the other three do not have: the codes are
 * zero-padded and the padding is part of the code, so they cannot be numeric members; and ARCA types `MonId`
 * as `String(8)` on the cotización response against `String(3)` in the catalogue, so no fixed width can be
 * assumed for a future entry.
 *
 * ISO-4217 could not express this catalogue, which is why it exists on the wire: `DOL` and `002` (the blue)
 * are both `USD` at different published rates, and `049` (Gramos de Oro Fino) has no ISO code at all.
 *
 * The tension in keeping the list: a membership check and "a new ARCA currency needs no change here" cannot
 * both be true. Keeping the check makes a new code a one-line addition, and buys a `400 UNKNOWN_CODE` naming
 * the field instead of a `502` relaying ARCA's `12000`.
 *
 * This set is the definition of a currency this service supports rather than merely an input filter:
 * `/currencies/rates` intersects the authority's live catalogue with it, so the rates a caller can cache and
 * the currencies it can invoice in are the same set. The whole-table sync logs any catalogue entry missing
 * from here, which is the one place the drift becomes visible.
 *
 * Transcribed from ARCA's own publication and verified against a live `FEParamGetTiposMonedas`.
 */
export const ARCA_CURRENCY_CODES: ReadonlySet<string> = new Set<string>([
    'PES', 'DOL', '002', '009', '010', '011', '012', '014', '015', '016', '018', '019', '021',
    '023', '024', '025', '026', '028', '029', '030', '031', '032', '033', '034', '035', '040',
    '041', '042', '043', '044', '045', '046', '047', '049', '051', '052', '053', '054', '055',
    '056', '057', '059', '060', '061', '062', '063', '064', 'RUB', 'NZD',
]);

/**
 * A currency code in the spelling the catalogue is keyed by — trimmed and upper-cased. Every membership test
 * must go through here, and it is a named function because the inlined copies had already drifted: the
 * whole-table sync asked two questions about one catalogue entry on adjacent lines and only the first
 * normalized, so a lower-cased `Id` was reported as drift for a code already in the set and then sent to
 * ARCA in a spelling it answers `12000` to.
 *
 * `trim` is for caller-supplied codes, which arrive raw from a JSON body; a code read off the wire came
 * through `text`, which trimmed it already. `toUpperCase` matters on both, and only for the lettered codes —
 * the zero-padded numeric ones have no case to get wrong but do have padding that must survive, which is why
 * this normalizes rather than reformats.
 */
export function normalizeCurrencyCode(currencyCode: string): string {
    return currencyCode.trim().toUpperCase();
}

/** Whether `currencyCode` names a currency this service supports, in any casing or padding of whitespace. */
export function isKnownCurrencyCode(currencyCode: string): boolean {
    return ARCA_CURRENCY_CODES.has(normalizeCurrencyCode(currencyCode));
}

/**
 * Maps a canonical `currencyCode` to the ARCA `MonId`, which is the identity. Throws if the code is unknown.
 * Case- and whitespace-tolerant on input but returns the catalogue's spelling, so a caller sending `"dol"`
 * gets `DOL` on the wire rather than a `12000` from ARCA.
 */
export function toMonId(currencyCode: string): string {
    const candidate = normalizeCurrencyCode(currencyCode);
    if (!ARCA_CURRENCY_CODES.has(candidate)) {
        throw new ArcaValidationError(
            `No ARCA MonId (currency) mapping for canonical code "${currencyCode}"`,
            'UNKNOWN_CODE',
        );
    }
    return candidate;
}
