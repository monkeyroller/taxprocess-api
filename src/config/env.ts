import 'dotenv/config';

/**
 * Typed, frozen application configuration. `process.env` is read exactly once, here; the rest of the
 * service depends on {@link env} and never touches `process.env` directly. Invalid values fail fast at
 * import time (i.e. at boot).
 *
 * This service holds NO secrets: there is deliberately no `ARCA_MASTER_KEY` and no outbound core URL —
 * the private key + credential store live in `webprocess-api`, and core always initiates requests.
 */
export interface AppConfig {
    readonly port: number;
    readonly nodeEnv: string;
    readonly corsOrigin: string;
    /** WSAA ticket cache file path (dev). Unset ⇒ in-memory cache only. */
    readonly ticketCachePath: string | undefined;
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
});
