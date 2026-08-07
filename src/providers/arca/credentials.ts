import {
    isCertificateSigningRequest,
    isValidCertificate,
    isValidPrivateKey,
    keyMatchesCertificatePem,
} from './sdk/index.js';
import type {
    CredentialValidationError,
    CredentialValidationResult,
    ValidateCredentialsInput,
} from '../provider.js';

/** An ARCA issuer CUIT is 11 digits. */
const CUIT_RE = /^\d{11}$/;

/**
 * Validates an ARCA credential bundle at registration time (H3). Checks the issuer CUIT format (from the
 * non-secret `configuration.issuerTaxId`), that the certificate is an issued cert (not a CSR), that the
 * private key parses, and that the key matches the certificate. Returns `{ ok: true }` or structured
 * errors. This is the PEM/CUIT validation that previously lived in core's `provider-adapters.ts`.
 */
export function validateArcaCredentials(input: ValidateCredentialsInput): CredentialValidationResult {
    const errors: Array<CredentialValidationError> = [];
    const {configuration, credentials} = input;

    const issuerTaxId = configuration.issuerTaxId;
    if (typeof issuerTaxId !== 'string' || !CUIT_RE.test(issuerTaxId)) {
        errors.push({
            code: 'INVALID_TAXPAYER_ID',
            message: 'configuration.issuerTaxId must be an 11-digit CUIT',
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

    return errors.length > 0 ? {ok: false, errors} : {ok: true};
}
