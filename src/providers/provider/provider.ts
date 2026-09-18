import type {GenericEnvironment} from './environment.js';
import type {EntityAuthBlock} from './entity-auth.js';
import type {NeutralInvoice} from './neutral-invoice.js';
import type {
    AuthorityStatusResult,
    CreditInvoiceObligationResult,
    CurrencyRatesResult,
    LastAuthorizedResult,
    NextNumbersResult,
    PointsOfSaleResult,
    TaxAuthorizationResult,
    TaxpayerResult,
} from './neutral-results.js';
import type {CredentialValidationResult, ValidateCredentialsInput} from './credential-validation.js';
import type {WebService} from './web-service.js';

/**
 * Provider abstraction for the general tax service. Each tax entity is registered under an entity code;
 * controllers dispatch on the request's `entityCode` and speak only this neutral vocabulary, so every
 * entity-specific detail lives inside the provider.
 *
 * An abstract class rather than an interface so shared template-method flow can be hoisted here as more
 * entities land; today it is a pure contract.
 */

/** A tax entity provider — the sole owner of one entity's specifics. */
export abstract class TaxEntityProvider {
    /**
     * Translates a failure from this provider's own vocabulary into a neutral one. Anything already neutral
     * or unrecognized must be returned unchanged, which is what the default does.
     *
     * Every public method below runs its implementation through this, so a provider's native error class can
     * never reach the HTTP layer — which is why the mapper needs no `instanceof` against any provider.
     */
    protected translateFault(err: unknown): unknown {
        return err;
    }

    /**
     * Runs one provider operation, translating any native failure on the way out. `op()` is called inside the
     * `try`, so an implementation that throws synchronously is translated like a rejected promise.
     */
    private async guarded<T>(op: () => Promise<T>): Promise<T> {
        try {
            return await op();
        } catch (err) {
            throw this.translateFault(err);
        }
    }

    /*
     * The public surface is final: each method is a thin guard around the `*Impl` hook a provider implements.
     * Subclasses override the hooks, never these — overriding a public method would skip the translation and
     * let an authority-specific error class escape to the wire.
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
    ): Promise<LastAuthorizedResult> {
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
    creditInvoiceObligation(
        environment: GenericEnvironment,
        issuerTaxId: string,
        receiverTaxId: string,
        issueDate: string,
    ): Promise<CreditInvoiceObligationResult> {
        return this.guarded(() =>
            this.creditInvoiceObligationImpl(environment, issuerTaxId, receiverTaxId, issueDate),
        );
    }
    pointsOfSale(entity: EntityAuthBlock, webService?: WebService): Promise<PointsOfSaleResult> {
        return this.guarded(() => this.pointsOfSaleImpl(entity, webService));
    }
    currencyRates(
        environment: GenericEnvironment,
        currencyCodes?: ReadonlyArray<string>,
        date?: string,
        webService?: WebService,
    ): Promise<CurrencyRatesResult> {
        return this.guarded(() => this.currencyRatesImpl(environment, currencyCodes, date, webService));
    }

    protected abstract validateCredentialsImpl(input: ValidateCredentialsInput): Promise<CredentialValidationResult>;
    protected abstract authorizeInvoiceImpl(entity: EntityAuthBlock, invoice: NeutralInvoice): Promise<TaxAuthorizationResult>;
    protected abstract lastAuthorizedImpl(entity: EntityAuthBlock, pointOfSaleNumber: number, documentTypeCode: number): Promise<LastAuthorizedResult>;
    protected abstract nextNumbersImpl(entity: EntityAuthBlock, pointOfSaleNumber: number, documentTypeCodes: ReadonlyArray<number>): Promise<NextNumbersResult>;
    protected abstract queryVoucherImpl(entity: EntityAuthBlock, pointOfSaleNumber: number, documentTypeCode: number, voucherNumber: number): Promise<TaxAuthorizationResult>;
    protected abstract authorityStatusImpl(environment: GenericEnvironment): Promise<AuthorityStatusResult>;
    /**
     * Looks up whoever the authority's registry holds under `identificationNumber`, read according to
     * `identificationTypeCode` — the same canonical code an invoice receiver carries. The provider decides
     * which of the authority's registries can answer, and reports it back as the result's `detail`.
     *
     * Takes no issuer block: registry lookups run under this service's own delegated identity, so there is
     * no `CREDENTIALS_REQUIRED` handshake. Returns a non-empty list, an identity document being able to
     * match several taxpayers, and raises a not-found rather than an empty one.
     */
    protected abstract lookupTaxpayersImpl(
        environment: GenericEnvironment,
        identificationTypeCode: number,
        identificationNumber: string,
    ): Promise<TaxpayerResult>;
    /**
     * Whether `receiverTaxId` must be sent a credit-invoice document (AR: Factura de Crédito Electrónica)
     * for a voucher issued on `issueDate`, and the amount at or above which that applies.
     *
     * Three things a second entity implementing this needs:
     *
     * - **It takes no issuer block and no credentials**, like `lookupTaxpayers` and `currencyRates`: the
     *   obligation is a property of the *receiver* and the régimen, not of whoever is asking, so it is read
     *   under this service's own delegated identity and there is no `CREDENTIALS_REQUIRED` handshake. That
     *   is a precondition rather than a convenience, and for the reason `currencyRates` gives: a tenant's
     *   certificate authorizes that tenant's sales and says nothing about a third party's obligations, so
     *   reading a platform-wide fact through one arbitrary tenant's credential would make the answer depend
     *   on which tenant happened to ask, and break when that certificate lapsed.
     *
     *   `issuerTaxId` is therefore **informational**: required so an audit of "why was this voucher a credit
     *   invoice" can name both parties, and used for nothing else.
     * - **An unknown receiver is `obligated: false`, never a not-found.** "The registry does not know this
     *   taxpayer" and "this taxpayer is not obligated" are the same outcome for the decision being made, and
     *   translating an absence into a verdict at the call site is where that goes wrong.
     * - **`source` says which of two independent answers this is**, and they are never blended. An
     *   implementation that cannot reach its authority may answer from a local register, but every field of
     *   the answer must then come from that register — an authority verdict beside a local threshold
     *   disagrees exactly when the régimen changes.
     *
     * `issueDate` is the voucher's own day rather than today, and is required: a backdated sale must be
     * judged against the régimen as it stood then, and a defaulted date is silently wrong for one.
     */
    protected abstract creditInvoiceObligationImpl(
        environment: GenericEnvironment,
        issuerTaxId: string,
        receiverTaxId: string,
        issueDate: string,
    ): Promise<CreditInvoiceObligationResult>;
    /**
     * The entity's registered points of sale.
     *
     * `webService` selects the register when the entity keeps more than one, which some do: a point of sale
     * enrolled for ordinary invoicing may not be usable for export invoicing and vice versa. Omitted means
     * the entity's ordinary register.
     */
    protected abstract pointsOfSaleImpl(
        entity: EntityAuthBlock,
        webService?: WebService,
    ): Promise<PointsOfSaleResult>;
    /**
     * The authority's published exchange rates, with the band it accepts around each.
     *
     * Takes no issuer block, for the same reason the taxpayer lookup does not: an exchange rate is a
     * property of the entity, currency and day alone, so it is read under this service's own delegate
     * identity. That is a precondition rather than a convenience — a caller caches these centrally for every
     * tenant, and populating a platform-wide catalogue from one arbitrary tenant's certificate would break
     * when that certificate lapsed.
     *
     * `currencyCodes` omitted means the entity's whole table: an authority publishes all its rates at once,
     * so that is both the shape of a daily sync and of the answer a caller caches. A code the authority has
     * no rate for comes back under `unavailable` with a reason, never as a failed batch.
     *
     * `date` names the day to quote for, in the authority's own calendar; omitted, the latest publication is
     * returned. The answer's `rateDate` may be earlier than the day asked for, since a rate belongs to the
     * last published business day — so a caller reads the day off the answer, never off its request.
     */
    protected abstract currencyRatesImpl(
        environment: GenericEnvironment,
        currencyCodes?: ReadonlyArray<string>,
        date?: string,
        webService?: WebService,
    ): Promise<CurrencyRatesResult>;
}
