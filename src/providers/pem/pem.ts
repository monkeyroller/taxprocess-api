import crypto from 'node:crypto';
import forge from 'node-forge';

/**
 * PEM normalization and validation for certificate-based credentials. Entity-agnostic: every function here
 * is X.509, PKCS#1, PKCS#8 or CSR handling, with no authority's vocabulary in it. The one place an
 * authority-specific reading would creep in is pushed out to the caller —
 * `certificateSubjectSerialNumber` returns the raw RDN and leaves interpreting it as a tax id to whoever
 * knows one.
 *
 * Validation goes through Node's `crypto`, which parses both PKCS#1 and PKCS#8, unlike node-forge. Keys are
 * canonicalized to PKCS#1 so a forge-based CMS signer can consume them directly, and node-forge is used only
 * to recognize a CSR, Node having no CSR parser.
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
 * Ensures a private key carries PEM armor. A bare base64 body is tried as PKCS#8 then PKCS#1; the first that
 * parses wins.
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
 * Parses `pem` as an X.509 certificate and returns its canonical PEM, or `null` if it is not a certificate.
 * Use this at the storage boundary so only valid certificates are persisted.
 */
export function canonicalizeCertificatePem(pem: string): string | null {
    try {
        return new crypto.X509Certificate(ensureCertificatePem(pem)).toString();
    } catch {
        return null;
    }
}

/**
 * Parses `pem` as an unencrypted RSA private key and returns its canonical PKCS#1 PEM, the form a
 * forge-based CMS signer consumes, or `null` if it is not usable.
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
        const asDer = (k: crypto.KeyObject): Buffer => k.export({type: 'spki', format: 'der'});
        return asDer(certPublicKey).equals(asDer(keyPublicKey));
    } catch {
        return false;
    }
}

/**
 * The raw value of the certificate subject's `serialNumber` RDN, or `null` if the material is not a
 * parseable certificate or has no such RDN. Authorities commonly embed the taxpayer's national id there —
 * ARCA renders it as `serialNumber=CUIT 20111111112`. Only that RDN is consulted, so a digit run elsewhere
 * in the subject is never mistaken for the id.
 *
 * Reading the value as a tax id is the caller's job, which is what keeps this module entity-agnostic:
 * stripping a prefix, dropping separators and checking a length are decisions only a provider that knows its
 * authority can make.
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
 * True if the material is a CSR rather than an issued certificate — the most common mistaken upload.
 * Tolerates missing or mislabeled armor around the base64 body.
 */
export function isCertificateSigningRequest(pem: string): boolean {
    const normalized = normalizePem(pem);
    const candidate = normalized.includes('CERTIFICATE REQUEST')
        ? normalized
        : wrapWithArmor(normalized, 'CERTIFICATE REQUEST');
    try {
        // Throws when `candidate` is not a parseable CSR; it never returns a nullish value.
        forge.pki.certificationRequestFromPem(candidate);
        return true;
    } catch {
        return false;
    }
}
