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
 * How one web service spells a block of code/message pairs. WSFEv1 and WSFEXv1 carry the same three ideas —
 * a result, a list of errors, a list of events — and disagree only on the names and the arity, so the
 * reader below is shared and only the spelling is per-service.
 *
 * `childKey` absent means the node *is* the pair rather than a wrapper around a repeated child. That is
 * WSFEX's shape: `FEXErr` and `FEXEvents` are a single `{ErrCode, ErrMsg}` / `{EventCode, EventMsg}` each,
 * where WSFEv1 wraps a repeated `Err` / `Evt`. `asArray` reads a bare object as a one-element list, so the
 * two collapse into one code path with no branch.
 */
export interface CodeMessageDialect {
    /** Repeated child holding the pairs. Absent when the node itself is a single pair. */
    readonly childKey?: string;
    readonly codeField: string;
    readonly messageField: string;
}

/** WSFEv1's fatal block: `Errors/Err[]{Code,Msg}`. */
export const WSFEV1_ERRORS: CodeMessageDialect = {childKey: 'Err', codeField: 'Code', messageField: 'Msg'};

/** WSFEv1's event block: `Events/Evt[]{Code,Msg}` — informational, never a failure. */
export const WSFEV1_EVENTS: CodeMessageDialect = {childKey: 'Evt', codeField: 'Code', messageField: 'Msg'};

/** WSFEv1's non-fatal observations: `Observaciones/Obs[]{Code,Msg}`. */
export const WSFEV1_OBSERVATIONS: CodeMessageDialect = {
    childKey: 'Obs',
    codeField: 'Code',
    messageField: 'Msg',
};

/**
 * WSFEXv1's fatal block: a single `FEXErr{ErrCode,ErrMsg}`.
 *
 * Note what the caller has to do that WSFEv1 never requires: WSFEX sends this element on success too, with
 * `ErrCode` `0`. Presence is not failure here, so `assertNoErrors` drops a zero code — see
 * {@link isNoErrorCode}.
 */
export const WSFEX_ERRORS: CodeMessageDialect = {codeField: 'ErrCode', messageField: 'ErrMsg'};

/** WSFEXv1's event block: a single `FEXEvents{EventCode,EventMsg}`. */
export const WSFEX_EVENTS: CodeMessageDialect = {codeField: 'EventCode', messageField: 'EventMsg'};

/**
 * ARCA's code/message pairs read through `dialect`, as `{code, message}`. One reader for every shape both
 * services use — non-fatal `Obs`, fatal `Err`/`FEXErr`, informational `Evt`/`FEXEvents` — since they are the
 * same wire structure and had drifted into two implementations with different absent-child handling.
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
export function codeMsgPairs(node: unknown, dialect: CodeMessageDialect): Array<ArcaCodeMessage> {
    const pairs = dialect.childKey === undefined
        ? node
        : (node as Record<string, unknown> | undefined)?.[dialect.childKey];
    return asArray(pairs)
        .map((child) => ({
            code: codeMsgText(child[dialect.codeField]),
            message: codeMsgText(child[dialect.messageField]),
        }))
        .filter((pair) => pair.code !== '' || pair.message !== '');
}

/**
 * Whether a code means "nothing went wrong". WSFEX sends `FEXErr` on every response and marks success with
 * `ErrCode` `0`, so a presence check would read every successful call as a failure.
 *
 * A **blank** code is deliberately not this. ARCA does send a `Msg` with no `Code`, and that is a real
 * rejection the caller has to see — `codeMsgPairs` keeps half a pair for exactly that reason, and treating
 * blank as zero here would throw it away again. So this asks whether the authority said zero, not whether it
 * said nothing.
 *
 * WSFEv1 never sends a zero code — it omits the block entirely — so applying this to both services costs
 * nothing and keeps one predicate rather than a per-service branch.
 */
export function isNoErrorCode(code: string): boolean {
    return code !== '' && Number(code) === 0;
}
