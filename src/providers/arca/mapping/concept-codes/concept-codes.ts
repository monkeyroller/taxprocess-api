import {ArcaValidationError} from '../../sdk/core/errors.js';
import type {InvoiceConcept} from '../../sdk/invoicing/common/common-invoice.types.js';
import type {FexExportType} from '../../sdk/invoicing/export/fex-invoice.types.js';
import {
    CONCEPT_GOODS_AND_SERVICES,
    CONCEPT_OTHER,
    type NeutralInvoiceConcept,
} from '../../../provider/neutral-invoice.js';

/**
 * What is being invoiced, translated to whichever of ARCA's two invoicing services authorizes the voucher.
 *
 * **The asymmetry is why both functions live in one module.** Each service rejects exactly the member the
 * other needs: `Concepto` has a "productos y servicios" that `Tipo_expo` lacks, and `Tipo_expo` has an
 * "otros" that `Concepto` lacks. Split across two files that fact is invisible, and the next person to
 * widen one set has no reason to look at the other.
 *
 * Both mappings are the **identity**, which is a fact about ARCA's numbering rather than a rule this
 * contract relies on. `Concepto` is 1/2/3 and `Tipo_expo` is 1/2/**4** — the gap at 3 is the authority's
 * own, verified against production `FEXGetPARAM_Tipo_Expo` on 2026-09-04 (exactly three rows, ids 1/2/4) —
 * and it is precisely that gap the export-only member occupies. The neutral catalogue is numbered to fit
 * both, so neither needs a lookup table.
 *
 * Which service a voucher belongs to is ARCA's decomposition and stays inside this provider (contract §9),
 * which is why the refusal lives here rather than in the DTO: deciding that document type 19 means "export,
 * so `3` is impossible" needs the authority's voucher-type numbering.
 */

/**
 * ARCA's `Concepto` for a neutral concept.
 *
 * Throws for `OTHER`: WSFEv1 has no code for it, so a domestic voucher cannot say it. Refused here with a
 * message naming the field rather than relayed as ARCA's own Spanish rejection.
 */
export function toConcepto(concept: NeutralInvoiceConcept): InvoiceConcept {
    if (concept === CONCEPT_OTHER) {
        throw new ArcaValidationError(
            `concept ${String(CONCEPT_OTHER)} (other) is not available on a domestic voucher — ARCA's ` +
                'Concepto covers goods, services and both, and has no code for anything else',
            'UNKNOWN_CODE',
        );
    }
    return concept;
}

/**
 * ARCA's `Tipo_expo` for a neutral concept.
 *
 * Throws for `GOODS_AND_SERVICES`, and the message has to be actionable because this is a real situation
 * rather than a typo: an export genuinely covering both has no code, so the caller has to decide how to
 * document it. ARCA's own numbering skipping 3 is what makes it unrepresentable, not a limit of ours.
 */
export function toTipoExpo(concept: NeutralInvoiceConcept): FexExportType {
    if (concept === CONCEPT_GOODS_AND_SERVICES) {
        throw new ArcaValidationError(
            `concept ${String(CONCEPT_GOODS_AND_SERVICES)} (goods and services) is not available on an ` +
                "export voucher — ARCA's Tipo_expo has no code for it. Issue separate vouchers, or name " +
                'the dominant one',
            'UNKNOWN_CODE',
        );
    }
    return concept;
}
