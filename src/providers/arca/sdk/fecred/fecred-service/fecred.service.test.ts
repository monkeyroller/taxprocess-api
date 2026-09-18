import {describe, expect, it, jest} from '@jest/globals';
import {FeCredService} from './fecred.service.js';
import {SoapClient} from '../../core/soap-client/soap-client.js';
import type {ArcaAuth} from '../../core/types.js';

/**
 * WSFECRED's wire, as its WSDL declares it.
 *
 * These were guesses once and are not any more: every shape asserted below was read from `<endpoint>?wsdl`
 * on 2026-09-17. The WSDL is public and needs no certificate, so it stays the cheapest way to check any of
 * this — re-read it before reaching for a probe.
 *
 * The parsing cases are a different kind of assertion. Those pin a property that must hold whatever the
 * authority sends: an answer we cannot read is `undefined`, never a confident verdict. The schema happens
 * to agree — `obligado` and `montoDesde` are both `minOccurs="0"` — but the rule would stand regardless.
 */
describe('FeCredService.receptionObligation', () => {
    const AUTH: ArcaAuth = {token: 'tok', sign: 'sig', cuit: 20111111112};

    function serviceWith(response: Record<string, unknown>): {
        service: FeCredService;
        call: jest.SpiedFunction<SoapClient['call']>;
    } {
        const soap = new SoapClient();
        const call = jest.spyOn(soap, 'call').mockResolvedValue(response);
        return {service: new FeCredService(soap, 'homologacion'), call};
    }

    /**
     * The payload wrapper inside `…Response`.
     *
     * The WSDL settles the *element* names — request `…Request`, response `…Response` — and
     * `…Return` for the body inside the response is the JAX-WS convention the padrón services also
     * follow, which is why `parseReceptionObligation` looks there first. It is the one response-side name
     * not independently confirmed against the schema's output type, so the reader falls back to the
     * response root rather than insisting on it; the test below covers that path.
     */
    function wrapped(inner: Record<string, unknown>): Record<string, unknown> {
        return {consultarMontoObligadoRecepcionReturn: inner};
    }

    it('sends the operation, endpoint, element form and SOAPAction the WSDL declares', async () => {
        const {service, call} = serviceWith(wrapped({obligado: 'S', montoDesde: '5000000.00'}));

        await service.receptionObligation(AUTH, {receiverTaxId: 30711111119, issueDate: '2026-09-17'});

        expect(call).toHaveBeenCalledWith(
            'https://fwshomo.afip.gov.ar/wsfecred/FECredService',
            'http://ar.gob.afip.wsfecred/FECredService/',
            'consultarMontoObligadoRecepcion',
            expect.anything(),
            // All three read from the WSDL: the schema declares no `elementFormDefault` (so children are
            // unqualified), the operation binds to an input element with a `Request` suffix while the
            // response keeps the bare operation name, and the binding declares `soapAction` as the bare
            // operation rather than a URI.
            //
            // The SOAPAction is asserted rather than left to the default because the default is the
            // `.asmx` convention — `{namespace}/{operation}` — and getting it wrong fails the same
            // indistinguishable way a wrong element form does, with a fault that reads like an
            // authentication problem.
            {
                elementForm: 'unqualified',
                requestElement: 'consultarMontoObligadoRecepcionRequest',
                soapAction: 'consultarMontoObligadoRecepcion',
            },
        );
    });

    it('sends AuthRequestType and the two query fields the schema declares — and nothing else', async () => {
        const {service, call} = serviceWith(wrapped({obligado: 'N'}));

        await service.receptionObligation(AUTH, {receiverTaxId: 30711111119, issueDate: '2026-09-17'});

        expect(call.mock.calls[0]?.[3]).toEqual({
            authRequest: {token: 'tok', sign: 'sig', cuitRepresentada: 20111111112},
            cuitConsultada: 30711111119,
            fechaEmision: '2026-09-17',
        });
    });

    it.each([
        ['S', true],
        ['SI', true],
        ['true', true],
        ['1', true],
        ['N', false],
        ['NO', false],
        ['false', false],
        ['0', false],
    ])('reads obligado %s as %s, whichever spelling the service prefers', async (raw, expected) => {
        const {service} = serviceWith(wrapped({obligado: raw, montoDesde: '5000000.00'}));

        const info = await service.receptionObligation(AUTH, {receiverTaxId: 1, issueDate: '2026-09-17'});

        expect(info.obligated).toBe(expected);
    });

    it.each([
        ['an absent element', {}],
        ['a blank element', {obligado: '   '}],
        ['a spelling we do not know', {obligado: 'QUIZAS'}],
    ])('reads %s as undefined rather than false', async (_name, node) => {
        // The single most important property in this file. `false` would read as "this buyer is not
        // obligated" and issue an ordinary factura the authority later refuses, off the numerator, with
        // nothing naming the cause. `undefined` makes the caller fall back and label the answer honestly.
        const {service} = serviceWith(wrapped(node));

        const info = await service.receptionObligation(AUTH, {receiverTaxId: 1, issueDate: '2026-09-17'});

        expect(info.obligated).toBeUndefined();
    });

    it.each([
        ['an absent element', {}],
        ['a blank element', {montoDesde: ''}],
        ['an unparseable element', {montoDesde: 'n/d'}],
    ])('reads montoDesde from %s as undefined rather than 0', async (_name, node) => {
        // `0` is the dangerous filler here: every voucher clears a floor of zero, so every sale to this
        // buyer would become an FCE.
        const {service} = serviceWith(wrapped({obligado: 'S', ...node}));

        const info = await service.receptionObligation(AUTH, {receiverTaxId: 1, issueDate: '2026-09-17'});

        expect(info.thresholdAmount).toBeUndefined();
    });

    it('does not mangle the threshold into a float it was not', async () => {
        const {service} = serviceWith(wrapped({obligado: 'S', montoDesde: '1234567.89'}));

        const info = await service.receptionObligation(AUTH, {receiverTaxId: 1, issueDate: '2026-09-17'});

        expect(info.thresholdAmount).toBe(1234567.89);
    });

    it('carries the untouched node through, so an unexpected wire is diagnosable from the response', async () => {
        const node = {obligado: 'S', montoDesde: '5000000.00', algoInesperado: 'x'};
        const {service} = serviceWith(wrapped(node));

        const info = await service.receptionObligation(AUTH, {receiverTaxId: 1, issueDate: '2026-09-17'});

        expect(info.raw).toMatchObject({algoInesperado: 'x'});
    });

    it('raises on an in-payload arrayErrores rather than reading it as an empty answer', async () => {
        // The WSDL declares `arrayErrores` inside the return type, so a rejection arrives on a `200`.
        // Unread, it parses as an answer with both fields absent — indistinguishable from an unreadable
        // response, and quietly downgraded to the offline registry instead of being reported.
        const {service} = serviceWith(
            wrapped({
                arrayErrores: {codigoDescripcion: {codigo: '1001', descripcion: 'CUIT inexistente'}},
            }),
        );

        await expect(
            service.receptionObligation(AUTH, {receiverTaxId: 1, issueDate: '2026-09-17'}),
        ).rejects.toMatchObject({errors: [{code: '1001', message: 'CUIT inexistente'}]});
    });

    it('does not raise on an observación, which qualifies an answer rather than withholding one', async () => {
        // Refusing one would turn a verdict the authority did give into a fallback.
        const {service} = serviceWith(
            wrapped({
                obligado: 'S',
                montoDesde: '5000000.00',
                arrayObservacion: {codigoDescripcion: {codigo: '10', descripcion: 'algo'}},
            }),
        );

        const info = await service.receptionObligation(AUTH, {receiverTaxId: 1, issueDate: '2026-09-17'});

        expect(info.obligated).toBe(true);
    });

    it('falls back to the response root when the Return wrapper is not where we expect it', async () => {
        // `…Return` is the JAX-WS convention rather than a name read off the output type, so reading the
        // root when it is absent means a service that flattens its answer still parses, instead of every
        // field reading `undefined` and every request silently becoming an offline-registry answer.
        //
        // The limit of this, and the reason `…Return` is worth confirming: if the real wrapper is named
        // something else again, the root is read, `arrayErrores` is not found under it, and a rejection
        // parses as an answer with both fields absent. `toAuthorityAnswer` still refuses that rather than
        // reading it as a verdict, so the outcome is a labelled fallback and never a wrong `obligated` —
        // but it is a fallback where an error was owed.
        const {service} = serviceWith({obligado: 'S', montoDesde: '5000000.00'});

        const info = await service.receptionObligation(AUTH, {receiverTaxId: 1, issueDate: '2026-09-17'});

        expect(info.obligated).toBe(true);
        expect(info.thresholdAmount).toBe(5000000);
    });
});
