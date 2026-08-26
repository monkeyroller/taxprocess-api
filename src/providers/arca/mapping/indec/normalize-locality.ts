/**
 * The one normalization used on BOTH sides of an INDEC locality lookup: on the catalog names when the
 * index is built, and on ARCA's free-text `localidad` when one is resolved. Keeping it in a module of its
 * own — imported by the index builder and by `geography.ts` alike — is what guarantees the two can
 * never drift, which is also why `localities.generated.ts` stores names verbatim instead of pre-normalized.
 *
 * Folding is deliberately shallow: case, accents, punctuation, whitespace. On top of it sits one further,
 * strictly opt-in step — {@link expandAbbreviations}, the `GRAL.` → `GENERAL` rewrite ARCA's free text
 * needs. There is still **no** edit-distance matching: an address that needs a near miss forgiven resolves
 * to nothing, which the contract allows, rather than to a code that might belong to somewhere else.
 *
 * The `BARRIO`/`B°` prefix ARCA prepends is deliberately **not** folded away here. It carries meaning:
 * it says the text names a neighbourhood rather than a locality, and dropping it would let a barrio match
 * the unrelated locality of the same name (see {@link withoutPlaceKindPrefix} and `geography.ts`).
 */

/** Leading tokens that name the *kind* of place rather than the place (`BARRIO YAPEYU` → `YAPEYU`). */
const PLACE_KIND_PREFIXES: ReadonlyArray<string> = ['BARRIO', 'BRIO', 'BO', 'B'];

/**
 * A locality name reduced to its comparable form: uppercase, unaccented, punctuation-free, single-spaced.
 * Returns `undefined` when nothing comparable is left, so a blank or punctuation-only `localidad` never
 * becomes an index key.
 */
export function normalizeLocalityName(value: string): string | undefined {
    const folded = value
        .normalize('NFD')
        // Combining marks (á → a, ñ → n). Every catalog and ARCA spelling difference we have seen is
        // either this or case.
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        // Anything that is not a letter or a digit becomes a separator: `B°`, `SAN JOSE (ANEXO)` and
        // `GRAL.SAN MARTIN` all reduce to space-separated words rather than to distinct spellings.
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
    return folded === '' ? undefined : folded;
}

/**
 * An already-{@link normalizeLocalityName}d name with its leading place-kind word removed, or `undefined`
 * when it carries none — so a caller can tell "this text announced itself as a neighbourhood" from "this
 * text is a plain name", which is the whole reason the two operations are separate.
 *
 * Never strips the last word: `BARRIO` alone is a name we cannot resolve, not an empty one, and dropping
 * it would silently key an address on nothing.
 */
export function withoutPlaceKindPrefix(normalized: string): string | undefined {
    const words = normalized.split(' ');
    if (words.length > 1 && PLACE_KIND_PREFIXES.includes(words[0])) {
        return words.slice(1).join(' ');
    }
    return undefined;
}

/**
 * The honorific and place-word abbreviations Argentine addresses are written with, mapped to the spelling
 * the INDEC catalog uses. Keys are {@link normalizeLocalityName}d, so the trailing period of `GRAL.` is
 * already gone by the time one is looked up.
 *
 * Entry criteria, both required, because a table like this is where a wrong city comes from:
 *
 *  1. **The expansion earns its place in the catalog.** Every value here is a word the vendored catalog
 *     actually carries (`GENERAL` ×92, `SANTA` ×114, `COLONIA` ×128). `BRIGADIER`, `MARISCAL`, `MAESTRO`
 *     and `DOCTORA` are absent from it, so `BRIG`/`MCAL`/`MTRO`/`DRA` would be dead keys and are omitted.
 *  2. **The abbreviation has exactly one reading.** Deliberately excluded for failing this:
 *     - `PTE` — *Presidente* or *Puente*, and the catalog holds five `Puente …` localities. One table
 *       cannot decide which, so neither is guessed; `PDTE` and `PRES` are unambiguous and are kept.
 *     - `SN`/`S` — `S/N` is *sin número*, a street-level marker, and a bare initial carries no signal.
 *     - `VDA` — *viuda*, not *villa*.
 *     - `MTRO` — *Maestro* or *Ministro* (and dead by criterion 1 anyway).
 *
 * `CAP` → `CAPITAN` is kept despite `CAP. FEDERAL` being a common way to write *Capital Federal*: the
 * catalog holds no `CAPITAL` anywhere, so the worst that spelling can do is resolve to nothing.
 *
 * Exported only so `geography.test.ts` can invert it and run every catalog name back through the
 * resolver abbreviated — a check that has to read the table itself to stay honest when the table changes.
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
 * An already-{@link normalizeLocalityName}d name with every abbreviated word written out, or `undefined`
 * when it carries none — the same "tell me whether this applied" contract as {@link withoutPlaceKindPrefix},
 * so a caller never re-queries the index with a spelling it already tried.
 *
 * Every word is rewritten, not just the first: the catalog's own `VILLA GDOR LUIS F ETCHEVEHERE` puts the
 * abbreviation second, and `NTRA SRA DE FATIMA` abbreviates two words running.
 *
 * This is only ever a *fallback* spelling (see `geography.ts`), which is what makes it safe. A name the
 * catalog states literally is found before expansion is ever attempted, so the nine catalog names that
 * genuinely contain one of these tokens cannot be rewritten out from under a caller who spelled them right.
 */
export function expandAbbreviations(normalized: string): string | undefined {
    const expanded = normalized
        .split(' ')
        .map((word) => LOCALITY_ABBREVIATIONS.get(word) ?? word)
        .join(' ');
    // Both sides are space-joined from the same split, so equality here means no word was rewritten.
    return expanded === normalized ? undefined : expanded;
}
