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
 * The coding systems an address on a neutral result may name — a **closed vocabulary shared by every
 * provider**, which is why it lives here and not inside one.
 *
 * A caller resolves an address level by matching the pair `(code, codeScheme)` against its own catalogs,
 * so these values are join keys rather than labels. Three rules follow from that and none of them are
 * cosmetic:
 *
 * - **Member values are the contract; member names are not** — the same rule the canonical code enums in
 *   `code-maps.ts` state. Adding a member is additive; changing an existing value is breaking.
 * - **Key-safe spelling** (`/^[A-Z0-9-]+$/`). A scheme that differed only by a space or a capital would
 *   not raise an error anywhere — it would match no row, and the caller's field would land `null`, which
 *   is precisely the outcome coding the address was meant to remove.
 * - **A token names one specific catalog, never a role.** `ISO-3166-1-ALPHA-2` and `ISO-3166-2` are
 *   separate members because ISO 3166-1 defines three codes for the same country (alpha-2 `AR`, alpha-3
 *   `ARG`, numeric `032`) and because a shared `ISO` would make country and region collide under
 *   pair-matching. By the same rule, a future provider registers `IBGE` or `INSEE` — not
 *   `NATIONAL-STATISTICS`, which two countries could both claim.
 */
export enum AddressCodeScheme {
    /** ISO 3166-1 alpha-2 country code (`"AR"`). The alpha-3 and numeric forms are a different scheme. */
    ISO_3166_1_ALPHA_2 = 'ISO-3166-1-ALPHA-2',
    /** ISO 3166-2 principal-subdivision code (`"AR-X"` — Córdoba). One code form, so no variant is named. */
    ISO_3166_2 = 'ISO-3166-2',
    /** INDEC's 8-digit localidad censal code (AR): provincia 2 + departamento 3 + localidad 3. */
    INDEC = 'INDEC',
}

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
    /**
     * Delegated authorization (AR: ARCA *representación*). When `true`, `issuerTaxId` is the
     * **representado** — the taxpayer the invoice is issued for — and this service signs with its **own**
     * platform certificate (configured per environment on the service), NOT a certificate for
     * `issuerTaxId`. `credentials` is ignored on a delegated request, and a delegated request never
     * triggers the `CREDENTIALS_REQUIRED` handshake. Omitted/`false` ⇒ the tenant-certificate flow
     * (certificate owner == `issuerTaxId`). The represented taxpayer must have delegated the web service
     * to our CUIT out of band; this service keeps no allow-list of who has.
     */
    readonly delegated?: boolean;
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

/** Which registry answered a taxpayer lookup, and therefore which fields the entries can carry. */
export type {TaxpayerDetail} from '../http/dto/neutral-result.dto.js';

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
    /**
     * Translates a failure from this provider's own vocabulary into a neutral one — normally a
     * {@link ProviderFault}. Anything already neutral (or unrecognized) must be returned unchanged, which is
     * what the default does.
     *
     * Every public method below runs its implementation through this, so a provider's native error class can
     * never reach the HTTP layer. That is the whole reason the mapper needs no `instanceof` against any
     * provider: the translation happens at the boundary the provider owns, on the way out.
     */
    protected translateFault(err: unknown): unknown {
        return err;
    }

    /**
     * Runs one provider operation, translating any native failure on the way out. `op()` is called *inside*
     * the `try`, so an implementation that throws synchronously — a code-map lookup rejecting an unknown
     * code before any I/O — is translated exactly like a rejected promise.
     */
    private async guarded<T>(op: () => Promise<T>): Promise<T> {
        try {
            return await op();
        } catch (err) {
            throw this.translateFault(err);
        }
    }

    /*
     * The public surface is final on purpose: each method is a thin guard around the `*Impl` hook a provider
     * implements. Subclasses override the hooks, never these — overriding a public method would skip the
     * translation and let an authority-specific error class escape to the wire.
     */

    validateCredentials(input: ValidateCredentialsInput): Promise<CredentialValidationResult> {
        return this.guarded(() => this.validateCredentialsImpl(input));
    }
    authorizeInvoice(entity: EntityAuthBlock, invoice: NeutralInvoice): Promise<TaxAuthorizationResult> {
        return this.guarded(() => this.authorizeInvoiceImpl(entity, invoice));
    }
    lastAuthorized(
        entity: EntityAuthBlock,
        pointOfSaleNumber: number,
        documentTypeCode: number,
    ): Promise<{number: number}> {
        return this.guarded(() => this.lastAuthorizedImpl(entity, pointOfSaleNumber, documentTypeCode));
    }
    nextNumbers(
        entity: EntityAuthBlock,
        pointOfSaleNumber: number,
        documentTypeCodes: ReadonlyArray<number>,
    ): Promise<NextNumbersResult> {
        return this.guarded(() => this.nextNumbersImpl(entity, pointOfSaleNumber, documentTypeCodes));
    }
    queryVoucher(
        entity: EntityAuthBlock,
        pointOfSaleNumber: number,
        documentTypeCode: number,
        voucherNumber: number,
    ): Promise<TaxAuthorizationResult> {
        return this.guarded(() =>
            this.queryVoucherImpl(entity, pointOfSaleNumber, documentTypeCode, voucherNumber),
        );
    }
    authorityStatus(environment: GenericEnvironment): Promise<AuthorityStatusResult> {
        return this.guarded(() => this.authorityStatusImpl(environment));
    }
    lookupTaxpayers(
        environment: GenericEnvironment,
        identificationTypeCode: number,
        identificationNumber: string,
    ): Promise<TaxpayerResult> {
        return this.guarded(() =>
            this.lookupTaxpayersImpl(environment, identificationTypeCode, identificationNumber),
        );
    }
    pointsOfSale(entity: EntityAuthBlock): Promise<PointsOfSaleResult> {
        return this.guarded(() => this.pointsOfSaleImpl(entity));
    }

    protected abstract validateCredentialsImpl(input: ValidateCredentialsInput): Promise<CredentialValidationResult>;
    protected abstract authorizeInvoiceImpl(entity: EntityAuthBlock, invoice: NeutralInvoice): Promise<TaxAuthorizationResult>;
    protected abstract lastAuthorizedImpl(entity: EntityAuthBlock, pointOfSaleNumber: number, documentTypeCode: number): Promise<{number: number}>;
    protected abstract nextNumbersImpl(entity: EntityAuthBlock, pointOfSaleNumber: number, documentTypeCodes: ReadonlyArray<number>): Promise<NextNumbersResult>;
    protected abstract queryVoucherImpl(entity: EntityAuthBlock, pointOfSaleNumber: number, documentTypeCode: number, voucherNumber: number): Promise<TaxAuthorizationResult>;
    protected abstract authorityStatusImpl(environment: GenericEnvironment): Promise<AuthorityStatusResult>;
    /**
     * Looks up whoever the authority's registry holds under `identificationNumber`, interpreting it
     * according to `identificationTypeCode` (the same canonical code an invoice receiver carries). The
     * provider decides which of the authority's registries can answer for that identification type, and
     * reports it back as the result's `detail`.
     *
     * Takes no issuer block: registry lookups are made under this service's own delegated identity, not a
     * tenant's certificate, so there is no `CREDENTIALS_REQUIRED` handshake. Returns a non-empty list —
     * an identity document can legitimately match several taxpayers — and raises
     * {@link TaxpayerNotFoundError} rather than an empty one.
     */
    protected abstract lookupTaxpayersImpl(
        environment: GenericEnvironment,
        identificationTypeCode: number,
        identificationNumber: string,
    ): Promise<TaxpayerResult>;
    protected abstract pointsOfSaleImpl(entity: EntityAuthBlock): Promise<PointsOfSaleResult>;
}

/**
 * What kind of failure a provider is reporting — the neutral half of the error contract.
 *
 * A category maps to exactly one HTTP status (`http/error-mapper.ts` owns that table and nothing else), so
 * this enumerates the *statuses the wire contract has*, not the vocabulary of any one authority. Providers
 * classify into it; only providers know which of their authority's failures belongs where.
 *
 * The split matters most across the three `502`s and the two `400`s: an authority that refused our
 * credential, one that rejected the business content, and one we could not reach are all "retry later" to a
 * caller but different things to an operator — while a rejection that is stable and caller-fixable
 * (`AUTHORITY_REJECTED`) must read as a `400`, because a `502` invites a retry that will fail identically.
 */
export type ProviderFaultCategory =
    /** Provider-side validation, before or instead of an authority call. → `400` */
    | 'VALIDATION'
    /** The authority rejected the request for a stable, caller-fixable reason. → `400` */
    | 'AUTHORITY_REJECTED'
    /** The authority refused our credential/token. → `502` */
    | 'AUTHORITY_AUTH'
    /** The authority rejected the request for a reason we have not classified. → `502` */
    | 'AUTHORITY_SERVICE'
    /** The authority could not be reached, or answered unintelligibly. → `502` */
    | 'AUTHORITY_TRANSPORT'
    /** A provider operation that exists but is not implemented yet. → `501` */
    | 'NOT_IMPLEMENTED'
    /** A provider failure that is neither the caller's fault nor the authority's. → `500` */
    | 'PROVIDER_INTERNAL';

/**
 * A provider failure, already translated out of its authority's vocabulary — the ONLY error shape the HTTP
 * layer needs to understand from a provider.
 *
 * `code` is the stable wire category the caller branches on, and the **provider authors it**: ARCA emits its
 * documented `ARCA_VALIDATION` / `ARCA_SERVICE` / `ARCA_AUTH` / `ARCA_SOAP` / `ARCA_ERROR` /
 * `RECEIVER_MATCHES_ISSUER` (CONTRACT §8), and a future entity emits its own. That is deliberate: the codes
 * are already entity-prefixed on the wire, so neutralizing them here would be a breaking contract change,
 * and inventing a second neutral code alongside them would give callers two things to branch on. `details`
 * is likewise provider-shaped (ARCA's `{code}` / `{arcaCode, arcaErrors}`) and travels verbatim.
 *
 * What the HTTP layer contributes is only the status, read from {@link category}. It therefore needs no
 * `instanceof` against any provider's error classes, and no table of any authority's codes.
 */
export class ProviderFault extends Error {
    constructor(
        readonly category: ProviderFaultCategory,
        readonly code: string,
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ProviderFault';
    }
}

/**
 * Raised when no valid ticket is cached for the issuer and the request carried no credentials. The HTTP
 * layer maps this to `409 CREDENTIALS_REQUIRED`; core then re-sends the same request with the issuer's
 * credentials attached, and the provider logs in to the authority and proceeds. Fields are reported in the
 * neutral vocabulary (`entityCode`, `issuerTaxId`, generic `environment`); `service` is the authority's own
 * web-service identifier, echoed as the opaque string the caller sees.
 *
 * Neutral rather than provider-local because the 409 handshake is a contract-level flow (CONTRACT §2), not
 * an ARCA detail: any entity whose credentials core holds encrypted goes through the same exchange.
 */
export class CredentialsRequiredError extends Error {
    constructor(
        readonly entityCode: string,
        readonly issuerTaxId: string,
        readonly service: string,
        readonly environment: GenericEnvironment,
    ) {
        super(
            `CREDENTIALS_REQUIRED for entity=${entityCode} issuerTaxId=${issuerTaxId} ` +
                `service=${service} env=${environment}`,
        );
        this.name = 'CredentialsRequiredError';
    }
}

/** Raised when a request names an entity code with no registered provider. Maps to `400`. */
export class UnknownEntityError extends Error {
    constructor(readonly entityCode: string) {
        super(`Unknown entity code: "${entityCode}"`);
        this.name = 'UnknownEntityError';
    }
}

/**
 * Raised on a `delegated` request when the authority reports that our delegate identity is not
 * authorized to act for `issuerTaxId` — i.e. the represented taxpayer has not delegated the web service
 * to our CUIT (AR: not linked in ARCA's *Administrador de Relaciones*). A deterministic, user-actionable
 * outcome (the user must grant the delegation), so it maps to a distinct `403 DELEGATION_NOT_AUTHORIZED`
 * rather than a generic authority failure (`502`) — mirroring why {@link VoucherNotFoundError} is a `404`.
 * The raw authority code + message ride in `details` so a genuine token fault is never masked as this.
 */
export class DelegationNotAuthorizedError extends Error {
    constructor(
        readonly delegateTaxId: string,
        readonly issuerTaxId: string,
        readonly authorityCode: string,
        readonly authorityMessage: string,
    ) {
        super(
            `Delegate ${delegateTaxId} is not authorized to issue for ${issuerTaxId}: grant the web ` +
                `service to ${delegateTaxId} (AR: ARCA "Administrador de Relaciones"). ` +
                `[authority ${authorityCode}] ${authorityMessage}`,
        );
        this.name = 'DelegationNotAuthorizedError';
    }
}

/**
 * Raised when a request sets `delegated: true` but this service has no valid delegate certificate
 * configured for that `environment` — a **server misconfiguration**, not a caller error. Maps to `500
 * DELEGATION_NOT_CONFIGURED`. `reason` distinguishes "none configured" from "configured but invalid".
 */
export class DelegationNotConfiguredError extends Error {
    constructor(
        readonly environment: GenericEnvironment,
        readonly reason: string,
    ) {
        super(`Delegation is not available for environment "${environment}": ${reason}`);
        this.name = 'DelegationNotConfiguredError';
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

/**
 * Raised by {@link TaxEntityProvider.lookupTaxpayers} when the authority's registry holds nobody under the
 * identifier — an unregistered tax id, or an identity document that matches no clave. Deliberately distinct
 * from an authority transport/business failure (which stays a `502`): like {@link VoucherNotFoundError},
 * this is a stable, deterministic outcome the caller can act on, so it maps to `404 TAXPAYER_NOT_FOUND`.
 *
 * Reported for both lookup routes so callers have one signal, which is also why a successful lookup never
 * returns an empty taxpayer list.
 */
export class TaxpayerNotFoundError extends Error {
    constructor(
        readonly entityCode: string,
        readonly identificationTypeCode: number,
        readonly identificationNumber: string,
        readonly authorityMessage?: string,
    ) {
        super(
            `No taxpayer registered under identification type ${identificationTypeCode} number ` +
                `${identificationNumber} (entity "${entityCode}")` +
                (authorityMessage === undefined ? '' : `: ${authorityMessage}`),
        );
        this.name = 'TaxpayerNotFoundError';
    }
}
