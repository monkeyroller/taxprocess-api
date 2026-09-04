/**
 * Reading values out of a parsed XML/SOAP response. Parser facts rather than authority facts, which is why
 * they are shared. Two properties of `fast-xml-parser` drive everything here:
 *
 * - A repeated element parses as an array, a single occurrence as a bare object, and an absent one as
 *   `undefined`. All three have to read the same, or a taxpayer with one registered activity takes a
 *   different code path from one with three.
 * - The parser runs with `parseTagValue: false`, so every field arrives as a string and an empty element
 *   reads as `''`. Blank is treated as "not returned" rather than a value, since `Number('')` is a finite
 *   `0` — which is how a missing element becomes a confident wrong answer.
 *
 * Each authority's own empty markers stay with that authority: ARCA fills unset codes with `'0'` and unset
 * dates with the literal `'NULL'`, so its cleaners layer over `text` inside the ARCA provider.
 *
 * Nodes are typed `Record<string, unknown>` rather than `any`: reaching a leaf through an `any` node defeats
 * every check downstream of it, and a value read off a parsed node genuinely is unknown until narrowed.
 */

/** A parsed XML element — a bag of child names whose values are only known once read. */
export type XmlNode = Record<string, unknown>;

/**
 * Normalizes the parser's single-vs-array output to an array. An absent element reads as `[]`, so a caller
 * can iterate without first asking whether the authority sent anything.
 */
export function asArray(node: unknown): Array<XmlNode> {
    if (node === undefined || node === null) {
        return [];
    }
    return (Array.isArray(node) ? node : [node]) as Array<XmlNode>;
}

/** Normalizes the parser's single-vs-array output to the first element, or `undefined` if there is none. */
export function firstOf(node: unknown): XmlNode | undefined {
    if (node === undefined || node === null) {
        return undefined;
    }
    return (Array.isArray(node) ? node[0] : node) as XmlNode | undefined;
}

/**
 * Trimmed text, or `undefined` for a missing or blank element. A non-primitive reads as absent rather than
 * being stringified: `String({})` is `'[object Object]'`, which would otherwise travel onward as if the
 * authority had said those fifteen characters.
 */
export function text(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
    }
    // The parser is configured not to coerce, so a scalar here means something upstream already did.
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    return undefined;
}

/** A finite integer, or `undefined` when missing/blank/unparseable (never a silent `0`). */
export function integer(value: unknown): number | undefined {
    const s = text(value);
    if (s === undefined) {
        return undefined;
    }
    const n = Number(s);
    return Number.isInteger(n) ? n : undefined;
}

/**
 * A finite number, or `undefined` when missing, blank or unparseable — never a silent `0`. `integer`'s
 * sibling for a field an authority declares as a decimal, and it exists for the same reason: a bare
 * `Number()` turns both ways of saying nothing into a number. An absent element is `NaN`, which survives
 * arithmetic; a blank one is a finite `0`, which is worse, `0` being a value a caller will act on.
 *
 * Finiteness only. Whether a particular number is sensible is the authority's rule and belongs with the
 * caller that knows it.
 */
export function decimal(value: unknown): number | undefined {
    const s = text(value);
    if (s === undefined) {
        return undefined;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * Whether a parsed value carries anything at all, recursively. Recursive because the containers can arrive
 * empty: a `<domicilioFiscal/>` element parses into a record whose every field is `undefined`, and a caller
 * copying that record would read two populated members out of a response that stated nothing.
 *
 * Blank strings are already `undefined` once through `text`, and re-checked here so this holds for any value
 * rather than only one these helpers produced.
 */
export function hasAnyContent(value: unknown): boolean {
    if (value === undefined || value === null) {
        return false;
    }
    if (typeof value === 'string') {
        return value.trim() !== '';
    }
    if (Array.isArray(value)) {
        return value.some(hasAnyContent);
    }
    if (typeof value === 'object') {
        return Object.values(value).some(hasAnyContent);
    }
    return true;
}
