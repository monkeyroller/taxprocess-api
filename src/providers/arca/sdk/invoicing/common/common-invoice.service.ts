import {InvoiceWebService} from '../invoice-web-service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../../core/constants.js';
import type {ArcaAuth, ServerStatus} from '../../core/types.js';
import type {
    CommonInvoiceRequest,
    CommonInvoiceResult,
} from './common-invoice.types.js';
import {
    authElement,
    cleanCode,
    extractObservations,
    firstOf,
    money,
    normalizeResultCode,
    toInt
} from "./common-helpers.js";

/**
 * WSFEv1 — Web Service de Factura Electrónica común (`serviceId: "wsfe"`).
 *
 * Issues facturas/notas A, B, C and M with CAE. This is the fully-implemented invoicing service;
 * the export/credit siblings share the same public contract via {@link InvoiceWebService}. Field
 * names in the built payloads and parsed results are the ARCA WSFEv1 SOAP schema verbatim.
 */
export class CommonInvoiceService extends InvoiceWebService<CommonInvoiceRequest, CommonInvoiceResult> {
    protected readonly serviceId = ServiceId.WSFEV1;
    protected readonly namespace = Namespaces.WSFEV1;

    protected override readonly authorizeOperation = 'FECAESolicitar';
    protected override readonly lastAuthorizedOperation = 'FECompUltimoAutorizado';
    protected override readonly queryOperation = 'FECompConsultar';
    protected override readonly dummyOperation = 'FEDummy';

    protected endpoint(): string {
        return ENDPOINTS[this.environment].wsfev1;
    }

    protected override buildAuthorizationRequest(
        auth: ArcaAuth,
        request: CommonInvoiceRequest,
    ): Record<string, unknown> {
        const registerCount = request.voucherNumberTo - request.voucherNumberFrom + 1;

        // Element order matches the WSFEv1 FECAEDetRequest XSD sequence exactly — ARCA rejects
        // out-of-order elements. Keys are inserted in that order below.
        const detail: Record<string, unknown> = {
            Concepto: request.concept,
            DocTipo: request.docType,
            DocNro: request.docNumber,
            CbteDesde: request.voucherNumberFrom,
            CbteHasta: request.voucherNumberTo,
            CbteFch: request.voucherDate,
            ImpTotal: money(request.totalAmount),
            ImpTotConc: money(request.netUntaxed),
            ImpNeto: money(request.netTaxed),
            ImpOpEx: money(request.exempt),
            ImpTrib: money(request.tributesAmount),
            ImpIVA: money(request.vatAmount),
        };

        if (request.concept !== 1) {
            detail.FchServDesde = request.serviceDateFrom;
            detail.FchServHasta = request.serviceDateTo;
            detail.FchVtoPago = request.paymentDueDate;
        }

        detail.MonId = request.currencyId;
        detail.MonCotiz = request.currencyRate.toFixed(6);

        // Per the WSFEv1 XSD, CondicionIVAReceptorId goes after MonCotiz and before CbtesAsoc.
        if (request.receiverIvaConditionId !== undefined) {
            detail.CondicionIVAReceptorId = request.receiverIvaConditionId;
        }

        if (request.associatedVouchers && request.associatedVouchers.length > 0) {
            detail.CbtesAsoc = {
                CbteAsoc: request.associatedVouchers.map((v) => ({
                    Tipo: v.voucherType,
                    PtoVta: v.salesPointNumber,
                    Nro: v.number,
                    ...(v.cuit !== undefined ? {Cuit: v.cuit} : {}),
                })),
            };
        }

        if (request.tributes && request.tributes.length > 0) {
            detail.Tributos = {
                Tributo: request.tributes.map((t) => ({
                    Id: t.id,
                    ...(t.description ? {Desc: t.description} : {}),
                    BaseImp: money(t.baseAmount),
                    Alic: money(t.rate),
                    Importe: money(t.amount),
                })),
            };
        }

        if (request.vatSubtotals.length > 0) {
            detail.Iva = {
                AlicIva: request.vatSubtotals.map((s) => ({
                    Id: s.Id,
                    BaseImp: money(s.BaseImp),
                    Importe: money(s.Importe),
                })),
            };
        }

        if (request.optionals && request.optionals.length > 0) {
            detail.Opcionales = {
                Opcional: request.optionals.map((o) => ({Id: o.id, Valor: o.value})),
            };
        }

        return {
            Auth: authElement(auth),
            FeCAEReq: {
                FeCabReq: {
                    CantReg: registerCount,
                    PtoVta: request.salesPointNumber,
                    CbteTipo: request.voucherType,
                },
                FeDetReq: {FECAEDetRequest: detail},
            },
        };
    }

    protected override parseAuthorizationResponse(result: Record<string, unknown>): CommonInvoiceResult {
        const header = (result.FeCabResp ?? {}) as Record<string, unknown>;
        const detail = firstOf(
            (result.FeDetResp as { FECAEDetResponse?: unknown } | undefined)?.FECAEDetResponse,
        );

        const resultCode = normalizeResultCode(
            (detail?.Resultado as string) ?? (header.Resultado as string),
        );
        const cae = cleanCode(detail?.CAE);

        return {
            result: resultCode,
            cae,
            caeExpiration: cae ? cleanCode(detail?.CAEFchVto) : undefined,
            voucherNumberFrom: toInt(detail?.CbteDesde),
            voucherNumberTo: toInt(detail?.CbteHasta),
            observations: extractObservations(detail?.Observaciones),
            raw: detail ?? result,
        };
    }

    protected override buildLastAuthorizedRequest(
        auth: ArcaAuth,
        salesPointNumber: number,
        voucherType: number,
    ): Record<string, unknown> {
        return {Auth: authElement(auth), PtoVta: salesPointNumber, CbteTipo: voucherType};
    }

    protected override parseLastAuthorizedNumber(result: Record<string, unknown>): number {
        return toInt(result.CbteNro);
    }

    protected override buildQueryRequest(
        auth: ArcaAuth,
        salesPointNumber: number,
        voucherType: number,
        voucherNumber: number,
    ): Record<string, unknown> {
        return {
            Auth: authElement(auth),
            FeCompConsReq: {
                CbteTipo: voucherType,
                CbteNro: voucherNumber,
                PtoVta: salesPointNumber
            },
        };
    }

    protected override parseVoucherQuery(result: Record<string, unknown>): CommonInvoiceResult {
        const info = (result.ResultGet ?? {}) as Record<string, unknown>;
        const cae = cleanCode(info.CodAutorizacion);
        return {
            result: normalizeResultCode(info.Resultado as string),
            cae,
            caeExpiration: cae ? cleanCode(info.FchVto) : undefined,
            voucherNumberFrom: toInt(info.CbteDesde),
            voucherNumberTo: toInt(info.CbteHasta),
            observations: extractObservations(info.Observaciones),
            raw: info,
        };
    }

    protected override parseServerStatus(result: Record<string, unknown>): ServerStatus {
        return {
            appServer: String(result.AppServer ?? ''),
            dbServer: String(result.DbServer ?? ''),
            authServer: String(result.AuthServer ?? ''),
        };
    }
}