/**
 * The neutral invoice vocabulary: the provider-agnostic shape core sends, carrying canonical fiscal
 * codes rather than any authority's own. The provider maps these to the entity's real codes.
 */

/**
 * What is being invoiced: 1 = goods, 2 = services, 3 = both (AR: `Concepto`). A runtime value paired with
 * the type below, so the DTO's validator cannot keep validating an old set after a member is added here.
 */
export const NEUTRAL_INVOICE_CONCEPTS = [1, 2, 3] as const;

export type NeutralInvoiceConcept = (typeof NEUTRAL_INVOICE_CONCEPTS)[number];

/** One taxed line: net (base) + tax amount at a given rate. */
export interface NeutralInvoiceLine {
    readonly netAmount: number;
    readonly taxRatePercent: number;
    readonly taxAmount: number;
}

/** The invoice receiver, identified by a per-entity identification type + number. */
export interface NeutralInvoiceReceiver {
    readonly identificationTypeCode: number;
    readonly identificationNumber: string;
    readonly fiscalConditionCode: number;
}

/** Optional invoice-level totals not derivable from the taxed lines. */
export interface NeutralInvoiceTotals {
    readonly untaxed?: number;
    readonly exempt?: number;
    readonly perceptions?: number;
}

/** A neutral invoice carrying canonical codes, which the provider maps to the entity's real ones. */
export interface NeutralInvoice {
    readonly documentTypeCode: number;
    readonly concept: NeutralInvoiceConcept;
    readonly pointOfSaleNumber: number;
    /** AR: `CbteDesde`. Core owns the number; the service never computes it. */
    readonly voucherNumberFrom: number;
    /** AR: `CbteHasta`. Single-voucher flow, so it equals `voucherNumberFrom`. */
    readonly voucherNumberTo: number;
    readonly receiver: NeutralInvoiceReceiver;
    /**
     * The authority's own currency code (AR: `MonId`) — the fourth canonical fiscal code. Exactly one of
     * this and `currencyIso` is present, and `currencyIso` goes once every caller sends this one.
     */
    readonly currencyCode?: string;
    /** @deprecated ISO-4217 code, superseded by `currencyCode`. */
    readonly currencyIso?: string;
    readonly currencyRate: number;
    readonly issueDate: string;
    readonly lines: ReadonlyArray<NeutralInvoiceLine>;
    readonly totals?: NeutralInvoiceTotals;
    readonly serviceDateFrom?: string;
    readonly serviceDateTo?: string;
    readonly paymentDueDate?: string;
}
