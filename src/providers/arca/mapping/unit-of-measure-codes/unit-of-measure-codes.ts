import {ArcaValidationError} from '../../sdk/core/errors.js';
import {UNIT_OF_MEASURE_NAMES} from './unit-of-measure-codes.data.js';

/**
 * ARCA's `Pro_umed` catalogue — the sixth canonical fiscal code, and the one that looks most neutralizable
 * and is least.
 *
 * UN/ECE Recommendation 20 exists and ARCA's list does not map onto it, but that is the smaller problem.
 * The real one is that **three of the ids are not units of measure at all**; they are line *modes*, and they
 * change which validations apply:
 *
 * | id | ARCA's wording | what it means |
 * | --- | --- | --- |
 * | `0` | (none — blank in ARCA's own table) | no unit; quantity, unit price and discount must be zero or absent (1775) |
 * | `97` | `seña/anticipo` | a deposit line. The total is unrestricted and **may be negative** (1815) |
 * | `99` | `bonificación` | a discount line. The total **must** be negative (1815) |
 *
 * A neutral `unitOfMeasure: 'KG'` cannot say "this line is a global discount", so the code travels on the
 * wire and these three keep their meaning. `98 otras unidades` is *not* one of them: it is an ordinary
 * escape hatch for a unit the catalogue does not name, and carries no special validation.
 *
 * This is exactly the class contract §9 warns about — a value a caller could plausibly have invented for
 * itself, and would then have invented differently.
 */

/** Every unit of measure the authority publishes, code → its own wording (`0` has none). */
export const UNITS_OF_MEASURE: ReadonlyMap<string, string> = new Map(UNIT_OF_MEASURE_NAMES);

/**
 * The three ids that are line *modes* rather than units. A caller sending one of these is describing the
 * kind of line, and the item's amounts are validated by a different rule as a result.
 *
 * A `const` object rather than three loose constants, following `Concept` and `ServiceId`: it gives the
 * three a name as a group, and {@link UnitMode} below is what turns `isUnitModeCode` into a type guard so a
 * caller that has narrowed cannot then compare against an ordinary unit id.
 */
export const UnitMode = {
    /** No unit: quantity, unit price and discount must be zero or absent (1775). */
    NONE: 0,
    /** `seña/anticipo` — a deposit line, whose total may be negative (1815). */
    DEPOSIT: 97,
    /** `bonificación` — a discount line, whose total must be negative (1815). */
    DISCOUNT: 99,
} as const;

export type UnitMode = (typeof UnitMode)[keyof typeof UnitMode];

/** Derived, so the set cannot fall behind the three named above. */
export const UNIT_MODE_CODES: ReadonlySet<number> = new Set(Object.values(UnitMode));

/**
 * Whether `unitOfMeasureCode` is one of the three modes rather than a real unit.
 *
 * A type guard rather than a `boolean`, which is what the grouping above buys: inside the branch the value
 * is one of the three, so comparing it against an ordinary unit id stops compiling.
 */
export function isUnitModeCode(unitOfMeasureCode: number): unitOfMeasureCode is UnitMode {
    return UNIT_MODE_CODES.has(unitOfMeasureCode);
}

/** Whether `unitOfMeasureCode` names a unit (or mode) this service supports. */
export function isKnownUnitOfMeasureCode(unitOfMeasureCode: number): boolean {
    return UNITS_OF_MEASURE.has(String(unitOfMeasureCode));
}

/**
 * The authority's `Pro_umed` for a canonical `unitOfMeasureCode`, which is the identity. Throws if unknown,
 * so a caller gets a `400` naming the field rather than ARCA's `1790`.
 */
export function toProUmed(unitOfMeasureCode: number): number {
    if (!isKnownUnitOfMeasureCode(unitOfMeasureCode)) {
        throw new ArcaValidationError(
            `No ARCA unit of measure (Pro_umed) for canonical code "${String(unitOfMeasureCode)}"`,
            'UNKNOWN_CODE',
        );
    }
    return unitOfMeasureCode;
}
