import type {ArcaCodeMessage} from '../../core/errors.js';
import type {VatSubtotal} from '../invoice-totals/invoice-totals.js';
import type {NeutralInvoiceConcept} from '../../../../provider/neutral-invoice.js';

/**
 * SDK-facing request/response types for WSFEv1. The request is the SDK's own shape, translated into the
 * WSFEv1 SOAP schema inside the service that builds the wire payload — so ARCA's field names appear only
 * there. Amounts are numbers; the service formats them.
 */

/**
 * ARCA `Concepto`: 1 = productos, 2 = servicios, 3 = productos y servicios. The neutral union under ARCA's
 * name rather than a copy, since the mapper assigns straight into this field and two declarations would be
 * assignable right up until one gained a member.
 */
export type InvoiceConcept = NeutralInvoiceConcept;

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
     * `CondicionIVAReceptorId` — the receiver's IVA condition (RG 5616, mandatory), in AFIP's
     * `FEParamGetCondicionIvaReceptor` codes (1 Responsable Inscripto, 5 Consumidor Final, 6 Monotributo).
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
 * An ARCA observation (`Observaciones.Obs`), attached to any result rather than only a rejected one: ARCA
 * routinely approves a voucher with a real CAE while still reporting observations about it. The parse is
 * independent of `Resultado`, so an approved-with-observations voucher keeps them.
 *
 * An alias rather than a copy, for the reason `InvoiceConcept` is one: `Obs` and `Err` are the same wire
 * structure and one reader parses both.
 */
export type ArcaObservation = ArcaCodeMessage;

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
