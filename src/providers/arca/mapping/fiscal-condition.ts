import {TaxProcessFiscalConditionCode} from './code-maps.js';
import type {TaxpayerData, PadronTax} from '../sdk/index.js';

/**
 * The taxpayer's fiscal condition, derived from what the padrón reports — core's CONTRACT-REQUESTS ask 4.
 *
 * The answer is a canonical `fiscalConditionCode`, the **same code space** `invoice.receiver` already
 * carries (`code-maps.ts` → RG 5616 / `CondicionIVAReceptorId`), so the condition a lookup reports is the
 * one that will later ride the invoice for that customer and core needs no new mapping.
 *
 * Deriving it means reading ARCA impuesto ids, which CONTRACT §9 keeps inside this provider — core would
 * otherwise have to hardcode an AFIP impuesto table, which both repos agreed it should not do.
 */

/**
 * The ARCA `idImpuesto` values that state a VAT condition, and the canonical code each implies. Confirmed
 * against ARCA's impuesto catalog; `20` is corroborated by a real constancia response in
 * `padron.parsers.test.ts`. Every other impuesto a taxpayer holds (ganancias, seguridad social, the
 * `DERECHO ESPECIFICO` of the fixtures, …) says nothing about VAT and is deliberately not listed.
 */
const VAT_CONDITION_BY_TAX_CODE: ReadonlyMap<string, TaxProcessFiscalConditionCode> = new Map([
    ['20', TaxProcessFiscalConditionCode.MONOTRIBUTO],
    ['30', TaxProcessFiscalConditionCode.RESPONSABLE_INSCRIPTO],
    ['32', TaxProcessFiscalConditionCode.SUJETO_EXENTO],
    ['34', TaxProcessFiscalConditionCode.IVA_NO_ALCANZADO],
]);

/**
 * ARCA's `estadoImpuesto` for a live registration. A de-registered IVA (`BD`, `BP`, …) must not report
 * Responsable Inscripto, and an impuesto that carries **no** state at all is not counted either: the
 * registry did not say it is current, and this whole derivation only ever speaks on positive evidence.
 */
const ACTIVE_TAX_STATUS = 'AC';

/** ARCA's `idImpuesto` for monotributo — the registration the category is an attribute of. */
const MONOTRIBUTO_TAX_CODE = '20';

function isActive(tax: PadronTax): boolean {
    return tax.status?.toUpperCase() === ACTIVE_TAX_STATUS;
}

/**
 * Whether ARCA stated outright that the monotributo registration has **ended** — an impuesto `20` on file
 * carrying a state that is not `AC`. Distinct from "no state at all", which says nothing either way.
 */
function isMonotributoDeregistered(taxes: ReadonlyArray<PadronTax>): boolean {
    return taxes.some(
        (tax) => tax.code === MONOTRIBUTO_TAX_CODE && tax.status !== undefined && !isActive(tax),
    );
}

/**
 * The canonical fiscal-condition code for a taxpayer, or `undefined` when the registry gives no basis to
 * determine one — in which case the key is omitted from the wire entirely, never sent as `null`.
 *
 * Two tiers of evidence, and the order matters. **Active impuestos decide.** They are registrations the
 * registry states a live status for, and they are mutually exclusive in law — so exactly one is the
 * answer and more than one is stale data we decline to guess between. **The monotributo category is only
 * consulted when the impuestos name no VAT condition at all**, because it is an attribute of a
 * registration rather than a registration: `simplifiedRegimeCategory` is the latest entry of the
 * historical `categoriaMonotributo` list, carries no state of its own, and therefore cannot outrank —
 * or contradict — an impuesto that says what is current today.
 *
 * `undefined` is the answer in these situations, all of them normal:
 *
 * - **`IDENTITY` results**, which carry no `taxes` at all — A13 cannot report the tax picture.
 * - **No VAT-relevant registration**, e.g. the individual in `padron.parsers.test.ts` registered only in
 *   `DERECHO ESPECIFICO`. Consumidor Final is *not* assumed here: it is a plausible guess rather than
 *   something ARCA stated, and core preselects on this code — a wrong preselect is worse for the operator
 *   than an empty field they were always going to fill in.
 * - **Contradictory registrations**, where more than one VAT condition is active at once. These are
 *   mutually exclusive in law, so overlap means stale registry data. Precedence would let us pick one
 *   anyway; picking nothing is the honest reading, and the caller still has `taxes[]` to show.
 * - **A category ARCA has already ended**, where the only evidence is a monotributo category and an
 *   impuesto `20` de-registered (`BD`, `BP`, …). The category is then history, not a condition.
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

    // Nothing active to read, so fall back to the category. This is what covers the `datosMonotributo`
    // blocks ARCA returns carrying a `categoriaMonotributo` and no `impuesto` element at all (see the
    // recategorización fixtures) — the taxpayer is a monotributista and no impuesto says so. A `20` the
    // registry has since given a non-active state is the one thing that overrides it: ARCA said the
    // registration ended, and a category left on file cannot re-open it.
    if (data.simplifiedRegimeCategory === undefined || isMonotributoDeregistered(taxes)) {
        return undefined;
    }
    return TaxProcessFiscalConditionCode.MONOTRIBUTO;
}
