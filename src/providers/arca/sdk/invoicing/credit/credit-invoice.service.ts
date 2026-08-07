import {CommonInvoiceService} from '../common/common-invoice.service.js';
import {NotImplementedError} from '../../core/errors.js';
import type {ArcaAuth} from '../../core/types.js';
import type {CommonInvoiceRequest, CommonInvoiceResult} from '../common/common-invoice.types.js';

/**
 * Factura de Crédito Electrónica MiPyME (RG 4367/18).
 *
 * SEED. FCE is NOT a distinct web service — it is issued through WSFEv1 using the FCE voucher types
 * (201/202/203 = A, 206/207/208 = B, 211/212/213 = C) plus the `Opcionales` field (e.g. CBU id 2101,
 * "transmisión" id 27). Hence it extends {@link CommonInvoiceService} and reuses the whole WSFEv1
 * pipeline; the only additions to implement are FCE-specific validation (voucher type must be an FCE
 * type; CBU optional required for facturas) and, for acceptance/rejection, the separate WSFECRED
 * registry — out of scope here. Until implemented, `requestAuthorization` throws.
 */
export class CreditInvoiceService extends CommonInvoiceService {
    override async requestAuthorization(
        _auth: ArcaAuth,
        _request: CommonInvoiceRequest,
    ): Promise<CommonInvoiceResult> {
        throw new NotImplementedError('CreditInvoiceService.requestAuthorization (FCE MiPyME)');
    }
}
