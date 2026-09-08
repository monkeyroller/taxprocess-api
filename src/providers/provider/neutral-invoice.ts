/**
 * The neutral invoice vocabulary: the provider-agnostic shape core sends, carrying canonical fiscal
 * codes rather than any authority's own. The provider maps these to the entity's real codes.
 */
import type {WebService} from './web-service.js';

/**
 * What is being invoiced — **this contract's own catalogue**, four codes covering every document an entity
 * can issue.
 *
 * **Not every code is valid on every voucher**, which makes this the one catalogue whose accepted set
 * depends on which of an entity's services answers. A domestic voucher cannot be `OTHER` and an export
 * cannot be `GOODS_AND_SERVICES`, because the authorities that issue them have no such code — the provider
 * refuses the one its service cannot express, naming the field.
 *
 * The numbers are **ours**, not an authority's, even where they coincide: for ARCA both mappings happen to
 * be the identity, which is a fact about ARCA's numbering rather than a rule. A second entity maps these to
 * whatever it uses, exactly as it would its own currency codes.
 *
 * A `const` object rather than an `enum`, following `ServiceId`. Three properties it needs at once, and no
 * other shape has all three: the names and the values are **one** declaration (four loose constants beside
 * a literal array were two, with nothing tying `4` in one to `4` in the other); a plain `1` still satisfies
 * the type, so a caller, a DTO and a fixture all read naturally; and `Object.values` carries no enum
 * reverse mapping, so the runtime list below holds numbers only.
 *
 * That last point is why the DTO validates with `@IsIn` over this list rather than `@IsEnum` over an enum:
 * `isEnum` accepts `Object.keys(e).map(k => e[k])`, which for a numeric enum is `['GOODS', 1, …]` — it
 * would take the member *name* as a valid value and pass a string through to the wire.
 */
export const Concept = {
    /** Goods. Shipped on a date, which is what every rule keyed on this member turns on. */
    GOODS: 1,
    /** Services. Rendered over a period, so the entity asks when they are paid rather than when they ship. */
    SERVICES: 2,
    /** Goods and services on one voucher. **Domestic only** — no export authority has a code for it. */
    GOODS_AND_SERVICES: 3,
    /** Neither, as the entity classifies it. **Export only** — no domestic authority has a code for it. */
    OTHER: 4,
} as const;

export type NeutralInvoiceConcept = (typeof Concept)[keyof typeof Concept];

/**
 * The runtime companion, derived so it cannot fall behind the catalogue — which is the whole reason for the
 * shape above. The DTO's validator reads this.
 */
export const NEUTRAL_INVOICE_CONCEPTS: ReadonlyArray<NeutralInvoiceConcept> = Object.values(Concept);

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
 * That widening makes one long-required field conditional: `receiver` describes a domestic voucher and has
 * no meaning on an export, which identifies its buyer by free text plus a destination. Exactly one of
 * `receiver` and `export` is present, and the DTO is where that is enforced.
 *
 * `concept` is *not* one of them. It says what the voucher bills, which every document has to answer, so it
 * is required throughout — only the set of codes it may take narrows per document.
 */
export interface NeutralInvoice {
    readonly documentTypeCode: number;
    /**
     * What is being invoiced, on every voucher — see {@link NEUTRAL_INVOICE_CONCEPTS}. Which codes are
     * valid depends on the document: an export cannot be `GOODS_AND_SERVICES` and a domestic voucher cannot
     * be `OTHER`.
     */
    readonly concept: NeutralInvoiceConcept;
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
