import crypto from 'node:crypto';
import forge from 'node-forge';
import {SoapClient} from '../soap-client/soap-client.js';
import {ArcaAuthError} from '../errors.js';
import {ENDPOINTS, Namespaces} from '../constants.js';
import type {AccessTicket} from '../types.js';
import type {ArcaConfig} from '../arca-config.js';
import {ExpiringCache} from '../../../../expiring-cache/expiring-cache.js';

/**
 * WSAA (Web Service de Autenticación y Autorización) client.
 *
 * Signs a Login Ticket Request as CMS/PKCS#7 SignedData with the issuer's certificate, exchanges it via
 * `loginCms` for a token and sign, and caches the resulting ticket per owner and service — ARCA issues a
 * distinct ticket per web service, and the owner in the key is what keeps tickets from crossing tenants.
 * Concurrent logins for one key are de-duplicated into a single request.
 *
 * Meant to be a long-lived singleton so the ~12h ticket cache pays off.
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
    private readonly tickets: ExpiringCache<AccessTicket, StoredTicket>;

    /**
     * `cachePath` gives cross-restart ticket persistence. WSAA refuses to issue a new ticket while a prior
     * one is still valid, so an in-memory-only cache breaks on every process restart.
     */
    constructor(
        private readonly soap: SoapClient,
        cachePath?: string,
    ) {
        // The caching itself is authority-agnostic and lives in `ExpiringCache`. What stays here is what
        // makes a ticket a ticket: the TRA, the CMS signature, WSAA's endpoint and its refusal to re-mint.
        //
        // `serialize`/`deserialize` pin a live on-disk format: changing it invalidates every persisted
        // ticket, and since WSAA will not re-mint while the old one is valid, a deploy that broke it would
        // take the till down for up to ~12h per certificate and service.
        this.tickets = new ExpiringCache<AccessTicket, StoredTicket>({
            cachePath,
            expiryMarginMs: EXPIRY_MARGIN_MS,
            expiresAt: (ticket) => ticket.expirationTime,
            serialize: (ticket) => ({
                token: ticket.token,
                sign: ticket.sign,
                expirationTime: ticket.expirationTime.toISOString(),
            }),
            deserialize: (stored) => ({
                token: stored.token,
                sign: stored.sign,
                expirationTime: new Date(stored.expirationTime),
            }),
        });
    }

    /** Returns a valid access ticket for `serviceId`, logging in via WSAA only when needed. */
    async getAccessTicket(config: ArcaConfig, serviceId: string): Promise<AccessTicket> {
        return this.tickets.getOrCreate(config.ticketOwnerKey, serviceId, () => this.login(config, serviceId));
    }

    /**
     * A cached, still-valid ticket without logging in, for a request that carries no credentials.
     * `undefined` on a miss, so the caller can ask the credential holder to re-send.
     */
    peekAccessTicket(ticketOwnerKey: string, serviceId: string): AccessTicket | undefined {
        return this.tickets.peek(ticketOwnerKey, serviceId);
    }

    /**
     * Clears cached tickets from memory and the persisted file, so one evicted after ARCA rejected it cannot
     * resurrect from disk. Widens as arguments are omitted: both name exactly that ticket, an owner alone
     * every service under it, neither the whole cache.
     *
     * Prefer the two-argument form for a rejection. ARCA binds a ticket to a certificate and service and
     * refuses to re-issue one while a prior ticket is valid, so dropping the other services' still-good
     * tickets leaves them unmintable — and unrecoverable, the file copy being purged too — for ~12h.
     */
    clearCache(ticketOwnerKey?: string, serviceId?: string): void {
        this.tickets.clear(ticketOwnerKey, serviceId);
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

    /** The TRA XML. `generationTime` is backdated to tolerate clock skew against ARCA. */
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
            // node-forge reads only PKCS#1, so any key is normalized to it via Node crypto first.
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

    /** Re-parses the unescaped ticket XML nested inside the WSAA response. */
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
