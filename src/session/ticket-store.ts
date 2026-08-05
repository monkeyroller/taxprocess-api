import type {ArcaAuth, ArcaEnvironment, ServiceIdValue} from '../arca/index.js';

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
 * In-memory cache of WSAA tickets, keyed by `(environment, cuit, service)`. This service owns the
 * cache but never mints: tickets arrive from core on a renewal re-send (`put`), are served until near
 * expiry (`getValid`), and a miss surfaces as {@link TicketRequiredError} (`resolve`).
 *
 * SKELETON: in-memory only. Persistence (survive restarts) and a shared Redis backing for horizontal
 * scale are deferred — a lost/cold cache simply triggers another `TICKET_REQUIRED`, and core
 * serializes minting, so no cross-node lock is required here.
 */
export class TicketStore {
    private readonly cache = new Map<string, CacheEntry>();

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
}

/** Long-lived singleton — the shared ticket cache for the process. */
export const ticketStore = new TicketStore();
