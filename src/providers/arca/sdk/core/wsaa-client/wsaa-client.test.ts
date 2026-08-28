import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import {WsaaClient} from './wsaa-client.js';
import {SoapClient} from '../soap-client/soap-client.js';
import type {ArcaConfig} from '../arca-config.js';

/**
 * Fake SOAP transport: records each `call`, returns a canned WSAA ticket, and reuses a real
 * SoapClient's XML parser so the ticket-parsing path under test is exercised end to end.
 */
class FakeSoap {
    calls: Array<{operation: string; payload: Record<string, unknown>; soapAction?: string}> = [];
    private readonly realParser = new SoapClient();

    constructor(private readonly ticketXml: string) {}

    async call(
        _endpoint: string,
        _namespace: string,
        operation: string,
        payload: Record<string, unknown>,
        options?: {soapAction?: string},
    ): Promise<Record<string, unknown>> {
        this.calls.push({operation, payload, soapAction: options?.soapAction});
        return {loginCmsReturn: this.ticketXml};
    }

    parseXmlString(xml: string): Record<string, unknown> {
        return this.realParser.parseXmlString(xml);
    }
}

function ticketXml(expirationIso: string): string {
    return (
        '<loginTicketResponse><header>' +
        `<expirationTime>${expirationIso}</expirationTime>` +
        '</header><credentials><token>TOK</token><sign>SIG</sign></credentials></loginTicketResponse>'
    );
}

function makeConfig(overrides: Partial<ArcaConfig> = {}): ArcaConfig {
    const keys = forge.pki.rsa.generateKeyPair({bits: 1024});
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2999-01-01T00:00:00Z');
    cert.sign(keys.privateKey);
    return {
        cuit: 20111111112,
        certPem: forge.pki.certificateToPem(cert),
        keyPem: forge.pki.privateKeyToPem(keys.privateKey),
        environment: 'homologacion',
        ticketOwnerKey: 'tenantA:20111111112',
        ...overrides,
    };
}

describe('WsaaClient', () => {
    it('signs the TRA and returns a parsed ticket (token + sign)', async () => {
        const soap = new FakeSoap(ticketXml('2999-01-01T00:00:00.000Z'));
        const client = new WsaaClient(soap as unknown as SoapClient);

        const ticket = await client.getAccessTicket(makeConfig(), 'wsfe');

        expect(ticket.token).toBe('TOK');
        expect(ticket.sign).toBe('SIG');
        expect(soap.calls).toHaveLength(1);
        // The signed CMS is passed as a non-empty base64 `in0`, and WSAA uses an empty SOAPAction.
        expect(typeof soap.calls[0].payload.in0).toBe('string');
        expect((soap.calls[0].payload.in0 as string).length).toBeGreaterThan(0);
        expect(soap.calls[0].soapAction).toBe('');
    });

    it('caches a valid ticket per (owner, service)', async () => {
        const soap = new FakeSoap(ticketXml('2999-01-01T00:00:00.000Z'));
        const client = new WsaaClient(soap as unknown as SoapClient);
        const config = makeConfig();

        await client.getAccessTicket(config, 'wsfe');
        await client.getAccessTicket(config, 'wsfe');
        expect(soap.calls).toHaveLength(1); // second call served from cache

        await client.getAccessTicket(config, 'wsfex');
        expect(soap.calls).toHaveLength(2); // different service -> its own login
    });

    it('de-duplicates concurrent logins for the same key', async () => {
        const soap = new FakeSoap(ticketXml('2999-01-01T00:00:00.000Z'));
        const client = new WsaaClient(soap as unknown as SoapClient);
        const config = makeConfig();

        await Promise.all([client.getAccessTicket(config, 'wsfe'), client.getAccessTicket(config, 'wsfe')]);
        expect(soap.calls).toHaveLength(1);
    });

    it('re-logs in when the cached ticket is expired', async () => {
        const soap = new FakeSoap(ticketXml('2000-01-01T00:00:00.000Z')); // already expired
        const client = new WsaaClient(soap as unknown as SoapClient);
        const config = makeConfig();

        await client.getAccessTicket(config, 'wsfe');
        await client.getAccessTicket(config, 'wsfe');
        expect(soap.calls).toHaveLength(2);
    });

    it('clearCache purges the persisted file so an evicted ticket cannot resurrect from disk', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsaa-'));
        const cachePath = path.join(dir, 'tickets.json');
        try {
            const soap = new FakeSoap(ticketXml('2999-01-01T00:00:00.000Z'));
            const client = new WsaaClient(soap as unknown as SoapClient, cachePath);
            const config = makeConfig();

            await client.getAccessTicket(config, 'wsfe');
            expect(JSON.parse(fs.readFileSync(cachePath, 'utf8'))).toHaveProperty(`${config.ticketOwnerKey}:wsfe`);

            client.clearCache(config.ticketOwnerKey);

            // Gone from the file, so a fresh client sharing the path finds no ticket to peek.
            expect(JSON.parse(fs.readFileSync(cachePath, 'utf8'))).not.toHaveProperty(`${config.ticketOwnerKey}:wsfe`);
            const fresh = new WsaaClient(soap as unknown as SoapClient, cachePath);
            expect(fresh.peekAccessTicket(config.ticketOwnerKey, 'wsfe')).toBeUndefined();
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    it('clearCache with a serviceId evicts only that service, in memory and on disk', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsaa-'));
        const cachePath = path.join(dir, 'tickets.json');
        try {
            const soap = new FakeSoap(ticketXml('2999-01-01T00:00:00.000Z'));
            const client = new WsaaClient(soap as unknown as SoapClient, cachePath);
            const config = makeConfig();
            const owner = config.ticketOwnerKey;

            await client.getAccessTicket(config, 'wsfe');
            await client.getAccessTicket(config, 'ws_sr_constancia_inscripcion');

            client.clearCache(owner, 'wsfe');

            // ARCA won't re-issue a ticket while a prior one lives, so the service ARCA never rejected must
            // keep both its in-memory and its persisted copy.
            expect(client.peekAccessTicket(owner, 'wsfe')).toBeUndefined();
            expect(client.peekAccessTicket(owner, 'ws_sr_constancia_inscripcion')).toBeDefined();
            const persisted = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            expect(persisted).not.toHaveProperty(`${owner}:wsfe`);
            expect(persisted).toHaveProperty(`${owner}:ws_sr_constancia_inscripcion`);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});
