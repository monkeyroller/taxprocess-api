import type {
    NeutralAuthorizationResultDto,
    NextNumbersResultDto,
    PointsOfSaleResultDto,
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
    readonly identificationTypeCode: number;
    readonly identificationNumber: string;
    readonly fiscalConditionCode: number;
}

/** Optional invoice-level totals not derivable from the taxed lines. */
export interface NeutralInvoiceTotals {
    readonly untaxed?: number;
    readonly exempt?: number;
    readonly perceptions?: number;
}

/**
 * A neutral invoice carrying provider-agnostic canonical codes (`documentTypeCode`,
 * `receiver.identificationTypeCode`, `receiver.fiscalConditionCode`). The provider maps these to the
 * entity's real codes.
 */
export interface NeutralInvoice {
    readonly documentTypeCode: number;
    readonly concept: NeutralInvoiceConcept;
    readonly pointOfSaleNumber: number;
    /** Exact voucher number to authorize (WSFEv1 CbteDesde). Core owns the number; the service never computes it. */
    readonly voucherNumberFrom: number;
    /** Exact voucher number to authorize (WSFEv1 CbteHasta). Single-voucher flow: equals voucherNumberFrom. */
    readonly voucherNumberTo: number;
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

/** Neutral list of the entity's registered points of sale (reuses the country-agnostic result DTO). */
export type PointsOfSaleResult = PointsOfSaleResultDto;

/** Neutral batch of next-expected voucher numbers, one per requested code (reuses the country-agnostic DTO). */
export type NextNumbersResult = NextNumbersResultDto;

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
    /**
     * The owning company's registered tax id (AR: CUIT) that the certificate must belong to. Sent by core
     * from `org.company.identificationNumber`. Formatting is not significant — the provider canonicalizes
     * it (and the cert's) to 11 digits before matching. Required — core always sends it.
     */
    readonly expectedTaxId: string;
}

/**
 * A tax entity provider — the sole owner of one entity's specifics. Registered under an entity code in
 * {@link file://./registry.ts}.
 */
export abstract class TaxEntityProvider {
    abstract validateCredentials(input: ValidateCredentialsInput): Promise<CredentialValidationResult>;
    abstract authorizeInvoice(entity: EntityAuthBlock, invoice: NeutralInvoice): Promise<TaxAuthorizationResult>;
    abstract lastAuthorized(entity: EntityAuthBlock, pointOfSaleNumber: number, documentTypeCode: number): Promise<{number: number}>;
    abstract nextNumbers(entity: EntityAuthBlock, pointOfSaleNumber: number, documentTypeCodes: ReadonlyArray<number>): Promise<NextNumbersResult>;
    abstract queryVoucher(entity: EntityAuthBlock, pointOfSaleNumber: number, documentTypeCode: number, voucherNumber: number): Promise<TaxAuthorizationResult>;
    abstract authorityStatus(environment: GenericEnvironment): Promise<AuthorityStatusResult>;
    abstract lookupTaxpayer(entity: EntityAuthBlock, taxpayerId: string, level?: string): Promise<TaxpayerResult>;
    abstract pointsOfSale(entity: EntityAuthBlock): Promise<PointsOfSaleResult>;
}

/** Raised when a request names an entity code with no registered provider. Maps to `400`. */
export class UnknownEntityError extends Error {
    constructor(readonly entityCode: string) {
        super(`Unknown entity code: "${entityCode}"`);
        this.name = 'UnknownEntityError';
    }
}

/**
 * Raised by {@link TaxEntityProvider.queryVoucher} when the authority has no record of the queried voucher —
 * it was never issued. Deliberately distinct from an authority transport/business failure (which stays a
 * `502`): a genuine not-found is a stable, deterministic outcome, not a transient error. Maps to
 * `404 VOUCHER_NOT_FOUND`.
 *
 * This is the exact signal core's orphan reconciliation depends on. A sale left PENDING after an authorize
 * whose response never persisted may be cleared and re-authorized **only** once the authority confirms the
 * voucher does not exist; any other query outcome (`502`, timeout) must keep the sale PENDING for a later
 * retry, never clear it — clearing on an ambiguous failure risks issuing a second fiscal document for a sale
 * that was in fact already authorized.
 */
export class VoucherNotFoundError extends Error {
    constructor(
        readonly entityCode: string,
        readonly pointOfSaleNumber: number,
        readonly documentTypeCode: number,
        readonly voucherNumber: number,
    ) {
        super(
            `No voucher ${voucherNumber} for point of sale ${pointOfSaleNumber}, document type ` +
                `${documentTypeCode} (entity "${entityCode}")`,
        );
        this.name = 'VoucherNotFoundError';
    }
}
