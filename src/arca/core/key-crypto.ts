import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';

/**
 * App-level envelope encryption for ARCA private keys at rest (AES-256-GCM).
 *
 * The master key comes from the environment, never the database, so a database dump alone cannot
 * decrypt a stored key. `keyVersion` is persisted alongside each ciphertext so keys can be rotated
 * without a bulk re-encrypt: new writes use {@link CURRENT_KEY_VERSION}; reads decrypt with whatever
 * version produced the row.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard
const KEY_LENGTH = 32; // AES-256

/** Version stamped on newly-encrypted secrets. Bump when introducing a new master key. */
export const CURRENT_KEY_VERSION = 1;

export interface EncryptedSecret {
    /** Base64 ciphertext. */
    ciphertext: string;
    /** Base64 initialization vector (nonce). */
    iv: string;
    /** Base64 GCM authentication tag. */
    authTag: string;
    /** Which master key version encrypted this secret. */
    keyVersion: number;
}

function envVarForVersion(version: number): string {
    return version === CURRENT_KEY_VERSION ? 'ARCA_MASTER_KEY' : `ARCA_MASTER_KEY_V${version}`;
}

function loadMasterKey(version: number): Buffer {
    const envName = envVarForVersion(version);
    const raw = process.env[envName];
    if (!raw) {
        throw new Error(`${envName} is not set; cannot encrypt/decrypt ARCA credentials`);
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_LENGTH) {
        throw new Error(`${envName} must decode to ${KEY_LENGTH} bytes (base64-encoded 256-bit key)`);
    }
    return key;
}

/** Encrypts a UTF-8 secret (e.g. a private-key PEM) with the current master key. */
export function encryptSecret(plaintext: string): EncryptedSecret {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, loadMasterKey(CURRENT_KEY_VERSION), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        keyVersion: CURRENT_KEY_VERSION,
    };
}

/**
 * Decrypts a secret produced by {@link encryptSecret}. Throws if the master key is missing or if the
 * authentication tag does not verify (tampered/corrupt ciphertext).
 */
export function decryptSecret(secret: EncryptedSecret): string {
    const decipher = createDecipheriv(
        ALGORITHM,
        loadMasterKey(secret.keyVersion),
        Buffer.from(secret.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(secret.ciphertext, 'base64')),
        decipher.final(),
    ]);
    return plaintext.toString('utf8');
}
