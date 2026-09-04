import type {ArcaCodeMessage} from "../../core/errors.js";
import type {ArcaAuth} from "../../core/types.js";
import {asArray, integer, text} from "../../../../xml-node/xml-node.js";

export function authElement(auth: ArcaAuth): Record<string, unknown> {
    return {Token: auth.token, Sign: auth.sign, Cuit: auth.cuit};
}

export function money(value: number): string {
    return value.toFixed(2);
}

/**
 * A whole number from a wire field, falling back to `0` when the authority sent nothing usable. Named for
 * the fallback because the fallback is the dangerous part: a silent `0` from a missing element is how a
 * malformed response becomes a confident wrong answer. `parseLastAuthorizedNumber` deliberately refuses this
 * default, since there `0` is also ARCA's legitimate answer for "never authorized".
 *
 * The default is tolerable on the two kinds of field that keep it. `CbteDesde`/`CbteHasta` are echoed back
 * by ARCA, so absent means a malformed response, and `0` is an impossible voucher number that only ever
 * travels beside a `Resultado` defaulted to `R`. `Nro` on a point of sale is likewise visibly unusable at
 * `0` rather than quietly wrong.
 *
 * Built on `integer` rather than a bare `Number`, so blank reads as absent and a fractional value becomes
 * `0` rather than a plausible-looking `1.5`.
 */
export function toIntOrZero(value: unknown): number {
    return integer(value) ?? 0;
}

/** Treats ARCA's own empty markers (`""`, `"0"`) as absent. */
export function cleanCode(value: unknown): string | undefined {
    const s = text(value);
    return s === undefined || s === '0' ? undefined : s;
}

/** The same, for date fields ARCA fills with the literal `"NULL"` when empty. */
export function cleanArcaDate(value: unknown): string | undefined {
    const s = cleanCode(value);
    return s === undefined || s.toUpperCase() === 'NULL' ? undefined : s;
}

export function normalizeResultCode(value: string | undefined): 'A' | 'R' | 'P' {
    return value === 'A' || value === 'P' ? value : 'R';
}

/**
 * A `Code`/`Msg` child as text, with an absent one rendered as `''` rather than the literal `"undefined"`.
 * Both places that read these pairs put the result somewhere durable — observations are persisted verbatim
 * onto an authorized sale, and error entries reach the caller in `details` — so blank has to mean "the
 * authority sent nothing".
 */
function codeMsgText(value: unknown): string {
    return text(value) ?? '';
}

/**
 * ARCA's repeated `{Code, Msg}` pairs under `childKey`, as `{code, message}`. One reader for both shapes —
 * non-fatal `Obs` and fatal `Err` — since they are the same wire structure and had drifted into two
 * implementations with different absent-child handling.
 *
 * A pair stating neither a code nor a message is dropped rather than returned blank. An empty element parses
 * to `''`, so it is a value and survives `asArray`, arriving as an entry the authority never wrote. Neither
 * reader can absorb one: an observation is persisted verbatim onto an authorized sale, so a phantom is a
 * blank row core keeps for the life of the voucher, and `assertNoErrors` raises on a non-empty list, so a
 * phantom manufactures a `502` out of an empty element.
 *
 * A pair carrying only one of the two is kept: ARCA does send a `Msg` with no `Code`, and half a pair is
 * still something the authority said.
 */
export function codeMsgPairs(node: unknown, childKey: 'Obs' | 'Err'): Array<ArcaCodeMessage> {
    const children = (node as Record<string, unknown> | undefined)?.[childKey];
    return asArray(children)
        .map((child) => ({
            code: codeMsgText(child.Code),
            message: codeMsgText(child.Msg),
        }))
        .filter((pair) => pair.code !== '' || pair.message !== '');
}
