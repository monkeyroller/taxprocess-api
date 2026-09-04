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
 *
 * **`RUB` and `NZD` are deliberately absent — see {@link ARCA_UNQUOTABLE_CODES}.**
 */
export const ARCA_CURRENCY_CODES: ReadonlySet<string> = new Set<string>([
    'PES', 'DOL', '002', '009', '010', '011', '012', '014', '015', '016', '018', '019', '021',
    '023', '024', '025', '026', '028', '029', '030', '031', '032', '033', '034', '035', '040',
    '041', '042', '043', '044', '045', '046', '047', '049', '051', '052', '053', '054', '055',
    '056', '057', '059', '060', '061', '062', '063', '064',
]);

/**
 * Catalogue codes ARCA publishes as in force but its own cotización service does not recognize. **Not part of
 * {@link ARCA_CURRENCY_CODES}**: they are recorded here so the omission reads as a measurement rather than as
 * a transcription slip, and so the whole-table sync can tell this apart from ordinary catalogue drift.
 *
 * ARCA's two tables contradict each other for these two. Measured 2026-09-04 ~10:08 ART against PRODUCTION:
 *
 * - `FEParamGetTiposMonedas` lists `RUB` (Rublo) and `NZD` (Dólar Neozelandes), `FchDesde 20250114`, no
 *   `FchHasta` — in force, in a 49-row catalogue that otherwise matches this set exactly.
 * - `FEParamGetCotizacion` answers **`12000` "El código de moneda ingresado es invalido. Verificar los
 *   codigos mediante el metodo FEParamGetTiposMonedas"** for both, on every one of the six probe calls
 *   including the one that omits `FchCotiz` — pointing the caller at the method that lists them.
 *
 * The `12000` is what makes this different from a currency ARCA simply has not published today. Same run,
 * same ticket, same minute: `DOL` answered `MonCotiz 1508 / FchCotiz 20260903`, and `049` (Gramos de Oro
 * Fino, catalogued since 2010) answered a clean `602 Sin Resultados` on all six. `049` therefore stays in the
 * set and reports `NO_PUBLICATION`, which is a fact about a day. A `12000` is the authority refusing the code
 * itself, and no walk-back or retry can turn it into a rate.
 *
 * **These two are the whole of it, and that was measured rather than assumed.** All 48 non-reference codes
 * were asked with no `FchCotiz` on one ticket that same run: 27 answered a rate, **19 answered `602`, and
 * exactly these 2 answered `12000`**. The nineteen — `002`, `040`-`047`, `049`, `051`-`057`, `059`, `064` —
 * are catalogued and unpriced, which is an ordinary `NO_PUBLICATION` and precisely why they stay in the set.
 * Being unpriced is common; being refused is not. Only the second kind belongs here.
 *
 * WSFEX offers no way around it. Its `FEXGetPARAM_MON` is byte-identical to WSFEv1's catalogue — the same 49
 * rows, `RUB` and `NZD` included — while `FEXGetPARAM_MON_CON_COTIZACION` prices the *same 27 codes* at the
 * same rates and the same `Fecha_ctz`. The two services share one rate table, so an export voucher is no
 * escape hatch for a currency the authority will not quote.
 *
 * Keeping them in the set cost more than the rate they could never carry. `ARCA_CURRENCY_CODES` gates both
 * endpoints — `/currencies/rates` fetches from it and `toMonId` admits invoices from it — so a `RUB` sale was
 * mapped to `MonId=RUB` and sent, where validation 10119 has no published `R` to band against and the caller
 * learns this after committing the sale. Out of the set, that same sale is refused locally as
 * `400 UNKNOWN_CODE` naming the field, which is the whole point of keeping a membership check.
 *
 * **Re-add a code the day the cotización service answers for it**, which is one line here plus the count in
 * the test: `PROBE_ENVIRONMENT=production PROBE_CURRENCY=RUB pnpm probe:cotizacion-day`. Read-only, six reads
 * of a public number, and it settles the question in seconds — a `602` (or a rate) means ARCA has reconciled
 * its tables. Nothing here re-checks automatically: this is a fact about the authority, not about a request.
 */
export const ARCA_UNQUOTABLE_CODES: ReadonlySet<string> = new Set<string>(['RUB', 'NZD']);

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
