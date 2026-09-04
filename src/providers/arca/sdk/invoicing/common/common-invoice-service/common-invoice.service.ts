import {InvoiceWebService} from '../../invoice-web-service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../../../core/constants.js';
import type {
    ArcaAuth,
    CurrencyRateInfo,
    CurrencyTypeInfo,
    PointOfSaleInfo,
    ServerStatus,
} from '../../../core/types.js';
import type {
    CommonInvoiceRequest,
    CommonInvoiceResult,
} from '../common-invoice.types.js';
import {asArray, decimal, firstOf, integer, text} from '../../../../../xml-node/xml-node.js';
import {ArcaServiceError} from '../../../core/errors.js';
import {
    authElement,
    cleanArcaDate,
    cleanCode,
    codeMsgPairs,
    money,
    normalizeResultCode,
    toIntOrZero
} from "../common-helpers.js";

/**
 * WSFEv1 — Web Service de Factura Electrónica común. Issues facturas and notas A, B, C and M with CAE. The
 * export and credit siblings share the same public contract through the base class. Field names in the built
 * payloads and parsed results are the ARCA SOAP schema verbatim.
 */
export class CommonInvoiceService extends InvoiceWebService<CommonInvoiceRequest, CommonInvoiceResult> {
    protected readonly serviceId = ServiceId.WSFEV1;
    protected readonly namespace = Namespaces.WSFEV1;

    protected override readonly authorizeOperation = 'FECAESolicitar';
    protected override readonly lastAuthorizedOperation = 'FECompUltimoAutorizado';
    protected override readonly queryOperation = 'FECompConsultar';
    protected override readonly pointsOfSaleOperation = 'FEParamGetPtosVenta';
    protected override readonly currencyRateOperation = 'FEParamGetCotizacion';
    protected override readonly currencyTypesOperation = 'FEParamGetTiposMonedas';
    protected override readonly dummyOperation = 'FEDummy';

    protected endpoint(): string {
        return ENDPOINTS[this.environment].wsfev1;
    }

    protected override buildAuthorizationRequest(
        auth: ArcaAuth,
        request: CommonInvoiceRequest,
    ): Record<string, unknown> {
        const registerCount = request.voucherNumberTo - request.voucherNumberFrom + 1;

        // Element order matches the FECAEDetRequest XSD sequence exactly: ARCA rejects out-of-order
        // elements.
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
                    PtoVta: v.pointOfSaleNumber,
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
                    PtoVta: request.pointOfSaleNumber,
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
            caeExpiration: cae ? cleanArcaDate(detail?.CAEFchVto) : undefined,
            voucherNumberFrom: toIntOrZero(detail?.CbteDesde),
            voucherNumberTo: toIntOrZero(detail?.CbteHasta),
            observations: codeMsgPairs(detail?.Observaciones, 'Obs'),
            raw: detail ?? result,
        };
    }

    protected override buildLastAuthorizedRequest(
        auth: ArcaAuth,
        pointOfSaleNumber: number,
        voucherType: number,
    ): Record<string, unknown> {
        return {Auth: authElement(auth), PtoVta: pointOfSaleNumber, CbteTipo: voucherType};
    }

    /**
     * `FECompUltimoAutorizado`'s `CbteNro`, where `0` and absent are different answers. ARCA reports a
     * genuinely never-authorized point of sale and voucher type as `0`, which becomes next-number `1`. A
     * response missing the element is a malformed answer instead, and reading it as `0` would hand core `1`
     * for a point of sale that may already hold thousands of vouchers — so it raises.
     */
    protected override parseLastAuthorizedNumber(result: Record<string, unknown>): number {
        const number = integer(result.CbteNro);
        if (number === undefined) {
            throw new ArcaServiceError(
                'FECompUltimoAutorizado returned no CbteNro; refusing to read a missing element as 0 ' +
                    '(which would report the next number as 1).',
                [{code: '', message: 'CbteNro missing from FECompUltimoAutorizado response'}],
            );
        }
        return number;
    }

    protected override buildPointsOfSaleRequest(auth: ArcaAuth): Record<string, unknown> {
        return {Auth: authElement(auth)};
    }

    protected override parsePointsOfSale(result: Record<string, unknown>): Array<PointOfSaleInfo> {
        // `asArray` reads an absent element as `[]` — a CUIT with no registered points of sale.
        const node = (result.ResultGet as {PtoVenta?: unknown} | undefined)?.PtoVenta;
        return asArray(node).map((p) => ({
            number: toIntOrZero(p.Nro),
            issuanceMode: cleanCode(p.EmisionTipo),
            blocked: text(p.Bloqueado)?.toUpperCase() === 'S',
            dischargeDate: cleanArcaDate(p.FchBaja),
        }));
    }

    /**
     * `FEParamGetCotizacion` takes `MonId` plus an optional `FchCotiz`. The optional element is omitted
     * rather than sent empty: ARCA validates the format of whatever is present, so `<FchCotiz/>` is a 12002
     * where an absent element means "give me the latest".
     */
    protected override buildCurrencyRateRequest(
        auth: ArcaAuth,
        currencyId: string,
        rateDate?: string,
    ): Record<string, unknown> {
        const payload: Record<string, unknown> = {Auth: authElement(auth), MonId: currencyId};
        if (rateDate !== undefined) {
            payload.FchCotiz = rateDate;
        }
        return payload;
    }

    /**
     * `FchCotiz` stays a `yyyymmdd` string: parsing it into a `Date` here is what would shift the day.
     *
     * `MonId` is read back from the answer rather than echoed from the request, the authority deciding the
     * canonical spelling. Through `text` rather than `String(x ?? '').trim()`, because it travels to the
     * caller as the answer's `currencyCode` and `String({})` would ship `'[object Object]'` as a currency.
     *
     * `decimal` rather than a bare `Number`, so both halves of a rate are read to the same standard —
     * `Number` alone let the rate through in the states the day is rejected for, `NaN` from a missing
     * element and `0` from a blank one, leaving the caller nothing to test.
     */
    protected override parseCurrencyRate(result: Record<string, unknown>): CurrencyRateInfo {
        const info = (result.ResultGet ?? {}) as Record<string, unknown>;
        return {
            monId: text(info.MonId) ?? '',
            rate: decimal(info.MonCotiz),
            rateDate: cleanArcaDate(info.FchCotiz) ?? '',
        };
    }

    protected override buildCurrencyTypesRequest(auth: ArcaAuth): Record<string, unknown> {
        return {Auth: authElement(auth)};
    }

    /**
     * A catalogue entry with no usable `Id` is dropped rather than surfaced as an empty code, which could
     * only ever fail a later cotización call with a 12000.
     */
    protected override parseCurrencyTypes(result: Record<string, unknown>): Array<CurrencyTypeInfo> {
        const node = (result.ResultGet as {Moneda?: unknown} | undefined)?.Moneda;
        return asArray(node)
            .map((m) => ({
                id: text(m.Id) ?? '',
                description: text(m.Desc) ?? '',
                validFrom: cleanArcaDate(m.FchDesde) ?? '',
                validTo: cleanArcaDate(m.FchHasta),
            }))
            .filter((m) => m.id !== '');
    }

    protected override buildQueryRequest(
        auth: ArcaAuth,
        pointOfSaleNumber: number,
        voucherType: number,
        voucherNumber: number,
    ): Record<string, unknown> {
        return {
            Auth: authElement(auth),
            FeCompConsReq: {
                CbteTipo: voucherType,
                CbteNro: voucherNumber,
                PtoVta: pointOfSaleNumber
            },
        };
    }

    protected override parseVoucherQuery(result: Record<string, unknown>): CommonInvoiceResult {
        const info = (result.ResultGet ?? {}) as Record<string, unknown>;
        const cae = cleanCode(info.CodAutorizacion);
        return {
            result: normalizeResultCode(info.Resultado as string),
            cae,
            caeExpiration: cae ? cleanArcaDate(info.FchVto) : undefined,
            voucherNumberFrom: toIntOrZero(info.CbteDesde),
            voucherNumberTo: toIntOrZero(info.CbteHasta),
            observations: codeMsgPairs(info.Observaciones, 'Obs'),
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