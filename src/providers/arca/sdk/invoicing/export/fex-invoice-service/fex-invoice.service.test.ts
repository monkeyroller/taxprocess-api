import {describe, expect, it} from '@jest/globals';
import {FexInvoiceService} from './fex-invoice.service.js';
import {ArcaServiceError, NotImplementedError} from '../../../core/errors.js';
import type {FexInvoiceRequest} from '../fex-invoice.types.js';
import type {SoapClient} from '../../../core/soap-client/soap-client.js';
import type {ArcaAuth} from '../../../core/types.js';

/**
 * Exercises WSFEXv1 request and parse pairs without a network, through a fake SOAP client that returns the
 * operation's response element verbatim as the real transport does.
 */

const AUTH: ArcaAuth = {token: 'T', sign: 'S', cuit: 20111111112};

function serviceReturning(response: Record<string, unknown>): {
    service: FexInvoiceService;
    lastCall: {operation?: string; payload?: Record<string, unknown>};
} {
    const lastCall: {operation?: string; payload?: Record<string, unknown>} = {};
    const soap = {
        async call(_endpoint: string, _namespace: string, operation: string, payload: Record<string, unknown>) {
            lastCall.operation = operation;
            lastCall.payload = payload;
            return response;
        },
    } as unknown as SoapClient;
    return {service: new FexInvoiceService(soap, 'homologacion'), lastCall};
}

/** A minimal service export (UC-2): no permits, no notas, nothing conditional switched on. */
const SERVICE_EXPORT: FexInvoiceRequest = {
    requestId: 41,
    voucherType: 19,
    pointOfSaleNumber: 3,
    voucherNumber: 7,
    voucherDate: '20260904',
    exportType: 2,
    destinationCode: 203,
    clientName: 'Joao Da Silva',
    clientAddress: 'Rua 76 km 34.5 Alagoas',
    clientTaxId: 'PJ54482221-l',
    currencyId: 'DOL',
    currencyRate: 1508,
    totalAmount: 500,
    paymentTerms: 'Contado',
    language: 1,
    paymentDate: '20260930',
    items: [{description: 'Consultoría', quantity: 2, unitOfMeasure: 7, unitPrice: 250, totalAmount: 500}],
};

const authorizeResponse = (auth: Record<string, unknown>): Record<string, unknown> => ({
    FEXAuthorizeResult: {FEXResultAuth: auth, FEXErr: {ErrCode: 0, ErrMsg: ''}},
});

describe('FexInvoiceService.requestAuthorization (FEXAuthorize)', () => {
    it('sends Cmp in the XSD sequence order, omitting every absent optional', async () => {
        const {service, lastCall} = serviceReturning(
            authorizeResponse({Cbte_nro: 7, Cae: '69000000000001', Fch_venc_Cae: '20261015', Resultado: 'A'}),
        );

        await service.requestAuthorization(AUTH, SERVICE_EXPORT);

        expect(lastCall.operation).toBe('FEXAuthorize');
        const cmp = (lastCall.payload as {Cmp: Record<string, unknown>}).Cmp;

        // Order is load-bearing: ARCA rejects out-of-order elements.
        expect(Object.keys(cmp)).toEqual([
            'Id',
            'Fecha_cbte',
            'Cbte_Tipo',
            'Punto_vta',
            'Cbte_nro',
            'Tipo_expo',
            'Dst_cmp',
            'Cliente',
            'Domicilio_cliente',
            'Id_impositivo',
            'Moneda_Id',
            'Moneda_ctz',
            'Imp_total',
            'Forma_pago',
            'Idioma_cbte',
            'Items',
            'Fecha_pago',
        ]);

        // The forbidden-for-this-combination fields are absent rather than empty: an empty element is a
        // value ARCA validates, so `<CanMisMonExt/>` is a 1605 where an absent one is correct.
        expect(cmp).not.toHaveProperty('CanMisMonExt');
        expect(cmp).not.toHaveProperty('Permiso_existente');
        expect(cmp).not.toHaveProperty('Permisos');
        expect(cmp).not.toHaveProperty('Cmps_asoc');
        expect(cmp).not.toHaveProperty('Incoterms');
    });

    it('formats the rate to six decimals and the totals to two', async () => {
        const {service, lastCall} = serviceReturning(authorizeResponse({Resultado: 'A', Cae: '1'}));

        await service.requestAuthorization(AUTH, {...SERVICE_EXPORT, currencyRate: 1508, totalAmount: 500});

        const cmp = (lastCall.payload as {Cmp: Record<string, unknown>}).Cmp;
        expect(cmp.Moneda_ctz).toBe('1508.000000');
        expect(cmp.Imp_total).toBe('500.00');
        const items = (cmp.Items as {Item: Array<Record<string, unknown>>}).Item;
        expect(items[0]?.Pro_total_item).toBe('500.00');
    });

    it('nests permits and associated vouchers under their wrapper elements', async () => {
        const {service, lastCall} = serviceReturning(authorizeResponse({Resultado: 'A', Cae: '1'}));

        await service.requestAuthorization(AUTH, {
            ...SERVICE_EXPORT,
            exportType: 1,
            permitPresent: 'S',
            permits: [{permitId: '09052EC01006154G', destinationCode: 203}],
            incoterm: 'CIF',
            incotermDescription: 'Texto dic.',
            associatedVouchers: [{voucherType: 19, pointOfSaleNumber: 3, number: 6, cuit: 20111111112}],
        });

        const cmp = (lastCall.payload as {Cmp: Record<string, unknown>}).Cmp;
        expect(cmp.Permisos).toEqual({Permiso: [{Id_permiso: '09052EC01006154G', Dst_merc: 203}]});
        expect(cmp.Cmps_asoc).toEqual({
            Cmp_asoc: [{Cbte_tipo: 19, Cbte_punto_vta: 3, Cbte_nro: 6, Cbte_cuit: 20111111112}],
        });
        expect(cmp.Incoterms).toBe('CIF');
    });

    it('reads the CAE, the echoed number and Reproceso off FEXResultAuth', async () => {
        const {service} = serviceReturning(
            authorizeResponse({
                Id: 41,
                Cbte_nro: 7,
                Cae: '69000000000001',
                Fch_venc_Cae: '20261015',
                Fch_cbte: '20260904',
                Resultado: 'A',
                Reproceso: 'N',
                Motivos_Obs: '',
            }),
        );

        const result = await service.requestAuthorization(AUTH, SERVICE_EXPORT);

        expect(result).toMatchObject({
            result: 'A',
            cae: '69000000000001',
            caeExpiration: '20261015',
            voucherNumber: 7,
            voucherDate: '20260904',
            requestId: 41,
            reprocessed: false,
            observations: [],
        });
    });

    it('reports Reproceso "S" as a replay', async () => {
        // The success case on a deliberate retry, and a reused-id bug otherwise -- either way the caller has
        // to be able to tell, because the voucher returned is not the one just described.
        const {service} = serviceReturning(
            authorizeResponse({Cbte_nro: 7, Cae: '69000000000001', Resultado: 'A', Reproceso: 'S'}),
        );

        expect((await service.requestAuthorization(AUTH, SERVICE_EXPORT)).reprocessed).toBe(true);
    });

    it('reads Motivos_Obs as a single observation carrying no code', async () => {
        // WSFEX sends one delimited string of at most 40 characters where WSFEv1 sends repeated
        // {Code, Msg} pairs, so there is no code to report.
        const {service} = serviceReturning(
            authorizeResponse({Cbte_nro: 7, Cae: '1', Resultado: 'A', Motivos_Obs: '14 - Monotributo'}),
        );

        expect((await service.requestAuthorization(AUTH, SERVICE_EXPORT)).observations).toEqual([
            {code: '', message: '14 - Monotributo'},
        ]);
    });

    it('defaults an unrecognised Resultado to rejected', async () => {
        const {service} = serviceReturning(authorizeResponse({Cbte_nro: 0}));

        expect((await service.requestAuthorization(AUTH, SERVICE_EXPORT)).result).toBe('R');
    });
});

describe('FexInvoiceService error block (FEXErr)', () => {
    it('raises on a non-zero ErrCode', async () => {
        const {service} = serviceReturning({
            FEXAuthorizeResult: {FEXErr: {ErrCode: 1601, ErrMsg: 'Moneda_ctz debe ser 1 para PES'}},
        });

        const failure = await service
            .requestAuthorization(AUTH, SERVICE_EXPORT)
            .then(() => undefined)
            .catch((err: unknown) => err as ArcaServiceError);

        expect(failure).toBeInstanceOf(ArcaServiceError);
        expect(failure?.errors).toEqual([{code: '1601', message: 'Moneda_ctz debe ser 1 para PES'}]);
    });

    it('treats ErrCode 0 as success', async () => {
        // WSFEX sends FEXErr on every response, so presence cannot mean failure. Reading it the WSFEv1 way
        // -- looking under `Errors` -- would find nothing and report every rejection as a success; reading
        // presence as failure would reject every successful call.
        const {service} = serviceReturning({
            FEXAuthorizeResult: {
                FEXResultAuth: {Cbte_nro: 7, Cae: '69000000000001', Resultado: 'A'},
                FEXErr: {ErrCode: 0, ErrMsg: ''},
            },
        });

        expect((await service.requestAuthorization(AUTH, SERVICE_EXPORT)).cae).toBe('69000000000001');
    });

    it('raises on an error carrying a message and no code', async () => {
        const {service} = serviceReturning({
            FEXAuthorizeResult: {FEXErr: {ErrMsg: 'sin codigo'}},
        });

        const failure = await service
            .requestAuthorization(AUTH, SERVICE_EXPORT)
            .then(() => undefined)
            .catch((err: unknown) => err as ArcaServiceError);

        expect(failure).toBeInstanceOf(ArcaServiceError);
        expect(failure?.errors).toEqual([{code: '', message: 'sin codigo'}]);
    });
});

describe('FexInvoiceService.getLastAuthorizedNumber (FEXGetLast_CMP)', () => {
    it('nests Pto_venta and Cbte_Tipo inside Auth', async () => {
        // Unlike every other operation on either service, which put their arguments beside Auth.
        const {service, lastCall} = serviceReturning({
            FEXGetLast_CMPResult: {FEXResult_LastCMP: {Cbte_nro: 12, Cbte_fecha: '20260903'}},
        });

        const last = await service.getLastAuthorizedNumber(AUTH, 3, 19);

        expect(lastCall.operation).toBe('FEXGetLast_CMP');
        expect(lastCall.payload).toEqual({
            Auth: {Token: 'T', Sign: 'S', Cuit: 20111111112, Pto_venta: 3, Cbte_Tipo: 19},
        });
        expect(last).toBe(12);
    });

    it('reads a never-authorized point of sale as 0', async () => {
        const {service} = serviceReturning({FEXGetLast_CMPResult: {FEXResult_LastCMP: {Cbte_nro: 0}}});

        expect(await service.getLastAuthorizedNumber(AUTH, 3, 19)).toBe(0);
    });

    it('refuses a missing Cbte_nro rather than reading it as 0', async () => {
        // `0` is ARCA's legitimate answer for "never authorized", so a silent default here would report the
        // next number as 1 for a point of sale that may already hold thousands of vouchers.
        const {service} = serviceReturning({FEXGetLast_CMPResult: {FEXResult_LastCMP: {}}});

        await expect(service.getLastAuthorizedNumber(AUTH, 3, 19)).rejects.toBeInstanceOf(ArcaServiceError);
    });
});

describe('FexInvoiceService.queryVoucher (FEXGetCMP)', () => {
    it('sends Cmp and reads the stored voucher off FEXResultGet', async () => {
        const {service, lastCall} = serviceReturning({
            FEXGetCMPResult: {
                FEXResultGet: {Cbte_nro: 7, Cae: '69000000000001', Fch_venc_Cae: '20261015', Resultado: 'A'},
            },
        });

        const result = await service.queryVoucher(AUTH, 3, 19, 7);

        expect(lastCall.operation).toBe('FEXGetCMP');
        expect(lastCall.payload).toEqual({
            Auth: {Token: 'T', Sign: 'S', Cuit: 20111111112},
            Cmp: {Cbte_tipo: 19, Punto_vta: 3, Cbte_nro: 7},
        });
        expect(result).toMatchObject({cae: '69000000000001', voucherNumber: 7});
    });

    it("reads the query response's own spelling of the voucher date", async () => {
        // ARCA spells it `Fch_cbte` when authorizing and `Fecha_cbte` when answering a query -- the same
        // inconsistency that has `Cbte_Tipo` in one payload and `Cbte_tipo` in the other. Reading only the
        // authorize spelling left a queried export voucher with no date at all.
        const {service} = serviceReturning({
            FEXGetCMPResult: {
                FEXResultGet: {
                    Cbte_nro: 7,
                    Cae: '69000000000001',
                    Fch_venc_Cae: '20261015',
                    Fecha_cbte: '20260904',
                    Resultado: 'A',
                },
            },
        });

        expect((await service.queryVoucher(AUTH, 3, 19, 7)).voucherDate).toBe('20260904');
    });
});

describe('FexInvoiceService.getPointsOfSale (FEXGetPARAM_PtoVenta)', () => {
    it('reads the FEEWS register, which has no issuance-kind column', async () => {
        const {service} = serviceReturning({
            FEXGetPARAM_PtoVentaResult: {
                FEXResultGet: {
                    ClsFEXResponse_PtoVenta: [
                        {Pve_Nro: 1, Pve_Bloqueado: 'N', Pve_FchBaja: 'NULL'},
                        {Pve_Nro: 2, Pve_Bloqueado: 'S', Pve_FchBaja: '20260101'},
                    ],
                },
            },
        });

        expect(await service.getPointsOfSale(AUTH)).toEqual([
            {number: 1, blocked: false, dischargeDate: undefined},
            {number: 2, blocked: true, dischargeDate: '20260101'},
        ]);
    });

    it('reads an issuer with no registered export point of sale as an empty list', async () => {
        const {service} = serviceReturning({FEXGetPARAM_PtoVentaResult: {}});

        expect(await service.getPointsOfSale(AUTH)).toEqual([]);
    });
});

describe('FexInvoiceService.getLastRequestId (FEXGetLast_ID)', () => {
    it('reads the highest request id ARCA has seen', async () => {
        const {service, lastCall} = serviceReturning({FEXGetLast_IDResult: {FEXResultGet: {Id: 41}}});

        expect(await service.getLastRequestId(AUTH)).toBe(41);
        expect(lastCall.operation).toBe('FEXGetLast_ID');
        expect(lastCall.payload).toEqual({Auth: {Token: 'T', Sign: 'S', Cuit: 20111111112}});
    });

    it('refuses a missing Id rather than restarting the sequence at 0', async () => {
        const {service} = serviceReturning({FEXGetLast_IDResult: {FEXResultGet: {}}});

        await expect(service.getLastRequestId(AUTH)).rejects.toBeInstanceOf(ArcaServiceError);
    });
});

describe('FexInvoiceService.getCurrencyRatesForDay (FEXGetPARAM_MON_CON_COTIZACION)', () => {
    it('prices the whole table in one call, normalizing the one date ARCA slashes', async () => {
        const {service, lastCall} = serviceReturning({
            FEXGetPARAM_MON_CON_COTIZACIONResult: {
                FEXResultGet: {
                    ClsFEXResponse_Mon_CON_Cotizacion: [
                        {Mon_Id: 'DOL', Mon_ctz: '1508', Fecha_ctz: '03/09/2026'},
                        {Mon_Id: '060', Mon_ctz: '1756.5184', Fecha_ctz: '03/09/2026'},
                    ],
                },
            },
        });

        const rates = await service.getCurrencyRatesForDay(AUTH, '20260903');

        expect(lastCall.payload).toEqual({
            Auth: {Token: 'T', Sign: 'S', Cuit: 20111111112},
            Fecha_CTZ: '20260903',
        });
        // `Fecha_ctz` arrives `DD/MM/YYYY` where every other date on either service is `yyyymmdd`. Converted
        // here so nothing downstream has to know that one row of one table speaks a different dialect --
        // which would be a silent mistake, `'03/09/2026'` being a plausible thing to store as a day.
        expect(rates).toEqual([
            {monId: 'DOL', rate: 1508, rateDate: '20260903'},
            {monId: '060', rate: 1756.5184, rateDate: '20260903'},
        ]);
    });

    it('reports no day rather than guessing one when the rendering is unrecognized', async () => {
        const {service} = serviceReturning({
            FEXGetPARAM_MON_CON_COTIZACIONResult: {
                FEXResultGet: {
                    ClsFEXResponse_Mon_CON_Cotizacion: {Mon_Id: 'DOL', Mon_ctz: '1508', Fecha_ctz: '2026-09-03'},
                },
            },
        });

        expect((await service.getCurrencyRatesForDay(AUTH, '20260903'))[0]?.rateDate).toBeUndefined();
    });
});

describe('FexInvoiceService unimplemented operations', () => {
    it('answers NOT_IMPLEMENTED for the per-currency cotización rather than sending a WSFEv1 payload', async () => {
        // `FEXGetPARAM_Ctz` takes FchCotiz as YYYY-MM-DD where WSFEv1 wants yyyymmdd (error 1003), so
        // inheriting the WSFEv1 builder would silently ask about a different day.
        const {service} = serviceReturning({});

        await expect(service.getCurrencyRate(AUTH, 'DOL')).rejects.toBeInstanceOf(NotImplementedError);
        await expect(service.getCurrencyTypes(AUTH)).rejects.toBeInstanceOf(NotImplementedError);
    });
});
