import crypto from 'node:crypto';
import forge from 'node-forge';

/**
 * PEM normalization + validation for ARCA credentials.
 *
 * Validation goes through Node's built-in `crypto`, which parses both PKCS#1 (`RSA PRIVATE KEY`) and
 * PKCS#8 (`PRIVATE KEY`) — unlike node-forge, whose `privateKeyFromPem` only reads PKCS#1. Keys are
 * canonicalized to PKCS#1 so the forge-based WSAA signer can consume them directly. `node-forge` is
 * used only to recognize a CSR (Node has no CSR parser).
 */

/** Converts escaped/CRLF newlines to real `\n`, trims, and guarantees a trailing newline. */
export function normalizePem(pem: string): string {
    const repaired = pem
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
    return `${repaired}\n`;
}

function hasArmor(pem: string): boolean {
    return /-----BEGIN [A-Z0-9 ]+-----/.test(pem);
}

/** Wraps a bare base64 body in PEM armor for `label`, at 64 chars/line. */
function wrapWithArmor(pem: string, label: string): string {
    const body = pem.replace(/-----[^-]*-----/g, '').replace(/\s+/g, '');
    const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? body;
    return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}

/** Ensures a certificate carries PEM armor, adding a `CERTIFICATE` wrapper around a bare body. */
export function ensureCertificatePem(pem: string): string {
    const normalized = normalizePem(pem);
    return hasArmor(normalized) ? normalized : wrapWithArmor(normalized, 'CERTIFICATE');
}

/**
 * Ensures a private key carries PEM armor. A bare base64 body is tried as PKCS#8 (`PRIVATE KEY`)
 * then PKCS#1 (`RSA PRIVATE KEY`); the first that parses (via Node `crypto`) wins.
 */
export function ensurePrivateKeyPem(pem: string): string {
    const normalized = normalizePem(pem);
    if (hasArmor(normalized)) {
        return normalized;
    }
    for (const label of ['PRIVATE KEY', 'RSA PRIVATE KEY']) {
        const candidate = wrapWithArmor(normalized, label);
        try {
            crypto.createPrivateKey(candidate);
            return candidate;
        } catch {
            // try the next label
        }
    }
    return normalized;
}

/**
 * Parses `pem` as an X.509 certificate and returns its **canonical** PEM (armor + wrapping fixed),
 * or `null` if it is not a certificate. Use this at the storage boundary so only clean, valid
 * certificates are ever persisted.
 */
export function canonicalizeCertificatePem(pem: string): string | null {
    try {
        return new crypto.X509Certificate(ensureCertificatePem(pem)).toString();
    } catch {
        return null;
    }
}

/**
 * Parses `pem` as an unencrypted RSA private key (PKCS#1 or PKCS#8) and returns its **canonical**
 * PKCS#1 PEM (the form the forge-based WSAA signer consumes), or `null` if it is not usable.
 */
export function canonicalizePrivateKeyPem(pem: string): string | null {
    try {
        const key = crypto.createPrivateKey(ensurePrivateKeyPem(pem));
        if (key.asymmetricKeyType !== 'rsa') {
            return null;
        }
        return key.export({type: 'pkcs1', format: 'pem'}).toString();
    } catch {
        return null;
    }
}

/** True if `certPem` parses as an X.509 certificate (armor added if missing). */
export function isValidCertificate(certPem: string): boolean {
    return canonicalizeCertificatePem(certPem) !== null;
}

/** True if `keyPem` parses as an (unencrypted) RSA private key (PKCS#1 or PKCS#8; armor optional). */
export function isValidPrivateKey(keyPem: string): boolean {
    return canonicalizePrivateKeyPem(keyPem) !== null;
}

/** True if the private key belongs to the certificate — their public keys are identical. */
export function keyMatchesCertificatePem(certPem: string, keyPem: string): boolean {
    try {
        const certPublicKey = new crypto.X509Certificate(ensureCertificatePem(certPem)).publicKey;
        const keyPublicKey = crypto.createPublicKey(ensurePrivateKeyPem(keyPem));
        const asDer = (k: crypto.KeyObject): Buffer => k.export({type: 'spki', format: 'der'}) as Buffer;
        return asDer(certPublicKey).equals(asDer(keyPublicKey));
    } catch {
        return false;
    }
}

/**
 * Returns the raw value of the certificate subject's `serialNumber` RDN (OID 2.5.4.5), or `null` if the
 * material is not a parseable X.509 certificate or has no such RDN. ARCA embeds the taxpayer CUIT here,
 * rendered by OpenSSL/Node as e.g. `serialNumber=CUIT 20441917369`. Only that RDN is consulted — a digit
 * run elsewhere in the subject (a CN, an OU) is never mistaken for the taxpayer id. Interpreting the raw
 * value as a CUIT (stripping the `CUIT ` prefix / separators, length check) is the caller's job; see
 * `canonicalCuit`.
 */
export function certificateSubjectSerialNumber(certPem: string): string | null {
    try {
        const {subject} = new crypto.X509Certificate(ensureCertificatePem(certPem));
        const serialLine = subject
            .split('\n')
            .map((line) => line.trim())
            .find((line) => /^serialNumber=/i.test(line));
        return serialLine === undefined ? null : serialLine.slice(serialLine.indexOf('=') + 1).trim();
    } catch {
        return null;
    }
}

/**
 * True if the material is a CSR (certificate *request*) rather than an issued certificate — the most
 * common mistaken upload. Tolerates a missing/`CERTIFICATE`-mislabeled armor around the base64 body.
 */
export function isCertificateSigningRequest(pem: string): boolean {
    const normalized = normalizePem(pem);
    const candidate = /CERTIFICATE REQUEST/.test(normalized)
        ? normalized
        : wrapWithArmor(normalized, 'CERTIFICATE REQUEST');
    try {
        return forge.pki.certificationRequestFromPem(candidate) != null;
    } catch {
        return false;
    }
}
