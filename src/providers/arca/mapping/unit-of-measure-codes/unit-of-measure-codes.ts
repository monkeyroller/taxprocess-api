import {UNIT_OF_MEASURE_NAMES} from './unit-of-measure-codes.data.js';

/**
 * ARCA's `Pro_umed` catalogue — no longer a canonical code, and this is the file that stopped it being one.
 *
 * It used to say two things at once. Most of its 49 ids are units; three are not — `0` no unit, `97`
 * seña/anticipo, `99` bonificación — and those say what a *line is*, changing which amount rules apply to it.
 * That is why the code travelled on the wire: a neutral `unitOfMeasure: 'KG'` could not say "this line is a
 * global discount", so the whole field stayed ARCA's.
 *
 * Both halves are now answered, separately, which is the only way either could be:
 *
 * - **What a line is** is `InvoiceLineType`, a neutral vocabulary. ARCA maps it back onto those same three
 *   ids through `PRO_UMED_BY_LINE_TYPE`, which is its business and no caller's.
 * - **What a line is measured in** is a UN/ECE Recommendation 20 common code. The old docblock here claimed
 *   "Rec 20 exists and ARCA's list does not map onto it". Measured, that is wrong: **33 of the 49 map**, the
 *   two judgements among them are marked, and the 13 that genuinely have no Rec 20 word are registered with
 *   the reason in `arca-rec20-units.ts`.
 *
 * What is left in this file is the authority's own table, which is still needed for one thing: the register
 * has to be checked against it, so a re-dump that adds a unit fails until someone classifies it.
 *
 * `Pro_umed` no longer leaks past this directory, which is what contract §9 has been asking for.
 */

export {
    PRO_UMED_BY_LINE_TYPE,
    PRO_UMED_BY_REC20,
    REC20_BY_PRO_UMED,
    REC20_CANNOT_NAME,
    type RefusalKind,
    assertUnitOfMeasureScheme,
    proUmedForLineType,
    toProUmedFromRec20,
} from './arca-rec20-units.js';

/** Every unit of measure the authority publishes, code → its own wording (`0` has none). */
export const UNITS_OF_MEASURE: ReadonlyMap<string, string> = new Map(UNIT_OF_MEASURE_NAMES);

/**
 * Whether `unitOfMeasureCode` is an id ARCA publishes.
 *
 * Nothing on the wire reaches this any more — a caller sends a Rec 20 code, and `toProUmedFromRec20` is what
 * refuses an unknown one. It stays exported because the classification test asks it of every id in the
 * register, which is the check that keeps the register honest.
 */
export function isKnownUnitOfMeasureCode(unitOfMeasureCode: number): boolean {
    return UNITS_OF_MEASURE.has(String(unitOfMeasureCode));
}
