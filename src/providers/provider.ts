import type {
    NeutralAuthorizationResultDto,
    TaxpayerResultDto,
} from '../http/dto/neutral-result.dto.js';

/**
 * Provider abstraction for the general tax service. Each tax entity (ARCA now; Chile SII, Mexico SAT
 * later) is a {@link TaxEntityProvider} registered under an entity code. Controllers dispatch on the
 * request's `entityCode` and speak only this neutral vocabulary — every entity-specific detail
 * (id→real-code mapping, credential validation, WSAA/QR/CAE, environment naming) lives inside the
 * provider.
 *
 * Modeled as an abstract class (mirroring the SDK's `*.service.base.ts` convention) so shared
 * template-method flow can be hoisted here as more entities land; today it is a pure contract.
 */

/** Generic environment selector. Providers map this to their own naming (AR: produccion/homologacion). */
export type GenericEnvironment = 'production' | 'testing';

export const GENERIC_ENVIRONMENTS = ['production', 'testing'] as const;

/**
 * Issuer credentials — the certificate + already-decrypted private key. Attached by core ONLY when it
 * re-sends after a `CREDENTIALS_REQUIRED`; held in memory only to mint a ticket, never persisted.
 */
export interface IssuerCredentials {
    readonly certPem: string;
    readonly keyPem: string;
}

/**
 * The entity/issuer block on every issuing call. `issuerTaxId` is the issuing party's single canonical
 * tax identifier (AR: CUIT; type is implied by `entityCode`), the ticket-cache partition. First requests
 * carry identity only; `credentials` appears on the `CREDENTIALS_REQUIRED` re-send.
 */
export interface EntityAuthBlock {
    readonly entityCode: string;
    readonly issuerTaxId: string;
    readonly environment: GenericEnvironment;
    readonly credentials?: IssuerCredentials;
}

/** ARCA `Concepto` analogue: 1 = goods, 2 = services, 3 = both. Kept in the neutral invoice. */
export type NeutralInvoiceConcept = 1 | 2 | 3;

/** One taxed line: net (base) + tax amount at a given rate. */
export interface NeutralInvoiceLine {
    readonly netAmount: number;
    readonly taxRatePercent: number;
    readonly taxAmount: number;
}

/** The invoice receiver, identified by a per-entity identification type + number. */
export interface NeutralInvoiceReceiver {
    readonly identificationTypeId: number;
    readonly identificationNumber: string;
    readonly fiscalConditionId: number;
}

/** Optional invoice-level totals not derivable from the taxed lines. */
export interface NeutralInvoiceTotals {
    readonly untaxed?: number;
    readonly exempt?: number;
    readonly perceptions?: number;
}

/**
 * A neutral invoice carrying core's own generic ids (`documentTypeId`, `receiver.identificationTypeId`,
 * `receiver.fiscalConditionId`). The provider maps these to the entity's real codes.
 */
export interface NeutralInvoice {
    readonly documentTypeId: number;
    readonly concept: NeutralInvoiceConcept;
    readonly salesPointNumber: number;
    readonly receiver: NeutralInvoiceReceiver;
    readonly currencyIso: string;
    readonly currencyRate: number;
    readonly issueDate: string;
    readonly lines: ReadonlyArray<NeutralInvoiceLine>;
    readonly totals?: NeutralInvoiceTotals;
    readonly serviceDateFrom?: string;
    readonly serviceDateTo?: string;
    readonly paymentDueDate?: string;
}

/** The neutral authorization result (reuses the country-agnostic result DTO). */
export type TaxAuthorizationResult = NeutralAuthorizationResultDto;

/** Neutral taxpayer-registry lookup result (reuses the country-agnostic result DTO). */
export type TaxpayerResult = TaxpayerResultDto;

/** Neutral authority health result. */
export interface AuthorityStatusResult {
    readonly appServer: string;
    readonly dbServer: string;
    readonly authServer: string;
}

/** A single structured validation problem returned by {@link TaxEntityProvider.validateCredentials}. */
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
}

/**
 * A tax entity provider — the sole owner of one entity's specifics. Registered under an entity code in
 * {@link file://./registry.ts}.
 */
export abstract class TaxEntityProvider {
    abstract validateCredentials(input: ValidateCredentialsInput): Promise<CredentialValidationResult>;
    abstract authorizeInvoice(entity: EntityAuthBlock, invoice: NeutralInvoice): Promise<TaxAuthorizationResult>;
    abstract lastAuthorized(entity: EntityAuthBlock, salesPointNumber: number, documentTypeId: number): Promise<{number: number}>;
    abstract queryVoucher(entity: EntityAuthBlock, salesPointNumber: number, documentTypeId: number, voucherNumber: number): Promise<TaxAuthorizationResult>;
    abstract authorityStatus(environment: GenericEnvironment): Promise<AuthorityStatusResult>;
    abstract lookupTaxpayer(entity: EntityAuthBlock, taxpayerId: string, level?: string): Promise<TaxpayerResult>;
}

/** Raised when a request names an entity code with no registered provider. Maps to `400`. */
export class UnknownEntityError extends Error {
    constructor(readonly entityCode: string) {
        super(`Unknown entity code: "${entityCode}"`);
        this.name = 'UnknownEntityError';
    }
}
