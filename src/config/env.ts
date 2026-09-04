import 'dotenv/config';

/**
 * Typed, frozen application configuration. `process.env` is read exactly once here, and invalid values fail
 * fast at import time.
 *
 * This service stores no tenant secrets at rest: the encrypted per-tenant credentials live in core, which
 * sends the decrypted key on the `CREDENTIALS_REQUIRED` handshake. This service uses it only in memory to
 * mint a ticket, then keeps only the ticket.
 *
 * The one exception is the delegate certificate — a single platform credential supplied at deploy time via a
 * secret-managed file path or inline PEM, which lets this service act as an ARCA delegate and issue on
 * behalf of taxpayers that delegated the web service to us. Loaded once and held in memory only.
 */
export interface AppConfig {
    readonly port: number;
    readonly nodeEnv: string;
    readonly corsOrigin: string;
    /** WSAA ticket cache file path. Unset leaves the cache in-memory only. */
    readonly ticketCachePath: string | undefined;
    /** Delegate certificate sources per environment. */
    readonly arcaDelegate: ArcaDelegateConfig;
}

/**
 * Raw delegate-certificate sources for one ARCA environment. Inline PEM wins over a file path when both are
 * set, and an environment with neither has delegation disabled. The PEMs are read and validated lazily by
 * the delegate credential store rather than here.
 */
export interface DelegateCertConfig {
    readonly certPem: string | undefined;
    readonly certPath: string | undefined;
    readonly keyPem: string | undefined;
    readonly keyPath: string | undefined;
}

/**
 * The delegate certificate configuration, one entry per environment, ARCA production and testing requiring
 * different certificates. `expectedTaxId`, when set, is a boot-time cross-check against deploying the wrong
 * cert: the loaded certificate's CUIT must equal it or boot fails.
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
