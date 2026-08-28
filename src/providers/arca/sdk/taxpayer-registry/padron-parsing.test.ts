import {afterEach, describe, expect, it} from '@jest/globals';
import {SoapClient} from '../core/soap-client.js';
import {ArcaSoapError, ArcaTaxpayerNotFoundError, ArcaValidationError} from '../core/errors.js';
import {ConstanciaInscripcionService} from './constancia-inscripcion.service.js';
import {TaxpayerIdentityService} from './taxpayer-identity.service.js';
import type {ArcaAuth} from '../core/types.js';

/**
 * Padrón response parsing, driven by the worked examples in ARCA's own manuals — constancia de
 * inscripción v4.1 and padrón alcance 13 v1.4. The fixtures are XML, not hand-built objects, and go
 * through the REAL `SoapClient` parser: that is the only way the tests see what production sees
 * (`parseTagValue: false`, so every value is a string; namespace prefixes stripped; a repeated element
 * as an array but a single occurrence as a bare object).
 */

const AUTH: ArcaAuth = {token: 't', sign: 's', cuit: 30999999997};

/** Parses a full SOAP envelope with the production parser and hands back the response element. */
function responseOf(xml: string, operation: string): Record<string, unknown> {
    const parsed = new SoapClient().parseXmlString(xml) as Record<string, any>;
    return parsed.Envelope.Body[`${operation}Response`] as Record<string, unknown>;
}

/** A service whose transport returns `xml`'s parsed response element instead of calling ARCA. */
function serviceReturning<T>(
    Service: new (soap: SoapClient, environment: 'homologacion') => T,
    xml: string,
    operation: string,
): T {
    const soap = {call: async () => responseOf(xml, operation)} as unknown as SoapClient;
    return new Service(soap, 'homologacion');
}

/** A service whose transport throws — how A13 reports its documented §5.3 conditions. */
function serviceFailing<T>(Service: new (soap: SoapClient, environment: 'homologacion') => T, error: unknown): T {
    const soap = {
        call: async () => {
            throw error;
        },
    } as unknown as SoapClient;
    return new Service(soap, 'homologacion');
}

function envelope(operation: string, namespace: string, body: string): string {
    return (
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
        `<ns2:${operation}Response xmlns:ns2="${namespace}">${body}</ns2:${operation}Response>` +
        '</soap:Body></soap:Envelope>'
    );
}

const CONSTANCIA_NS = 'http://a5.soap.ws.server.puc.sr/';
const A13_NS = 'http://a13.soap.ws.server.puc.sr/';

function constanciaResponse(personaReturn: string): string {
    return envelope('getPersona_v2', CONSTANCIA_NS, `<personaReturn>${personaReturn}</personaReturn>`);
}

/** Manual v4.1 §3.2.3 — an individual, with the 2026 caracterizaciones block. */
const INDIVIDUAL = constanciaResponse(`
    <datosGenerales>
        <apellido>SKIOGEK OGIUPE</apellido>
        <caracterizacion>
            <descripcionCaracterizacion>IVA ANUAL AGROPECUARIO</descripcionCaracterizacion>
            <fechaSolicitud>20030316</fechaSolicitud>
            <idCaracterizacion>17</idCaracterizacion>
            <periodo>19010101</periodo>
        </caracterizacion>
        <caracterizacion>
            <descripcionCaracterizacion>GANANCIAS SIMPLIFICADA LEY 27.779</descripcionCaracterizacion>
            <fechaSolicitud>20260220</fechaSolicitud>
            <idCaracterizacion>639</idCaracterizacion>
            <periodo>202602</periodo>
        </caracterizacion>
        <domicilioFiscal>
            <codPostal>5000</codPostal>
            <descripcionProvincia>CORDOBA</descripcionProvincia>
            <direccion>SANTA FE 7516</direccion>
            <idProvincia>3</idProvincia>
            <localidad>BARRIO YAPEYU</localidad>
            <tipoDomicilio>FISCAL</tipoDomicilio>
        </domicilioFiscal>
        <esSucesion>NO</esSucesion>
        <estadoClave>ACTIVO</estadoClave>
        <idPersona>20164755100</idPersona>
        <mesCierre>12</mesCierre>
        <nombre>FELIX</nombre>
        <tipoClave>CUIT</tipoClave>
        <tipoPersona>FISICA</tipoPersona>
    </datosGenerales>
    <datosRegimenGeneral>
        <actividad>
            <descripcionActividad>CULTIVO DE ARROZ</descripcionActividad>
            <idActividad>11121</idActividad>
            <nomenclador>883</nomenclador>
            <orden>1</orden>
            <periodo>201409</periodo>
        </actividad>
        <impuesto>
            <descripcionImpuesto>DERECHO ESPECIFICO</descripcionImpuesto>
            <estadoImpuesto>AC</estadoImpuesto>
            <idImpuesto>2015</idImpuesto>
            <motivo>INSCRIPCION TRAMITADA EN AGENCIA</motivo>
            <periodo>201801</periodo>
        </impuesto>
    </datosRegimenGeneral>
    <metadata><fechaHora>2026-03-02T16:40:52.693-03:00</fechaHora><servidor>setiwsh2</servidor></metadata>
`);

/** A monotributista legal entity: razón social, a category, and no régimen-general block at all. */
const LEGAL_ENTITY = constanciaResponse(`
    <datosGenerales>
        <razonSocial>ESTUDIO CONTABLE SRL</razonSocial>
        <domicilioFiscal>
            <codPostal>1828</codPostal>
            <descripcionProvincia>BUENOS AIRES</descripcionProvincia>
            <direccion>ALEM 5982</direccion>
            <idProvincia>1</idProvincia>
            <localidad>BANFIELD</localidad>
            <tipoDomicilio>FISCAL</tipoDomicilio>
        </domicilioFiscal>
        <estadoClave>ACTIVO</estadoClave>
        <fechaContratoSocial>2011-05-03T00:00:00-03:00</fechaContratoSocial>
        <idPersona>30712345678</idPersona>
        <mesCierre>6</mesCierre>
        <tipoClave>CUIT</tipoClave>
        <tipoPersona>JURIDICA</tipoPersona>
    </datosGenerales>
    <datosMonotributo>
        <actividadMonotributista>
            <descripcionActividad>SERVICIOS DE CONTABILIDAD</descripcionActividad>
            <idActividad>692000</idActividad>
            <nomenclador>883</nomenclador>
            <orden>1</orden>
            <periodo>201105</periodo>
        </actividadMonotributista>
        <categoriaMonotributo>
            <descripcionCategoria>CATEGORIA D</descripcionCategoria>
            <idCategoria>4</idCategoria>
            <idImpuesto>20</idImpuesto>
            <periodo>202601</periodo>
        </categoriaMonotributo>
        <impuesto>
            <descripcionImpuesto>MONOTRIBUTO</descripcionImpuesto>
            <estadoImpuesto>AC</estadoImpuesto>
            <idImpuesto>20</idImpuesto>
            <periodo>201105</periodo>
        </impuesto>
    </datosMonotributo>
    <errorRegimenGeneral>
        <error>No cumple con las condiciones</error>
        <mensaje>No cumple con las condiciones para enviar datos del regimen general</mensaje>
    </errorRegimenGeneral>
`);

/** Manual v4.1 §3.3.3 — how a CUIT nobody is registered under comes back (as a 200). */
const NOT_FOUND = constanciaResponse(`
    <errorConstancia>
        <error>No existe persona con ese Id</error>
        <idPersona>12345678901</idPersona>
    </errorConstancia>
`);

/**
 * Live homologación, CUIT 24850833059: the constancia declines an INACTIVE clave — a `200` whose only
 * content is the complaint. A13 holds this person in full (LEBLANC RACHEL, `registrationStatus: INACTIVE`),
 * which is why this has to raise rather than parse into an empty taxpayer.
 */
const INACTIVE_CLAVE = constanciaResponse(`
    <errorConstancia>
        <error>La clave se encuentra inactiva</error>
        <idPersona>24850833059</idPersona>
    </errorConstancia>
`);

/**
 * Live homologación, CUIT 20111111112: a CANCELLED clave, reported alongside two genuine data-quality
 * complaints. The verdict is not the only entry and not the one a naive read would land on, and its
 * siblings both name the CUIT without saying anything about its existence.
 */
const CANCELLED_CLAVE = constanciaResponse(`
    <errorConstancia>
        <error>La CUIT fue cancelada de acuerdo a: CLAVES INVALIDAS.</error>
        <error>La CUIT no registra domicilio fiscal declarado, o el mismo se encuentra incompleto o incorrecto.</error>
        <error>La CUIT registra una o más actividades económicas que no pertenecen al nomenclador de actividades vigente F. 883 RG AFIP3587/13</error>
        <idPersona>20111111112</idPersona>
    </errorConstancia>
`);

/**
 * The same two complaints WITHOUT the cancellation verdict. Both name the CUIT, so they are exactly what an
 * over-eager verdict pattern would misread as "no such taxpayer" — a real registration turned into a 404.
 */
const CUIT_DATA_ERRORS = constanciaResponse(`
    <datosGenerales>
        <idPersona>20111111112</idPersona>
        <razonSocial>ALGUIEN SA</razonSocial>
        <estadoClave>ACTIVO</estadoClave>
    </datosGenerales>
    <errorConstancia>
        <error>La CUIT no registra domicilio fiscal declarado, o el mismo se encuentra incompleto o incorrecto.</error>
        <error>La CUIT registra una o más actividades económicas que no pertenecen al nomenclador de actividades vigente F. 883 RG AFIP3587/13</error>
        <idPersona>20111111112</idPersona>
    </errorConstancia>
`);

/**
 * The cancellation verdict beside a REGISTRATION the service did report. `getPersona_v2` answers for a clave
 * the v1 operation refuses, so an inactive/cancelled clave can come back with its `datosGenerales` intact —
 * and then the complaint is not a no-answer at all: `estadoClave` carries the state, and A13 has strictly
 * less to say about this taxpayer than what is already in hand.
 */
const CANCELLED_CLAVE_WITH_REGISTRATION = constanciaResponse(`
    <datosGenerales>
        <idPersona>20111111112</idPersona>
        <razonSocial>ALGUIEN SA</razonSocial>
        <estadoClave>INACTIVO</estadoClave>
    </datosGenerales>
    <errorConstancia>
        <error>La CUIT fue cancelada de acuerdo a: CLAVES INVALIDAS.</error>
        <idPersona>20111111112</idPersona>
    </errorConstancia>
`);

/** An existing taxpayer whose constancia carries data-quality complaints — NOT a not-found. */
const WITH_DATA_ERRORS = constanciaResponse(`
    <datosGenerales>
        <apellido>PEREZ</apellido>
        <estadoClave>INACTIVO</estadoClave>
        <idPersona>20111111112</idPersona>
        <nombre>JUAN</nombre>
        <tipoClave>CUIT</tipoClave>
        <tipoPersona>FISICA</tipoPersona>
    </datosGenerales>
    <errorConstancia>
        <error>Domicilio Incompleto</error>
        <error>Codigo postal erroneo</error>
        <idPersona>20111111112</idPersona>
    </errorConstancia>
`);

describe('ConstanciaInscripcionService.getTaxpayer', () => {
    it('maps an individual: identity, fiscal address, activities and taxes', async () => {
        const service = serviceReturning(ConstanciaInscripcionService, INDIVIDUAL, 'getPersona_v2');

        const data = await service.getTaxpayer(AUTH, 20164755100);

        expect(data).toMatchObject({
            detail: 'REGISTRATION',
            taxId: '20164755100',
            taxIdType: 'CUIT',
            personType: 'INDIVIDUAL',
            firstName: 'FELIX',
            lastName: 'SKIOGEK OGIUPE',
            name: 'SKIOGEK OGIUPE FELIX',
            registrationStatus: 'ACTIVE',
            fiscalYearEndMonth: 12,
        });
        expect(data.fiscalAddress).toEqual({
            street: 'SANTA FE 7516',
            city: 'BARRIO YAPEYU',
            postalCode: '5000',
            region: 'CORDOBA',
            regionCode: '3',
            kind: 'FISCAL',
            status: undefined,
        });
        // The fiscal address is the only one this service reports, so it is also the whole list.
        expect(data.addresses).toEqual([data.fiscalAddress]);
        expect(data.activities).toEqual([
            {code: '11121', description: 'CULTIVO DE ARROZ', period: '2014-09', primary: true},
        ]);
        expect(data.taxes).toEqual([
            {
                code: '2015',
                description: 'DERECHO ESPECIFICO',
                period: '2018-01',
                status: 'AC',
                reason: 'INSCRIPCION TRAMITADA EN AGENCIA',
            },
        ]);
    });

    it('passes ARCA-only data through providerMetadata, including the 2026 caracterizaciones', async () => {
        const service = serviceReturning(ConstanciaInscripcionService, INDIVIDUAL, 'getPersona_v2');

        const {providerMetadata} = await service.getTaxpayer(AUTH, 20164755100);

        expect(providerMetadata).toMatchObject({service: 'ws_sr_constancia_inscripcion', esSucesion: false});
        expect(providerMetadata.caracterizaciones).toEqual([
            {code: '17', description: 'IVA ANUAL AGROPECUARIO', requestedDate: '2003-03-16', period: '1901-01'},
            {
                code: '639',
                description: 'GANANCIAS SIMPLIFICADA LEY 27.779',
                requestedDate: '2026-02-20',
                period: '2026-02',
            },
        ]);
    });

    it('maps a monotributista entity: razón social, category, and the monotributo blocks', async () => {
        const service = serviceReturning(ConstanciaInscripcionService, LEGAL_ENTITY, 'getPersona_v2');

        const data = await service.getTaxpayer(AUTH, 30712345678);

        expect(data).toMatchObject({
            personType: 'LEGAL_ENTITY',
            name: 'ESTUDIO CONTABLE SRL',
            simplifiedRegimeCategory: 'CATEGORIA D',
            incorporationDate: '2011-05-03',
            fiscalYearEndMonth: 6,
        });
        expect(data.firstName).toBeUndefined();
        expect(data.activities).toEqual([
            {code: '692000', description: 'SERVICIOS DE CONTABILIDAD', period: '2011-05', primary: true},
        ]);
        expect(data.taxes).toEqual([
            {code: '20', description: 'MONOTRIBUTO', period: '2011-05', status: 'AC', reason: undefined},
        ]);
        expect(data.providerMetadata.regimenGeneralErrors).toEqual(['No cumple con las condiciones']);
    });

    it('raises a not-found for the errorConstancia "no existe persona" wording', async () => {
        const service = serviceReturning(ConstanciaInscripcionService, NOT_FOUND, 'getPersona_v2');

        await expect(service.getTaxpayer(AUTH, 12345678901)).rejects.toBeInstanceOf(ArcaTaxpayerNotFoundError);
    });

    /**
     * An inactive or cancelled clave leaves every field of the response empty. Parsing it into a taxpayer
     * yields a `200` with no name, no personType and no registrationStatus — an answer about the taxpayer
     * that ARCA never gave. It must raise instead, so `claveFor` falls through to A13, which can answer.
     */
    it('raises a not-found for an inactive clave, so the lookup falls through to A13', async () => {
        const service = serviceReturning(ConstanciaInscripcionService, INACTIVE_CLAVE, 'getPersona_v2');

        const error = await service.getTaxpayer(AUTH, 24850833059).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(ArcaTaxpayerNotFoundError);
        // ARCA's own wording rides along: it is what the provider rethrows into the 404 when A13 misses too.
        expect((error as Error).message).toContain('La clave se encuentra inactiva');
    });

    it('raises a not-found for a cancelled clave, past the data-quality complaints beside it', async () => {
        const service = serviceReturning(ConstanciaInscripcionService, CANCELLED_CLAVE, 'getPersona_v2');

        const error = await service.getTaxpayer(AUTH, 20111111112).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(ArcaTaxpayerNotFoundError);
        expect((error as Error).message).toContain('La CUIT fue cancelada');
    });

    it('keeps a registration the service did report, verdict beside it or not', async () => {
        const service = serviceReturning(
            ConstanciaInscripcionService,
            CANCELLED_CLAVE_WITH_REGISTRATION,
            'getPersona_v2',
        );

        const data = await service.getTaxpayer(AUTH, 20111111112);

        expect(data.name).toBe('ALGUIEN SA');
        expect(data.registrationStatus).toBe('INACTIVE');
        // The verdict is not swallowed — it rides along where every other complaint does.
        expect(data.providerMetadata.constanciaErrors).toEqual([
            'La CUIT fue cancelada de acuerdo a: CLAVES INVALIDAS.',
        ]);
    });

    it('does not read a complaint that merely names the CUIT as a verdict about its existence', async () => {
        const service = serviceReturning(ConstanciaInscripcionService, CUIT_DATA_ERRORS, 'getPersona_v2');

        const data = await service.getTaxpayer(AUTH, 20111111112);

        expect(data.name).toBe('ALGUIEN SA');
        expect(data.registrationStatus).toBe('ACTIVE');
        expect(data.providerMetadata.constanciaErrors).toHaveLength(2);
    });

    it('treats other errorConstancia entries as data-quality notes on a real taxpayer, not a not-found', async () => {
        const service = serviceReturning(ConstanciaInscripcionService, WITH_DATA_ERRORS, 'getPersona_v2');

        const data = await service.getTaxpayer(AUTH, 20111111112);

        expect(data.taxId).toBe('20111111112');
        // Every non-ACTIVO state reads as inactive; only a missing estadoClave goes unreported.
        expect(data.registrationStatus).toBe('INACTIVE');
        expect(data.providerMetadata.constanciaErrors).toEqual(['Domicilio Incompleto', 'Codigo postal erroneo']);
        // A taxpayer with no fiscal address still gets the array, empty — never a missing key.
        expect(data.addresses).toEqual([]);
        expect(data.fiscalAddress).toBeUndefined();
    });

    it('reports the CURRENT monotributo category, not whichever period came first', async () => {
        // Recategorización is twice-yearly, so a taxpayer accumulates entries. ARCA documents no ordering,
        // and here the newest is deliberately not first. The `estadoClave` in this fixture and the two below
        // is incidental to what they test — it is what makes each an answer at all, rather than a régimen
        // block hanging off a `datosGenerales` that names nobody.
        const service = serviceReturning(
            ConstanciaInscripcionService,
            constanciaResponse(
                '<datosGenerales><idPersona>30712345678</idPersona><estadoClave>ACTIVO</estadoClave></datosGenerales>' +
                    '<datosMonotributo>' +
                    '<categoriaMonotributo><descripcionCategoria>CATEGORIA B</descripcionCategoria><periodo>202401</periodo></categoriaMonotributo>' +
                    '<categoriaMonotributo><descripcionCategoria>CATEGORIA D</descripcionCategoria><periodo>202607</periodo></categoriaMonotributo>' +
                    '<categoriaMonotributo><descripcionCategoria>CATEGORIA C</descripcionCategoria><periodo>202501</periodo></categoriaMonotributo>' +
                    '</datosMonotributo>',
            ),
            'getPersona_v2',
        );

        await expect(service.getTaxpayer(AUTH, 30712345678)).resolves.toMatchObject({
            simplifiedRegimeCategory: 'CATEGORIA D',
        });
    });

    it('compares category periods as year-months, so a full AAAAMMDD cannot outrank a later AAAAMM', async () => {
        const service = serviceReturning(
            ConstanciaInscripcionService,
            constanciaResponse(
                '<datosGenerales><idPersona>30712345678</idPersona><estadoClave>ACTIVO</estadoClave></datosGenerales>' +
                    '<datosMonotributo>' +
                    '<categoriaMonotributo><descripcionCategoria>CATEGORIA A</descripcionCategoria><periodo>20240115</periodo></categoriaMonotributo>' +
                    '<categoriaMonotributo><descripcionCategoria>CATEGORIA D</descripcionCategoria><periodo>202607</periodo></categoriaMonotributo>' +
                    '</datosMonotributo>',
            ),
            'getPersona_v2',
        );

        // Raw string compare would rank "20240115" above "202607"; numeric compare would too.
        await expect(service.getTaxpayer(AUTH, 30712345678)).resolves.toMatchObject({
            simplifiedRegimeCategory: 'CATEGORIA D',
        });
    });

    it('leaves `primary` unreported for an activity ARCA sends no orden for', async () => {
        const service = serviceReturning(
            ConstanciaInscripcionService,
            constanciaResponse(
                '<datosGenerales><idPersona>30712345678</idPersona><estadoClave>ACTIVO</estadoClave></datosGenerales>' +
                    '<datosRegimenGeneral><actividad>' +
                    '<idActividad>692000</idActividad><descripcionActividad>SERVICIOS</descripcionActividad>' +
                    '</actividad></datosRegimenGeneral>',
            ),
            'getPersona_v2',
        );

        const data = await service.getTaxpayer(AUTH, 30712345678);

        // NOT `false` — that would claim ARCA said this is not the principal activity, which it did not.
        expect(data.activities).toEqual([
            {code: '692000', description: 'SERVICIOS', period: undefined, primary: undefined},
        ]);
    });

    it('keeps a data-quality complaint that merely mentions something missing', async () => {
        // The 404 test is about the PERSON; this one is about an address. A bare `no existe` check would
        // throw away a complete registration because one of its blocks was flagged. The registration has to
        // actually be here for that to be what is under test — an `idPersona` echo and a complaint is the
        // substantively empty answer of its own test below, not a registration with a flagged block.
        const service = serviceReturning(
            ConstanciaInscripcionService,
            constanciaResponse(
                '<datosGenerales><idPersona>20111111112</idPersona><razonSocial>ALGUIEN SA</razonSocial>' +
                    '<estadoClave>ACTIVO</estadoClave></datosGenerales>' +
                    '<errorConstancia><error>No existe domicilio fiscal declarado</error></errorConstancia>',
            ),
            'getPersona_v2',
        );

        const data = await service.getTaxpayer(AUTH, 20111111112);

        expect(data.taxId).toBe('20111111112');
        expect(data.name).toBe('ALGUIEN SA');
        expect(data.providerMetadata.constanciaErrors).toEqual(['No existe domicilio fiscal declarado']);
    });

    it('classifies its SOAP faults exactly as A13 does — same webapp, same vocabulary', async () => {
        // Constancia reports a not-found in its payload, but nothing stops it faulting like its sibling. Both
        // services must answer the same authority verdict with the same HTTP status.
        const missing = serviceFailing(
            ConstanciaInscripcionService,
            new ArcaSoapError('La Clave (CUIT/CUIL) consultada es inexistente'),
        );
        await expect(missing.getTaxpayer(AUTH, 20111111112)).rejects.toBeInstanceOf(ArcaTaxpayerNotFoundError);

        const malformed = serviceFailing(ConstanciaInscripcionService, new ArcaSoapError('El Id ingresado no es valido'));
        await expect(malformed.getTaxpayer(AUTH, 1)).rejects.toBeInstanceOf(ArcaValidationError);

        const credential = new ArcaSoapError('El token no es válido');
        const stale = serviceFailing(ConstanciaInscripcionService, credential);
        await expect(stale.getTaxpayer(AUTH, 20111111112)).rejects.toBe(credential);
    });

    it('falls back to the requested clave when the response omits idPersona', async () => {
        // `estadoClave` is what makes this an ANSWER rather than the substantively empty response below:
        // `tipoClave` alone is derivable from the clave that was asked with and says nothing on its own.
        const service = serviceReturning(
            ConstanciaInscripcionService,
            constanciaResponse(
                '<datosGenerales><tipoClave>CUIT</tipoClave><estadoClave>ACTIVO</estadoClave></datosGenerales>',
            ),
            'getPersona_v2',
        );

        await expect(service.getTaxpayer(AUTH, 20111111112)).resolves.toMatchObject({taxId: '20111111112'});
    });

    /**
     * The bug behind the 2026-08-27 report: an answer that reports NOTHING about the taxpayer used to come
     * back as a success, and a draft holding only the number that was asked with reached the customer form
     * and was auto-applied. It has to raise so `claveFor` asks A13, which for these very claves
     * (`27333333339`, `23333333333` in homologación) answers with the full identity.
     *
     * Every spelling of "nothing", because each defeats a different obvious implementation: an empty
     * `datosGenerales` with no recognizable complaint beside it defeats gating on the wording, a
     * `datosGenerales` present but carrying only an `idPersona` echo defeats counting its keys, and a
     * cancelled clave's leftover `impuesto` defeats asking whether the MAPPED record holds anything at all
     * — a tax with nobody attached to it is not a taxpayer, and the customer form has no use for it.
     */
    it.each([
        [
            'an unrecognizable complaint beside an empty datosGenerales',
            '<errorConstancia><error>La consulta no pudo completarse</error></errorConstancia>',
        ],
        ['no complaint at all', ''],
        [
            'a datosGenerales carrying only the idPersona echo',
            '<datosGenerales><idPersona>27333333339</idPersona></datosGenerales>',
        ],
        [
            'a datosGenerales carrying only echoes',
            '<datosGenerales><idPersona>27333333339</idPersona><tipoClave>CUIT</tipoClave></datosGenerales>',
        ],
        [
            'an empty domicilioFiscal container and nothing else',
            '<datosGenerales><idPersona>27333333339</idPersona><domicilioFiscal></domicilioFiscal></datosGenerales>',
        ],
        [
            'a cancelled clave whose only leftover is a registered tax',
            '<errorConstancia><error>La CUIT fue cancelada de acuerdo a: CLAVES INVALIDAS.</error></errorConstancia>' +
                '<datosRegimenGeneral><impuesto><idImpuesto>30</idImpuesto><estadoImpuesto>BA</estadoImpuesto></impuesto>' +
                '</datosRegimenGeneral>',
        ],
        [
            'a monotributo category with no one attached to it',
            '<datosMonotributo><categoriaMonotributo><idCategoria>B</idCategoria><periodo>202601</periodo>' +
                '</categoriaMonotributo></datosMonotributo>',
        ],
    ])('raises a not-found for an answer that reports nothing: %s', async (_case, body) => {
        const service = serviceReturning(ConstanciaInscripcionService, constanciaResponse(body), 'getPersona_v2');

        await expect(service.getTaxpayer(AUTH, 27333333339)).rejects.toBeInstanceOf(ArcaTaxpayerNotFoundError);
    });

    /**
     * The regression guard the widened miss needs: ONE authority-reported field is a real answer. Each of
     * these responses is as close to empty as a response can be while still saying something, and none of
     * them may become a 404 — the constancia is the richer padrón, and falling through would trade its
     * answer for A13's thinner one.
     */
    it.each([
        ['a registration status', '<estadoClave>ACTIVO</estadoClave>', {registrationStatus: 'ACTIVE'}],
        ['a razón social', '<razonSocial>ALGUIEN SA</razonSocial>', {name: 'ALGUIEN SA'}],
        ['a person type', '<tipoPersona>FISICA</tipoPersona>', {personType: 'INDIVIDUAL'}],
        [
            'a fiscal address',
            '<domicilioFiscal><direccion>CUENCA 2000</direccion></domicilioFiscal>',
            {fiscalAddress: {street: 'CUENCA 2000'}},
        ],
    ])('keeps an answer whose only content is %s', async (_case, general, expected) => {
        const service = serviceReturning(
            ConstanciaInscripcionService,
            constanciaResponse(
                `<datosGenerales><idPersona>20272901849</idPersona>${general}</datosGenerales>` +
                    '<errorConstancia><error>La CUIT fue cancelada de acuerdo a: CLAVES INVALIDAS.</error></errorConstancia>',
            ),
            'getPersona_v2',
        );

        // The cancellation verdict is deliberately beside it: with something reported there is nothing to
        // fall through to A13 FOR, so the complaint stays a note rather than becoming the answer.
        await expect(service.getTaxpayer(AUTH, 20272901849)).resolves.toMatchObject(expected);
    });

    /**
     * The recognizable-wording case is covered above (an inactive clave keeps ARCA's own sentence, which is
     * what `details.upstreamMessage` carries to the operator). This is its other half: the wording no longer
     * DECIDES, so an unreadable complaint is still a miss — and it is still quoted, because the record it
     * arrived on is discarded with the raise and this SDK logs nothing. "Not a verdict we recognize" is
     * exactly when the operator most needs to see what ARCA actually said.
     */
    it('still raises when the wording is one no pattern recognizes, and quotes it anyway', async () => {
        const service = serviceReturning(
            ConstanciaInscripcionService,
            constanciaResponse('<errorConstancia><error>Servicio no disponible momentaneamente</error></errorConstancia>'),
            'getPersona_v2',
        );

        const error = await service.getTaxpayer(AUTH, 27333333339).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(ArcaTaxpayerNotFoundError);
        expect((error as Error).message).toBe('Servicio no disponible momentaneamente');
    });

    /**
     * The one complaint never quoted. A credential fault copied into the not-found would tell the caller a
     * clave is unknown when our ticket was the problem — and the provider's `padronCall` classifies by
     * message text, so it would evict a delegate ticket ARCA will not re-issue for ~12h on the strength of a
     * sentence we merely passed along.
     */
    it('never quotes a complaint about our own credentials', async () => {
        const service = serviceReturning(
            ConstanciaInscripcionService,
            constanciaResponse('<errorConstancia><error>El token no es valido</error></errorConstancia>'),
            'getPersona_v2',
        );

        const error = await service.getTaxpayer(AUTH, 27333333339).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(ArcaTaxpayerNotFoundError);
        expect((error as Error).message).toBe('No taxpayer registered under id 27333333339');
    });
});

/** Manual v1.4 §3.2.3 — an individual with two declared addresses. */
const A13_PERSON = envelope(
    'getPersonaV2',
    A13_NS,
    `<personaReturn>
        <metadata><fechaHora>2026-08-14T11:52:48.525-03:00</fechaHora><servidor>host</servidor></metadata>
        <persona>
            <apellido>INTENTAR</apellido>
            <descripcionActividadPrincipal>SERVICIOS DE ALOJAMIENTO</descripcionActividadPrincipal>
            <domicilio>
                <calle>AV LOS INCAS</calle>
                <codigoPostal>5881</codigoPostal>
                <descripcionProvincia>SAN LUIS</descripcionProvincia>
                <direccion>AV LOS INCAS 4137</direccion>
                <estadoDomicilio>CONFIRMADO</estadoDomicilio>
                <idProvincia>11</idProvincia>
                <localidad>MERLO</localidad>
                <numero>4137</numero>
                <tipoDomicilio>FISCAL</tipoDomicilio>
            </domicilio>
            <domicilio>
                <calle>AV LOS INCAS</calle>
                <codigoPostal>5881</codigoPostal>
                <descripcionProvincia>SAN LUIS</descripcionProvincia>
                <direccion>AV LOS INCAS 8732</direccion>
                <estadoDomicilio>NO DENUNCIADO</estadoDomicilio>
                <idProvincia>11</idProvincia>
                <localidad>MERLO</localidad>
                <numero>8732</numero>
                <tipoDomicilio>LEGAL/REAL</tipoDomicilio>
            </domicilio>
            <estadoClave>ACTIVO</estadoClave>
            <fechaNacimiento>1936-02-11T12:00:00-03:00</fechaNacimiento>
            <idActividadPrincipal>551023</idActividadPrincipal>
            <idPersona>27015942210</idPersona>
            <mesCierre>12</mesCierre>
            <nombre>JAZMIN</nombre>
            <numeroDocumento>1594221</numeroDocumento>
            <periodoActividadPrincipal>201311</periodoActividadPrincipal>
            <tipoClave>CUIT</tipoClave>
            <tipoDocumento>LC</tipoDocumento>
            <tipoPersona>FISICA</tipoPersona>
        </persona>
    </personaReturn>`,
);

/** An entity, exercising `formaJuridica` and `fechaInscripcion` (A13-only fields). */
const A13_ENTITY = envelope(
    'getPersonaV2',
    A13_NS,
    `<personaReturn>
        <persona>
            <estadoClave>ACTIVO</estadoClave>
            <fechaInscripcion>2014-09-30T00:00:00-03:00</fechaInscripcion>
            <formaJuridica>FIDEICOMISO TESTAMENTARIO</formaJuridica>
            <idPersona>30712345678</idPersona>
            <razonSocial>FIDEICOMISO LOS ALAMOS</razonSocial>
            <tipoClave>CUIT</tipoClave>
            <tipoPersona>JURIDICA</tipoPersona>
        </persona>
    </personaReturn>`,
);

describe('TaxpayerIdentityService', () => {
    it('maps the person: document, birth date, every declared address, principal activity', async () => {
        const service = serviceReturning(TaxpayerIdentityService, A13_PERSON, 'getPersonaV2');

        const data = await service.getTaxpayer(AUTH, 27015942210);

        expect(data).toMatchObject({
            detail: 'IDENTITY',
            taxId: '27015942210',
            taxIdType: 'CUIT',
            personType: 'INDIVIDUAL',
            name: 'INTENTAR JAZMIN',
            registrationStatus: 'ACTIVE',
            documentType: 'LC',
            documentNumber: '1594221',
            birthDate: '1936-02-11',
            fiscalYearEndMonth: 12,
        });
        expect(data.addresses).toHaveLength(2);
        expect(data.fiscalAddress).toMatchObject({street: 'AV LOS INCAS 4137', kind: 'FISCAL'});
        expect(data.addresses[1]).toMatchObject({kind: 'LEGAL/REAL', status: 'NO DENUNCIADO'});
        // A13 surfaces one principal activity as three flat fields; it is normalized to the same list shape.
        expect(data.activities).toEqual([
            {code: '551023', description: 'SERVICIOS DE ALOJAMIENTO', period: '2013-11', primary: true},
        ]);
    });

    it('never reports taxes — this registry cannot see them, which is not the same as none', async () => {
        const service = serviceReturning(TaxpayerIdentityService, A13_PERSON, 'getPersonaV2');

        const data = await service.getTaxpayer(AUTH, 27015942210);

        expect(data.taxes).toBeUndefined();
        expect(data.simplifiedRegimeCategory).toBeUndefined();
    });

    it('maps an entity: razón social, legal form and registration date', async () => {
        const service = serviceReturning(TaxpayerIdentityService, A13_ENTITY, 'getPersonaV2');

        await expect(service.getTaxpayer(AUTH, 30712345678)).resolves.toMatchObject({
            personType: 'LEGAL_ENTITY',
            name: 'FIDEICOMISO LOS ALAMOS',
            legalForm: 'FIDEICOMISO TESTAMENTARIO',
            registrationDate: '2014-09-30',
        });
    });

    /**
     * A13's silent "no such clave", in every spelling — and the reason a missing `persona` block is not the
     * only one worth testing: this is the padrón the constancia falls back ONTO, and the padrón the document
     * route reads alone, so an echo-only record returned from here is the same empty draft that reached the
     * customer form. Presence of the container is not an answer; identifying somebody is.
     */
    it.each([
        ['no persona block at all', '<metadata/>'],
        ['an empty persona container', '<persona></persona>'],
        ['a persona carrying only the idPersona echo', '<persona><idPersona>27015942210</idPersona></persona>'],
        [
            'a persona carrying only echoes',
            '<persona><idPersona>27015942210</idPersona><tipoClave>CUIT</tipoClave></persona>',
        ],
    ])('treats a response that identifies nobody as a not-found: %s', async (_case, personaReturn) => {
        const service = serviceReturning(
            TaxpayerIdentityService,
            envelope('getPersonaV2', A13_NS, `<personaReturn>${personaReturn}</personaReturn>`),
            'getPersonaV2',
        );

        await expect(service.getTaxpayer(AUTH, 27015942210)).rejects.toBeInstanceOf(ArcaTaxpayerNotFoundError);
    });

    /** The guard on that: A13's own thinnest real answer — an inactive clave with a name — must survive. */
    it('keeps an answer that identifies somebody, however thin', async () => {
        const service = serviceReturning(
            TaxpayerIdentityService,
            envelope(
                'getPersonaV2',
                A13_NS,
                '<personaReturn><persona><idPersona>27015942210</idPersona><apellido>INTENTAR</apellido>' +
                    '<estadoClave>INACTIVO</estadoClave></persona></personaReturn>',
            ),
            'getPersonaV2',
        );

        await expect(service.getTaxpayer(AUTH, 27015942210)).resolves.toMatchObject({
            name: 'INTENTAR',
            registrationStatus: 'INACTIVE',
        });
    });

    it('translates the documented "clave inexistente" fault into a not-found', async () => {
        const service = serviceFailing(
            TaxpayerIdentityService,
            new ArcaSoapError('La Clave (CUIT/CUIL) consultada es inexistente'),
        );

        await expect(service.getTaxpayer(AUTH, 27015942210)).rejects.toBeInstanceOf(ArcaTaxpayerNotFoundError);
    });

    it('translates the documented "Id no es valido" fault into a validation error, not a not-found', async () => {
        const service = serviceFailing(
            TaxpayerIdentityService,
            new ArcaSoapError('El Id de la persona no es valido'),
        );

        await expect(service.getTaxpayer(AUTH, 1)).rejects.toBeInstanceOf(ArcaValidationError);
    });

    it('leaves a token/representación fault alone for the provider to handle', async () => {
        const thrown = new ArcaSoapError('No autorizado, par token/sign invalido.');
        const service = serviceFailing(TaxpayerIdentityService, thrown);

        await expect(service.getTaxpayer(AUTH, 27015942210)).rejects.toBe(thrown);
    });

    it.each([
        ['El token no es válido'],
        ['El certificado no es valido'],
        ['No existe un ticket de acceso vigente para el servicio'],
    ])('never reads a credential fault (%s) as a bad identifier', async (message) => {
        // Each of these carries the SAME verdict wording A13 uses for a bad clave, so classifying on the
        // verdict alone would turn a rejected ticket into `400 INVALID_ID` (telling core to correct a clave
        // that was never wrong) or into a `404` — burying a retryable authority failure behind a caller error.
        const thrown = new ArcaSoapError(message);
        const service = serviceFailing(TaxpayerIdentityService, thrown);

        await expect(service.getTaxpayer(AUTH, 27015942210)).rejects.toBe(thrown);
    });

    it('leaves a fault about something other than the identifier untouched', async () => {
        // "not found" about anything but the person we asked for is not this taxpayer's 404; an unreadable
        // fault stays the authority error it arrived as.
        const thrown = new ArcaSoapError('El servicio no existe en este entorno');
        const service = serviceFailing(TaxpayerIdentityService, thrown);

        await expect(service.getTaxpayer(AUTH, 27015942210)).rejects.toBe(thrown);
    });

    it('still classifies the documented id faults once no credential wording is present', async () => {
        const missing = serviceFailing(
            TaxpayerIdentityService,
            new ArcaSoapError('La Clave (CUIT/CUIL) consultada es inexistente'),
        );
        await expect(missing.getIdPersonaList(AUTH, 11709676)).rejects.toBeInstanceOf(ArcaTaxpayerNotFoundError);

        const malformed = serviceFailing(TaxpayerIdentityService, new ArcaSoapError('El Id ingresado no es valido'));
        await expect(malformed.getIdPersonaList(AUTH, 1)).rejects.toBeInstanceOf(ArcaValidationError);
    });

    it('reads the claves a document resolves to, single or many', async () => {
        const many = serviceReturning(
            TaxpayerIdentityService,
            envelope(
                'getIdPersonaListByDocumento',
                A13_NS,
                `<idPersonaListReturn>
                    <idPersona>23117096769</idPersona>
                    <idPersona>27117096764</idPersona>
                    <metadata><servidor>host</servidor></metadata>
                </idPersonaListReturn>`,
            ),
            'getIdPersonaListByDocumento',
        );
        await expect(many.getIdPersonaList(AUTH, 11709676)).resolves.toEqual(['23117096769', '27117096764']);

        // A single match parses as a bare element, not an array — it must still read as a list.
        const one = serviceReturning(
            TaxpayerIdentityService,
            envelope(
                'getIdPersonaListByDocumento',
                A13_NS,
                '<idPersonaListReturn><idPersona>23117096769</idPersona></idPersonaListReturn>',
            ),
            'getIdPersonaListByDocumento',
        );
        await expect(one.getIdPersonaList(AUTH, 11709676)).resolves.toEqual(['23117096769']);
    });

    it('reads an unmatched document as an empty list, leaving the 404 decision to the caller', async () => {
        const service = serviceReturning(
            TaxpayerIdentityService,
            envelope('getIdPersonaListByDocumento', A13_NS, '<idPersonaListReturn><metadata/></idPersonaListReturn>'),
            'getIdPersonaListByDocumento',
        );

        await expect(service.getIdPersonaList(AUTH, 11709676)).resolves.toEqual([]);
    });
});

/**
 * The request side, driven through a REAL `SoapClient` so the assertions are about bytes on the wire.
 *
 * ARCA's `sr-padron` webapp is JAX-WS with an unqualified schema: it wants `<token>`, not
 * `{http://a5.soap.ws.server.puc.sr/}token`. The qualified envelope is rejected at unmarshalling —
 * before the ticket is looked at — so the fault reads as an auth failure ("ARCA rejected the delegate
 * ticket") and sends the reader after the certificate instead of the body. That misdiagnosis is what
 * these tests exist to prevent recurring.
 */
describe('padrón request envelope', () => {
    const originalFetch = (global as any).fetch;
    afterEach(() => {
        (global as any).fetch = originalFetch;
    });

    /** Captures the request body while answering with `responseXml`. */
    function captureRequest(responseXml: string): {body: () => string} {
        let body = '';
        (global as any).fetch = async (_url: string, init: any) => {
            body = init.body;
            return {ok: true, status: 200, text: async () => responseXml};
        };
        return {body: () => body};
    }

    it('sends the constancia lookup with unqualified children', async () => {
        // The response is incidental here — only the REQUEST is under test — but it has to report something
        // about the taxpayer, or parsing it correctly raises the not-found an empty answer now is.
        const capture = captureRequest(
            constanciaResponse(
                '<datosGenerales><idPersona>20123456789</idPersona><estadoClave>ACTIVO</estadoClave></datosGenerales>',
            ),
        );
        const service = new ConstanciaInscripcionService(new SoapClient(), 'homologacion');

        await service.getTaxpayer(AUTH, 20123456789);

        const body = capture.body();
        expect(body).toContain(`<ns1:getPersona_v2 xmlns:ns1="${CONSTANCIA_NS}">`);
        expect(body).toContain('<token>t</token>');
        expect(body).toContain('<sign>s</sign>');
        expect(body).toContain('<cuitRepresentada>30999999997</cuitRepresentada>');
        expect(body).toContain('<idPersona>20123456789</idPersona>');
        expect(body).not.toContain(`xmlns="${CONSTANCIA_NS}"`);
    });

    it('sends the A13 document search with unqualified children', async () => {
        const capture = captureRequest(
            envelope(
                'getIdPersonaListByDocumento',
                A13_NS,
                '<idPersonaListReturn><idPersona>23117096769</idPersona></idPersonaListReturn>',
            ),
        );
        const service = new TaxpayerIdentityService(new SoapClient(), 'homologacion');

        await service.getIdPersonaList(AUTH, 11709676);

        const body = capture.body();
        expect(body).toContain(`<ns1:getIdPersonaListByDocumento xmlns:ns1="${A13_NS}">`);
        expect(body).toContain('<documento>11709676</documento>');
        expect(body).not.toContain(`xmlns="${A13_NS}"`);
    });
});
