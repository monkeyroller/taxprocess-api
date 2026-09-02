import {TaxProcessFiscalConditionCode} from '../canonical-codes.js';
import type {PadronTax, TaxpayerData} from '../../sdk/taxpayer-registry/padron.types.js';

/**
 * The taxpayer's fiscal condition, derived from what the padrón reports, so core can seed a customer's
 * contributor type from a lookup instead of leaving it to be picked by hand.
 *
 * The answer is a canonical `fiscalConditionCode`, the same code space `invoice.receiver` carries, so the
 * condition a lookup reports is the one that will later ride the invoice for that customer.
 *
 * Deriving it means reading ARCA impuesto ids, which stay inside this provider — core would otherwise have
 * to hardcode an AFIP impuesto table.
 */

/**
 * The ARCA `idImpuesto` values that state a VAT condition, and the canonical code each implies. Confirmed
 * against ARCA's impuesto catalog. Every other impuesto a taxpayer holds says nothing about VAT and is
 * deliberately not listed.
 */
const VAT_CONDITION_BY_TAX_CODE: ReadonlyMap<string, TaxProcessFiscalConditionCode> = new Map([
    ['20', TaxProcessFiscalConditionCode.MONOTRIBUTO],
    ['30', TaxProcessFiscalConditionCode.RESPONSABLE_INSCRIPTO],
    ['32', TaxProcessFiscalConditionCode.SUJETO_EXENTO],
    ['34', TaxProcessFiscalConditionCode.IVA_NO_ALCANZADO],
]);

/**
 * ARCA's `estadoImpuesto` for a live registration. A de-registered IVA must not report Responsable
 * Inscripto, and an impuesto carrying no state at all is not counted either: the registry did not say it is
 * current, and this derivation only ever speaks on positive evidence.
 */
const ACTIVE_TAX_STATUS = 'AC';

/** ARCA's `idImpuesto` for monotributo — the registration the category is an attribute of. */
const MONOTRIBUTO_TAX_CODE = '20';

function isActive(tax: PadronTax): boolean {
    return tax.status?.toUpperCase() === ACTIVE_TAX_STATUS;
}

/**
 * Whether ARCA stated outright that the monotributo registration has ended — an impuesto `20` on file
 * carrying a state that is not `AC`. Distinct from no state at all, which says nothing either way.
 */
function isMonotributoDeregistered(taxes: ReadonlyArray<PadronTax>): boolean {
    return taxes.some(
        (tax) => tax.code === MONOTRIBUTO_TAX_CODE && tax.status !== undefined && !isActive(tax),
    );
}

/**
 * The canonical fiscal-condition code for a taxpayer, or `undefined` when the registry gives no basis for
 * one — in which case the key is omitted from the wire, never sent as `null`.
 *
 * Two tiers of evidence, in order. Active impuestos decide: they are registrations the registry states a
 * live status for, and they are mutually exclusive in law, so exactly one is the answer and more than one is
 * stale data. The monotributo category is consulted only when the impuestos name no VAT condition at all,
 * because it is an attribute of a registration rather than a registration — the latest entry of a historical
 * list, carrying no state of its own, so it cannot outrank an impuesto that says what is current today.
 *
 * `undefined` is the answer in four normal situations: an `IDENTITY` result, which carries no `taxes` at all;
 * a taxpayer with no VAT-relevant registration, where Consumidor Final is a plausible guess rather than
 * something ARCA stated and a wrong preselect is worse for the operator than an empty field; contradictory
 * registrations, where overlap means stale registry data and picking nothing is the honest reading; and a
 * category ARCA has already ended, which is history rather than a condition.
 */
export function deriveFiscalConditionCode(data: TaxpayerData): TaxProcessFiscalConditionCode | undefined {
    const taxes = data.taxes ?? [];
    const conditions = new Set<TaxProcessFiscalConditionCode>();

    for (const tax of taxes) {
        const condition = VAT_CONDITION_BY_TAX_CODE.get(tax.code);
        if (condition !== undefined && isActive(tax)) {
            conditions.add(condition);
        }
    }
    if (conditions.size > 0) {
        return conditions.size === 1 ? [...conditions][0] : undefined;
    }

    // Nothing active to read, so fall back to the category. This covers the `datosMonotributo` blocks ARCA
    // returns carrying a `categoriaMonotributo` and no `impuesto` element at all — the taxpayer is a
    // monotributista and no impuesto says so. A `20` since given a non-active state overrides it: ARCA said
    // the registration ended, and a category left on file cannot re-open it.
    if (data.simplifiedRegimeCategory === undefined || isMonotributoDeregistered(taxes)) {
        return undefined;
    }
    return TaxProcessFiscalConditionCode.MONOTRIBUTO;
}
