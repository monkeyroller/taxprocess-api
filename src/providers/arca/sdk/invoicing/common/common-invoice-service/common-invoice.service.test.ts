import {describe, expect, it} from '@jest/globals';
import {CommonInvoiceService} from './common-invoice.service.js';
import {ArcaServiceError} from '../../../core/errors.js';
import type {CommonInvoiceRequest} from '../common-invoice.types.js';
import type {SoapClient} from '../../../core/soap-client/soap-client.js';
import type {ArcaAuth} from '../../../core/types.js';

/**
 * Exercises WSFEv1 request and parse pairs without a network, through a fake SOAP client that returns the
 * operation's response element verbatim as the real transport does.
 */

const AUTH: ArcaAuth = {token: 'T', sign: 'S', cuit: 20111111112};

/** Builds a service whose transport always returns `response`, capturing the last call's arguments. */
function serviceReturning(response: Record<string, unknown>): {
    service: CommonInvoiceService;
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
    return {service: new CommonInvoiceService(soap, 'homologacion'), lastCall};
}

const wrap = (resultGet: unknown): Record<string, unknown> => ({
    FEParamGetPtosVentaResult: resultGet === undefined ? {} : {ResultGet: resultGet},
});

describe('CommonInvoiceService.getPointsOfSale (FEParamGetPtosVenta)', () => {
    it('sends only the Auth block to the FEParamGetPtosVenta operation', async () => {
        const {service, lastCall} = serviceReturning(wrap({PtoVenta: {Nro: 1, EmisionTipo: 'CAE', Bloqueado: 'N', FchBaja: 'NULL'}}));

        await service.getPointsOfSale(AUTH);

        expect(lastCall.operation).toBe('FEParamGetPtosVenta');
        expect(lastCall.payload).toEqual({Auth: {Token: 'T', Sign: 'S', Cuit: 20111111112}});
    });

    it('maps a list of points of sale, coercing Bloqueado and clearing NULL discharge dates', async () => {
        const {service} = serviceReturning(
            wrap({
                PtoVenta: [
                    {Nro: 1, EmisionTipo: 'CAE', Bloqueado: 'N', FchBaja: 'NULL'},
                    {Nro: 2, EmisionTipo: 'CAEA', Bloqueado: 'S', FchBaja: '20240115'},
                ],
            }),
        );

        const points = await service.getPointsOfSale(AUTH);

        expect(points).toEqual([
            {number: 1, issuanceMode: 'CAE', blocked: false, dischargeDate: undefined},
            {number: 2, issuanceMode: 'CAEA', blocked: true, dischargeDate: '20240115'},
        ]);
    });

    it('normalizes a single point of sale (object, not array) into a one-element list', async () => {
        const {service} = serviceReturning(wrap({PtoVenta: {Nro: 7, EmisionTipo: 'CAE', Bloqueado: 'N', FchBaja: ''}}));

        const points = await service.getPointsOfSale(AUTH);

        expect(points).toHaveLength(1);
        expect(points[0]).toEqual({number: 7, issuanceMode: 'CAE', blocked: false, dischargeDate: undefined});
    });

    it('returns an empty list when the CUIT has no registered points of sale (absent ResultGet)', async () => {
        const {service} = serviceReturning(wrap(undefined));

        await expect(service.getPointsOfSale(AUTH)).resolves.toEqual([]);
    });
});

/**
 * A minimal valid request. Every field is distinct where a mix-up would matter, so the payload assertions
 * below catch a positional swap rather than comparing a number against itself.
 */
const REQUEST: CommonInvoiceRequest = {
    pointOfSaleNumber: 3,
    voucherType: 1,
    concept: 1,
    docType: 80,
    docNumber: 20111111112,
    voucherNumberFrom: 42,
    voucherNumberTo: 42,
    voucherDate: '20260805',
    totalAmount: 121,
    netUntaxed: 0,
    netTaxed: 100,
    exempt: 0,
    vatAmount: 21,
    tributesAmount: 0,
    currencyId: 'PES',
    currencyRate: 1,
    receiverIvaConditionId: 1,
    vatSubtotals: [{Id: 5, BaseImp: 100, Importe: 21}],
};

/**
 * A `FECAESolicitar` response. `Resultado` appears in both the batch header and the per-voucher detail;
 * `headerResult` sets the header copy, which the parse consults only as a fallback.
 */
const authorizeResponse = (detail: Record<string, unknown>, headerResult = 'A'): Record<string, unknown> => ({
    FECAESolicitarResult: {
        FeCabResp: {Resultado: headerResult, CbteTipo: '1', PtoVta: '3'},
        FeDetResp: {FECAEDetResponse: detail},
    },
});

/** An approved detail block; the payload tests need a parseable response but assert nothing about it. */
const APPROVED_DETAIL = {
    Resultado: 'A',
    CAE: '75123456789012',
    CAEFchVto: '20260815',
    CbteDesde: '42',
    CbteHasta: '42',
};

/** The `FECAEDetRequest` element the last call carried. */
const sentDetail = (lastCall: {payload?: Record<string, unknown>}): Record<string, unknown> =>
    (lastCall.payload as {FeCAEReq: {FeDetReq: {FECAEDetRequest: Record<string, unknown>}}}).FeCAEReq.FeDetReq
        .FECAEDetRequest;

/**
 * The request half of the pairs — two properties a response-only test cannot see.
 *
 * Element order: `FECAEDetRequest` is an XSD sequence and ARCA rejects out-of-order elements, but `toEqual`
 * is order-blind, so the key order is asserted separately.
 *
 * Positional argument mapping: `queryVoucher` funnels three adjacent numbers into three ARCA fields, so a
 * swap type-checks silently. It would not merely return the wrong voucher — recovery would query one that
 * does not exist, read that as nothing to recover, and re-surface the `10016` for a sale already filed.
 */
describe('CommonInvoiceService request payloads', () => {
    it('builds the FECAESolicitar payload for a goods voucher (concept 1)', async () => {
        const {service, lastCall} = serviceReturning(authorizeResponse(APPROVED_DETAIL));

        await service.requestAuthorization(AUTH, REQUEST);

        expect(lastCall.operation).toBe('FECAESolicitar');
        expect(lastCall.payload).toEqual({
            Auth: {Token: 'T', Sign: 'S', Cuit: 20111111112},
            FeCAEReq: {
                // CantReg is derived from the range, not passed in: 42..42 is one register.
                FeCabReq: {CantReg: 1, PtoVta: 3, CbteTipo: 1},
                FeDetReq: {
                    FECAEDetRequest: {
                        Concepto: 1,
                        DocTipo: 80,
                        DocNro: 20111111112,
                        CbteDesde: 42,
                        CbteHasta: 42,
                        CbteFch: '20260805',
                        // Amounts go on the wire as fixed-2 strings; the rate as fixed-6.
                        ImpTotal: '121.00',
                        ImpTotConc: '0.00',
                        ImpNeto: '100.00',
                        ImpOpEx: '0.00',
                        ImpTrib: '0.00',
                        ImpIVA: '21.00',
                        MonId: 'PES',
                        MonCotiz: '1.000000',
                        CondicionIVAReceptorId: 1,
                        Iva: {AlicIva: [{Id: 5, BaseImp: '100.00', Importe: '21.00'}]},
                    },
                },
            },
        });
        // Concept 1 omits the service-date block entirely: an empty element is not the same as absent.
        expect(Object.keys(sentDetail(lastCall))).toEqual([
            'Concepto',
            'DocTipo',
            'DocNro',
            'CbteDesde',
            'CbteHasta',
            'CbteFch',
            'ImpTotal',
            'ImpTotConc',
            'ImpNeto',
            'ImpOpEx',
            'ImpTrib',
            'ImpIVA',
            'MonId',
            'MonCotiz',
            'CondicionIVAReceptorId',
            'Iva',
        ]);
    });

    it('slots the service dates between ImpIVA and MonId for a services voucher (concept 2)', async () => {
        const {service, lastCall} = serviceReturning(authorizeResponse(APPROVED_DETAIL));

        await service.requestAuthorization(AUTH, {
            ...REQUEST,
            concept: 2,
            serviceDateFrom: '20260801',
            serviceDateTo: '20260831',
            paymentDueDate: '20260910',
        });

        const detail = sentDetail(lastCall);
        expect(detail.FchServDesde).toBe('20260801');
        expect(detail.FchServHasta).toBe('20260831');
        expect(detail.FchVtoPago).toBe('20260910');
        expect(Object.keys(detail)).toEqual([
            'Concepto',
            'DocTipo',
            'DocNro',
            'CbteDesde',
            'CbteHasta',
            'CbteFch',
            'ImpTotal',
            'ImpTotConc',
            'ImpNeto',
            'ImpOpEx',
            'ImpTrib',
            'ImpIVA',
            'FchServDesde',
            'FchServHasta',
            'FchVtoPago',
            'MonId',
            'MonCotiz',
            'CondicionIVAReceptorId',
            'Iva',
        ]);
    });

    it('maps queryVoucher(pointOfSale, voucherType, voucherNumber) onto FeCompConsReq without transposing them', async () => {
        const {service, lastCall} = serviceReturning({
            FECompConsultarResult: {ResultGet: {Resultado: 'A', CodAutorizacion: '75123456789012'}},
        });

        await service.queryVoucher(AUTH, 3, 1, 42);

        expect(lastCall.operation).toBe('FECompConsultar');
        expect(lastCall.payload).toEqual({
            Auth: {Token: 'T', Sign: 'S', Cuit: 20111111112},
            FeCompConsReq: {CbteTipo: 1, CbteNro: 42, PtoVta: 3},
        });
    });
});

/**
 * ARCA can approve a voucher and observe it: a real CAE plus a populated `Observaciones` block. The parse
 * must not tie observations to a rejection, since dropping them would discard the authority's only notice
 * about an accepted voucher. Field values are strings because the parser does not coerce.
 */
describe('CommonInvoiceService — the CAE expiry is a DATE field', () => {
    it("reads ARCA's NULL marker as absent, not as the four characters", async () => {
        // `CAEFchVto` was read with `cleanCode`, which strips `''` and `'0'` but not the `'NULL'` marker
        // ARCA fills unset date fields with. Surfaced as `'NULL'`, the mapper then threw on it — a `500` on
        // an authorization that succeeded at ARCA, losing the CAE.
        const {service} = serviceReturning(
            authorizeResponse({
                Resultado: 'A',
                CAE: '75123456789012',
                CAEFchVto: 'NULL',
                CbteDesde: '42',
                CbteHasta: '42',
            }),
        );

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.cae).toBe('75123456789012');
        expect(result.caeExpiration).toBeUndefined();
    });

    it('applies the same reading to the query path', async () => {
        const {service} = serviceReturning({
            FECompConsultarResult: {
                ResultGet: {
                    Resultado: 'A',
                    CodAutorizacion: '75123456789012',
                    FchVto: 'NULL',
                    CbteDesde: 42,
                    CbteHasta: 42,
                },
            },
        });

        const result = await service.queryVoucher(AUTH, 3, 1, 42);

        expect(result.cae).toBe('75123456789012');
        expect(result.caeExpiration).toBeUndefined();
    });
});

describe('CommonInvoiceService.requestAuthorization (FECAESolicitar) — observations', () => {
    it('keeps observations on an APPROVED voucher, alongside the CAE', async () => {
        const {service} = serviceReturning(
            authorizeResponse({
                Resultado: 'A',
                CAE: '75123456789012',
                CAEFchVto: '20260815',
                CbteDesde: '42',
                CbteHasta: '42',
                Observaciones: {Obs: {Code: '10063', Msg: 'El comprobante fue autorizado con observaciones'}},
            }),
        );

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.result).toBe('A');
        expect(result.cae).toBe('75123456789012');
        expect(result.caeExpiration).toBe('20260815');
        expect(result.observations).toEqual([
            {code: '10063', message: 'El comprobante fue autorizado con observaciones'},
        ]);
    });

    it('normalizes multiple Obs entries into a list on an approved voucher', async () => {
        const {service} = serviceReturning(
            authorizeResponse({
                Resultado: 'A',
                CAE: '75123456789012',
                CAEFchVto: '20260815',
                CbteDesde: '42',
                CbteHasta: '42',
                Observaciones: {
                    Obs: [
                        {Code: '10063', Msg: 'primera'},
                        {Code: '10192', Msg: 'segunda'},
                    ],
                },
            }),
        );

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.result).toBe('A');
        expect(result.cae).toBe('75123456789012');
        expect(result.observations).toEqual([
            {code: '10063', message: 'primera'},
            {code: '10192', message: 'segunda'},
        ]);
    });

    it('returns an empty observation list when the approved voucher carries none', async () => {
        const {service} = serviceReturning(
            authorizeResponse({
                Resultado: 'A',
                CAE: '75123456789012',
                CAEFchVto: '20260815',
                CbteDesde: '42',
                CbteHasta: '42',
            }),
        );

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.observations).toEqual([]);
    });

    /**
     * Core persists observations verbatim, so a half-formed `Obs` must degrade to blank: `String(undefined)`
     * would write the literal word "undefined" onto an authorized sale as if ARCA had said it.
     */
    it('renders an Obs missing Code or Msg as blank, never the string "undefined"', async () => {
        const {service} = serviceReturning(
            authorizeResponse({
                ...APPROVED_DETAIL,
                Observaciones: {Obs: [{Code: '10063'}, {Msg: 'sin codigo'}, {Code: '10192', Msg: ''}]},
            }),
        );

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.observations).toEqual([
            {code: '10063', message: ''},
            {code: '', message: 'sin codigo'},
            {code: '10192', message: ''},
        ]);
    });

    it('drops an Obs that states neither a code nor a message instead of persisting a blank row', async () => {
        // An empty `<Obs/>` parses to `''`, which is a value rather than an absence, so it survives the
        // single-vs-array normalization and would arrive as an entry the authority never wrote. Core
        // persists observations verbatim, so a phantom is a blank row kept for the life of the voucher.
        for (const obs of ['', {}, {Code: '', Msg: ''}, [{Code: '', Msg: ''}]]) {
            const {service} = serviceReturning(
                authorizeResponse({...APPROVED_DETAIL, Observaciones: {Obs: obs}}),
            );

            const result = await service.requestAuthorization(AUTH, REQUEST);

            expect(result.observations).toEqual([]);
            // Still an ordinary approval — an empty observation says nothing about the outcome.
            expect(result.cae).toBe('75123456789012');
        }
    });

    it('keeps an Obs carrying only one half of the pair — half is still something ARCA said', async () => {
        const {service} = serviceReturning(
            authorizeResponse({
                ...APPROVED_DETAIL,
                Observaciones: {Obs: [{Code: '10063'}, {Msg: 'sin codigo'}, {Code: '', Msg: ''}]},
            }),
        );

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.observations).toEqual([
            {code: '10063', message: ''},
            {code: '', message: 'sin codigo'},
        ]);
    });

    it('keeps observations on a rejected voucher (no CAE)', async () => {
        const {service} = serviceReturning(
            authorizeResponse(
                {
                    Resultado: 'R',
                    CAE: '',
                    CAEFchVto: '',
                    CbteDesde: '42',
                    CbteHasta: '42',
                    Observaciones: {Obs: {Code: '10016', Msg: 'El numero o fecha del comprobante no se corresponde'}},
                },
                'R',
            ),
        );

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.result).toBe('R');
        expect(result.cae).toBeUndefined();
        expect(result.observations).toEqual([
            {code: '10016', message: 'El numero o fecha del comprobante no se corresponde'},
        ]);
    });
});

/**
 * `Resultado` arrives twice, once per voucher and once for the batch, and the parse prefers the detail.
 * Precedence and fallback are separate branches, and neither may resolve to an approval by accident: a
 * wrong one would hand core a `200` carrying no CAE, which the controller's guard is only the second line
 * of defence against.
 */
describe('CommonInvoiceService.requestAuthorization (FECAESolicitar) — result code', () => {
    it('prefers the detail Resultado over a conflicting header', async () => {
        const {service} = serviceReturning(
            authorizeResponse({Resultado: 'R', CAE: '', CAEFchVto: '', CbteDesde: '42', CbteHasta: '42'}, 'A'),
        );

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.result).toBe('R');
        expect(result.cae).toBeUndefined();
    });

    /**
     * On an approved header on purpose: `normalizeResultCode` already answers `'R'` for anything it cannot
     * read, so a header rejection would pass with the fallback deleted. Only an approval makes the branch
     * observable, and it is the case that matters — reading it as `'R'` would discard a CAE ARCA issued.
     */
    it('falls back to the header Resultado when the detail block omits it', async () => {
        const {service} = serviceReturning(
            authorizeResponse({CAE: '75123456789012', CAEFchVto: '20260815', CbteDesde: '42', CbteHasta: '42'}, 'A'),
        );

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.result).toBe('A');
        expect(result.cae).toBe('75123456789012');
        expect(result.caeExpiration).toBe('20260815');
    });

    it('reads a header-only rejection (no FeDetResp at all) without throwing', async () => {
        const {service} = serviceReturning({
            FECAESolicitarResult: {FeCabResp: {Resultado: 'R', CbteTipo: '1', PtoVta: '3'}},
        });

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.result).toBe('R');
        expect(result.cae).toBeUndefined();
        // No detail means no echoed range; 0 is the "authority said nothing" value, not voucher zero.
        expect(result.voucherNumberFrom).toBe(0);
        expect(result.observations).toEqual([]);
        // `raw` falls back to the whole result element, so the response stays diagnosable.
        expect(result.raw).toHaveProperty('FeCabResp');
    });

    it('defaults to REJECTED when neither the detail nor the header carries a Resultado', async () => {
        const {service} = serviceReturning({
            FECAESolicitarResult: {
                FeCabResp: {CbteTipo: '1', PtoVta: '3'},
                FeDetResp: {FECAEDetResponse: {CbteDesde: '42', CbteHasta: '42'}},
            },
        });

        const result = await service.requestAuthorization(AUTH, REQUEST);

        expect(result.result).toBe('R');
    });
});

/**
 * `FECompConsultar` is the recovery path for observations core failed to persist off the authorize response,
 * so the stored voucher's `Observaciones` must survive the query parse too.
 */
describe('CommonInvoiceService.queryVoucher (FECompConsultar) — observations', () => {
    it('keeps observations on a queried authorized voucher', async () => {
        const {service} = serviceReturning({
            FECompConsultarResult: {
                ResultGet: {
                    Resultado: 'A',
                    CodAutorizacion: '75123456789012',
                    FchVto: '20260815',
                    CbteDesde: '42',
                    CbteHasta: '42',
                    Observaciones: {Obs: {Code: '10063', Msg: 'autorizado con observaciones'}},
                },
            },
        });

        const result = await service.queryVoucher(AUTH, 3, 1, 42);

        expect(result.result).toBe('A');
        expect(result.cae).toBe('75123456789012');
        expect(result.observations).toEqual([{code: '10063', message: 'autorizado con observaciones'}]);
    });
});

/** `FEParamGetCotizacion` — one currency's published rate, optionally for a given day. */
describe('CommonInvoiceService.getCurrencyRate (FEParamGetCotizacion)', () => {
    const rateResponse = (resultGet: unknown): Record<string, unknown> => ({
        FEParamGetCotizacionResult: {ResultGet: resultGet},
    });

    it('sends Auth and MonId, and OMITS FchCotiz entirely when no day is asked for', async () => {
        // Omitted rather than sent empty: ARCA validates the format of whatever is present, so an empty
        // element is a 12002 where an absent one means "give me the latest".
        const {service, lastCall} = serviceReturning(
            rateResponse({MonId: 'DOL', MonCotiz: '1465.5', FchCotiz: '20260827'}),
        );

        await service.getCurrencyRate(AUTH, 'DOL');

        expect(lastCall.operation).toBe('FEParamGetCotizacion');
        expect(lastCall.payload).toEqual({Auth: {Token: 'T', Sign: 'S', Cuit: 20111111112}, MonId: 'DOL'});
        expect(lastCall.payload).not.toHaveProperty('FchCotiz');
    });

    it('sends FchCotiz when a day is asked for', async () => {
        const {service, lastCall} = serviceReturning(
            rateResponse({MonId: 'DOL', MonCotiz: '1452', FchCotiz: '20260825'}),
        );

        await service.getCurrencyRate(AUTH, 'DOL', '20260825');

        expect(lastCall.payload).toMatchObject({MonId: 'DOL', FchCotiz: '20260825'});
    });

    it('parses the rate as a number and keeps the day as ARCA yyyymmdd', async () => {
        // These arrive as strings in production, and `rateDate` stays one: it is a calendar day, and
        // running it through a `Date` is what shifts the day.
        const {service} = serviceReturning(
            rateResponse({MonId: 'DOL', MonCotiz: '1465.5', FchCotiz: '20260827'}),
        );

        expect(await service.getCurrencyRate(AUTH, 'DOL')).toEqual({
            monId: 'DOL',
            rate: 1465.5,
            rateDate: '20260827',
        });
    });

    it('reads MonId back from the answer rather than echoing the request', async () => {
        // The authority decides the canonical spelling, and types the response field wider than the
        // catalogue's own `Id`.
        const {service} = serviceReturning(
            rateResponse({MonId: '002', MonCotiz: '1600', FchCotiz: '20260827'}),
        );

        expect((await service.getCurrencyRate(AUTH, '002')).monId).toBe('002');
    });

    it('clears an ARCA empty marker on the date rather than passing NULL through', async () => {
        const {service} = serviceReturning(rateResponse({MonId: 'DOL', MonCotiz: '1', FchCotiz: 'NULL'}));

        expect((await service.getCurrencyRate(AUTH, 'DOL')).rateDate).toBe('');
    });

    it('reports a rate the answer did not carry as absent, never as NaN or zero', async () => {
        // The number is held to the same standard as the day beside it. A bare `Number()` read a missing
        // `MonCotiz` as `NaN` and a blank one as a finite `0` — the worse of the two, since the provider
        // resolves it into the band `[0, 0]`, the wire stating ARCA accepts exactly zero.
        for (const monCotiz of [undefined, '', '   ', 'not-a-number']) {
            const {service} = serviceReturning(
                rateResponse({MonId: 'DOL', MonCotiz: monCotiz, FchCotiz: '20260827'}),
            );
            expect((await service.getCurrencyRate(AUTH, 'DOL')).rate).toBeUndefined();
        }
    });

    it('throws on an Errors block, so an unknown code does not read as a rate of NaN', async () => {
        const soap = {
            async call() {
                return {
                    FEParamGetCotizacionResult: {
                        Errors: {Err: {Code: 12000, Msg: 'Campo <MonId> debe ser algunos de los habilitados'}},
                    },
                };
            },
        } as unknown as SoapClient;

        await expect(new CommonInvoiceService(soap, 'homologacion').getCurrencyRate(AUTH, 'DOLL')).rejects.toThrow(
            /12000/,
        );
    });

    it('reports a half-formed Errors entry as blank, never as the literal string "undefined"', async () => {
        // These entries reach the caller in `details`, so an `Err` missing a `Code` used to hand core the
        // word "undefined" as though ARCA had sent it as an error code.
        const soap = {
            async call() {
                return {
                    FEParamGetCotizacionResult: {Errors: {Err: {Msg: 'sin codigo'}}},
                };
            },
        } as unknown as SoapClient;

        const failure = await new CommonInvoiceService(soap, 'homologacion')
            .getCurrencyRate(AUTH, 'DOL')
            .then(() => undefined)
            .catch((err: unknown) => err as ArcaServiceError);

        expect(failure).toBeInstanceOf(ArcaServiceError);
        expect(failure?.errors).toEqual([{code: '', message: 'sin codigo'}]);
        expect(JSON.stringify(failure?.errors)).not.toContain('undefined');
    });

    it('does not manufacture a 502 out of an Errors block that names nothing', async () => {
        // `assertNoErrors` raises on a non-empty list, and an empty `<Err/>` parses to `''` — a value that
        // survives the single-vs-array normalization. Counted as an entry it produced a `502` with nothing
        // in it, invented from an element the authority left blank. An unreadable answer still degrades
        // safely, the result code defaulting to a rejection.
        for (const err of ['', {}, {Code: '', Msg: ''}]) {
            const soap = {
                async call() {
                    return {
                        FEParamGetCotizacionResult: {
                            Errors: {Err: err},
                            ResultGet: {MonId: 'DOL', MonCotiz: '1465.5', FchCotiz: '20260827'},
                        },
                    };
                },
            } as unknown as SoapClient;

            expect(await new CommonInvoiceService(soap, 'homologacion').getCurrencyRate(AUTH, 'DOL')).toEqual({
                monId: 'DOL',
                rate: 1465.5,
                rateDate: '20260827',
            });
        }
    });
});

/**
 * `FECompUltimoAutorizado` — the number core adds 1 to. The two readings that matter are "ARCA said zero"
 * and "ARCA said nothing", and they must not collapse: both would otherwise report next-number 1.
 */
describe('CommonInvoiceService.getLastAuthorizedNumber (FECompUltimoAutorizado)', () => {
    const serviceFor = (payload: unknown): CommonInvoiceService => {
        const soap = {
            async call() {
                return {FECompUltimoAutorizadoResult: payload};
            },
        } as unknown as SoapClient;
        return new CommonInvoiceService(soap, 'homologacion');
    };

    it('reads CbteNro 0 as zero — a genuinely never-authorized point of sale', async () => {
        // ARCA's own answer for "nothing issued here yet"; the provider turns it into next-number 1.
        expect(await serviceFor({CbteNro: 0}).getLastAuthorizedNumber(AUTH, 3, 1)).toBe(0);
        expect(await serviceFor({CbteNro: '0'}).getLastAuthorizedNumber(AUTH, 3, 1)).toBe(0);
    });

    it('reads a real number as itself', async () => {
        expect(await serviceFor({CbteNro: '4172'}).getLastAuthorizedNumber(AUTH, 3, 1)).toBe(4172);
    });

    it('refuses a response with no CbteNro rather than reading it as 0', async () => {
        // A malformed answer read as `0` reports next-number 1 for a point of sale that may already hold
        // thousands of vouchers, and duplicating a live number is worse than failing the call.
        await expect(serviceFor({}).getLastAuthorizedNumber(AUTH, 3, 1)).rejects.toBeInstanceOf(ArcaServiceError);
        await expect(serviceFor({CbteNro: ''}).getLastAuthorizedNumber(AUTH, 3, 1)).rejects.toThrow(/CbteNro/);
    });
});

/** `FEParamGetTiposMonedas` — the whole catalogue, used to enumerate the entity's table. */
describe('CommonInvoiceService.getCurrencyTypes (FEParamGetTiposMonedas)', () => {
    const typesResponse = (resultGet: unknown): Record<string, unknown> => ({
        FEParamGetTiposMonedasResult: resultGet === undefined ? {} : {ResultGet: resultGet},
    });

    it('sends only the Auth block', async () => {
        const {service, lastCall} = serviceReturning(typesResponse({Moneda: {Id: 'PES', Desc: 'Pesos', FchDesde: '20090403'}}));

        await service.getCurrencyTypes(AUTH);

        expect(lastCall.operation).toBe('FEParamGetTiposMonedas');
        expect(lastCall.payload).toEqual({Auth: {Token: 'T', Sign: 'S', Cuit: 20111111112}});
    });

    it('maps a list, clearing the optional FchHasta when absent', async () => {
        const {service} = serviceReturning(
            typesResponse({
                Moneda: [
                    {Id: 'PES', Desc: 'Pesos Argentinos', FchDesde: '20090403', FchHasta: 'NULL'},
                    {Id: 'DOL', Desc: 'Dolar Estadounidense', FchDesde: '20090403', FchHasta: '20301231'},
                ],
            }),
        );

        expect(await service.getCurrencyTypes(AUTH)).toEqual([
            {id: 'PES', description: 'Pesos Argentinos', validFrom: '20090403', validTo: undefined},
            {id: 'DOL', description: 'Dolar Estadounidense', validFrom: '20090403', validTo: '20301231'},
        ]);
    });

    it('normalizes the single-element case fast-xml-parser reports as an object', async () => {
        const {service} = serviceReturning(typesResponse({Moneda: {Id: 'PES', Desc: 'Pesos', FchDesde: '20090403'}}));

        expect(await service.getCurrencyTypes(AUTH)).toHaveLength(1);
    });

    it('returns an empty list when the authority reports no catalogue at all', async () => {
        expect(await serviceReturning(typesResponse(undefined)).service.getCurrencyTypes(AUTH)).toEqual([]);
    });

    it('drops an entry with no usable code rather than surfacing an empty one', async () => {
        // An empty `Id` could only ever fail a later cotización call with a 12000.
        const {service} = serviceReturning(
            typesResponse({Moneda: [{Id: '', Desc: 'junk', FchDesde: '20090403'}, {Id: 'DOL', Desc: 'Dolar', FchDesde: '20090403'}]}),
        );

        expect((await service.getCurrencyTypes(AUTH)).map((m) => m.id)).toEqual(['DOL']);
    });
});
