import forge from 'node-forge';
import {validateArcaCredentials} from './credentials.js';
import type {ValidateCredentialsInput} from '../../provider.js';

interface Pair {
    certPem: string;
    keyPem: string;
}

function makePair(cn: string, cuit?: string): Pair {
    const keys = forge.pki.rsa.generateKeyPair({bits: 1024});
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2999-01-01T00:00:00Z');
    // ARCA embeds the taxpayer CUIT in the subject `serialNumber` RDN (OID 2.5.4.5) as `CUIT <cuit>`.
    const subject: forge.pki.CertificateField[] = [{name: 'commonName', value: cn}];
    if (cuit !== undefined) {
        subject.push({type: '2.5.4.5', value: `CUIT ${cuit}`});
    }
    cert.setSubject(subject);
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
    // Default cert carries a CUIT and expectedTaxId matches it, so structural-focused tests never trip the
    // taxpayer check unless they opt in via an override.
    const pair = makePair('AR', '20123456789');
    return {
        environment: over.environment ?? 'testing',
        configuration: over.configuration ?? {},
        credentials: {
            certPem: over.certPem ?? pair.certPem,
            keyPem: over.keyPem ?? pair.keyPem,
        },
        expectedTaxId: over.expectedTaxId ?? '20123456789',
    };
}

describe('validateArcaCredentials', () => {
    it('accepts a valid cert + matching key + well-formed CUIT', () => {
        const pair = makePair('AR', '20123456789');
        const result = validateArcaCredentials({
            environment: 'testing',
            configuration: {}, // ARCA credential validation reads nothing from configuration
            credentials: {certPem: pair.certPem, keyPem: pair.keyPem},
            expectedTaxId: '20123456789',
        });
        expect(result).toEqual({ok: true});
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

    it('accepts a cert issued to expectedTaxId', () => {
        const pair = makePair('company', '20111111112');
        const result = validateArcaCredentials({
            environment: 'testing',
            configuration: {}, // ARCA credential validation reads nothing from configuration
            credentials: {certPem: pair.certPem, keyPem: pair.keyPem},
            expectedTaxId: '20111111112',
        });
        expect(result).toEqual({ok: true});
    });

    it('rejects a valid cert issued to a different CUIT than expectedTaxId', () => {
        const pair = makePair('company', '20111111112');
        const result = validateArcaCredentials({
            environment: 'testing',
            configuration: {}, // ARCA credential validation reads nothing from configuration
            credentials: {certPem: pair.certPem, keyPem: pair.keyPem},
            expectedTaxId: '30999999994',
        });
        expect(result.ok).toBe(false);
        expect(result.errors?.map((e) => e.code)).toEqual(['TAXID_MISMATCH']);
    });

    it('reports the structural code, not TAXID_MISMATCH, for a CSR with a mismatching expectedTaxId', () => {
        const result = validateArcaCredentials(
            input({certPem: makeCsr(), expectedTaxId: '30999999994'}),
        );
        expect(result.ok).toBe(false);
        const codes = result.errors?.map((e) => e.code);
        expect(codes).toContain('CERT_IS_CSR');
        expect(codes).not.toContain('TAXID_MISMATCH');
    });

    it('matches regardless of CUIT formatting (dashes vs bare digits) on either side', () => {
        // cert carries a dash-formatted CUIT, expectedTaxId is bare digits
        const dashedCert = makePair('company', '20-11111111-2');
        expect(
            validateArcaCredentials({
                environment: 'testing',
                configuration: {}, // ARCA credential validation reads nothing from configuration
                credentials: {certPem: dashedCert.certPem, keyPem: dashedCert.keyPem},
                expectedTaxId: '20111111112',
            }),
        ).toEqual({ok: true});

        // cert carries bare digits, expectedTaxId is dash-formatted
        const bareCert = makePair('company', '20111111112');
        expect(
            validateArcaCredentials({
                environment: 'testing',
                configuration: {}, // ARCA credential validation reads nothing from configuration
                credentials: {certPem: bareCert.certPem, keyPem: bareCert.keyPem},
                expectedTaxId: '20-11111111-2',
            }),
        ).toEqual({ok: true});
    });

    it('does not mistake an 11-digit run elsewhere in the subject for the taxpayer id', () => {
        // No serialNumber RDN; the CN coincidentally contains the expected 11 digits. The tightened
        // extraction reads only the serialNumber RDN, so this is a mismatch, not an accidental pass.
        const pair = makePair('Empresa 20111111112 SA');
        const result = validateArcaCredentials({
            environment: 'testing',
            configuration: {}, // ARCA credential validation reads nothing from configuration
            credentials: {certPem: pair.certPem, keyPem: pair.keyPem},
            expectedTaxId: '20111111112',
        });
        expect(result.ok).toBe(false);
        expect(result.errors?.map((e) => e.code)).toEqual(['TAXID_MISMATCH']);
        expect(result.errors?.[0]?.message).toContain('carries no CUIT');
    });

    it('rejects an expectedTaxId that is not a valid CUIT', () => {
        const result = validateArcaCredentials(input({expectedTaxId: '123'}));
        expect(result.ok).toBe(false);
        expect(result.errors?.map((e) => e.code)).toEqual(['INVALID_TAXPAYER_ID']);
        expect(result.errors?.[0]?.message).toContain('not a valid CUIT');
    });
});
