import {describe, expect, it} from '@jest/globals';
import {deriveFiscalConditionCode} from './fiscal-condition.js';
import {TaxProcessFiscalConditionCode} from '../canonical-codes.js';
import type {PadronTax, TaxpayerData} from '../../sdk/taxpayer-registry/padron.types.js';

/**
 * The fiscal-condition derivation. The interesting cases are the ones that report NOTHING: this field
 * feeds a preselect in core's customer draft, so a wrong code costs the operator more than an absent one.
 */

function registration(taxes: Array<PadronTax>, overrides: Partial<TaxpayerData> = {}): TaxpayerData {
    return {
        detail: 'REGISTRATION',
        taxId: '20111111112',
        addresses: [],
        activities: [],
        taxes,
        providerMetadata: {},
        ...overrides,
    };
}

/** An active registration in one ARCA impuesto. */
function active(code: string, description: string): PadronTax {
    return {code, description, status: 'AC'};
}

describe('deriveFiscalConditionCode', () => {
    it('reads Responsable Inscripto off an active IVA registration', () => {
        expect(deriveFiscalConditionCode(registration([active('30', 'IMPUESTO AL VALOR AGREGADO')]))).toBe(
            TaxProcessFiscalConditionCode.RESPONSABLE_INSCRIPTO,
        );
    });

    it('reads Monotributo, Exento and No Alcanzado off their own impuestos', () => {
        expect(deriveFiscalConditionCode(registration([active('20', 'MONOTRIBUTO')]))).toBe(
            TaxProcessFiscalConditionCode.MONOTRIBUTO,
        );
        expect(deriveFiscalConditionCode(registration([active('32', 'IVA EXENTO')]))).toBe(
            TaxProcessFiscalConditionCode.SUJETO_EXENTO,
        );
        expect(deriveFiscalConditionCode(registration([active('34', 'IVA NO ALCANZADO')]))).toBe(
            TaxProcessFiscalConditionCode.IVA_NO_ALCANZADO,
        );
    });

    it('answers in the code space invoices already use, so core needs no second mapping', () => {
        // The point of ask 4: the condition a lookup reports is the one that later rides the invoice as
        // `receiver.fiscalConditionCode`. These are RG 5616 values, not a lookup-only vocabulary.
        expect(deriveFiscalConditionCode(registration([active('30', 'IVA')]))).toBe(1);
        expect(deriveFiscalConditionCode(registration([active('20', 'MONOTRIBUTO')]))).toBe(6);
    });

    it('ignores impuestos that say nothing about VAT', () => {
        // The individual in padron-parsing.test.ts is registered only in DERECHO ESPECIFICO. That is a
        // real, active registration and still no basis for a fiscal condition.
        const taxpayer = registration([active('2015', 'DERECHO ESPECIFICO')]);

        expect(deriveFiscalConditionCode(taxpayer)).toBeUndefined();
    });

    it('does not fall back to Consumidor Final when there is no VAT registration at all', () => {
        // Plausible, and not something ARCA said. Core preselects on this code, so the user picking from
        // a blank field beats the user un-picking a wrong default.
        expect(deriveFiscalConditionCode(registration([]))).toBeUndefined();
    });

    it('ignores a de-registered IVA rather than reporting Responsable Inscripto', () => {
        const deregistered: PadronTax = {code: '30', description: 'IVA', status: 'BD'};

        expect(deriveFiscalConditionCode(registration([deregistered]))).toBeUndefined();
    });

    it('does not count an impuesto the registry gave no status for', () => {
        // The registry never said the registration is current, and this derivation only speaks on
        // positive evidence.
        expect(deriveFiscalConditionCode(registration([{code: '30', description: 'IVA'}]))).toBeUndefined();
    });

    it('takes a monotributo category as evidence when no impuesto names a condition', () => {
        // ARCA returns `datosMonotributo` blocks carrying a categoría and no `impuesto` element at all
        // (see the recategorización fixtures). The taxpayer is a monotributista either way.
        const taxpayer = registration([], {simplifiedRegimeCategory: 'CATEGORIA D'});

        expect(deriveFiscalConditionCode(taxpayer)).toBe(TaxProcessFiscalConditionCode.MONOTRIBUTO);
    });

    it('agrees with itself when the category and the impuesto both say monotributo', () => {
        const taxpayer = registration([active('20', 'MONOTRIBUTO')], {
            simplifiedRegimeCategory: 'CATEGORIA D',
        });

        expect(deriveFiscalConditionCode(taxpayer)).toBe(TaxProcessFiscalConditionCode.MONOTRIBUTO);
    });

    it('ignores a category ARCA has already de-registered, rather than reporting Monotributo', () => {
        // `simplifiedRegimeCategory` is the latest entry of a HISTORICAL list and carries no state of its
        // own, so on its own it cannot tell a current monotributista from a former one. The impuesto can,
        // and it says the registration ended. Reading the category here would report a condition for a
        // taxpayer ARCA no longer holds one for — the same mistake `status: 'BD'` already rules out above.
        const taxpayer = registration([{code: '20', description: 'MONOTRIBUTO', status: 'BD'}], {
            simplifiedRegimeCategory: 'CATEGORIA D',
        });

        expect(deriveFiscalConditionCode(taxpayer)).toBeUndefined();
    });

    it('lets an active impuesto outrank a leftover category instead of reading them as a contradiction', () => {
        // A taxpayer who left monotributo for régimen general. The impuesto states a live status; the
        // category is what the registry still has on file from before. Treating the two as equal evidence
        // would silence the field for an ordinary Responsable Inscripto.
        const movedToGeneralRegime = registration([active('30', 'IVA')], {
            simplifiedRegimeCategory: 'CATEGORIA D',
        });

        expect(deriveFiscalConditionCode(movedToGeneralRegime)).toBe(
            TaxProcessFiscalConditionCode.RESPONSABLE_INSCRIPTO,
        );
    });

    it('still reads the category when the impuesto on file carries no state at all', () => {
        // "No state" is not "de-registered": ARCA said nothing, so the category remains the only evidence.
        const taxpayer = registration([{code: '20', description: 'MONOTRIBUTO'}], {
            simplifiedRegimeCategory: 'CATEGORIA D',
        });

        expect(deriveFiscalConditionCode(taxpayer)).toBe(TaxProcessFiscalConditionCode.MONOTRIBUTO);
    });

    it('reports nothing when the registrations on file contradict each other', () => {
        // Mutually exclusive in law, so an overlap is stale registry data. Precedence would let us pick
        // one; declining is the honest reading, and the caller still has `taxes[]` to show.
        const contradictory = registration([active('20', 'MONOTRIBUTO'), active('30', 'IVA')]);

        expect(deriveFiscalConditionCode(contradictory)).toBeUndefined();
    });

    it('reports nothing on an IDENTITY result, which carries no taxes to read', () => {
        const identity: TaxpayerData = {
            detail: 'IDENTITY',
            taxId: '27117096764',
            addresses: [],
            activities: [],
            providerMetadata: {},
        };

        expect(deriveFiscalConditionCode(identity)).toBeUndefined();
    });
});
