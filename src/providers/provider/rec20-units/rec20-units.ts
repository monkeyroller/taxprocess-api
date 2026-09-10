import {REC20_SNAPSHOT, REC20_UNIT_ROWS, type Rec20Unit} from './rec20-units.data.js';

/**
 * UN/ECE Recommendation 20 — the unit vocabulary this service accepts, and the reason `unitOfMeasureCode` is
 * a standard code rather than an authority's own.
 *
 * **A curated subset, not the whole recommendation.** Rev 17 publishes 2136 codes and 1756 of them are
 * active; this carries 208. The cut is not a taste: Rec 20's own columns do not separate trade units from
 * physics ones — `Level/Category` is a normative-relevance tier (`PR`, `DZN`, `GRO`, `MIL` and `NMP` are all
 * level 3.7, while `SET` is 3.2 and `CTM` 3.5), and `Quantity` is compound prose that `KGM`, `MTR` and `C62`
 * all fall outside. So the rule is stated in the generator and applied there; it is written out in full at
 * the top of `rec20-units.data.ts`. `rec20-units.test.ts` re-applies the *checkable half* to the committed
 * rows — rule A keys off the `Description` column, which those rows deliberately do not carry, so what
 * stands behind rule A is the generator and a reader, not a test.
 *
 * **This catalogue is service-wide; support is per-entity.** Carrying a code is not the same as an authority
 * being able to express it — ARCA maps 33 of these 208 — and the two answer differently, which is what
 * `UNSUPPORTED_UNIT_OF_MEASURE` exists for. This module deliberately has no `to*` function: translating to an
 * authority's field is the provider's job, and a neutral vocabulary that knew how would be the cycle
 * `eslint.config.js` guards against.
 */

export {REC20_SNAPSHOT, type Rec20Unit};

/**
 * Every unit this service carries, keyed by common code.
 *
 * Derived from the rows rather than declared beside them, so the index cannot fall behind the data — the
 * property `KNOWN_COUNTRY_TAX_IDS` is shaped for.
 */
export const REC20_UNITS: ReadonlyMap<string, Rec20Unit> = new Map(
    REC20_UNIT_ROWS.map((unit) => [unit.commonCode, unit]),
);

/**
 * A common code in the spelling the catalogue is keyed by — trimmed and upper-cased.
 *
 * Every membership test goes through here — `REC20_UNITS` is keyed by the normalized spelling, so a lookup
 * that skipped this would answer for a code nobody sent. A named function for the reason
 * `normalizeCurrencyCode` is: inlined copies drift, and a caller typing `"kgm"` into a JSON body should not
 * be told its unit does not exist. `trim` is for caller-supplied values, which arrive raw — the export DTO
 * trims too, so the padding never reaches here from HTTP; `toUpperCase` matters on all of them, the
 * recommendation publishing every code in upper case.
 */
export function normalizeRec20Code(commonCode: string): string {
    return commonCode.trim().toUpperCase();
}
