import {encryptSecret, decryptSecret, CURRENT_KEY_VERSION} from './key-crypto.js';

describe('key-crypto (AES-256-GCM)', () => {
    const originalKey = process.env.ARCA_MASTER_KEY;

    beforeAll(() => {
        // Deterministic 32-byte key for the test run.
        process.env.ARCA_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    });

    afterAll(() => {
        process.env.ARCA_MASTER_KEY = originalKey;
    });

    it('round-trips a secret and stamps the current key version', () => {
        const plaintext = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';
        const encrypted = encryptSecret(plaintext);

        expect(encrypted.keyVersion).toBe(CURRENT_KEY_VERSION);
        expect(encrypted.ciphertext).not.toContain('BEGIN');
        expect(decryptSecret(encrypted)).toBe(plaintext);
    });

    it('produces a distinct IV/ciphertext each call', () => {
        const a = encryptSecret('same');
        const b = encryptSecret('same');
        expect(a.iv).not.toBe(b.iv);
        expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it('rejects a tampered ciphertext (auth tag fails)', () => {
        const encrypted = encryptSecret('secret');
        const tamperedBytes = Buffer.from(encrypted.ciphertext, 'base64');
        tamperedBytes[0] ^= 0xff;
        const tampered = {...encrypted, ciphertext: tamperedBytes.toString('base64')};
        expect(() => decryptSecret(tampered)).toThrow();
    });

    it('throws when the master key is missing', () => {
        const saved = process.env.ARCA_MASTER_KEY;
        delete process.env.ARCA_MASTER_KEY;
        try {
            expect(() => encryptSecret('x')).toThrow(/ARCA_MASTER_KEY/);
        } finally {
            process.env.ARCA_MASTER_KEY = saved;
        }
    });
});
