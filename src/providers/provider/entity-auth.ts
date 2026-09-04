import type {GenericEnvironment} from './environment.js';

/**
 * Issuer credentials — the certificate and already-decrypted private key. Attached by core only when it
 * re-sends after a `CREDENTIALS_REQUIRED`; held in memory to mint a ticket, never persisted.
 */
export interface IssuerCredentials {
    readonly certPem: string;
    readonly keyPem: string;
}

/**
 * The entity/issuer block on every issuing call. `issuerTaxId` is the issuing party's canonical tax
 * identifier, its type implied by `entityCode`, and is the ticket-cache partition. First requests carry
 * identity only; `credentials` appears on the `CREDENTIALS_REQUIRED` re-send.
 */
export interface EntityAuthBlock {
    readonly entityCode: string;
    readonly issuerTaxId: string;
    readonly environment: GenericEnvironment;
    readonly credentials?: IssuerCredentials;
    /**
     * Delegated authorization (AR: representación). When `true`, `issuerTaxId` is the represented taxpayer
     * and this service signs with its own platform certificate, so `credentials` is ignored and no
     * `CREDENTIALS_REQUIRED` handshake occurs. Omitted or `false` is the tenant-certificate flow.
     *
     * The represented taxpayer must have delegated the web service to our CUIT out of band; this service
     * keeps no allow-list of who has.
     */
    readonly delegated?: boolean;
}
