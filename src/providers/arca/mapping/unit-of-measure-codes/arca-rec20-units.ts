import {
    InvoiceLineType,
    type NonProductLineType,
} from '../../../provider/invoice-line-type/invoice-line-type.js';
import {UnitOfMeasureCodeScheme} from '../../../provider/unit-of-measure-scheme/unit-of-measure-scheme.js';
import {REC20_UNITS, normalizeRec20Code} from '../../../provider/rec20-units/rec20-units.js';
import {ArcaValidationError} from '../../sdk/core/errors.js';

/**
 * ARCA's half of the unit standard: which UN/ECE Recommendation 20 codes it can express as a `Pro_umed`, and
 * which of its own units the recommendation has no word for.
 *
 * **Not a `.data.ts`.** That convention means a transcription with a source, a date, a re-take command and a
 * row count — `unit-of-measure-codes.data.ts` next door is one, and re-dumping it is safe. Nothing here can
 * be re-dumped. Every row below is a judgement made by reading both catalogues, and the file is named to say
 * so: it must be re-argued, not re-taken.
 */

/**
 * ARCA's `Pro_umed` → the Rec 20 code that means the same thing. 33 of the authority's 49 ids.
 *
 * Thirty-one are exact — `kilogramos` is `KGM` and there is nothing to decide. Two are judgements and are
 * marked where they sit. The remaining sixteen are accounted for by {@link REC20_CANNOT_NAME} and
 * {@link PRO_UMED_BY_LINE_TYPE}, and a test asserts the three together classify all 49, so a re-dump adding
 * a unit fails until someone reads it.
 */
export const REC20_BY_PRO_UMED: ReadonlyMap<number, string> = new Map([
    [1, 'KGM'], // kilogramos
    [2, 'MTR'], // metros
    [3, 'MTK'], // metros cuadrados
    [4, 'MTQ'], // metros cúbicos
    [5, 'LTR'], // litros
    [6, 'MWH'], // 1000 kWh — Rec 20 names this one in the same words: `megawatt hour (1000 kW.h)`
    // JUDGEMENT. `unidades` is the generic countable, used for goods and services alike. `C62 one` is the
    // SI-normative dimensionless unit whose published synonym is literally "unit"; `H87 piece` and `EA each`
    // were the alternatives and both mean a physical article, which `unidades` on a services line is not.
    [7, 'C62'],
    [8, 'PR'], // pares
    [9, 'DZN'], // docenas
    [10, 'CTM'], // quilates — the metric carat, 200 mg
    [11, 'MIL'], // millares
    [14, 'GRM'], // gramos
    [15, 'MMT'], // milimetros
    [16, 'MMQ'], // mm cúbicos
    [17, 'KMT'], // kilómetros
    [18, 'HLT'], // hectolitros
    [20, 'CMT'], // centímetros
    // JUDGEMENT, and the weakest one here. ARCA's row lumps four things into a single id — juego, paquete,
    // mazo, naipes — and Rec 20 keeps them apart (`SET`, `NMP`, and Rec 21's packaging codes). `SET` is the
    // broadest of them and the only one that covers a deck of cards, so it is the least wrong; it is not
    // exact, and a caller meaning `paquete` specifically wants `NMP`.
    [25, 'SET'],
    [27, 'CMQ'], // cm cúbicos
    [29, 'TNE'], // toneladas
    [30, 'DMA'], // dam cúbicos
    [31, 'H19'], // hm cúbicos
    [32, 'H20'], // km cúbicos
    [33, 'MC'], // microgramos
    [41, 'MGM'], // miligramos
    [47, 'MLT'], // mililitros
    [48, 'CUR'], // curie
    [49, 'MCU'], // milicurie
    [50, 'M5'], // microcurie
    [54, 'GRO'], // gruesa — a gross, 144
    [61, 'E4'], // kg bruto — `gross kilogram`, "the total number of kilograms before deductions"
    [96, 'NMP'], // packs
    // `otras unidades`, the escape hatch, turns out to be standard: `ZZ mutually defined` is "a unit of
    // measure as agreed in common between two or more parties". It is why nothing on this field has to be
    // ARCA's own numbering.
    [98, 'ZZ'],
]);

/**
 * The reverse, derived rather than written twice.
 *
 * A `Map` built from the same pairs, so the two cannot drift, and a test asserts it still holds 33 entries —
 * which is the assertion that no two ARCA units have been pointed at one Rec 20 code. Collapsing two would
 * make this direction pick a winner silently.
 */
export const PRO_UMED_BY_REC20: ReadonlyMap<string, number> = new Map(
    [...REC20_BY_PRO_UMED].map(([proUmed, commonCode]) => [commonCode, proUmed]),
);


/**
 * How ARCA says what a line *is*: through the same field, with three ids reserved for it.
 *
 * No `PRODUCT` entry, and that absence is load-bearing — a product line's `Pro_umed` comes from its unit, so
 * a lookup here returning something for it would let two sources both claim the same line. A test asserts it
 * stays absent.
 */
export const PRO_UMED_BY_LINE_TYPE: ReadonlyMap<NonProductLineType, number> = new Map([
    [InvoiceLineType.LUMP_SUM, 0], // no unit; quantity, unit price and discount must be zero or absent (1775)
    [InvoiceLineType.DEPOSIT, 97], // seña/anticipo — unrestricted in sign (1815)
    [InvoiceLineType.DISCOUNT, 99], // bonificación — the total must be negative (1815)
]);

/** Why an ARCA unit has no Rec 20 code. Two different facts, and a reader deserves to see which. */
export type RefusalKind =
    /** Rec 20 publishes nothing that means this. */
    | 'REC20_DEFINES_NONE'
    /** It was never a unit — ARCA parked something else in the unit table. */
    | 'NOT_A_UNIT';

/**
 * The 13 `Pro_umed` ids no Rec 20 code names, with the measurement behind each — the register
 * `ARCA_UNQUOTABLE_CODES` is shaped for. A row excluded without a reason is how a catalogue drifts.
 *
 * The consequence is real and worth stating where it will be read: an export priced in `kg activo`
 * (agroquímicos) or `muiacthor` (pharma) cannot be invoiced through this service at all.
 */
export const REC20_CANNOT_NAME: ReadonlyMap<number, {kind: RefusalKind; reason: string}> = new Map([
    [
        34,
        {
            kind: 'REC20_DEFINES_NONE' as const,
            reason:
                'nanogramos. Rec 20 carries the nano- prefix for the ampere, farad, henry, metre, ohm, ' +
                'second and tesla, but not for the gram; for mass it has only L32 nanogram per kilogram, ' +
                'which is a ratio',
        },
    ],
    [
        35,
        {
            kind: 'REC20_DEFINES_NONE' as const,
            reason: 'picogramos. The same gap — picofarad, picometre, picosecond, picowatt, but no picogram',
        },
    ],
    [
        51,
        {
            kind: 'REC20_DEFINES_NONE' as const,
            reason:
                'uiacthor. Rec 20 has only NIU, an undifferentiated "number of international units" — ' +
                'hormonal activity appears nowhere in the table, and mapping it to NIU would collapse this ' +
                'id together with 62 and 64',
        },
    ],
    [
        52,
        {
            kind: 'REC20_DEFINES_NONE' as const,
            reason:
                'muiacthor, a thousand IU. Rec 20 has HIU (hundred) and MIU (million) and nothing between, ' +
                'so the magnitude is missing even before the kind of activity is',
        },
    ],
    [
        53,
        {
            kind: 'REC20_DEFINES_NONE' as const,
            reason:
                'kg base. Rec 20 qualifies mass by water content and packaging — MND dry weight, KSD 90% ' +
                'dry, 58 net, E4 gross, KIC including container — and never by the base substance',
        },
    ],
    [62, {kind: 'REC20_DEFINES_NONE' as const, reason: 'uiactant. As 51: only NIU, undifferentiated'}],
    [63, {kind: 'REC20_DEFINES_NONE' as const, reason: 'muiactant, a thousand IU. As 52: no such magnitude'}],
    [64, {kind: 'REC20_DEFINES_NONE' as const, reason: 'uiactig. As 51: only NIU, undifferentiated'}],
    [65, {kind: 'REC20_DEFINES_NONE' as const, reason: 'muiactig, a thousand IU. As 52: no such magnitude'}],
    [
        66,
        {
            kind: 'REC20_DEFINES_NONE' as const,
            reason:
                'kg activo. Rec 20 has no active-substance mass. E25 "active unit" exists but is explicitly ' +
                'a count — "the number of active units within a substance" — not a weight',
        },
    ],
    [67, {kind: 'REC20_DEFINES_NONE' as const, reason: 'gramo activo. As 66: E25 counts, it does not weigh'}],
    [68, {kind: 'REC20_DEFINES_NONE' as const, reason: 'gramo base. As 53: Rec 20 does not qualify by base'}],
    [
        95,
        {
            kind: 'NOT_A_UNIT' as const,
            reason:
                'anulación/devolución — a cancellation marker ARCA parked in the unit table. Unlike 0, 97 ' +
                'and 99 it is not one of the three the authority documents amount rules for, so it is not ' +
                'a line type either; inventing one would be guessing at a rule ARCA has not published',
        },
    ],
]);

/**
 * The `Pro_umed` for a line that is not an ordinary product line.
 *
 * Throws on `PRODUCT` rather than returning a default: a product line is measured by its unit, and answering
 * anything here would be the silent wrong `Pro_umed` this whole change exists to stop.
 */
export function proUmedForLineType(lineType: NonProductLineType): number {
    const proUmed = PRO_UMED_BY_LINE_TYPE.get(lineType);
    if (proUmed === undefined) {
        throw new ArcaValidationError(
            `A ${lineType} line takes its ARCA Pro_umed from its unit, not from its line type`,
            'INVALID_LINE_TYPE',
        );
    }
    return proUmed;
}

/**
 * The unit catalogues this provider can read a code against — one, today.
 *
 * A `Set` of the schemes ARCA *implements*, rather than a comparison against the enum, and the difference is
 * the whole point: `UnitOfMeasureCodeScheme` promises that adding a second standard is additive rather than a
 * reinterpretation of every value already sent, and that only holds if a provider reads the field. Nothing
 * did — the code went straight to {@link toProUmedFromRec20}, which would read a Rec 21 code against the
 * Rec 20 table and call it unknown, telling a caller its code does not exist when it exists in the catalogue
 * they named.
 *
 * Typed `ReadonlySet<string>` deliberately. Written as `scheme !== UnitOfMeasureCodeScheme.UN_ECE_REC20` the
 * check narrows to `never` while the vocabulary has one member, which is a lint error and, worse, a guard the
 * compiler is entitled to believe can never fire. Membership of a set of what is implemented stays a real
 * question at every size, and a member added to the enum without being added here is refused rather than
 * silently mapped — which is the safe default for a catalogue this provider has not been taught.
 */
const SCHEMES_THIS_PROVIDER_READS: ReadonlySet<string> = new Set([UnitOfMeasureCodeScheme.UN_ECE_REC20]);

/**
 * Refuses a unit code drawn from a catalogue this provider does not read, at the field `at`.
 *
 * Absent means Rec 20, which is the field's documented default, so saying nothing is always accepted.
 */
export function assertUnitOfMeasureScheme(scheme: UnitOfMeasureCodeScheme | undefined, at: string): void {
    if (scheme !== undefined && !SCHEMES_THIS_PROVIDER_READS.has(scheme)) {
        throw new ArcaValidationError(
            `${at} names the ${scheme} catalogue, which this entity does not read. ARCA units are mapped ` +
                `from ${[...SCHEMES_THIS_PROVIDER_READS].join(', ')} only`,
            'UNSUPPORTED_UNIT_OF_MEASURE_SCHEME',
        );
    }
}

/**
 * The `Pro_umed` for a UN/ECE Rec 20 common code, at the field `at` so a caller with forty lines knows which
 * one is wrong.
 *
 * **Two refusals, and they mean different things**, which is the reason this is not one check:
 *
 * - `UNKNOWN_CODE` — not a unit this service carries. A typo, or one the curation rule dropped.
 * - `UNSUPPORTED_UNIT_OF_MEASURE` — a real Rec 20 unit that *ARCA* has no equivalent for. The caller's code
 *   is fine and would be fine against another entity; only 33 of the 208 map here. Answering that with
 *   `UNKNOWN_CODE` would tell them their code is wrong when it is not, which is why
 *   `UNSUPPORTED_IDENTIFICATION_TYPE` is likewise its own code rather than folded into the unknown one.
 *
 * The second message carries the unit's own Rec 20 name and the entity that refused it, because the caller
 * has the code already and probably has neither.
 *
 * It never falls back to `98 otras unidades`. Resolving an hour to *otras unidades* would put a wrong unit on
 * a fiscal document under the appearance of success — the rule `toDstCmp` and `toMonId` already follow.
 */
export function toProUmedFromRec20(commonCode: string, at: string): number {
    const candidate = normalizeRec20Code(commonCode);
    const unit = REC20_UNITS.get(candidate);
    if (unit === undefined) {
        throw new ArcaValidationError(
            `${at} "${commonCode}" is not a unit of measure this service carries. It publishes a curated ` +
                'subset of UN/ECE Recommendation 20 Rev 17 — ask if you need one that is missing',
            'UNKNOWN_CODE',
        );
    }
    const proUmed = PRO_UMED_BY_REC20.get(candidate);
    if (proUmed === undefined) {
        throw new ArcaValidationError(
            `${at} "${candidate}" (${unit.name}) is a UN/ECE Recommendation 20 unit, but ARCA has no ` +
                'equivalent in its Pro_umed catalogue and this service will not substitute one',
            'UNSUPPORTED_UNIT_OF_MEASURE',
        );
    }
    return proUmed;
}
