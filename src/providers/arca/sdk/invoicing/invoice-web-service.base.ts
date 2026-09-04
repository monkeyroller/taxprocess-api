import {SoapClient} from '../core/soap-client/soap-client.js';
import {ArcaServiceError, NotImplementedError, type ArcaErrorEntry} from '../core/errors.js';
import type {ArcaEnvironment} from '../core/constants.js';
import {codeMsgPairs} from './common/common-helpers.js';
import type {
    ArcaAuth,
    CurrencyRateInfo,
    CurrencyTypeInfo,
    PointOfSaleInfo,
    ServerStatus,
} from '../core/types.js';

/**
 * Shared base for every ARCA invoice-authorization web service.
 *
 * The base owns the common orchestration: building the SOAP call, unwrapping `{op}Result`, and translating an
 * ARCA `Errors.Err` block into a thrown error. Each concrete service fills only the operation-specific hooks
 * and declares its identity, so every subclass exposes the same public methods with the same signatures.
 *
 * Hooks default to throwing, so a seed service becomes a real type-checked class the moment it declares its
 * identity, without stubbing every operation.
 */
export abstract class InvoiceWebService<TRequest, TResponse> {
    /** ARCA service id used to obtain the WSAA access ticket, e.g. `"wsfe"`. */
    protected abstract readonly serviceId: string;
    /** SOAP target namespace, e.g. `"http://ar.gov.afip.dif.FEV1/"`. */
    protected abstract readonly namespace: string;

    constructor(
        protected readonly soap: SoapClient,
        protected readonly environment: ArcaEnvironment,
    ) {}

    /** Absolute service URL for the current environment. */
    protected abstract endpoint(): string;

    /** ARCA service id this instance authenticates against, used to request the WSAA ticket. */
    get service(): string {
        return this.serviceId;
    }

    /** Requests authorization (CAE) for a voucher. WSFEv1: `FECAESolicitar`. */
    async requestAuthorization(auth: ArcaAuth, request: TRequest): Promise<TResponse> {
        const payload = this.buildAuthorizationRequest(auth, request);
        const result = await this.invoke(this.authorizeOperation, payload);
        return this.parseAuthorizationResponse(result);
    }

    /** Last authorized voucher number for a point of sale + voucher type. WSFEv1: `FECompUltimoAutorizado`. */
    async getLastAuthorizedNumber(auth: ArcaAuth, pointOfSaleNumber: number, voucherType: number): Promise<number> {
        const payload = this.buildLastAuthorizedRequest(auth, pointOfSaleNumber, voucherType);
        const result = await this.invoke(this.lastAuthorizedOperation, payload);
        return this.parseLastAuthorizedNumber(result);
    }

    /**
     * Queries a previously authorized voucher. WSFEv1: `FECompConsultar`. The only operation that returns a
     * stored CAE, so it is also the idempotency backstop for `requestAuthorization`.
     */
    async queryVoucher(
        auth: ArcaAuth,
        pointOfSaleNumber: number,
        voucherType: number,
        voucherNumber: number,
    ): Promise<TResponse> {
        const payload = this.buildQueryRequest(auth, pointOfSaleNumber, voucherType, voucherNumber);
        const result = await this.invoke(this.queryOperation, payload);
        return this.parseVoucherQuery(result);
    }

    /** The entity's registered points of sale. WSFEv1: `FEParamGetPtosVenta`. */
    async getPointsOfSale(auth: ArcaAuth): Promise<Array<PointOfSaleInfo>> {
        const payload = this.buildPointsOfSaleRequest(auth);
        const result = await this.invoke(this.pointsOfSaleOperation, payload);
        return this.parsePointsOfSale(result);
    }

    /**
     * The authority's published cotización for one currency. WSFEv1: `FEParamGetCotizacion`.
     *
     * `rateDate` names the day to quote for in ARCA `yyyymmdd`; omitted, the authority answers with its
     * latest publication. The reply's own `FchCotiz` may be earlier than the day asked for, a cotización
     * belonging to the last published business day, so callers read the day off the answer.
     *
     * One currency per call, which is why a caller wanting a whole table has to fan out — and why that
     * fan-out belongs behind one batched endpoint, separate calls being able to straddle a publication
     * boundary and mix vintages.
     */
    async getCurrencyRate(auth: ArcaAuth, currencyId: string, rateDate?: string): Promise<CurrencyRateInfo> {
        const payload = this.buildCurrencyRateRequest(auth, currencyId, rateDate);
        const result = await this.invoke(this.currencyRateOperation, payload);
        return this.parseCurrencyRate(result);
    }

    /** The authority's whole currency catalogue. WSFEv1: `FEParamGetTiposMonedas`. */
    async getCurrencyTypes(auth: ArcaAuth): Promise<Array<CurrencyTypeInfo>> {
        const payload = this.buildCurrencyTypesRequest(auth);
        const result = await this.invoke(this.currencyTypesOperation, payload);
        return this.parseCurrencyTypes(result);
    }

    /** Service health check. WSFEv1: `FEDummy` (unauthenticated). */
    async getServerStatus(): Promise<ServerStatus> {
        const result = await this.invoke(this.dummyOperation, {});
        return this.parseServerStatus(result);
    }

    /** Sends `operation`, unwraps `{operation}Result`, and throws on an ARCA `Errors` block. */
    protected async invoke(operation: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        const response = await this.soap.call(this.endpoint(), this.namespace, operation, payload);
        const result = (response[`${operation}Result`] as Record<string, unknown>) ?? response;
        this.assertNoErrors(result);
        return result;
    }

    /**
     * Raises if the result carries a non-empty `Errors.Err`. Shares `codeMsgPairs` with the observation
     * reader, since `Obs` and `Err` are the same wire structure — reading them two ways is how this one came
     * to render a missing `Code` as the literal `"undefined"` while the other had been fixed not to.
     */
    protected assertNoErrors(result: Record<string, unknown>): void {
        const entries: Array<ArcaErrorEntry> = codeMsgPairs(
            (result as {Errors?: unknown}).Errors,
            'Err',
        );
        if (entries.length === 0) {
            return;
        }
        throw new ArcaServiceError(entries.map((e) => `[${e.code}] ${e.message}`).join('; '), entries);
    }

    protected readonly authorizeOperation: string = '';
    protected readonly lastAuthorizedOperation: string = '';
    protected readonly queryOperation: string = '';
    protected readonly pointsOfSaleOperation: string = '';
    protected readonly currencyRateOperation: string = '';
    protected readonly currencyTypesOperation: string = '';
    protected readonly dummyOperation: string = '';

    protected buildAuthorizationRequest(_auth: ArcaAuth, _request: TRequest): Record<string, unknown> {
        throw new NotImplementedError(`${this.constructor.name}.requestAuthorization`);
    }

    protected parseAuthorizationResponse(_result: Record<string, unknown>): TResponse {
        throw new NotImplementedError(`${this.constructor.name}.parseAuthorizationResponse`);
    }

    protected buildLastAuthorizedRequest(
        _auth: ArcaAuth,
        _pointOfSaleNumber: number,
        _voucherType: number,
    ): Record<string, unknown> {
        throw new NotImplementedError(`${this.constructor.name}.getLastAuthorizedNumber`);
    }

    protected parseLastAuthorizedNumber(_result: Record<string, unknown>): number {
        throw new NotImplementedError(`${this.constructor.name}.getLastAuthorizedNumber`);
    }

    protected buildQueryRequest(
        _auth: ArcaAuth,
        _pointOfSaleNumber: number,
        _voucherType: number,
        _voucherNumber: number,
    ): Record<string, unknown> {
        throw new NotImplementedError(`${this.constructor.name}.queryVoucher`);
    }

    protected parseVoucherQuery(_result: Record<string, unknown>): TResponse {
        throw new NotImplementedError(`${this.constructor.name}.queryVoucher`);
    }

    protected buildPointsOfSaleRequest(_auth: ArcaAuth): Record<string, unknown> {
        throw new NotImplementedError(`${this.constructor.name}.getPointsOfSale`);
    }

    protected parsePointsOfSale(_result: Record<string, unknown>): Array<PointOfSaleInfo> {
        throw new NotImplementedError(`${this.constructor.name}.getPointsOfSale`);
    }

    protected parseServerStatus(_result: Record<string, unknown>): ServerStatus {
        throw new NotImplementedError(`${this.constructor.name}.getServerStatus`);
    }

    protected buildCurrencyRateRequest(
        _auth: ArcaAuth,
        _currencyId: string,
        _rateDate?: string,
    ): Record<string, unknown> {
        throw new NotImplementedError(`${this.constructor.name}.getCurrencyRate`);
    }

    protected parseCurrencyRate(_result: Record<string, unknown>): CurrencyRateInfo {
        throw new NotImplementedError(`${this.constructor.name}.getCurrencyRate`);
    }

    protected buildCurrencyTypesRequest(_auth: ArcaAuth): Record<string, unknown> {
        throw new NotImplementedError(`${this.constructor.name}.getCurrencyTypes`);
    }

    protected parseCurrencyTypes(_result: Record<string, unknown>): Array<CurrencyTypeInfo> {
        throw new NotImplementedError(`${this.constructor.name}.getCurrencyTypes`);
    }
}
