import {ArcaValidationError} from '../../sdk/core/errors.js';
import {TaxProcessDocumentTypeCode} from '../canonical-codes.js';
import type {WebService} from '../../../provider/web-service.js';

/**
 * Which of ARCA's invoicing web services authorizes, prices and numbers a given voucher.
 *
 * The whole reason this is internal: contract §9 puts `CbteTipo` on the do-not-leak list, and §7 already
 * specifies which web service answers as per-entity configuration. So `/invoices/authorize` stays one
 * endpoint and the decision is made here — the same shape as `padron-routing`, which decides which registry
 * can answer a taxpayer lookup and reports it back rather than asking the caller.
 *
 * Three callers, deliberately one function: authorization, the cotización lookup (a rate has to come from
 * the service that will validate it), and the point-of-sale list (WSFEX reads a different register). Keeping
 * them on one resolver is what stops the three drifting.
 */

/** ARCA's three invoicing services, in the SDK's own naming rather than the wire's. */
export type InvoiceRoute = 'WSFEV1' | 'WSMTXCA' | 'WSFEXV1';

/**
 * The route back in the caller's spelling, for an answer that has to say which service produced it.
 *
 * Two spellings exist because the route is internal and `WebService` is the contract's — §7 publishes the
 * mixed-case names and this module normalizes them. Kept next to the type so a new route cannot be added
 * without deciding what to call it on the wire.
 */
export const WEB_SERVICE_BY_ROUTE: Readonly<Record<InvoiceRoute, WebService>> = {
    WSFEV1: 'WSFEv1',
    WSMTXCA: 'WSMTXCA',
    WSFEXV1: 'WSFEXv1',
};

/** The `configuration.webService` value core sends → the route it names. */
const ROUTE_BY_WEB_SERVICE: Readonly<Record<WebService, InvoiceRoute>> = {
    WSFEv1: 'WSFEV1',
    WSMTXCA: 'WSMTXCA',
    WSFEXv1: 'WSFEXV1',
};

/**
 * The voucher types only WSFEXv1 can authorize — a Factura E and its notas. Validation 1530 states the set
 * and it is exactly these three.
 *
 * **Not what `FEXGetPARAM_Cbte_Tipo` returns.** That catalogue publishes five (measured in production):
 * `88` Remito Electrónico and `89` Resumen de Datos join the three above. Neither can be authorized — they
 * appear only in `Cmps_asoc.Cbte_tipo`, the tobacco remito a Factura E references, which is what validation
 * 1680 lists them under. Nor is the catalogue the associable set either: `91`, `993` and `994` are
 * associable and absent from it. It is a partial union of two different sets, so it cannot be read as
 * "what may I issue".
 *
 * `22` (Facturas — Permiso Exportación Simple) is deliberately absent, and **not because Exporta Simple is
 * unimplemented**: that regime is invoiced as a `19` carrying simplified-export `Opcionales`, per the
 * manual's own wording — "para '19 – Facturas' el documento de exportación simplificada". `22` is a separate
 * legacy code in ARCA's master voucher table that WSFEXv1's catalogue does not publish and its validations
 * never name. Routing it here would only produce a rejection the caller cannot read.
 */
const EXPORT_DOCUMENT_TYPES: ReadonlySet<number> = new Set<number>([
    TaxProcessDocumentTypeCode.FACTURA_EXPORTACION,
    TaxProcessDocumentTypeCode.NOTA_DEBITO_EXTERIOR,
    TaxProcessDocumentTypeCode.NOTA_CREDITO_EXTERIOR,
]);

/** True when `documentTypeCode` can only be issued through WSFEXv1. */
export function isExportDocumentType(documentTypeCode: number): boolean {
    return EXPORT_DOCUMENT_TYPES.has(documentTypeCode);
}

export interface InvoiceRouteInput {
    /** The entity's `configuration.webService`, when core sent it. */
    readonly webService?: WebService;
    /** The canonical document type, when the operation has one. A rate lookup does not. */
    readonly documentTypeCode?: number;
}

/**
 * The service that answers for this combination.
 *
 * - An explicit `webService` decides it. That is the only thing that can, for the domestic types: WSFEv1 and
 *   WSMTXCA both issue 1/6/11, so no document type could ever separate them.
 * - Failing that, an export document type resolves on its own, since 19/20/21 exist on no other service.
 * - Neither present is `WSFEV1`, which is what every caller got before this existed.
 *
 * **A disagreement raises rather than picking a winner.** `webService: "WSFEv1"` with document type 19, or
 * `"WSFEXv1"` with a 6, is a caller bug: one of the two fields is wrong and guessing which would authorize a
 * voucher through a service the caller did not mean. Naming it is the main reason to accept both inputs
 * instead of one.
 */
export function invoiceRoute(input: InvoiceRouteInput): InvoiceRoute {
    const {webService, documentTypeCode} = input;
    const exportDocument = documentTypeCode !== undefined && isExportDocumentType(documentTypeCode);

    if (webService === undefined) {
        return exportDocument ? 'WSFEXV1' : 'WSFEV1';
    }

    const route = ROUTE_BY_WEB_SERVICE[webService];
    if (documentTypeCode === undefined) {
        return route;
    }
    if (exportDocument !== (route === 'WSFEXV1')) {
        throw new ArcaValidationError(
            `webService "${webService}" cannot issue document type ${String(documentTypeCode)}: ` +
                `${exportDocument ? 'that is an export voucher, which only WSFEXv1 authorizes' : 'WSFEXv1 authorizes only document types 19, 20 and 21'}.`,
            'WEB_SERVICE_DOCUMENT_TYPE_MISMATCH',
        );
    }
    return route;
}
