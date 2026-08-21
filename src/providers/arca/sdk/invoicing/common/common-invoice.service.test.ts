import {describe, expect, it} from '@jest/globals';
import {CommonInvoiceService} from './common-invoice.service.js';
import type {CommonInvoiceRequest} from './common-invoice.types.js';
import type {SoapClient} from '../../core/soap-client.js';
import type {ArcaAuth} from '../../core/types.js';

/**
 * Exercises WSFEv1 request/parse pairs without a network by driving {@link CommonInvoiceService} through a
 * fake `SoapClient`. The fake returns the operation's `{op}Response` element verbatim (as the real transport
 * does); the base unwraps `{op}Result`.
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
 * A minimal valid request. Every field is distinct where a mix-up would matter (`pointOfSaleNumber` 3 vs
 * `voucherType` 1 vs `voucherNumber` 42), so the payload assertions below catch a positional swap rather
 * than comparing a number against itself.
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
 * A `FECAESolicitar` response. `Resultado` appears in BOTH the batch header (`FeCabResp`) and the per-voucher
 * detail; `headerResult` sets the header copy, which the parse consults only as a fallback — see the
 * "result code" suite for the precedence.
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
 * The request half of the pairs — two properties a response-only test cannot see:
 *
 * - **Element order.** `FECAEDetRequest` is an XSD `sequence` and ARCA rejects out-of-order elements outright,
 *   but `toEqual` is order-blind, so the key order is asserted separately.
 * - **Positional argument mapping.** `queryVoucher(auth, pointOfSaleNumber, voucherType, voucherNumber)` funnels
 *   three adjacent `number`s into `{CbteTipo, CbteNro, PtoVta}`, so a swap type-checks silently. It would not
 *   merely return the wrong voucher: idempotent recovery would query a voucher that does not exist, read that as
 *   "nothing to recover", and re-surface the `10016` rejection for a sale ARCA has already filed
 *   (`docs/CONTRACT.md` § `/invoices/authorize`, idempotency).
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
        // Concept 1 omits the FchServ*/FchVtoPago block entirely — an empty element is not the same as absent.
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
 * ARCA can approve a voucher AND observe it: `Resultado: "A"` with a real CAE plus a populated
 * `Observaciones` block. The parse must not tie observations to a rejection — dropping them here would
 * silently discard the authority's only notice about an accepted voucher (see `docs/CONTRACT.md` §
 * `/invoices/authorize`). Field values are STRINGS because the SOAP client parses with `parseTagValue: false`.
 */
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
     * Core persists observations verbatim on every outcome, so a half-formed `Obs` must degrade to blank —
     * `String(undefined)` would write the literal word "undefined" onto an authorized sale as if the authority
     * had said it. An empty `<Msg/>` reads as `''` for the same reason (`trimValues: true`).
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
 * `Resultado` arrives twice — once per voucher in the detail, once for the batch in the header — and the parse
 * reads `detail?.Resultado ?? header.Resultado`. Precedence and fallback are separate branches, and neither may
 * ever resolve to `'A'` by accident: a wrong approval would hand core a `200` carrying no CAE, which the
 * controller's `authorizationCode !== ''` guard is only the second line of defence against.
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
     * Asserted on an APPROVED header on purpose: `normalizeResultCode` already answers `'R'` for anything it
     * cannot read, so a header rejection would pass with the fallback deleted. Only an approval makes the branch
     * observable — and it is the case that matters, since reading it as `'R'` would discard a CAE ARCA issued.
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
 * `FECompConsultar` is core's recovery path for observations it failed to persist off the authorize response,
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
