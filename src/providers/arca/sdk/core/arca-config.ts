import type {ArcaEnvironment} from './constants.js';

/**
 * Fully-resolved per-issuer configuration handed to the SDK. Built by the application layer from a
 * decrypted credential row; the SDK itself never touches the database or the credential store.
 */
export interface ArcaConfig {
    /** Issuer CUIT (digits only) the certificate represents. */
    cuit: number;
    /** X.509 certificate in PEM format. */
    certPem: string;
    /** RSA private key in PEM format — already decrypted, kept in memory only. */
    keyPem: string;
    /** Selects homologación vs. producción endpoints. */
    environment: ArcaEnvironment;
    /**
     * Opaque scoping key for the WSAA ticket cache so tickets never cross tenants or companies.
     * The application layer sets this to `${tenantId}:${cuit}`.
     */
    ticketOwnerKey: string;
}
