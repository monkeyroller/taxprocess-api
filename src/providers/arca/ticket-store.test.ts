import forge from 'node-forge';
import {ArcaValidationError, ServiceId, type AccessTicket, type ArcaConfig, type ServiceIdValue, type WsaaClient} from './sdk/index.js';
import {CredentialsRequiredError, TicketStore} from './ticket-store.js';
import type {DelegateCredentials, DelegateCredentialStore} from './delegate-credentials.js';
import {DelegationNotConfiguredError, type GenericEnvironment} from '../provider.js';

const ENTITY = 'ARCA';
const ISSUER = '20123456789';
const CUIT = 20123456789; // Number(ISSUER)
const SVC: ServiceIdValue = ServiceId.WSFEV1;
const ENV: GenericEnvironment = 'testing';
const OWNER_KEY = `${ENTITY}:${ENV}:${ISSUER}`;

// The service's own delegate identity (our organization's CUIT), used for the delegated-path tests. Its
// partition carries the `delegate` segment, so it can never collide with a tenant partition.
const DELEGATE_CUIT = '30711111118';
const DELEGATE_OWNER_KEY = `${ENTITY}:${ENV}:delegate:${DELEGATE_CUIT}`;

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

/**
 * Fake WsaaClient recording calls. `peekReturn`, when set, forces a cache hit (existing tests). Otherwise
 * peek consults an internal store that `getAccessTicket` populates keyed by `(ticketOwnerKey, serviceId)`,
 * so the real "one minted ticket, reused across peeks for the same owner key" behavior is observable.
 */
class FakeWsaa {
    peekReturn: AccessTicket | undefined = undefined;
    mintReturn: AccessTicket = ticket(60);
    peekCalls: Array<[string, string]> = [];
    getCalls: Array<[ArcaConfig, string]> = [];
    private readonly store = new Map<string, AccessTicket>();

    peekAccessTicket(ownerKey: string, serviceId: string): AccessTicket | undefined {
        this.peekCalls.push([ownerKey, serviceId]);
        return this.peekReturn ?? this.store.get(`${ownerKey}:${serviceId}`);
    }

    async getAccessTicket(config: ArcaConfig, serviceId: string): Promise<AccessTicket> {
        this.getCalls.push([config, serviceId]);
        this.store.set(`${config.ticketOwnerKey}:${serviceId}`, this.mintReturn);
        return this.mintReturn;
    }

    /** Mirrors the real client's scoping: exact `(owner, service)` when a service is given, else the owner. */
    clearCache(ownerKey?: string, serviceId?: string): void {
        if (ownerKey === undefined) {
            this.store.clear();
            return;
        }
        if (serviceId !== undefined) {
            this.store.delete(`${ownerKey}:${serviceId}`);
            return;
        }
        for (const key of [...this.store.keys()]) {
            if (key.startsWith(`${ownerKey}:`)) {
                this.store.delete(key);
            }
        }
    }

    /** Test helper: which `(owner, service)` tickets are currently cached. */
    cachedKeys(): Array<string> {
        return [...this.store.keys()];
    }
}

/**
 * Fake DelegateCredentialStore: returns configured delegate creds per environment (undefined ⇒ not set) and
 * recognizes its own certificate by exact PEM equality (the real store compares canonical PEMs).
 */
class FakeDelegate {
    creds: Partial<Record<GenericEnvironment, DelegateCredentials>> = {};

    get(environment: GenericEnvironment): DelegateCredentials | undefined {
        return this.creds[environment];
    }

    matchesDelegateCertificate(environment: GenericEnvironment, certPem: string): boolean {
        return this.creds[environment]?.certPem === certPem;
    }
}

function makeStore(fake: FakeWsaa, delegate: FakeDelegate = new FakeDelegate()): TicketStore {
    return new TicketStore(fake as unknown as WsaaClient, delegate as unknown as DelegateCredentialStore);
}

/** A delegate bundle for the tests — cert/key content is irrelevant (FakeWsaa never signs). */
function delegateCreds(delegateCuit = DELEGATE_CUIT): DelegateCredentials {
    return {certPem: 'DELEGATE-CERT', keyPem: 'DELEGATE-KEY', delegateCuit};
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

    it('keys the tenant partition by issuerTaxId exactly, unchanged by the delegated-cert work', async () => {
        const fake = new FakeWsaa();
        const store = makeStore(fake);

        await store.resolve(ENTITY, ISSUER, SVC, ENV, CREDS);

        // A formatted issuerTaxId can never reach the key (parseArcaId rejects it first), so the partition is
        // byte-for-byte the pre-delegation one — a shared ARCA_TICKET_CACHE_PATH survives the deploy.
        expect(fake.getCalls[0][0].ticketOwnerKey).toBe(OWNER_KEY);
        await expect(store.resolve(ENTITY, '20-12345678-9', SVC, ENV, CREDS)).rejects.toBeInstanceOf(
            ArcaValidationError,
        );
    });

    describe('delegated authorization', () => {
        it('mints via the delegate certificate, keeping Auth.Cuit = the represented issuer', async () => {
            const fake = new FakeWsaa();
            const delegate = new FakeDelegate();
            delegate.creds[ENV] = delegateCreds();
            const store = makeStore(fake, delegate);

            // No request credentials — the service uses its own delegate cert.
            const auth = await store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true);

            expect(auth).toEqual({token: 'T', sign: 'S', cuit: CUIT}); // Auth.Cuit is the representado
            expect(fake.getCalls).toHaveLength(1);
            const [config] = fake.getCalls[0];
            expect(config).toMatchObject({
                cuit: CUIT, // representado
                certPem: 'DELEGATE-CERT', // our delegate cert, not a tenant's
                keyPem: 'DELEGATE-KEY',
                environment: 'homologacion',
                ticketOwnerKey: DELEGATE_OWNER_KEY, // cache keyed by the SIGNER (delegate), not the issuer
            });
        });

        it('never throws CredentialsRequiredError on a delegated request (uses the service cert)', async () => {
            const fake = new FakeWsaa();
            const delegate = new FakeDelegate();
            delegate.creds[ENV] = delegateCreds();
            const store = makeStore(fake, delegate);

            await expect(store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true)).resolves.toMatchObject({
                cuit: CUIT,
            });
        });

        it('reuses ONE delegate ticket across different represented CUITs (single WSAA login)', async () => {
            const fake = new FakeWsaa();
            const delegate = new FakeDelegate();
            delegate.creds[ENV] = delegateCreds();
            const store = makeStore(fake, delegate);

            await store.resolve(ENTITY, '20111111112', SVC, ENV, undefined, true);
            await store.resolve(ENTITY, '20222222223', SVC, ENV, undefined, true);

            // Both represented CUITs share the delegate's ticket → exactly one login.
            expect(fake.getCalls).toHaveLength(1);
            expect(fake.getCalls[0][0].ticketOwnerKey).toBe(DELEGATE_OWNER_KEY);
        });

        it('shares one ticket when our own non-delegated issuance presents the DELEGATE certificate', async () => {
            const fake = new FakeWsaa();
            const delegate = new FakeDelegate();
            const ourCert = makeCert(DELEGATE_CUIT);
            delegate.creds[ENV] = {...ourCert, delegateCuit: DELEGATE_CUIT};
            const store = makeStore(fake, delegate);

            // Our organization issues for itself (non-delegated) with the very cert we delegate with...
            await store.resolve(ENTITY, DELEGATE_CUIT, SVC, ENV, ourCert);
            // ...then acts as delegate for another taxpayer. One physical cert ⇒ ARCA holds ONE ticket, so
            // both roles must land in the same partition or the second login would be alreadyAuthenticated.
            await store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true);

            expect(fake.getCalls).toHaveLength(1);
            expect(fake.getCalls[0][0].ticketOwnerKey).toBe(DELEGATE_OWNER_KEY);
        });

        it('keeps a DIFFERENT tenant certificate for our own CUIT out of the delegate partition', async () => {
            const fake = new FakeWsaa();
            const delegate = new FakeDelegate();
            delegate.creds[ENV] = {...makeCert(DELEGATE_CUIT), delegateCuit: DELEGATE_CUIT};
            const store = makeStore(fake, delegate);

            // A second certificate of the same CUIT (ARCA allows several; a representación is granted to one
            // specific computador). Its ticket must NOT be reused for delegated calls — that would yield a
            // permanent 601 misread as a missing delegation.
            await store.resolve(ENTITY, DELEGATE_CUIT, SVC, ENV, makeCert(DELEGATE_CUIT));
            await store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true);

            expect(fake.getCalls).toHaveLength(2); // two certs ⇒ two tickets, in disjoint partitions
            expect(fake.getCalls[0][0].ticketOwnerKey).toBe(`${ENTITY}:${ENV}:${DELEGATE_CUIT}`);
            expect(fake.getCalls[1][0].ticketOwnerKey).toBe(DELEGATE_OWNER_KEY);
        });

        it('never serves a credential-less tenant request from the delegate ticket', async () => {
            const fake = new FakeWsaa();
            const delegate = new FakeDelegate();
            delegate.creds[ENV] = delegateCreds();
            const store = makeStore(fake, delegate);

            // A delegate ticket exists for our own CUIT (minted at deploy-time config, not by any caller)...
            await store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true);

            // ...so a caller naming our own CUIT with no credentials must still be asked for them: it never
            // proved possession of a certificate for that CUIT.
            await expect(store.resolve(ENTITY, DELEGATE_CUIT, SVC, ENV)).rejects.toBeInstanceOf(
                CredentialsRequiredError,
            );
        });

        it('throws DELEGATION_NOT_CONFIGURED when no delegate cert is configured for the environment', async () => {
            const fake = new FakeWsaa();
            const store = makeStore(fake, new FakeDelegate()); // no creds configured
            await expect(store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true)).rejects.toBeInstanceOf(
                DelegationNotConfiguredError,
            );
            expect(fake.getCalls).toHaveLength(0);
        });

        it('does not require the request cert to match the issuer (delegate cert owner differs by design)', async () => {
            const fake = new FakeWsaa();
            const delegate = new FakeDelegate();
            delegate.creds[ENV] = delegateCreds();
            const store = makeStore(fake, delegate);

            // ISSUER (representado) ≠ DELEGATE_CUIT (signer); the ISSUER_TAXID_CERT_MISMATCH guard must NOT fire.
            await expect(store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true)).resolves.toMatchObject({
                cuit: CUIT,
            });
        });

        it('invalidateDelegated evicts the shared delegate ticket so the next request re-mints', async () => {
            const fake = new FakeWsaa();
            const delegate = new FakeDelegate();
            delegate.creds[ENV] = delegateCreds();
            const store = makeStore(fake, delegate);

            await store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true);
            await store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true);
            expect(fake.getCalls).toHaveLength(1); // second call served from the cached ticket

            store.invalidateDelegated(ENTITY, ENV, SVC); // ARCA rejected the ticket with a token fault

            await store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true);
            expect(fake.getCalls).toHaveLength(2); // evicted ⇒ a fresh mint
            expect(fake.getCalls[1][0].ticketOwnerKey).toBe(DELEGATE_OWNER_KEY);
        });

        it('invalidateDelegated evicts ONLY the rejected service, keeping other delegate tickets', async () => {
            const fake = new FakeWsaa();
            const delegate = new FakeDelegate();
            delegate.creds[ENV] = delegateCreds();
            const store = makeStore(fake, delegate);
            const padron: ServiceIdValue = ServiceId.CONSTANCIA_INSCRIPCION;

            await store.resolve(ENTITY, ISSUER, SVC, ENV, undefined, true);
            await store.resolve(ENTITY, ISSUER, padron, ENV, undefined, true);
            expect(fake.cachedKeys()).toHaveLength(2);

            store.invalidateDelegated(ENTITY, ENV, SVC);

            // The padrón ticket was never rejected; dropping it would leave it unmintable
            // (`alreadyAuthenticated`) until it expires ~12h later.
            expect(fake.cachedKeys()).toEqual([`${DELEGATE_OWNER_KEY}:${padron}`]);
        });

        it('invalidateDelegated is a no-op when delegation is not configured for the environment', () => {
            const fake = new FakeWsaa();
            const store = makeStore(fake, new FakeDelegate());
            expect(() => store.invalidateDelegated(ENTITY, ENV, SVC)).not.toThrow();
        });
    });
});
