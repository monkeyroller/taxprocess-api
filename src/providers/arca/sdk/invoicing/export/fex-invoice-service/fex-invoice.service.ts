import {InvoiceWebService} from '../../invoice-web-service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../../../core/constants.js';
import {ArcaServiceError} from '../../../core/errors.js';
import type {ArcaAuth, PointOfSaleInfo, ServerStatus} from '../../../core/types.js';
import type {FexInvoiceRequest, FexInvoiceResult, FexObservation} from '../fex-invoice.types.js';
import {decimal, integer, text} from '../../../../../xml-node/xml-node.js';
import {
    authElement,
    cleanArcaDate,
    cleanCode,
    money,
    normalizeResultCode,
    toIntOrZero,
    WSFEX_ERRORS,
    WSFEX_EVENTS,
    type CodeMessageDialect,
} from '../../common/common-helpers.js';
import {catalogueRows, WSFEX_POINTS_OF_SALE} from '../../common/catalogue-rows/catalogue-rows.js';

/**
 * WSFEXv1 — Factura Electrónica de Exportación. Issues Factura E (19), Nota de Débito (20) and Nota de
 * Crédito (21) por operaciones con el exterior, with CAE. Field names in the built payloads and parsed
 * results are the ARCA SOAP schema verbatim.
 *
 * Shares the base class with WSFEv1 in earnest rather than nominally: transport, `{op}Result` unwrapping,
 * error and event reading and reference-table reading all apply unchanged, and the four dialect members
 * below are the whole of the envelope difference. What genuinely diverges is the authorization document, and
 * that is exactly what the per-operation hooks are for.
 *
 * Two operations are deliberately left inheriting the base's throwing defaults, so they answer `501` rather
 * than sending a wrong payload:
 *
 * - `getCurrencyRate` — `FEXGetPARAM_Ctz` takes `FchCotiz` as `YYYY-MM-DD` where WSFEv1 wants `yyyymmdd`
 *   (error 1003). Inheriting the WSFEv1 builder would ask for a day ARCA reads differently, and the export
 *   rate path uses the whole-table method instead.
 * - `getCurrencyTypes` — `FEXGetPARAM_MON` measured identical to WSFEv1's catalogue against production on
 *   2026-09-04 (49 rows, same codes), so there is nothing for a second reader to say.
 */
export class FexInvoiceService extends InvoiceWebService<FexInvoiceRequest, FexInvoiceResult> {
    protected readonly serviceId = ServiceId.WSFEXV1;
    protected readonly namespace = Namespaces.WSFEXV1;

    /**
     * WSFEX puts its errors in a single `FEXErr{ErrCode,ErrMsg}` and its events in a single
     * `FEXEvents{EventCode,EventMsg}`, where WSFEv1 wraps repeated `Err`/`Evt` pairs under `Errors`/`Events`.
     * Without these four lines every WSFEX rejection would be looked for in an element WSFEX never sends and
     * read as a success.
     */
    protected override readonly errorNode = 'FEXErr';
    protected override readonly errorDialect: CodeMessageDialect = WSFEX_ERRORS;
    protected override readonly eventNode = 'FEXEvents';
    protected override readonly eventDialect: CodeMessageDialect = WSFEX_EVENTS;

    protected override readonly authorizeOperation = 'FEXAuthorize';
    protected override readonly lastAuthorizedOperation = 'FEXGetLast_CMP';
    protected override readonly queryOperation = 'FEXGetCMP';
    protected override readonly pointsOfSaleOperation = 'FEXGetPARAM_PtoVenta';
    protected override readonly dummyOperation = 'FEXDummy';

    protected endpoint(): string {
        return ENDPOINTS[this.environment].wsfexv1;
    }

    /**
     * Builds `{Auth, Cmp}`.
     *
     * Element order matches the `ClsFEXRequest` XSD sequence exactly: ARCA rejects out-of-order elements.
     *
     * Every optional element is **omitted rather than sent empty**, which is what enforces the rules that
     * forbid a field outright — `CanMisMonExt` on a peso Factura or any nota (1605), `Fecha_pago` on a nota
     * (1674), `Permisos` for a service export (1730). An empty element is a value ARCA validates, so
     * `<CanMisMonExt/>` is a rejection where an absent one is correct.
     */
    protected override buildAuthorizationRequest(
        auth: ArcaAuth,
        request: FexInvoiceRequest,
    ): Record<string, unknown> {
        const cmp: Record<string, unknown> = {Id: request.requestId};

        if (request.voucherDate !== undefined) {
            cmp.Fecha_cbte = request.voucherDate;
        }
        cmp.Cbte_Tipo = request.voucherType;
        cmp.Punto_vta = request.pointOfSaleNumber;
        cmp.Cbte_nro = request.voucherNumber;
        cmp.Tipo_expo = request.exportType;

        if (request.permitPresent !== undefined) {
            cmp.Permiso_existente = request.permitPresent;
        }
        if (request.permits !== undefined && request.permits.length > 0) {
            cmp.Permisos = {
                Permiso: request.permits.map((permit) => ({
                    Id_permiso: permit.permitId,
                    Dst_merc: permit.destinationCode,
                })),
            };
        }

        cmp.Dst_cmp = request.destinationCode;
        cmp.Cliente = request.clientName;
        if (request.clientCountryTaxId !== undefined) {
            cmp.Cuit_pais_cliente = request.clientCountryTaxId;
        }
        cmp.Domicilio_cliente = request.clientAddress;
        if (request.clientTaxId !== undefined) {
            cmp.Id_impositivo = request.clientTaxId;
        }

        cmp.Moneda_Id = request.currencyId;
        if (request.currencyRate !== undefined) {
            cmp.Moneda_ctz = request.currencyRate.toFixed(6);
        }
        if (request.settledInInvoiceCurrency !== undefined) {
            cmp.CanMisMonExt = request.settledInInvoiceCurrency;
        }
        if (request.commercialObservations !== undefined) {
            cmp.Obs_comerciales = request.commercialObservations;
        }

        cmp.Imp_total = money(request.totalAmount);

        if (request.observations !== undefined) {
            cmp.Obs = request.observations;
        }
        if (request.associatedVouchers !== undefined && request.associatedVouchers.length > 0) {
            cmp.Cmps_asoc = {
                Cmp_asoc: request.associatedVouchers.map((voucher) => ({
                    Cbte_tipo: voucher.voucherType,
                    Cbte_punto_vta: voucher.pointOfSaleNumber,
                    Cbte_nro: voucher.number,
                    ...(voucher.cuit === undefined ? {} : {Cbte_cuit: voucher.cuit}),
                })),
            };
        }
        if (request.paymentTerms !== undefined) {
            cmp.Forma_pago = request.paymentTerms;
        }
        if (request.incoterm !== undefined) {
            cmp.Incoterms = request.incoterm;
        }
        if (request.incotermDescription !== undefined) {
            cmp.Incoterms_Ds = request.incotermDescription;
        }

        cmp.Idioma_cbte = request.language;

        cmp.Items = {
            Item: request.items.map((item) => ({
                ...(item.code === undefined ? {} : {Pro_codigo: item.code}),
                Pro_ds: item.description,
                ...(item.quantity === undefined ? {} : {Pro_qty: item.quantity}),
                Pro_umed: item.unitOfMeasure,
                ...(item.unitPrice === undefined ? {} : {Pro_precio_uni: item.unitPrice}),
                ...(item.discount === undefined ? {} : {Pro_bonificacion: item.discount}),
                Pro_total_item: money(item.totalAmount),
            })),
        };

        if (request.optionals !== undefined && request.optionals.length > 0) {
            cmp.Opcionales = {
                Opcional: request.optionals.map((optional) => ({Id: optional.id, Valor: optional.value})),
            };
        }
        if (request.paymentDate !== undefined) {
            cmp.Fecha_pago = request.paymentDate;
        }
        if (request.activities !== undefined && request.activities.length > 0) {
            cmp.Actividades = {Actividad: request.activities.map((activity) => ({Id: activity.id}))};
        }

        return {Auth: authElement(auth), Cmp: cmp};
    }

    protected override parseAuthorizationResponse(result: Record<string, unknown>): FexInvoiceResult {
        return this.readVoucher((result.FEXResultAuth ?? {}) as Record<string, unknown>);
    }

    protected override parseVoucherQuery(result: Record<string, unknown>): FexInvoiceResult {
        return this.readVoucher((result.FEXResultGet ?? {}) as Record<string, unknown>);
    }

    /**
     * `FEXAuthorize` and `FEXGetCMP` describe the same voucher under different result elements, so one reader
     * serves both — the difference is only where it is rooted, and in one field name.
     *
     * That field is the voucher's own date, which the authorize response spells `Fch_cbte` and the query
     * response spells `Fecha_cbte` — ARCA's own inconsistency, and the same one that has the query taking
     * `Cbte_tipo` where the authorize request takes `Cbte_Tipo`. Reading only the first spelling left a
     * queried export voucher with no date at all.
     */
    private readVoucher(info: Record<string, unknown>): FexInvoiceResult {
        const cae = cleanCode(info.Cae);
        return {
            result: normalizeResultCode(text(info.Resultado)),
            cae,
            caeExpiration: cae === undefined ? undefined : cleanArcaDate(info.Fch_venc_Cae),
            voucherNumber: toIntOrZero(info.Cbte_nro),
            voucherDate: cleanArcaDate(info.Fch_cbte ?? info.Fecha_cbte),
            requestId: integer(info.Id),
            // Anything but an explicit "S" is a fresh authorization. Defaulting the other way would report
            // every voucher as a replay on a response that simply omitted the field.
            reprocessed: text(info.Reproceso)?.toUpperCase() === 'S',
            observations: readObservations(info.Motivos_Obs),
            raw: info,
        };
    }

    /**
     * `FEXGetLast_CMP` nests `Pto_venta` and `Cbte_Tipo` **inside `Auth`**, where every other operation on
     * both services puts its arguments beside it. Not a transcription slip — it is what the WSDL declares.
     */
    protected override buildLastAuthorizedRequest(
        auth: ArcaAuth,
        pointOfSaleNumber: number,
        voucherType: number,
    ): Record<string, unknown> {
        return {
            Auth: {...authElement(auth), Pto_venta: pointOfSaleNumber, Cbte_Tipo: voucherType},
        };
    }

    /**
     * `FEXGetLast_CMP`'s `Cbte_nro`, where `0` and absent are different answers — ARCA reports a genuinely
     * never-authorized point of sale and type as `0`, which becomes next-number `1`. A response missing the
     * element is malformed instead, and reading it as `0` would hand core `1` for a point of sale that may
     * already hold thousands of vouchers.
     */
    protected override parseLastAuthorizedNumber(result: Record<string, unknown>): number {
        const info = (result.FEXResult_LastCMP ?? {}) as Record<string, unknown>;
        const number = integer(info.Cbte_nro);
        if (number === undefined) {
            throw new ArcaServiceError(
                'FEXGetLast_CMP returned no Cbte_nro; refusing to read a missing element as 0 ' +
                    '(which would report the next number as 1).',
                [{code: '', message: 'Cbte_nro missing from FEXGetLast_CMP response'}],
            );
        }
        return number;
    }

    protected override buildQueryRequest(
        auth: ArcaAuth,
        pointOfSaleNumber: number,
        voucherType: number,
        voucherNumber: number,
    ): Record<string, unknown> {
        return {
            Auth: authElement(auth),
            Cmp: {Cbte_tipo: voucherType, Punto_vta: pointOfSaleNumber, Cbte_nro: voucherNumber},
        };
    }

    protected override buildPointsOfSaleRequest(auth: ArcaAuth): Record<string, unknown> {
        return {Auth: authElement(auth)};
    }

    /**
     * The FEEWS register — "Comprobantes de Exportación – Web Services", a different register from the one
     * `FEParamGetPtosVenta` answers. A point of sale good for WSFEv1 is not usable here and vice versa.
     *
     * `issuanceMode` stays `undefined`: the register is FEEWS-only, so unlike WSFEv1's it has no
     * CAE-vs-CAEA column to report.
     */
    protected override parsePointsOfSale(result: Record<string, unknown>): Array<PointOfSaleInfo> {
        return catalogueRows(result, WSFEX_POINTS_OF_SALE).map((row) => ({
            number: toIntOrZero(row.id),
            blocked: text(row.raw.Pve_Bloqueado)?.toUpperCase() === 'S',
            dischargeDate: row.validTo,
        }));
    }

    protected override parseServerStatus(result: Record<string, unknown>): ServerStatus {
        return {
            appServer: text(result.AppServer) ?? '',
            dbServer: text(result.DbServer) ?? '',
            authServer: text(result.AuthServer) ?? '',
        };
    }

    /**
     * The highest request `Id` ARCA has seen for this CUIT (`FEXGetLast_ID`).
     *
     * No base hook: WSFEv1 has no request-id sequence to report, so this is WSFEX's own operation rather
     * than a differently-spelled version of something shared. It is how a caller seeds or recovers the
     * sequence after losing track of it — the only way back from a timeout, since a reused `Id` returns the
     * old voucher rather than an error.
     */
    async getLastRequestId(auth: ArcaAuth): Promise<number> {
        const result = await this.invoke('FEXGetLast_ID', {Auth: authElement(auth)});
        const info = (result.FEXResultGet ?? {}) as Record<string, unknown>;
        const id = integer(info.Id);
        if (id === undefined) {
            throw new ArcaServiceError(
                'FEXGetLast_ID returned no Id; refusing to read a missing element as 0 (which would ' +
                    'restart the request-id sequence and replay an existing voucher).',
                [{code: '', message: 'Id missing from FEXGetLast_ID response'}],
            );
        }
        return id;
    }

    /**
     * Whether the customs database holds this permit for this destination (`FEXCheck_Permiso`).
     *
     * Advisory: it lets a caller reject a bad `Id_permiso`/`Dst_merc` pair before spending a voucher number
     * on a 1740. ARCA answers `"OK"` or `"NO"`, and anything else is treated as "not verified" rather than
     * as a pass.
     */
    async checkShippingPermit(
        auth: ArcaAuth,
        permitId: string,
        destinationCode: number,
    ): Promise<boolean> {
        const result = await this.invoke('FEXCheck_Permiso', {
            Auth: authElement(auth),
            ID_Permiso: permitId,
            Dst_merc: destinationCode,
        });
        const info = (result.FEXResultGet ?? {}) as Record<string, unknown>;
        return text(info.Status)?.toUpperCase() === 'OK';
    }

    /**
     * The whole currency table priced for one day (`FEXGetPARAM_MON_CON_COTIZACION`).
     *
     * WSFEv1 has no equivalent — its `FEParamGetCotizacion` answers one currency per call, which is why the
     * domestic path fans out. One call here is better than a fan-out for three reasons beyond call volume:
     * the answer cannot straddle a publication boundary, a currency absent from it is exactly "no rate for
     * that day", and the set it returns *is* the set a service export may invoice in (rule 1600). Measured
     * against production 2026-09-04: 27 of 49 catalogued currencies priced, and every rate identical to
     * `FEParamGetCotizacion`'s for the same day.
     *
     * `Fecha_CTZ` is mandatory despite the WSDL marking it optional — omitting it is a `2054` saying so — so
     * the caller resolves the day rather than asking for "the latest".
     */
    async getCurrencyRatesForDay(auth: ArcaAuth, arcaDay: string): Promise<Array<FexDayRate>> {
        const result = await this.invoke('FEXGetPARAM_MON_CON_COTIZACION', {
            Auth: authElement(auth),
            Fecha_CTZ: arcaDay,
        });
        return catalogueRows(result, {
            resultNode: 'FEXResultGet',
            rowKey: 'ClsFEXResponse_Mon_CON_Cotizacion',
            idField: 'Mon_Id',
        }).map((row) => ({
            monId: row.id,
            rate: decimal(row.raw.Mon_ctz),
            rateDate: arcaDayFromSlashed(text(row.raw.Fecha_ctz)),
        }));
    }
}

/** One row of `FEXGetPARAM_MON_CON_COTIZACION`. */
export interface FexDayRate {
    readonly monId: string;
    readonly rate?: number;
    /** The day this rate closed on, as an ARCA `yyyymmdd` day like every other date the SDK returns. */
    readonly rateDate?: string;
}

/**
 * `Fecha_ctz` as an ARCA day.
 *
 * This one operation renders its date `DD/MM/YYYY`, where every other date on either service is `yyyymmdd`.
 * Converted here rather than surfaced raw, so nothing downstream has to know that one row of one table
 * speaks a different dialect — the mistake would be silent, `'03/09/2026'` being a perfectly plausible
 * string to store as a day.
 *
 * The manual disagrees with itself about the element name too: its XML sample shows `Mon_fecha` and its
 * field table `Fecha_ctz`. The table is right (measured against production, 2026-09-04).
 *
 * An unrecognized rendering yields `undefined` rather than a guess, which the caller reports as a rate with
 * no usable day instead of keying one wrongly.
 */
function arcaDayFromSlashed(value: string | undefined): string | undefined {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? '');
    if (match === null) {
        return undefined;
    }
    return `${match[3] ?? ''}${match[2] ?? ''}${match[1] ?? ''}`;
}

/**
 * WSFEX's observations, which are not WSFEv1's shape.
 *
 * WSFEv1 reports repeated `Observaciones/Obs{Code,Msg}` pairs; WSFEX reports a single `Motivos_Obs` string
 * of at most 40 characters. So there is no code to read, and this deliberately does not go through
 * `codeMsgPairs` — it yields one entry carrying the authority's text and an empty code, keeping the result
 * shape identical to WSFEv1's for the caller.
 */
function readObservations(value: unknown): Array<FexObservation> {
    const message = text(value);
    if (message === undefined) {
        return [];
    }
    return [{code: '', message}];
}
