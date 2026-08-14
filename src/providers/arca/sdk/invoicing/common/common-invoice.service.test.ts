import {describe, expect, it} from '@jest/globals';
import {CommonInvoiceService} from './common-invoice.service.js';
import type {SoapClient} from '../../core/soap-client.js';
import type {ArcaAuth} from '../../core/types.js';

/**
 * Exercises the WSFEv1 `FEParamGetPtosVenta` request/parse pair without a network by driving
 * {@link CommonInvoiceService} through a fake `SoapClient`. The fake returns the operation's
 * `{op}Response` element verbatim (as the real transport does); the base unwraps `{op}Result`.
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
