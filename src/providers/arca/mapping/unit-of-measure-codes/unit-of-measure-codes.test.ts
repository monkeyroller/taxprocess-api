import {describe, expect, it} from '@jest/globals';
import {
    PRO_UMED_BY_LINE_TYPE,
    PRO_UMED_BY_REC20,
    REC20_BY_PRO_UMED,
    REC20_CANNOT_NAME,
    UNITS_OF_MEASURE,
    assertUnitOfMeasureScheme,
    isKnownUnitOfMeasureCode,
    proUmedForLineType,
    toProUmedFromRec20,
} from './unit-of-measure-codes.js';
import {InvoiceLineType} from '../../../provider/invoice-line-type/invoice-line-type.js';
import {REC20_UNITS} from '../../../provider/rec20-units/rec20-units.js';
import {UnitOfMeasureCodeScheme} from '../../../provider/unit-of-measure-scheme/unit-of-measure-scheme.js';
import {codeOf, messageOf} from '../validation-error.test-support.js';

describe('UNITS_OF_MEASURE', () => {
    it('carries the whole production table', () => {
        expect(UNITS_OF_MEASURE.size).toBe(49);
        expect(UNITS_OF_MEASURE.get('1')).toBe('kilogramos');
        expect(UNITS_OF_MEASURE.get('7')).toBe('unidades');
    });

    it('repairs the one row ARCA publishes double-encoded', () => {
        expect(UNITS_OF_MEASURE.get('95')).toBe('anulación/devolución');
    });

    it('refuses an id the authority does not publish', () => {
        // The catalogue is sparse -- it runs 0..11, then jumps -- so an absent id is a plausible typo rather
        // than an obviously silly value, which is what makes the membership check worth keeping.
        expect(isKnownUnitOfMeasureCode(12)).toBe(false);
        expect(isKnownUnitOfMeasureCode(94)).toBe(false);
        expect(isKnownUnitOfMeasureCode(7)).toBe(true);
    });
});

describe("the classification of ARCA's 49 ids", () => {
    it('accounts for every one, so a re-dump cannot add a unit nobody read', () => {
        // Not `33 + 3 + 13 === 49`, which would pass with an id sitting in two of the three buckets. The
        // union-plus-size pair is what actually holds: it catches both a missing id and a double-counted one.
        const classified = new Set<number>([
            ...REC20_BY_PRO_UMED.keys(),
            ...PRO_UMED_BY_LINE_TYPE.values(),
            ...REC20_CANNOT_NAME.keys(),
        ]);
        expect(classified.size).toBe(UNITS_OF_MEASURE.size);
        expect([...UNITS_OF_MEASURE.keys()].every((id) => classified.has(Number(id)))).toBe(true);
    });

    it('splits them 33 named, 3 line types and 13 unnameable', () => {
        // Pinned separately as well as together, so a row moving between the buckets is visible as a move
        // rather than netting out to the same total.
        expect(REC20_BY_PRO_UMED.size).toBe(33);
        expect(PRO_UMED_BY_LINE_TYPE.size).toBe(3);
        expect(REC20_CANNOT_NAME.size).toBe(13);
    });

    it('classifies nothing the authority does not publish', () => {
        const classified = [...REC20_BY_PRO_UMED.keys(), ...REC20_CANNOT_NAME.keys()];
        expect(classified.every(isKnownUnitOfMeasureCode)).toBe(true);
    });
});

describe('REC20_BY_PRO_UMED', () => {
    it('names only codes this service actually carries', () => {
        // The assertion that stops the curation rule and this map drifting apart: tighten the rule without
        // adding the row back to the generator's rule C and this fails rather than the mapping silently
        // pointing at nothing.
        expect([...REC20_BY_PRO_UMED.values()].every((code) => REC20_UNITS.has(code))).toBe(true);
    });

    it('maps no two ARCA units onto one Rec 20 code, so the reverse never has to pick a winner', () => {
        expect(PRO_UMED_BY_REC20.size).toBe(REC20_BY_PRO_UMED.size);
    });

    it('reads 7 unidades as C62 and 98 otras unidades as ZZ, the two that were decided rather than read', () => {
        // `C62 one` publishes "unit" as its synonym, which is what makes it the countable one rather than
        // `H87 piece`; `ZZ mutually defined` is "as agreed in common between two or more parties", which is
        // otras unidades exactly. Named here so a reader looking for the judgements finds them.
        expect(REC20_BY_PRO_UMED.get(7)).toBe('C62');
        expect(REC20_BY_PRO_UMED.get(98)).toBe('ZZ');
    });

    it('reads the units that were not decided at all', () => {
        expect(REC20_BY_PRO_UMED.get(1)).toBe('KGM');
        expect(REC20_BY_PRO_UMED.get(6)).toBe('MWH');
        expect(REC20_BY_PRO_UMED.get(61)).toBe('E4');
    });
});

describe('REC20_CANNOT_NAME', () => {
    it('gives every unit a reason, since an unexplained exclusion is how a catalogue drifts', () => {
        expect([...REC20_CANNOT_NAME.values()].every((entry) => entry.reason.length > 0)).toBe(true);
    });

    it('separates what Rec 20 defines nothing for from what was never a unit', () => {
        // Two different facts. `95` is a cancellation marker ARCA parked in the unit table; the other twelve
        // are real units the recommendation has no word for.
        expect(REC20_CANNOT_NAME.get(95)?.kind).toBe('NOT_A_UNIT');
        expect(REC20_CANNOT_NAME.get(66)?.kind).toBe('REC20_DEFINES_NONE');
        expect([...REC20_CANNOT_NAME.values()].filter((e) => e.kind === 'NOT_A_UNIT')).toHaveLength(1);
    });

    it('holds the masses and activities an agroquímico or pharma export is priced in', () => {
        // The business consequence of this register: these lines cannot be invoiced through this service.
        for (const id of [34, 35, 51, 52, 53, 62, 63, 64, 65, 66, 67, 68]) {
            expect(REC20_CANNOT_NAME.has(id)).toBe(true);
        }
    });

    it('claims no id the map already names', () => {
        expect([...REC20_CANNOT_NAME.keys()].some((id) => REC20_BY_PRO_UMED.has(id))).toBe(false);
    });
});

describe('PRO_UMED_BY_LINE_TYPE', () => {
    it('says what a line is through the three ids ARCA reserves for it', () => {
        expect(PRO_UMED_BY_LINE_TYPE.get(InvoiceLineType.LUMP_SUM)).toBe(0);
        expect(PRO_UMED_BY_LINE_TYPE.get(InvoiceLineType.DEPOSIT)).toBe(97);
        expect(PRO_UMED_BY_LINE_TYPE.get(InvoiceLineType.DISCOUNT)).toBe(99);
    });

    it('takes no Pro_umed from a product line, which is measured by its unit', () => {
        // The absence is load-bearing: an answer here would let two sources both claim the same line, and
        // one of them would be wrong. Asserted twice over -- the runtime map has no entry, and asking for
        // one does not compile, which is what narrowing the parameter to the non-product types buys.
        // @ts-expect-error a product line is measured by its unit, so it is not a thing to look up here.
        expect(PRO_UMED_BY_LINE_TYPE.has(InvoiceLineType.PRODUCT)).toBe(false);
        // @ts-expect-error same, through the function -- the guard is what a caller reaches this through.
        expect(codeOf(() => proUmedForLineType(InvoiceLineType.PRODUCT))).toBe('INVALID_LINE_TYPE');
    });
});

describe('assertUnitOfMeasureScheme', () => {
    const at = 'items[0].unitOfMeasureCode';

    it('reads an absent scheme, and the one member, as UN/ECE Rec 20', () => {
        // Absent is the field's documented default, which is why nothing on the wire has to spell it.
        expect(() => assertUnitOfMeasureScheme(undefined, at)).not.toThrow();
        expect(() => assertUnitOfMeasureScheme(UnitOfMeasureCodeScheme.UN_ECE_REC20, at)).not.toThrow();
    });

    it('refuses a catalogue it does not read, which is what makes a second member additive', () => {
        // Unreachable while the vocabulary has one member, and cast for exactly that reason: the guarantee
        // that adding a standard is additive is only worth stating if something reads the field, and the day
        // a second lands its codes must not be read through the Rec 20 table.
        const rec21 = 'UN-ECE-REC21' as UnitOfMeasureCodeScheme;
        expect(codeOf(() => assertUnitOfMeasureScheme(rec21, at))).toBe(
            'UNSUPPORTED_UNIT_OF_MEASURE_SCHEME',
        );
        // Names the field and the catalogue refused, since the caller sent both.
        expect(messageOf(() => assertUnitOfMeasureScheme(rec21, at))).toContain(at);
        expect(messageOf(() => assertUnitOfMeasureScheme(rec21, at))).toContain('UN-ECE-REC21');
    });
});

describe('toProUmedFromRec20', () => {
    const at = 'items[0].unitOfMeasureCode';

    it('resolves a unit ARCA can express', () => {
        expect(toProUmedFromRec20('KGM', at)).toBe(1);
        expect(toProUmedFromRec20('ZZ', at)).toBe(98);
    });

    it('tolerates the casing and padding a hand-typed body arrives with', () => {
        expect(toProUmedFromRec20(' kgm ', at)).toBe(1);
    });

    it('tells a code it does not carry apart from a unit ARCA cannot express', () => {
        // The distinction is the point of the pair, so both branches are asserted rather than "it threw":
        // answering UNKNOWN_CODE for HUR would tell a caller its code is wrong when the code is fine.
        expect(codeOf(() => toProUmedFromRec20('KGX', at))).toBe('UNKNOWN_CODE');
        expect(codeOf(() => toProUmedFromRec20('HUR', at))).toBe('UNSUPPORTED_UNIT_OF_MEASURE');
    });

    it('names the unit and the field when ARCA cannot express it, since the caller has neither', () => {
        const message = messageOf(() => toProUmedFromRec20('HUR', at));
        expect(message).toContain('HUR');
        expect(message).toContain('hour');
        expect(message).toContain('ARCA');
        expect(message).toContain(at);
    });

    it('says the catalogue is a subset when it does not carry a code, rather than that the unit is invalid', () => {
        // `HTZ` is a real Rec 20 unit this service curated out. The message has to invite the ask, because
        // adding it back is a one-line data change.
        expect(messageOf(() => toProUmedFromRec20('HTZ', at))).toContain('curated');
    });

    it('never substitutes otras unidades for a unit it cannot map', () => {
        // Resolving an hour to 98 would put a wrong unit on a fiscal document under the appearance of
        // success -- the rule toDstCmp and toMonId already follow.
        for (const code of ['HUR', 'HTZ', 'KGX']) {
            // The helper fails the test if the call returns instead of throwing, so a code reaching this
            // assertion has already been refused; what is pinned here is that it carries a reason.
            expect(codeOf(() => toProUmedFromRec20(code, at))).toBeDefined();
        }
    });
});
