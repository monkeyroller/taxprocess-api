/**
 * Request and response types for WSFECRED, the Factura de Crédito Electrónica registry.
 *
 * Only the reception-obligation query is modelled. The régimen's other half — aceptación, rechazo,
 * aceptación tácita, anulación and the state machine that turns an accepted FCE into a negotiable title —
 * lives on this same service and is deliberately absent: it asks questions about a *voucher*, while this
 * asks one about a *taxpayer*, and the two will not share a shape.
 */

/**
 * What the obligation query is about: a receiver, on a day. Never an amount — the answer does not depend on
 * one — and never an economic activity either.
 *
 * That second absence is the interesting one, and it is the schema's rather than ours: the WSDL declares
 * `ConsultarMontoObligadoRecepcionRequestType` as exactly `authRequest` + `cuitConsultada` + `fechaEmision`,
 * all three required and nothing else permitted. The régimen's floor varies by the receiver's principal
 * activity, so the service must be resolving that itself from the tax id and the date. A caller therefore
 * cannot influence it, and does not need to hold it.
 */
export interface ReceptionObligationQuery {
    /** The receiving taxpayer's CUIT, digits only (`cuitConsultada`). */
    readonly receiverTaxId: number;
    /**
     * The voucher's own day as `YYYY-MM-DD` — `fechaEmision` is an `xsd:date`, **not** ARCA's `yyyymmdd`.
     *
     * A backdated sale is judged against the régimen as it stood then, so this is the voucher's day and not
     * today. The caller converts, because which day an instant falls on is an authority-calendar question
     * and this layer holds no calendar.
     */
    readonly issueDate: string;
}

/**
 * ARCA's answer: `obligado` and `montoDesde`, read together.
 *
 * **Both fields are optional, and that is load-bearing.** `xml-node`'s readers return `undefined` for a
 * missing or blank element, and this endpoint's whole design rests on an unreadable answer becoming a
 * fallback rather than a confident verdict. Coercing here — `Boolean(...)`, `Number(...) || 0` — would turn
 * "the authority said nothing we could parse" into "this buyer is not obligated", which is an ordinary
 * factura the authority later refuses, off the numerator, with nothing naming the cause.
 */
export interface ReceptionObligationInfo {
    /** `obligado`. `undefined` when absent, blank, or spelled in a way this parser does not recognise. */
    readonly obligated: boolean | undefined;
    /** `montoDesde` — the floor, in the authority's own currency. `undefined` rather than a silent `0`. */
    readonly thresholdAmount: number | undefined;
    /**
     * The untouched response node, so the provider can put what the authority actually said into
     * `providerMetadata`.
     *
     * It is **not** here because the element names are in doubt — the WSDL settled those. It is here
     * because nothing has yet called this service for real: `obligado` and `montoDesde` are both
     * `minOccurs="0"`, the `arrayErrores` numbers are unmeasured, and until a live run says what ARCA
     * actually populates for a known empresa grande, the parsed node is the only record of it. Drop it
     * once `pnpm probe:fecred` has run against homologación and those answers are written down.
     */
    readonly raw: Record<string, unknown>;
}
