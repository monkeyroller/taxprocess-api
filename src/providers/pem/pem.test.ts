import crypto from 'node:crypto';
import forge from 'node-forge';
import {
    canonicalizeCertificatePem,
    canonicalizePrivateKeyPem,
    isValidCertificate,
    isValidPrivateKey,
    isCertificateSigningRequest,
    keyMatchesCertificatePem,
} from './pem.js';

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

describe('PEM validation gate', () => {
    const a = makePair('A');
    const b = makePair('B');

    it('accepts a valid certificate and its matching key', () => {
        expect(isValidCertificate(a.certPem)).toBe(true);
        expect(isValidPrivateKey(a.keyPem)).toBe(true);
        expect(canonicalizeCertificatePem(a.certPem)).toContain('BEGIN CERTIFICATE');
        expect(canonicalizePrivateKeyPem(a.keyPem)).toContain('BEGIN RSA PRIVATE KEY');
        expect(keyMatchesCertificatePem(a.certPem, a.keyPem)).toBe(true);
    });

    it('accepts a PKCS#8 key and canonicalizes it to PKCS#1', () => {
        const pkcs8 = crypto.createPrivateKey(a.keyPem).export({type: 'pkcs8', format: 'pem'}).toString();
        expect(pkcs8).toContain('BEGIN PRIVATE KEY');
        expect(isValidPrivateKey(pkcs8)).toBe(true);
        expect(keyMatchesCertificatePem(a.certPem, pkcs8)).toBe(true);
    });

    it('tolerates an armorless key body and escaped newlines', () => {
        const bare = a.keyPem.replace(/-----[^-]*-----/g, '').trim();
        expect(isValidPrivateKey(bare)).toBe(true);
        const escaped = a.certPem.replace(/\n/g, '\\n');
        expect(isValidCertificate(escaped)).toBe(true);
    });

    it('rejects a key that does not match the certificate', () => {
        expect(keyMatchesCertificatePem(a.certPem, b.keyPem)).toBe(false);
    });

    it('rejects a CSR uploaded as a certificate, and flags it as a CSR', () => {
        const keys = forge.pki.rsa.generateKeyPair({bits: 1024});
        const csr = forge.pki.createCertificationRequest();
        csr.publicKey = keys.publicKey;
        csr.setSubject([{name: 'commonName', value: 'req'}]);
        csr.sign(keys.privateKey);
        const csrPem = forge.pki.certificationRequestToPem(csr);

        expect(isValidCertificate(csrPem)).toBe(false);
        expect(canonicalizeCertificatePem(csrPem)).toBeNull();
        expect(isCertificateSigningRequest(csrPem)).toBe(true);
    });

    it('rejects a truncated/corrupt key', () => {
        const truncated = a.keyPem.slice(0, a.keyPem.length - 40);
        expect(isValidPrivateKey(truncated)).toBe(false);
        expect(canonicalizePrivateKeyPem(truncated)).toBeNull();
    });
});
