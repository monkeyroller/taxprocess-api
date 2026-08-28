import type {VatSubtotal} from '../invoice-totals/invoice-totals.js';

/**
 * SDK-facing request/response types for WSFEv1 (facturación electrónica común).
 *
 * The request is the SDK's own shape (English names); it is translated into the WSFEv1 SOAP schema
 * — whose field names (`PtoVta`, `CbteTipo`, `ImpTotal`, …) appear only inside the service that
 * builds the wire payload. Amounts are numbers; the service formats them for the wire.
 */

/** ARCA `Concepto`: 1 = productos, 2 = servicios, 3 = productos y servicios. */
export type InvoiceConcept = 1 | 2 | 3;

/** An associated voucher (`CbtesAsoc`), e.g. the invoice a credit note references. */
export interface AssociatedVoucher {
    /** `Tipo` — ARCA voucher type code. */
    voucherType: number;
    /** `PtoVta`. */
    pointOfSaleNumber: number;
    /** `Nro`. */
    number: number;
    /** `Cuit` of the associated voucher's issuer (optional). */
    cuit?: number;
}

/** An optional data field (`Opcionales`), e.g. FCE MiPyME CBU (id 2101). */
export interface InvoiceOptional {
    id: string;
    value: string;
}

/** An "other tribute" line (`Tributos`), e.g. a perception. `id` is the ARCA tribute id (99 = Otros). */
export interface InvoiceTribute {
    id: number;
    description?: string;
    /** `BaseImp` — taxable base for the tribute. */
    baseAmount: number;
    /** `Alic` — rate percentage. */
    rate: number;
    /** `Importe` — tribute amount. Sum of these must equal the request's `tributesAmount` (`ImpTrib`). */
    amount: number;
}

export interface CommonInvoiceRequest {
    pointOfSaleNumber: number;
    voucherType: number;
    concept: InvoiceConcept;
    /** ARCA DocTipo (e.g. 80 = CUIT, 96 = DNI, 99 = consumidor final). */
    docType: number;
    docNumber: number;
    voucherNumberFrom: number;
    voucherNumberTo: number;
    /** `CbteFch` in ARCA `yyyymmdd` format. */
    voucherDate: string;
    totalAmount: number;
    /** `ImpTotConc` — net not subject to VAT. */
    netUntaxed: number;
    /** `ImpNeto` — taxed net. */
    netTaxed: number;
    /** `ImpOpEx` — exempt amount. */
    exempt: number;
    /** `ImpIVA` — total VAT. */
    vatAmount: number;
    /** `ImpTrib` — other tributes. */
    tributesAmount: number;
    /** ARCA `MonId`, e.g. `"PES"`, `"DOL"`, `"060"`. */
    currencyId: string;
    /** `MonCotiz` — exchange rate to ARS (1 for PES). */
    currencyRate: number;
    /**
     * `CondicionIVAReceptorId` — the receiver's IVA condition (RG 5616, mandatory). Uses the AFIP
     * `FEParamGetCondicionIvaReceptor` codes (1 = Responsable Inscripto, 5 = Consumidor Final,
     * 6 = Monotributo, …).
     */
    receiverIvaConditionId?: number;
    /** `Iva[]` subtotals grouped by alícuota. */
    vatSubtotals: Array<VatSubtotal>;
    /** `Tributos[]` — other tributes (e.g. perceptions). Their `amount`s must sum to `tributesAmount`. */
    tributes?: Array<InvoiceTribute>;
    /** `FchServDesde` (yyyymmdd) — required when concept is 2 or 3. */
    serviceDateFrom?: string;
    /** `FchServHasta` (yyyymmdd) — required when concept is 2 or 3. */
    serviceDateTo?: string;
    /** `FchVtoPago` (yyyymmdd) — required when concept is 2 or 3. */
    paymentDueDate?: string;
    associatedVouchers?: Array<AssociatedVoucher>;
    optionals?: Array<InvoiceOptional>;
}

/**
 * An ARCA observation (`Observaciones.Obs`). Attached to ANY result, not only a partial/rejected one: ARCA
 * routinely approves a voucher (`Resultado: "A"`, real CAE) while still reporting observations about it. The
 * parse is deliberately independent of `Resultado` so an approved-with-observations voucher keeps them.
 */
export interface ArcaObservation {
    code: string;
    message: string;
}

export interface CommonInvoiceResult {
    /** `A` = aprobado, `R` = rechazado, `P` = parcial. */
    result: 'A' | 'R' | 'P';
    cae?: string;
    /** `CAEFchVto` in ARCA `yyyymmdd` format. */
    caeExpiration?: string;
    voucherNumberFrom: number;
    voucherNumberTo: number;
    observations: Array<ArcaObservation>;
    /** The raw parsed `FeDetResp`/`ResultGet` for callers needing fields the SDK does not surface. */
    raw: Record<string, unknown>;
}
