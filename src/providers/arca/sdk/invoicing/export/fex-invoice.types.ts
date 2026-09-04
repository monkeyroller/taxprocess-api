import type {ArcaCodeMessage} from '../../core/errors.js';

/**
 * SDK-facing request/response types for WSFEXv1 — the Factura de Exportación ("Factura E"). The request is
 * the SDK's own shape, translated into the WSFEX SOAP schema inside the service that builds the wire payload,
 * so ARCA's field names appear only there. Amounts are numbers; the service formats them.
 *
 * Sibling of `CommonInvoiceRequest` rather than a variant of it. The two documents share almost nothing:
 * WSFEv1 is batch-shaped (`CantReg`, `CbteDesde`..`CbteHasta`) with a VAT breakdown and no item array;
 * WSFEX is one voucher with a caller-supplied request id, a mandatory item array, and no VAT at all because
 * an export is zero-rated. Merging them would need a union where every field is optional, i.e. neither
 * service's rules expressible.
 */

/** `Tipo_expo`: 1 = exportación definitiva de bienes, 2 = servicios, 4 = otros. ARCA skips 3. */
export type FexExportType = 1 | 2 | 4;

/** `Idioma_cbte`: 1 = español, 2 = inglés, 3 = portugués. */
export type FexLanguage = 1 | 2 | 3;

/**
 * One line of the comprobante (`Items.Item`). Mandatory — a Factura E with no items is rejected (1666).
 *
 * `unitOfMeasure` (`Pro_umed`) is not purely a unit: `0`, `97` and `99` are validation modes rather than
 * units of measure. With any of them the quantity, unit price and discount must be zero or absent (1775);
 * with `97` the total is unrestricted and may be negative, and with `99` it must be negative (1815). That is
 * how a global discount or adjustment line is expressed.
 */
export interface FexItem {
    /** `Pro_codigo` — up to 50 characters. */
    code?: string;
    /** `Pro_ds` — mandatory, up to 4000 characters. */
    description: string;
    /** `Pro_qty` — up to 12 integer and 6 decimal places. */
    quantity?: number;
    /** `Pro_umed`. */
    unitOfMeasure: number;
    /** `Pro_precio_uni` — up to 12 integer and 6 decimal places. */
    unitPrice?: number;
    /** `Pro_bonificacion` — discount on the line. */
    discount?: number;
    /** `Pro_total_item` — mandatory, 13 integer and 2 decimal places. */
    totalAmount: number;
}

/**
 * A shipping permit and the destination of the goods it covers (`Permisos.Permiso`).
 *
 * Informed only for `exportType` 1 on a Factura (19) where `permitPresent` is `"S"`; sending one in any
 * other combination is a rejection (1720/1730), which is why the mapper omits the whole array rather than
 * sending it empty.
 */
export interface FexShippingPermit {
    /** `Id_permiso` — the despacho code, format `99999AAXX999999A`. */
    permitId: string;
    /** `Dst_merc` — the país code the goods are destined for. */
    destinationCode: number;
}

/** An associated voucher (`Cmps_asoc.Cmp_asoc`) — the invoice a nota de crédito or débito references. */
export interface FexAssociatedVoucher {
    /** `Cbte_tipo`. */
    voucherType: number;
    /** `Cbte_punto_vta`. */
    pointOfSaleNumber: number;
    /** `Cbte_nro`. */
    number: number;
    /** `Cbte_cuit` — the issuer of the associated voucher, for a third-party tabaco remito. */
    cuit?: number;
}

/** An optional data field (`Opcionales.Opcional`) — byte-identical to WSFEv1's. */
export interface FexOptional {
    id: string;
    value: string;
}

/** An activity bound to the comprobante (`Actividades.Actividad`) — harina/tabaco, RG 5264. */
export interface FexActivity {
    id: string;
}

export interface FexInvoiceRequest {
    /**
     * `Id` — the caller's own request id, and WSFEX's whole idempotency mechanism. Re-sending the same `Id`
     * returns the stored answer with `Reproceso = "S"` instead of authorizing again.
     *
     * Must be unique per CUIT and must be persisted before the call: it is the only way to recover after a
     * timeout, and reusing one silently returns a different voucher than the caller thinks it asked for.
     * `FEXGetLast_ID` reports the highest ARCA has seen.
     */
    requestId: number;
    /** `Cbte_Tipo` — 19 Factura E, 20 Nota de Débito, 21 Nota de Crédito. */
    voucherType: number;
    /** `Punto_vta` — must be registered as "Comprobantes de Exportación – Web Services" (FEEWS). */
    pointOfSaleNumber: number;
    /** `Cbte_nro` — must be exactly the next in sequence for the type and point of sale (1535). */
    voucherNumber: number;
    /** `Fecha_cbte` in ARCA `yyyymmdd`. Null or within five days either side of today (1500). */
    voucherDate?: string;
    exportType: FexExportType;
    /**
     * `Permiso_existente` — `"S"`, `"N"`, or absent. Absent for a nota (20/21) and for `exportType` 2 or 4;
     * required for `exportType` 1 on a Factura.
     */
    permitPresent?: 'S' | 'N';
    permits?: Array<FexShippingPermit>;
    /** `Dst_cmp` — país code of the comprobante's destination. `250` is the Tierra del Fuego AAE. */
    destinationCode: number;
    /** `Cliente` — the buyer's name or business name, mandatory (1650). */
    clientName: string;
    /**
     * `Cuit_pais_cliente` — the authority's generic per-country CUIT, from `FEXGetPARAM_DST_CUIT`. At least
     * one of this and `clientTaxId` must be present (1580).
     *
     * ARCA publishes no key joining these to `Dst_cmp`, and 92 país codes have no row at all — including
     * every AAE and zona franca — so this is never derived, only passed through when a caller supplies it.
     */
    clientCountryTaxId?: number;
    /** `Domicilio_cliente` — the buyer's commercial address, mandatory (1660). */
    clientAddress: string;
    /** `Id_impositivo` — the buyer's own tax identification in its own country. */
    clientTaxId?: string;
    /** `Moneda_Id`, e.g. `"PES"`, `"DOL"`, `"060"`. */
    currencyId: string;
    /** `Moneda_ctz` — exactly `1` when `currencyId` is `PES` (1601). */
    currencyRate?: number;
    /**
     * `CanMisMonExt` — `"S"` when the voucher is settled in its own foreign currency.
     *
     * Must not be sent at all for a peso Factura or for a nota (1605), which is why it is optional here and
     * omitted rather than defaulted in the mapper.
     */
    settledInInvoiceCurrency?: 'S' | 'N';
    /** `Obs_comerciales` — up to 4000 characters. */
    commercialObservations?: string;
    /** `Imp_total` — must equal the sum of the items' totals within ARCA's tolerance (1610). */
    totalAmount: number;
    /** `Obs` — up to 1000 characters. */
    observations?: string;
    associatedVouchers?: Array<FexAssociatedVoucher>;
    /** `Forma_pago` — mandatory for a Factura (1620). */
    paymentTerms?: string;
    /** `Incoterms` — mandatory only for a Factura with `exportType` 1 (1640). */
    incoterm?: string;
    /** `Incoterms_Ds` — free text, up to 20 characters; requires `incoterm` (1641). */
    incotermDescription?: string;
    language: FexLanguage;
    items: Array<FexItem>;
    optionals?: Array<FexOptional>;
    /**
     * `Fecha_pago` in ARCA `yyyymmdd` — mandatory for a Factura with `exportType` 2 or 4 and forbidden on a
     * nota (1672/1673/1674).
     */
    paymentDate?: string;
    activities?: Array<FexActivity>;
}

/**
 * An ARCA observation. WSFEX reports these as a single delimited `Motivos_Obs` string rather than WSFEv1's
 * repeated `Observaciones/Obs` pairs, so a WSFEX observation carries a message and no code.
 */
export type FexObservation = ArcaCodeMessage;

export interface FexInvoiceResult {
    /** `Resultado` — `A` aprobado, `R` rechazado, `P` parcial. */
    result: 'A' | 'R' | 'P';
    /** `Cae`. */
    cae?: string;
    /** `Fch_venc_Cae` in ARCA `yyyymmdd`. */
    caeExpiration?: string;
    /** `Cbte_nro` echoed back. */
    voucherNumber: number;
    /** `Fch_cbte` echoed back, in ARCA `yyyymmdd`. */
    voucherDate?: string;
    /** `Id` echoed back — the request id this answer belongs to. */
    requestId?: number;
    /**
     * `Reproceso === "S"` — ARCA replayed a stored answer for a request id it had already processed rather
     * than authorizing afresh.
     *
     * On a deliberate retry after a timeout this is the success case. On a request the caller believes is
     * new it means the id was reused, and the voucher returned is **not** the one just described.
     */
    reprocessed: boolean;
    observations: Array<FexObservation>;
    /** The raw parsed `FEXResultAuth`/`FEXResultGet`, for fields the SDK does not surface. */
    raw: Record<string, unknown>;
}
