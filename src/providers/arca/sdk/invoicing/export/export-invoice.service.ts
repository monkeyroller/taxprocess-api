import {InvoiceWebService} from '../invoice-web-service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../../core/constants.js';

/**
 * WSFEXv1 — Web Service de Factura Electrónica de Exportación (`serviceId: "wsfex"`).
 *
 * SEED. Issues comprobantes tipo E (exportación). It shares the {@link InvoiceWebService} contract,
 * but WSFEX uses a different SOAP schema (`FEXAuthorize`, `FEXGetLast_CMP`, `FEXCheckPermiso`, its own
 * `Cmp` request shape and `Id`-based authorization). To implement: add `wsfex.types.ts` and override
 * the build/parse hooks; until then every operation throws `NotImplementedError`.
 */
export class ExportInvoiceService extends InvoiceWebService<unknown, unknown> {
    protected readonly serviceId = ServiceId.WSFEXV1;
    protected readonly namespace = Namespaces.WSFEXV1;

    protected endpoint(): string {
        return ENDPOINTS[this.environment].wsfexv1;
    }
}
