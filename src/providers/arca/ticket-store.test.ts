import forge from 'node-forge';
import {ArcaValidationError, ServiceId, type AccessTicket, type ArcaConfig, type ServiceIdValue, type WsaaClient} from './sdk/index.js';
import {CredentialsRequiredError, TicketStore} from './ticket-store.js';
import type {GenericEnvironment} from '../provider.js';

const ENTITY = 'ARCA';
const ISSUER = '20123456789';
const CUIT = 20123456789; // Number(ISSUER)
const SVC: ServiceIdValue = ServiceId.WSFEV1;
const ENV: GenericEnvironment = 'testing';
const OWNER_KEY = `${ENTITY}:${ENV}:${ISSUER}`;

/** Self-signed cert carrying `cuit` in the subject serialNumber RDN (OID 2.5.4.5), as ARCA issues it. */
function makeCert(cuit?: string): {certPem: string; keyPem: string} {
    const keys = forge.pki.rsa.generateKeyPair({bits: 1024});
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2999-01-01T00:00:00Z');
    const subject: forge.pki.CertificateField[] = [{name: 'commonName', value: 'test'}];
    if (cuit !== undefined) {
        subject.push({type: '2.5.4.5', value: `CUIT ${cuit}`});
    }
    cert.setSubject(subject);
    cert.setIssuer([{name: 'commonName', value: 'test'}]);
    cert.sign(keys.privateKey);
    return {certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey)};
}

// The certificate the caller sends must belong to ISSUER — the mint path now enforces this.
const CREDS = makeCert(ISSUER);

function ticket(mins: number): AccessTicket {
    return {token: 'T', sign: 'S', expirationTime: new Date(Date.now() + mins * 60_000)};
}

/** Fake WsaaClient recording calls; `peekReturn` controls the cache-hit path. */
class FakeWsaa {
    peekReturn: AccessTicket | undefined = undefined;
    mintReturn: AccessTicket = ticket(60);
    peekCalls: Array<[string, string]> = [];
    getCalls: Array<[ArcaConfig, string]> = [];

    peekAccessTicket(ownerKey: string, serviceId: string): AccessTicket | undefined {
        this.peekCalls.push([ownerKey, serviceId]);
        return this.peekReturn;
    }

    async getAccessTicket(config: ArcaConfig, serviceId: string): Promise<AccessTicket> {
        this.getCalls.push([config, serviceId]);
        return this.mintReturn;
    }
}

function makeStore(fake: FakeWsaa): TicketStore {
    return new TicketStore(fake as unknown as WsaaClient);
}

describe('TicketStore (mint-on-credentials)', () => {
    it('throws CredentialsRequiredError on a cache miss with no credentials', async () => {
        const fake = new FakeWsaa();
        const store = makeStore(fake);
        await expect(store.resolve(ENTITY, ISSUER, SVC, ENV)).rejects.toBeInstanceOf(CredentialsRequiredError);
        expect(fake.getCalls).toHaveLength(0);
    });

    it('reports the neutral vocabulary on the CredentialsRequiredError', async () => {
        const fake = new FakeWsaa();
        const store = makeStore(fake);
        await expect(store.resolve(ENTITY, ISSUER, SVC, ENV)).rejects.toMatchObject({
            entityCode: ENTITY,
            issuerTaxId: ISSUER,
            service: SVC,
            environment: ENV,
        });
    });

    it('rejects a non-numeric issuerTaxId before touching the cache or minting', async () => {
        const fake = new FakeWsaa();
        const store = makeStore(fake);
        await expect(store.resolve(ENTITY, '20-12345678-9', SVC, ENV, CREDS)).rejects.toThrow(ArcaValidationError);
        expect(fake.peekCalls).toHaveLength(0);
        expect(fake.getCalls).toHaveLength(0);
    });

    it('serves a cached ticket without minting (no credentials needed)', async () => {
        const fake = new FakeWsaa();
        fake.peekReturn = ticket(60);
        const store = makeStore(fake);

        const auth = await store.resolve(ENTITY, ISSUER, SVC, ENV);

        expect(auth).toEqual({token: 'T', sign: 'S', cuit: CUIT});
        expect(fake.getCalls).toHaveLength(0);
    });

    it('mints from credentials on a miss, passing a config scoped by (entity, environment, issuer)', async () => {
        const fake = new FakeWsaa();
        const store = makeStore(fake);

        const auth = await store.resolve(ENTITY, ISSUER, SVC, ENV, CREDS);

        expect(auth).toEqual({token: 'T', sign: 'S', cuit: CUIT});
        expect(fake.getCalls).toHaveLength(1);
        const [config, serviceId] = fake.getCalls[0];
        expect(serviceId).toBe(SVC);
        expect(config).toMatchObject({
            cuit: CUIT,
            certPem: CREDS.certPem,
            keyPem: CREDS.keyPem,
            environment: 'homologacion', // 'testing' maps to ARCA homologación
            ticketOwnerKey: OWNER_KEY,
        });
    });

    it('rejects (400 ISSUER_TAXID_CERT_MISMATCH) when the cert CUIT differs from issuerTaxId — before minting', async () => {
        const fake = new FakeWsaa();
        const store = makeStore(fake);
        const wrongCert = makeCert('27999999993'); // a valid-shaped CUIT, but not ISSUER

        await expect(store.resolve(ENTITY, ISSUER, SVC, ENV, wrongCert)).rejects.toMatchObject({
            code: 'ISSUER_TAXID_CERT_MISMATCH',
        });
        expect(fake.getCalls).toHaveLength(0); // never contacts WSAA — no ticket minted under the wrong identity
    });

    it('rejects when the certificate carries no CUIT at all', async () => {
        const fake = new FakeWsaa();
        const store = makeStore(fake);

        await expect(store.resolve(ENTITY, ISSUER, SVC, ENV, makeCert())).rejects.toMatchObject({
            code: 'ISSUER_TAXID_CERT_MISMATCH',
        });
        expect(fake.getCalls).toHaveLength(0);
    });

    it('matches cert CUIT to issuerTaxId regardless of formatting differences', async () => {
        const fake = new FakeWsaa();
        const store = makeStore(fake);
        // Cert embeds the dashed spelling; issuerTaxId is bare digits — same CUIT, must mint.
        await store.resolve(ENTITY, ISSUER, SVC, ENV, makeCert('20-12345678-9'));

        expect(fake.getCalls).toHaveLength(1);
    });

    it('peeks the cache before minting even when credentials are present', async () => {
        const fake = new FakeWsaa();
        fake.peekReturn = ticket(60);
        const store = makeStore(fake);

        await store.resolve(ENTITY, ISSUER, SVC, ENV, CREDS);

        expect(fake.peekCalls[0]).toEqual([OWNER_KEY, SVC]);
        expect(fake.getCalls).toHaveLength(0); // cache hit short-circuits the mint
    });
});
