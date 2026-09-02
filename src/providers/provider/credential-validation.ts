import type {GenericEnvironment} from './environment.js';
import type {IssuerCredentials} from './entity-auth.js';

/** A single structured validation problem. */
export interface CredentialValidationError {
    readonly code: string;
    readonly message: string;
}

/** Result of credential validation: `{ ok: true }` or `{ ok: false, errors }`. */
export interface CredentialValidationResult {
    readonly ok: boolean;
    readonly errors?: ReadonlyArray<CredentialValidationError>;
}

/** Input to credential validation: the non-secret `configuration` blob + the secret `credentials`. */
export interface ValidateCredentialsInput {
    readonly environment: GenericEnvironment;
    readonly configuration: Record<string, unknown>;
    readonly credentials: IssuerCredentials;
    /**
     * The owning company's registered tax id (AR: CUIT) the certificate must belong to. Formatting is not
     * significant: the provider canonicalizes both sides before matching.
     */
    readonly expectedTaxId: string;
}
