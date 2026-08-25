/**
 * The one normalization used on BOTH sides of an INDEC locality lookup: on the catalog names when the
 * index is built, and on ARCA's free-text `localidad` when one is resolved. Keeping it in a module of its
 * own — imported by the index builder and by `ar-geography.ts` alike — is what guarantees the two can
 * never drift, which is also why `indec-localities.ts` stores names verbatim instead of pre-normalized.
 *
 * Folding is deliberately shallow: case, accents, punctuation, whitespace. There is **no** abbreviation
 * expansion (`GRAL.` → `GENERAL`) and no edit-distance matching — an address that needs either of those
 * resolves to nothing, which the contract allows, rather than to a code that might belong to somewhere else.
 *
 * The `BARRIO`/`B°` prefix ARCA prepends is deliberately **not** folded away here. It carries meaning:
 * it says the text names a neighbourhood rather than a locality, and dropping it would let a barrio match
 * the unrelated locality of the same name (see {@link withoutPlaceKindPrefix} and `ar-geography.ts`).
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
