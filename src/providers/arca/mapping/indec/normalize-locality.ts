/**
 * The one normalization used on both sides of an INDEC locality lookup: on the catalog names when the index
 * is built, and on ARCA's free-text `localidad` when one is resolved. A module of its own so the two can
 * never drift, which is also why `localities.generated.ts` stores names verbatim rather than pre-normalized.
 *
 * Folding is shallow — case, accents, punctuation, whitespace — with one opt-in step on top,
 * `expandAbbreviations`. There is no edit-distance matching: an address that needs a near miss forgiven
 * resolves to nothing rather than to a code that might belong somewhere else.
 *
 * The `BARRIO`/`B°` prefix ARCA prepends is not folded away here. It carries meaning — the text names a
 * neighbourhood rather than a locality — and dropping it would let a barrio match the unrelated locality of
 * the same name.
 */

/** Leading tokens that name the kind of place rather than the place (`BARRIO YAPEYU` → `YAPEYU`). */
const PLACE_KIND_PREFIXES: ReadonlyArray<string> = ['BARRIO', 'BRIO', 'BO', 'B'];

/**
 * A locality name reduced to its comparable form: uppercase, unaccented, punctuation-free, single-spaced.
 * Returns `undefined` when nothing comparable is left, so a blank or punctuation-only `localidad` never
 * becomes an index key.
 */
export function normalizeLocalityName(value: string): string | undefined {
    const folded = value
        .normalize('NFD')
        // Combining marks (á → a, ñ → n). Every spelling difference observed is either this or case.
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        // Anything but a letter or digit becomes a separator, so `B°`, `SAN JOSE (ANEXO)` and
        // `GRAL.SAN MARTIN` all reduce to space-separated words rather than distinct spellings.
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
    return folded === '' ? undefined : folded;
}

/**
 * An already-normalized name with its leading place-kind word removed, or `undefined` when it carries none —
 * so a caller can tell a text that announced itself as a neighbourhood from a plain name, which is why the
 * two operations are separate.
 *
 * Never strips the last word: `BARRIO` alone is a name we cannot resolve rather than an empty one, and
 * dropping it would key an address on nothing.
 */
export function withoutPlaceKindPrefix(normalized: string): string | undefined {
    const words = normalized.split(' ');
    if (words.length > 1 && PLACE_KIND_PREFIXES.includes(words[0])) {
        return words.slice(1).join(' ');
    }
    return undefined;
}

/**
 * The honorific and place-word abbreviations Argentine addresses are written with, mapped to the spelling the
 * INDEC catalog uses. Keys are already normalized, so the trailing period of `GRAL.` is gone.
 *
 * Two criteria for an entry, because a table like this is where a wrong city comes from. The expansion must
 * be a word the vendored catalog carries, which is why `BRIG`/`MCAL`/`MTRO`/`DRA` are omitted as dead keys.
 * And the abbreviation must have exactly one reading, which excludes `PTE` (Presidente or Puente, and the
 * catalog holds five `Puente …` localities), `SN`/`S` (sin número, a street-level marker) and `VDA` (viuda,
 * not villa). `PDTE` and `PRES` are unambiguous and kept.
 *
 * `CAP` → `CAPITAN` is kept despite `CAP. FEDERAL` being a common way to write Capital Federal: the catalog
 * holds no `CAPITAL` anywhere, so the worst that spelling can do is resolve to nothing.
 *
 * Exported so the test can invert it and run every catalog name back through the resolver abbreviated.
 */
export const LOCALITY_ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
    ['GRAL', 'GENERAL'],
    ['GRL', 'GENERAL'],
    ['CNEL', 'CORONEL'],
    ['CRNEL', 'CORONEL'],
    ['STA', 'SANTA'],
    ['STO', 'SANTO'],
    ['STGO', 'SANTIAGO'],
    ['PDTE', 'PRESIDENTE'],
    ['PRES', 'PRESIDENTE'],
    ['DR', 'DOCTOR'],
    ['ING', 'INGENIERO'],
    ['GOB', 'GOBERNADOR'],
    ['GDOR', 'GOBERNADOR'],
    ['TTE', 'TENIENTE'],
    ['SGTO', 'SARGENTO'],
    ['CTE', 'COMANDANTE'],
    ['CDTE', 'COMANDANTE'],
    ['ALTE', 'ALMIRANTE'],
    ['CAP', 'CAPITAN'],
    ['CNIA', 'COLONIA'],
    ['COL', 'COLONIA'],
    ['PJE', 'PARAJE'],
    ['PQUE', 'PARQUE'],
    ['PQE', 'PARQUE'],
    ['PTO', 'PUERTO'],
    ['FCO', 'FRANCISCO'],
    ['NTRA', 'NUESTRA'],
    ['SRA', 'SENORA'],
    ['EST', 'ESTACION'],
    ['ESTAC', 'ESTACION'],
]);

/**
 * An already-normalized name with every abbreviated word written out, or `undefined` when it carries none,
 * so a caller never re-queries the index with a spelling it already tried.
 *
 * Every word is rewritten rather than just the first: the catalog's own `VILLA GDOR LUIS F ETCHEVEHERE` puts
 * the abbreviation second, and `NTRA SRA DE FATIMA` abbreviates two words running.
 *
 * Only ever a fallback spelling, which is what makes it safe: a name the catalog states literally is found
 * before expansion is attempted, so the nine catalog names that contain one of these tokens cannot be
 * rewritten out from under a caller who spelled them right.
 */
export function expandAbbreviations(normalized: string): string | undefined {
    const expanded = normalized
        .split(' ')
        .map((word) => LOCALITY_ABBREVIATIONS.get(word) ?? word)
        .join(' ');
    // Both sides are space-joined from the same split, so equality here means no word was rewritten.
    return expanded === normalized ? undefined : expanded;
}
