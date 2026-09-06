/**
 * The neutral invoice vocabulary: the provider-agnostic shape core sends, carrying canonical fiscal
 * codes rather than any authority's own. The provider maps these to the entity's real codes.
 */
import type {WebService} from './web-service.js';

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

/**
 * One line of product detail.
 *
 * **Not `NeutralInvoiceLine`.** That name is already taken by a *tax subtotal* — net, rate, tax — which is
 * what a WSFEv1 voucher carries instead of any per-product breakdown. This is the product line itself, and
 * the two coexist rather than replace each other: a document can need both.
 *
 * Required by the services that invoice with detail: the export document (AR: WSFEX `Items`) and, when it
 * lands, factura electrónica con detalle (AR: WSMTXCA `arrayItems`). WSFEv1 has no item array at all.
 *
 * `taxRatePercent`/`taxAmount` are here for the con-detalle case, whose items carry per-item VAT. An export
 * is zero-rated and ignores them.
 */
export interface NeutralInvoiceItem {
    readonly code?: string;
    readonly description: string;
    readonly quantity?: number;
    /**
     * The authority's own unit code (AR: `Pro_umed`) — a canonical fiscal code, not a unit name, because
     * some of its values are not units. AR's `0`, `97` and `99` mark a line with no unit, a deposit and a
     * discount, and they change which amount rules apply.
     */
    readonly unitOfMeasureCode: number;
    readonly unitPrice?: number;
    readonly discount?: number;
    readonly totalAmount: number;
    readonly taxRatePercent?: number;
    readonly taxAmount?: number;
}

/** A customs shipping permit and the destination of the goods it covers (AR: `Permisos`). */
export interface NeutralShippingPermit {
    /** The authority's despacho code (AR: `Id_permiso`). */
    readonly permitId: string;
    /** Where the goods are going, in the same catalogue as the invoice's own destination. */
    readonly destinationCode: string;
}

/** An associated voucher — the invoice a credit or debit note references. */
export interface NeutralAssociatedVoucher {
    readonly documentTypeCode: number;
    readonly pointOfSaleNumber: number;
    readonly number: number;
    /** The issuer of the associated voucher, when it is not the issuer of this one. */
    readonly issuerTaxId?: string;
}

/**
 * The foreign-trade block: everything an export voucher needs and a domestic one has no field for.
 *
 * Its presence is what makes an invoice an export, and it stands in for `receiver`: an export identifies its
 * buyer by free text plus a destination, having no equivalent of the domestic identification-type/number
 * and fiscal-condition triple.
 */
export interface NeutralInvoiceExport {
    /** What is being exported. Distinct from `concept`, which has a "both" this vocabulary lacks. */
    readonly exportType: 'GOODS' | 'SERVICES' | 'OTHER';
    /**
     * Where the voucher is destined, as the authority's own customs-destination code (AR: `Dst_cmp`).
     *
     * A canonical fiscal code rather than ISO 3166-1, because the catalogue is a *customs destination* list
     * and ISO cannot express it: free zones are destinations distinct from the country containing them,
     * some codes aggregate several countries, and others are catch-alls. The special-customs-area code an
     * Argentine Tierra del Fuego shipment uses is one of the unmappable ones.
     */
    readonly destinationCode: string;
    /** Whether a customs shipping permit exists yet (AR: `Permiso_existente`). */
    readonly shippingPermitPresent?: boolean;
    readonly shippingPermits?: ReadonlyArray<NeutralShippingPermit>;
    readonly clientName: string;
    readonly clientAddress: string;
    /** The buyer's own tax identification in its own country (AR: `Id_impositivo`). */
    readonly clientTaxId?: string;
    /**
     * The authority's generic per-country tax id for the buyer (AR: `Cuit_pais_cliente`).
     *
     * Passed through, never derived: the authority publishes no key joining these to its destination codes,
     * and has no value at all for a special customs area or a free zone. `clientTaxId` is the ordinary path.
     */
    readonly clientCountryTaxId?: string;
    /** The ICC Incoterms clause. An international standard, so it travels as itself. */
    readonly incoterm?: string;
    readonly incotermDescription?: string;
    /** The language the document is written in, as ISO 639-1. */
    readonly language: 'es' | 'en' | 'pt';
    /** The voucher is settled in its own foreign currency (AR: `CanMisMonExt`). */
    readonly settledInInvoiceCurrency?: boolean;
    readonly paymentTerms?: string;
    readonly commercialObservations?: string;
    readonly observations?: string;
    /** When payment is due (AR: `Fecha_pago`), mandatory for a services or other export invoice. */
    readonly paymentDate?: string;
}

/** An optional data field the authority defines by regulation (AR: `Opcionales`). */
export interface NeutralInvoiceOptional {
    readonly id: string;
    readonly value: string;
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

/**
 * A neutral invoice carrying canonical codes, which the provider maps to the entity's real ones.
 *
 * One shape for every document the entity can issue, rather than one per authority service. Which service
 * answers is the provider's decision (contract §9 keeps the authority's voucher-type vocabulary internal),
 * so widening this is what lets an export voucher — and, later, one with per-item detail — travel the same
 * endpoint as a domestic one.
 *
 * That widening makes two long-required fields conditional. `receiver` and `concept` describe a domestic
 * voucher and have no meaning on an export, which identifies its buyer by free text plus a destination and
 * replaces the concept with an export type. Exactly one of `receiver` and `export` is present, and the DTO
 * is where that is enforced.
 */
export interface NeutralInvoice {
    readonly documentTypeCode: number;
    /**
     * What is being invoiced. Present for a domestic voucher and absent for an export, whose equivalent is
     * `export.exportType` — a different vocabulary, not a renaming.
     */
    readonly concept?: NeutralInvoiceConcept;
    readonly pointOfSaleNumber: number;
    /** AR: `CbteDesde`. Core owns the number; the service never computes it. */
    readonly voucherNumberFrom: number;
    /** AR: `CbteHasta`. Single-voucher flow, so it equals `voucherNumberFrom`. */
    readonly voucherNumberTo: number;
    /** The buyer of a domestic voucher. Absent on an export, which carries `export` instead. */
    readonly receiver?: NeutralInvoiceReceiver;
    /**
     * Which of the entity's web services should answer (the entity's `configuration.webService`).
     *
     * Omitted is the authority's ordinary domestic service. Only the caller can settle the cases a document
     * type cannot: an authority may have two services that issue the same voucher types.
     */
    readonly webService?: WebService;
    /**
     * The authority's own currency code (AR: `MonId`) — the fourth canonical fiscal code. Exactly one of
     * this and `currencyIso` is present, and `currencyIso` goes once every caller sends this one.
     */
    readonly currencyCode?: string;
    /** @deprecated ISO-4217 code, superseded by `currencyCode`. */
    readonly currencyIso?: string;
    readonly currencyRate: number;
    readonly issueDate: string;
    /** Tax subtotals. Empty on an export, which is zero-rated and has no VAT to break down. */
    readonly lines: ReadonlyArray<NeutralInvoiceLine>;
    /** Per-product detail. Required by the services that invoice with detail; unused by the others. */
    readonly items?: ReadonlyArray<NeutralInvoiceItem>;
    /** The foreign-trade block. Its presence is what makes this an export voucher. */
    readonly export?: NeutralInvoiceExport;
    /** Vouchers this one references — the invoice a credit or debit note adjusts. */
    readonly associatedVouchers?: ReadonlyArray<NeutralAssociatedVoucher>;
    /** Optional data fields the authority defines by regulation. */
    readonly optionals?: ReadonlyArray<NeutralInvoiceOptional>;
    readonly totals?: NeutralInvoiceTotals;
    readonly serviceDateFrom?: string;
    readonly serviceDateTo?: string;
    readonly paymentDueDate?: string;
}
