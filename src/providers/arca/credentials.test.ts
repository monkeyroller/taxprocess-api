import forge from 'node-forge';
import {validateArcaCredentials} from './credentials.js';
import type {ValidateCredentialsInput} from '../provider.js';

interface Pair {
    certPem: string;
    keyPem: string;
}

function makePair(cn: string): Pair {
    const keys = forge.pki.rsa.generateKeyPair({bits: 1024});
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2999-01-01T00:00:00Z');
    cert.setSubject([{name: 'commonName', value: cn}]);
    cert.setIssuer([{name: 'commonName', value: cn}]);
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

function input(over: Partial<ValidateCredentialsInput> & {certPem?: string; keyPem?: string}): ValidateCredentialsInput {
    const pair = makePair('AR');
    return {
        environment: over.environment ?? 'testing',
        configuration: over.configuration ?? {issuerTaxId: '20123456789'},
        credentials: {
            certPem: over.certPem ?? pair.certPem,
            keyPem: over.keyPem ?? pair.keyPem,
        },
    };
}

describe('validateArcaCredentials', () => {
    it('accepts a valid cert + matching key + well-formed CUIT', () => {
        const pair = makePair('AR');
        const result = validateArcaCredentials({
            environment: 'testing',
            configuration: {issuerTaxId: '20123456789'},
            credentials: {certPem: pair.certPem, keyPem: pair.keyPem},
        });
        expect(result).toEqual({ok: true});
    });

    it('rejects a non-11-digit issuerTaxId', () => {
        const result = validateArcaCredentials(input({configuration: {issuerTaxId: '123'}}));
        expect(result.ok).toBe(false);
        expect(result.errors?.map((e) => e.code)).toContain('INVALID_TAXPAYER_ID');
    });

    it('rejects a CSR supplied as the certificate', () => {
        const result = validateArcaCredentials(input({certPem: makeCsr()}));
        expect(result.ok).toBe(false);
        expect(result.errors?.map((e) => e.code)).toContain('CERT_IS_CSR');
    });

    it('rejects a key that does not match the certificate', () => {
        const other = makePair('OTHER');
        const result = validateArcaCredentials(input({keyPem: other.keyPem}));
        expect(result.ok).toBe(false);
        expect(result.errors?.map((e) => e.code)).toContain('KEY_CERT_MISMATCH');
    });

    it('rejects a corrupt private key', () => {
        const pair = makePair('AR');
        const result = validateArcaCredentials(input({keyPem: pair.keyPem.slice(0, -40)}));
        expect(result.ok).toBe(false);
        expect(result.errors?.map((e) => e.code)).toContain('INVALID_KEY');
    });
});
