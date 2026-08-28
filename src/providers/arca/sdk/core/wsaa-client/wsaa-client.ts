import crypto from 'node:crypto';
import fs from 'node:fs';
import forge from 'node-forge';
import {SoapClient} from '../soap-client/soap-client.js';
import {ArcaAuthError} from '../errors.js';
import {ENDPOINTS, Namespaces} from '../constants.js';
import type {AccessTicket} from '../types.js';
import type {ArcaConfig} from '../arca-config.js';

/**
 * WSAA (Web Service de Autenticación y Autorización) client.
 *
 * Signs a Login Ticket Request (TRA) as a CMS/PKCS#7 SignedData with the issuer's certificate,
 * exchanges it via `loginCms` for a Token + Sign, and caches the resulting access ticket
 * per `(ticketOwnerKey, serviceId)` — ARCA issues a distinct ticket per web service, and the cache
 * key includes the owner so tickets never cross tenants/companies. Concurrent logins for the same
 * key are de-duplicated into a single in-flight request.
 *
 * This client is meant to be a long-lived singleton so the ~12h ticket cache actually pays off.
 */

const TICKET_TTL_MINUTES = 720; // ARCA tickets are valid ~12h
const EXPIRY_MARGIN_MS = 2 * 60 * 1000; // refresh 2 min before expiry
const GENERATION_BACKDATE_MS = 5 * 60 * 1000; // guard against clock skew vs. ARCA

/** Serialized form of a cached ticket, as persisted to disk. */
interface StoredTicket {
    token: string;
    sign: string;
    expirationTime: string;
}

export class WsaaClient {
    private readonly cache = new Map<string, AccessTicket>();
    private readonly pending = new Map<string, Promise<AccessTicket>>();

    /**
     * Optional file path for cross-restart ticket persistence. WSAA refuses to issue a new ticket
     * while a prior one is still valid (`coe.alreadyAuthenticated`), so an in-memory-only cache breaks
     * on every process restart. When a path is supplied (the app passes `env.ticketCachePath`, sourced
     * from `ARCA_TICKET_CACHE_PATH`), tickets survive restarts; when omitted, the cache is in-memory only.
     */
    constructor(
        private readonly soap: SoapClient,
        private readonly cachePath?: string,
    ) {}

    /** Returns a valid access ticket for `serviceId`, logging in via WSAA only when needed. */
    async getAccessTicket(config: ArcaConfig, serviceId: string): Promise<AccessTicket> {
        const cacheKey = `${config.ticketOwnerKey}:${serviceId}`;

        const cached = this.cache.get(cacheKey) ?? this.loadFromFile(cacheKey);
        if (cached && cached.expirationTime.getTime() - Date.now() > EXPIRY_MARGIN_MS) {
            this.cache.set(cacheKey, cached);
            return cached;
        }

        const inFlight = this.pending.get(cacheKey);
        if (inFlight) {
            return inFlight;
        }

        const login = this.login(config, serviceId)
            .then((ticket) => {
                this.cache.set(cacheKey, ticket);
                this.saveToFile(cacheKey, ticket);
                return ticket;
            })
            .finally(() => {
                this.pending.delete(cacheKey);
            });

        this.pending.set(cacheKey, login);
        return login;
    }

    /**
     * Returns a cached, still-valid ticket for `(ticketOwnerKey, serviceId)` WITHOUT logging in — used
     * to serve a request that carries no credentials. Returns undefined on a miss so the caller can ask
     * the credential holder to re-send credentials.
     */
    peekAccessTicket(ticketOwnerKey: string, serviceId: string): AccessTicket | undefined {
        const cacheKey = `${ticketOwnerKey}:${serviceId}`;
        const cached = this.cache.get(cacheKey) ?? this.loadFromFile(cacheKey);
        if (cached && cached.expirationTime.getTime() - Date.now() > EXPIRY_MARGIN_MS) {
            this.cache.set(cacheKey, cached);
            return cached;
        }
        return undefined;
    }

    /** Reads a persisted ticket for `cacheKey`, or undefined if none/unreadable. */
    private loadFromFile(cacheKey: string): AccessTicket | undefined {
        if (!this.cachePath) {
            return undefined;
        }
        try {
            const all = JSON.parse(fs.readFileSync(this.cachePath, 'utf8')) as Record<string, StoredTicket>;
            const stored = all[cacheKey];
            if (!stored) {
                return undefined;
            }
            return {token: stored.token, sign: stored.sign, expirationTime: new Date(stored.expirationTime)};
        } catch {
            return undefined;
        }
    }

    /**
     * Best-effort persist of a ticket for `cacheKey` (re-read → merge → write). The whole read-modify-write
     * is synchronous, so within this process it is a serial critical section — no two concurrent logins can
     * interleave and drop each other's entry. The write itself is serialized atomically: we write a
     * per-pid temp file and `rename` it over the target (an atomic swap on the same filesystem), so a crash
     * mid-write — or a second process sharing this cache file — can never observe or leave a torn file.
     */
    private saveToFile(cacheKey: string, ticket: AccessTicket): void {
        if (!this.cachePath) {
            return;
        }
        try {
            let all: Record<string, StoredTicket> = {};
            try {
                all = JSON.parse(fs.readFileSync(this.cachePath, 'utf8')) as Record<string, StoredTicket>;
            } catch {
                // no existing file — start fresh
            }
            all[cacheKey] = {
                token: ticket.token,
                sign: ticket.sign,
                expirationTime: ticket.expirationTime.toISOString(),
            };
            const tmpPath = `${this.cachePath}.${process.pid}.tmp`;
            fs.writeFileSync(tmpPath, JSON.stringify(all, null, 2));
            fs.renameSync(tmpPath, this.cachePath);
        } catch {
            // persistence is best-effort; fall back to in-memory only
        }
    }

    /**
     * Clears cached tickets from memory AND the persisted file, so a ticket evicted after ARCA rejected it
     * cannot resurrect from disk on the next {@link peekAccessTicket}. Scope widens as arguments are
     * omitted: `(owner, serviceId)` clears exactly that ticket, `(owner)` every service under that owner,
     * `()` the whole cache.
     *
     * Prefer the two-argument form for a rejection: ARCA binds a ticket to `(certificate, service)` and
     * refuses to re-issue one while a prior ticket is still valid (`coe.alreadyAuthenticated`), so dropping
     * the *other* services' still-good tickets would leave them unmintable — and unrecoverable, the file
     * copy being purged too — until they expire (~12h).
     */
    clearCache(ticketOwnerKey?: string, serviceId?: string): void {
        if (ticketOwnerKey === undefined) {
            this.cache.clear();
        } else if (serviceId !== undefined) {
            this.cache.delete(`${ticketOwnerKey}:${serviceId}`);
        } else {
            for (const key of this.cache.keys()) {
                if (key.startsWith(`${ticketOwnerKey}:`)) {
                    this.cache.delete(key);
                }
            }
        }
        this.removeFromFile(ticketOwnerKey, serviceId);
    }

    /**
     * Best-effort removal of persisted tickets, matching {@link clearCache}'s scope. Mirrors
     * {@link saveToFile}'s atomic temp-file + rename so a concurrent reader or a shared cache file never
     * observes a torn write. A missing/unreadable file is a no-op.
     */
    private removeFromFile(ticketOwnerKey?: string, serviceId?: string): void {
        if (!this.cachePath) {
            return;
        }
        const matches = (key: string): boolean => {
            if (ticketOwnerKey === undefined) {
                return true;
            }
            return serviceId === undefined ? key.startsWith(`${ticketOwnerKey}:`) : key === `${ticketOwnerKey}:${serviceId}`;
        };
        try {
            const all = JSON.parse(fs.readFileSync(this.cachePath, 'utf8')) as Record<string, StoredTicket>;
            let changed = false;
            for (const key of Object.keys(all)) {
                if (matches(key)) {
                    delete all[key];
                    changed = true;
                }
            }
            if (!changed) {
                return;
            }
            const tmpPath = `${this.cachePath}.${process.pid}.tmp`;
            fs.writeFileSync(tmpPath, JSON.stringify(all, null, 2));
            fs.renameSync(tmpPath, this.cachePath);
        } catch {
            // best-effort: no file yet, or unreadable — nothing to purge
        }
    }

    private async login(config: ArcaConfig, serviceId: string): Promise<AccessTicket> {
        const tra = this.buildLoginTicketRequest(serviceId);
        const signedCms = this.signLoginTicketRequest(tra, config.certPem, config.keyPem);
        const endpoint = ENDPOINTS[config.environment].wsaa;

        // WSAA (an Axis service) expects an empty SOAPAction.
        let response: Record<string, unknown>;
        try {
            response = await this.soap.call(
                endpoint,
                Namespaces.WSAA,
                'loginCms',
                {in0: signedCms},
                {soapAction: ''},
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/alreadyAuthenticated|ya posee un TA/i.test(message)) {
                throw new ArcaAuthError(
                    'WSAA_TICKET_STILL_VALID: a valid access ticket already exists for this ' +
                        'certificate + service and cannot be re-requested until it expires (~12h). ' +
                        'Set ARCA_TICKET_CACHE_PATH so tickets persist across restarts, or wait for expiry.',
                );
            }
            throw error;
        }
        const loginCmsReturn = response.loginCmsReturn;
        if (typeof loginCmsReturn !== 'string' || loginCmsReturn.length === 0) {
            throw new ArcaAuthError('WSAA returned an empty loginCmsReturn');
        }
        return this.parseAccessTicket(loginCmsReturn);
    }

    /** Builds the TRA XML. `generationTime` is backdated to tolerate clock skew against ARCA. */
    private buildLoginTicketRequest(serviceId: string): string {
        const now = Date.now();
        const generationTime = new Date(now - GENERATION_BACKDATE_MS).toISOString();
        const expirationTime = new Date(now + TICKET_TTL_MINUTES * 60 * 1000).toISOString();
        const uniqueId = Math.floor(now / 1000);
        return (
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<loginTicketRequest version="1.0">' +
            '<header>' +
            `<uniqueId>${uniqueId}</uniqueId>` +
            `<generationTime>${generationTime}</generationTime>` +
            `<expirationTime>${expirationTime}</expirationTime>` +
            '</header>' +
            `<service>${serviceId}</service>` +
            '</loginTicketRequest>'
        );
    }

    /** CMS/PKCS#7 SignedData (SHA-256) over the TRA, DER-encoded and base64'd — the `loginCms` input. */
    private signLoginTicketRequest(tra: string, certPem: string, keyPem: string): string {
        try {
            const certificate = forge.pki.certificateFromPem(certPem);
            // node-forge's privateKeyFromPem only reads PKCS#1; normalize any key (incl. PKCS#8)
            // to PKCS#1 via Node crypto first so PKCS#8 keys sign correctly too.
            const pkcs1KeyPem = crypto.createPrivateKey(keyPem).export({type: 'pkcs1', format: 'pem'}).toString();
            const privateKey = forge.pki.privateKeyFromPem(pkcs1KeyPem);

            const p7 = forge.pkcs7.createSignedData();
            p7.content = forge.util.createBuffer(tra, 'utf8');
            p7.addCertificate(certificate);
            p7.addSigner({
                key: privateKey,
                certificate,
                digestAlgorithm: forge.pki.oids.sha256,
                authenticatedAttributes: [
                    {type: forge.pki.oids.contentType, value: forge.pki.oids.data},
                    {type: forge.pki.oids.messageDigest},
                    {type: forge.pki.oids.signingTime},
                ],
            });
            p7.sign();

            const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
            return forge.util.encode64(der);
        } catch (error) {
            throw new ArcaAuthError(`Failed to sign WSAA login ticket: ${(error as Error).message ?? String(error)}`);
        }
    }

    /** Re-parses the (unescaped) ticket XML nested inside the WSAA response into an {@link AccessTicket}. */
    private parseAccessTicket(loginTicketResponseXml: string): AccessTicket {
        const parsed = this.soap.parseXmlString(loginTicketResponseXml) as Record<string, any>;
        const response = parsed.loginTicketResponse;
        const credentials = response?.credentials;
        const token = credentials?.token;
        const sign = credentials?.sign;
        if (!token || !sign) {
            throw new ArcaAuthError('WSAA login response is missing token/sign');
        }
        const rawExpiration = response?.header?.expirationTime;
        const expirationTime = rawExpiration
            ? new Date(String(rawExpiration))
            : new Date(Date.now() + TICKET_TTL_MINUTES * 60 * 1000);
        return {token: String(token), sign: String(sign), expirationTime};
    }
}
