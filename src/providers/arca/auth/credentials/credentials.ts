import {
    certificateSubjectSerialNumber,
    isCertificateSigningRequest,
    isValidCertificate,
    isValidPrivateKey,
    keyMatchesCertificatePem,
} from '../../../pem/pem.js';
import {canonicalCuit} from '../../mapping/identifiers.js';
import type {
    CredentialValidationError,
    CredentialValidationResult,
    ValidateCredentialsInput,
} from '../../../provider/credential-validation.js';

/**
 * Validates an ARCA credential bundle at registration time: the certificate is an issued cert rather than a
 * CSR, the private key parses, the key matches the certificate, and the certificate was issued to the
 * taxpayer core declares in `expectedTaxId`.
 */
export function validateArcaCredentials(input: ValidateCredentialsInput): CredentialValidationResult {
    const errors: Array<CredentialValidationError> = [];
    const {credentials, expectedTaxId} = input;

    // The owning company's CUIT the cert must belong to, canonicalized so formatting is not significant.
    const expected = canonicalCuit(expectedTaxId);
    if (expected === null) {
        errors.push({
            code: 'INVALID_TAXPAYER_ID',
            message: `expectedTaxId "${expectedTaxId}" is not a valid CUIT`,
        });
    }

    const {certPem, keyPem} = credentials;

    let certOk = false;
    if (isCertificateSigningRequest(certPem)) {
        errors.push({
            code: 'CERT_IS_CSR',
            message: 'certPem is a certificate signing request (CSR), not an issued certificate',
        });
    } else if (!isValidCertificate(certPem)) {
        errors.push({code: 'INVALID_CERT', message: 'certPem is not a valid X.509 certificate'});
    } else {
        certOk = true;
    }

    let keyOk = false;
    if (!isValidPrivateKey(keyPem)) {
        errors.push({code: 'INVALID_KEY', message: 'keyPem is not a valid private key'});
    } else {
        keyOk = true;
    }

    if (certOk && keyOk && !keyMatchesCertificatePem(certPem, keyPem)) {
        errors.push({code: 'KEY_CERT_MISMATCH', message: 'keyPem does not match the certificate'});
    }

    // The certificate must belong to the company that owns the integration. After the structural checks, so
    // an unparseable cert fails with its own code, and only when `expectedTaxId` is itself a valid CUIT.
    // Both sides go through the same canonicalizer, so formatting never causes a spurious mismatch.
    if (certOk && expected !== null) {
        const serial = certificateSubjectSerialNumber(certPem);
        const certTaxId = serial === null ? null : canonicalCuit(serial);
        if (certTaxId !== expected) {
            errors.push({
                code: 'TAXID_MISMATCH',
                message:
                    certTaxId === null
                        ? `certificate subject carries no CUIT; expected ${expected}`
                        : `certificate was issued to CUIT ${certTaxId}, expected ${expected}`,
            });
        }
    }

    return errors.length > 0 ? {ok: false, errors} : {ok: true};
}
