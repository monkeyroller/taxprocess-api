import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import {canonicalizeCertificatePem, canonicalizePrivateKeyPem} from '../../../pem/pem.js';
import {DelegateCredentialStore} from './delegate-credentials.js';
import {DelegationNotConfiguredError} from '../../../provider/faults.js';
import type {ArcaDelegateConfig, DelegateCertConfig} from '../../../../config/env.js';

interface Pair {
    certPem: string;
    keyPem: string;
}

/** Self-signed cert carrying `cuit` in the subject serialNumber RDN (OID 2.5.4.5), as ARCA issues it. */
function makePair(cuit?: string): Pair {
    const keys = forge.pki.rsa.generateKeyPair({bits: 1024});
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2999-01-01T00:00:00Z');
    const subject: forge.pki.CertificateField[] = [{name: 'commonName', value: 'delegate'}];
    if (cuit !== undefined) {
        subject.push({type: '2.5.4.5', value: `CUIT ${cuit}`});
    }
    cert.setSubject(subject);
    cert.setIssuer([{name: 'commonName', value: 'delegate'}]);
    cert.sign(keys.privateKey);
    return {certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey)};
}

function makeCsr(): string {
    const keys = forge.pki.rsa.generateKeyPair({bits: 1024});
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([{name: 'commonName', value: 'req'}]);
    csr.sign(keys.privateKey);
    return forge.pki.certificationRequestToPem(csr);
}

const EMPTY: DelegateCertConfig = {certPem: undefined, certPath: undefined, keyPem: undefined, keyPath: undefined};

function config(testing: Partial<DelegateCertConfig>, expectedTaxId?: string): ArcaDelegateConfig {
    return {production: EMPTY, testing: {...EMPTY, ...testing}, expectedTaxId};
}

describe('DelegateCredentialStore', () => {
    it('returns undefined when no delegate cert is configured for the environment', () => {
        const store = new DelegateCredentialStore(config({}));
        expect(store.get('testing')).toBeUndefined();
    });

    it('loads inline PEMs and derives the delegate CUIT from the certificate subject', () => {
        const pair = makePair('30711111118');
        const store = new DelegateCredentialStore(config({certPem: pair.certPem, keyPem: pair.keyPem}));

        expect(store.get('testing')).toEqual({
            certPem: canonicalizeCertificatePem(pair.certPem),
            keyPem: canonicalizePrivateKeyPem(pair.keyPem),
            delegateCuit: '30711111118',
        });
    });

    it('stores CANONICAL PEMs, so an escaped-newline inline PEM can still be signed with', () => {
        const pair = makePair('30711111118');
        // How a PEM commonly arrives from a single-quoted env var / JSON secret: literal `\n`, no real
        // newlines. Every validator repairs this internally, but the WSAA signer does not — storing the raw
        // value would pass boot and then fail `forge.pki.certificateFromPem` on every delegated request.
        const escaped = (pem: string): string => pem.replace(/\r?\n/g, '\\n');
        const store = new DelegateCredentialStore(
            config({certPem: escaped(pair.certPem), keyPem: escaped(pair.keyPem)}),
        );

        const loaded = store.get('testing');
        expect(loaded?.certPem).not.toContain('\\n');
        expect(loaded?.delegateCuit).toBe('30711111118');
        // The stored PEMs are exactly what the signer consumes — proven by signing with them.
        expect(() => forge.pki.certificateFromPem(loaded!.certPem)).not.toThrow();
        expect(() => crypto.createPrivateKey(loaded!.keyPem)).not.toThrow();
    });

    it('recognizes its own certificate through formatting differences', () => {
        const pair = makePair('30711111118');
        const other = makePair('30711111118');
        const store = new DelegateCredentialStore(config({certPem: pair.certPem, keyPem: pair.keyPem}));

        expect(store.matchesDelegateCertificate('testing', pair.certPem.replace(/\r?\n/g, '\\n'))).toBe(true);
        expect(store.matchesDelegateCertificate('testing', other.certPem)).toBe(false); // same CUIT, other cert
        expect(store.matchesDelegateCertificate('production', pair.certPem)).toBe(false); // not configured
    });

    it('matchesDelegateCertificate reports no match instead of throwing on a broken delegate config', () => {
        const pair = makePair('30711111118');
        const store = new DelegateCredentialStore(config({certPem: makeCsr(), keyPem: pair.keyPem}));
        // A tenant request must not fail because the *delegate* certificate is misconfigured.
        expect(store.matchesDelegateCertificate('testing', pair.certPem)).toBe(false);
    });

    it('accepts a matching ARCA_DELEGATE_TAXID (any formatting)', () => {
        const pair = makePair('30-71111111-8');
        const store = new DelegateCredentialStore(
            config({certPem: pair.certPem, keyPem: pair.keyPem}, '30711111118'),
        );
        expect(store.get('testing')?.delegateCuit).toBe('30711111118');
    });

    it('fails when ARCA_DELEGATE_TAXID disagrees with the certificate CUIT', () => {
        const pair = makePair('30711111118');
        const store = new DelegateCredentialStore(
            config({certPem: pair.certPem, keyPem: pair.keyPem}, '20123456789'),
        );
        expect(() => store.get('testing')).toThrow(DelegationNotConfiguredError);
    });

    it('rejects a CSR supplied as the delegate certificate', () => {
        const pair = makePair('30711111118');
        const store = new DelegateCredentialStore(config({certPem: makeCsr(), keyPem: pair.keyPem}));
        expect(() => store.get('testing')).toThrow(/CSR/);
    });

    it('rejects a private key that does not match the certificate', () => {
        const pair = makePair('30711111118');
        const other = makePair('30711111118');
        const store = new DelegateCredentialStore(config({certPem: pair.certPem, keyPem: other.keyPem}));
        expect(() => store.get('testing')).toThrow(/does not match/);
    });

    it('rejects a certificate that carries no CUIT in its subject', () => {
        const pair = makePair(); // no serialNumber RDN
        const store = new DelegateCredentialStore(config({certPem: pair.certPem, keyPem: pair.keyPem}));
        expect(() => store.get('testing')).toThrow(/no CUIT/);
    });

    it('fails when a certificate is set but the private key is missing', () => {
        const pair = makePair('30711111118');
        const store = new DelegateCredentialStore(config({certPem: pair.certPem}));
        expect(() => store.get('testing')).toThrow(DelegationNotConfiguredError);
    });

    it('loads the cert/key from file paths', () => {
        const pair = makePair('30711111118');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegate-'));
        const certPath = path.join(dir, 'cert.pem');
        const keyPath = path.join(dir, 'key.pem');
        fs.writeFileSync(certPath, pair.certPem);
        fs.writeFileSync(keyPath, pair.keyPem);
        try {
            const store = new DelegateCredentialStore(config({certPath, keyPath}));
            expect(store.get('testing')?.delegateCuit).toBe('30711111118');
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    it('fails clearly when a configured cert file cannot be read', () => {
        const pair = makePair('30711111118');
        const store = new DelegateCredentialStore(
            config({certPath: path.join(os.tmpdir(), 'does-not-exist-cert.pem'), keyPem: pair.keyPem}),
        );
        expect(() => store.get('testing')).toThrow(/could not be read/);
    });

    it('memoizes: a second get does not re-read/re-validate', () => {
        const pair = makePair('30711111118');
        const store = new DelegateCredentialStore(config({certPem: pair.certPem, keyPem: pair.keyPem}));
        const first = store.get('testing');
        expect(store.get('testing')).toBe(first); // same cached reference
    });
});
