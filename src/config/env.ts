import 'dotenv/config';

/**
 * Typed, frozen application configuration. `process.env` is read exactly once, here; the rest of the
 * service depends on {@link env} and never touches `process.env` directly. Invalid values fail fast at
 * import time (i.e. at boot).
 *
 * This service stores NO **tenant** secrets at rest: there is deliberately no `ARCA_MASTER_KEY` and no
 * credential store — the encrypted per-tenant credentials live in `webprocess-api`. Core sends the
 * decrypted key on the `CREDENTIALS_REQUIRED` handshake; this service uses it only in memory to mint a
 * ticket, then keeps only the ticket. Core always initiates (no outbound core URL here).
 *
 * The single, bounded exception is the **delegate certificate** ({@link ArcaDelegateConfig}): one
 * platform credential (our own organization's ARCA cert) supplied at deploy time via a secret-managed
 * file path or inline PEM. It is NOT tenant data and NOT in the credential store — it lets this service
 * act as an ARCA *delegate* (computador) and issue on behalf of taxpayers that delegated the web service
 * to us. Mount it from a secret manager; it is loaded once and held in memory only.
 */
export interface AppConfig {
    readonly port: number;
    readonly nodeEnv: string;
    readonly corsOrigin: string;
    /** WSAA ticket cache file path (dev). Unset ⇒ in-memory cache only. */
    readonly ticketCachePath: string | undefined;
    /** Delegate (representación) certificate sources per environment. See {@link ArcaDelegateConfig}. */
    readonly arcaDelegate: ArcaDelegateConfig;
}

/**
 * Raw delegate-certificate sources for one ARCA environment. Inline PEM wins over a file path when both
 * are set. All optional — an environment with neither cert nor key configured simply has delegation
 * disabled. The PEMs are read/validated lazily by the delegate credential store, not here.
 */
export interface DelegateCertConfig {
    readonly certPem: string | undefined;
    readonly certPath: string | undefined;
    readonly keyPem: string | undefined;
    readonly keyPath: string | undefined;
}

/**
 * The delegate certificate configuration, one entry per generic environment (ARCA production and testing
 * require different certificates). `expectedTaxId`, when set, is a boot-time cross-check: the loaded
 * certificate's CUIT must equal it, or boot fails — a guard against deploying the wrong cert.
 */
export interface ArcaDelegateConfig {
    readonly production: DelegateCertConfig;
    readonly testing: DelegateCertConfig;
    readonly expectedTaxId: string | undefined;
}

function readDelegateCertConfig(suffix: string): DelegateCertConfig {
    return {
        certPem: readOptional(`ARCA_DELEGATE_CERT_PEM_${suffix}`),
        certPath: readOptional(`ARCA_DELEGATE_CERT_PATH_${suffix}`),
        keyPem: readOptional(`ARCA_DELEGATE_KEY_PEM_${suffix}`),
        keyPath: readOptional(`ARCA_DELEGATE_KEY_PATH_${suffix}`),
    };
}

function readString(name: string, fallback: string): string {
    const value = process.env[name];
    return value === undefined || value === '' ? fallback : value;
}

function readOptional(name: string): string | undefined {
    const value = process.env[name];
    return value === undefined || value === '' ? undefined : value;
}

function readPort(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
        return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
        throw new Error(`Invalid ${name}: "${raw}" (expected an integer port in 1..65535)`);
    }
    return parsed;
}

export const env: AppConfig = Object.freeze({
    port: readPort('PORT', 4101),
    nodeEnv: readString('NODE_ENV', 'development'),
    corsOrigin: readString('CORS_ORIGIN', 'http://localhost:4200'),
    ticketCachePath: readOptional('ARCA_TICKET_CACHE_PATH'),
    arcaDelegate: {
        production: readDelegateCertConfig('PRODUCTION'),
        testing: readDelegateCertConfig('TESTING'),
        expectedTaxId: readOptional('ARCA_DELEGATE_TAXID'),
    },
});
