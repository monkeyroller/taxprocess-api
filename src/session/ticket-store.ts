import fs from 'node:fs';
import type {ArcaAuth, ArcaEnvironment, ServiceIdValue} from '../arca/index.js';
import {env} from '../config/env.js';

/** A WSAA ticket as minted by core and injected into a renewal re-send. */
export interface InjectedTicket {
    readonly token: string;
    readonly sign: string;
    /** ISO-8601 expiration timestamp (from the WSAA ticket). */
    readonly expiration: string;
}

/**
 * Raised when no valid ticket is cached for `(cuit, service, environment)`. The HTTP layer maps this
 * to `409 TICKET_REQUIRED`; core then mints a ticket and re-sends the same request with it attached.
 */
export class TicketRequiredError extends Error {
    constructor(
        readonly cuit: number,
        readonly service: ServiceIdValue,
        readonly environment: ArcaEnvironment,
    ) {
        super(`TICKET_REQUIRED for cuit=${cuit} service=${service} env=${environment}`);
        this.name = 'TicketRequiredError';
    }
}

interface CacheEntry {
    readonly token: string;
    readonly sign: string;
    readonly cuit: number;
    /** Epoch ms when the ticket expires. */
    readonly expiresAt: number;
}

/** Refresh a ticket slightly before its true expiry to tolerate clock skew and in-flight latency. */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

/**
 * Cache of WSAA tickets, keyed by `(environment, cuit, service)`. This service owns the cache but
 * never mints: tickets arrive from core on a renewal re-send (`put`), are served until near expiry
 * (`getValid`), and a miss surfaces as {@link TicketRequiredError} (`resolve`).
 *
 * Persistence is best-effort via `ARCA_TICKET_CACHE_PATH` so injected tickets survive restarts (an
 * empty/cold cache simply triggers another `TICKET_REQUIRED`). A shared Redis backing for horizontal
 * scale is deferred; no cross-node lock is needed here since core serializes minting.
 */
export class TicketStore {
    private readonly cache = new Map<string, CacheEntry>();

    constructor(private readonly cachePath: string | undefined = env.ticketCachePath) {
        this.loadFromFile();
    }

    private keyFor(cuit: number, service: ServiceIdValue, environment: ArcaEnvironment): string {
        return `${environment}:${cuit}:${service}`;
    }

    /** Stores a core-injected ticket and returns the {@link ArcaAuth} ready for an SDK call. */
    put(
        cuit: number,
        service: ServiceIdValue,
        environment: ArcaEnvironment,
        ticket: InjectedTicket,
    ): ArcaAuth {
        const expiresAt = new Date(ticket.expiration).getTime();
        if (Number.isNaN(expiresAt)) {
            throw new Error(`Injected ticket has an invalid expiration: "${ticket.expiration}"`);
        }
        this.cache.set(this.keyFor(cuit, service, environment), {
            token: ticket.token,
            sign: ticket.sign,
            cuit,
            expiresAt,
        });
        this.saveToFile();
        return {token: ticket.token, sign: ticket.sign, cuit};
    }

    /** Returns a cached, still-valid {@link ArcaAuth}, or `undefined` if missing/expired. */
    getValid(cuit: number, service: ServiceIdValue, environment: ArcaEnvironment): ArcaAuth | undefined {
        const key = this.keyFor(cuit, service, environment);
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }
        if (entry.expiresAt - Date.now() <= EXPIRY_MARGIN_MS) {
            this.cache.delete(key);
            return undefined;
        }
        return {token: entry.token, sign: entry.sign, cuit: entry.cuit};
    }

    /**
     * Resolves an {@link ArcaAuth} for a call: uses `injected` (a core re-send) if present, else a valid
     * cached ticket, else throws {@link TicketRequiredError} so core can mint and re-send.
     */
    resolve(
        cuit: number,
        service: ServiceIdValue,
        environment: ArcaEnvironment,
        injected?: InjectedTicket,
    ): ArcaAuth {
        if (injected) {
            return this.put(cuit, service, environment, injected);
        }
        const cached = this.getValid(cuit, service, environment);
        if (cached) {
            return cached;
        }
        throw new TicketRequiredError(cuit, service, environment);
    }

    /** Loads persisted, non-expired entries into the in-memory cache. Best-effort. */
    private loadFromFile(): void {
        if (this.cachePath === undefined) {
            return;
        }
        try {
            const raw = fs.readFileSync(this.cachePath, 'utf8');
            const stored = JSON.parse(raw) as Record<string, CacheEntry>;
            const now = Date.now();
            for (const [key, entry] of Object.entries(stored)) {
                if (entry.expiresAt - now > EXPIRY_MARGIN_MS) {
                    this.cache.set(key, entry);
                }
            }
        } catch {
            // No readable cache file — start empty.
        }
    }

    /** Best-effort persist of the current cache. */
    private saveToFile(): void {
        if (this.cachePath === undefined) {
            return;
        }
        try {
            const record: Record<string, CacheEntry> = Object.fromEntries(this.cache);
            fs.writeFileSync(this.cachePath, JSON.stringify(record, null, 2));
        } catch {
            // Persistence is best-effort; fall back to in-memory only.
        }
    }
}

/** Long-lived singleton — the shared ticket cache for the process. */
export const ticketStore = new TicketStore();
