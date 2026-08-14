import {SoapClient} from '../core/soap-client.js';
import {ArcaServiceError, NotImplementedError, type ArcaErrorEntry} from '../core/errors.js';
import type {ArcaEnvironment} from '../core/constants.js';
import type {ArcaAuth, PointOfSaleInfo, ServerStatus} from '../core/types.js';

/**
 * Shared base for every ARCA invoice-authorization web service (WSFEv1, WSFEXv1, …).
 *
 * The base owns the common orchestration — building the SOAP call, unwrapping `{op}Result`, and
 * translating an ARCA `Errors.Err` block into a thrown {@link ArcaServiceError}. Each concrete
 * service fills only the operation-specific hooks (build request / parse response) and declares its
 * `serviceId`, `namespace`, and `endpoint`. Every subclass therefore exposes the *same* public
 * methods with the same signatures — "executed differently" — which is the point of the module.
 *
 * Hooks default to throwing {@link NotImplementedError}, so a seed service (export/credit) becomes a
 * real, type-checked class the moment it declares its identity, without stubbing every operation.
 *
 * @typeParam TRequest  the SDK-facing authorization request for this service
 * @typeParam TResponse the simplified authorization result for this service
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

    /** Absolute service URL for the current environment (from `ENDPOINTS`). */
    protected abstract endpoint(): string;

    /** ARCA service id this instance authenticates against — used to request the WSAA ticket. */
    get service(): string {
        return this.serviceId;
    }

    // ---- Public contract: identical across every subclass ----

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
     * stored CAE, so it is also the idempotency backstop for `requestAuthorization`: on an already-authorized
     * number it recovers the issued CAE. See `docs/CONTRACT.md` (`/invoices/authorize` idempotency).
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

    /** Service health check. WSFEv1: `FEDummy` (unauthenticated). */
    async getServerStatus(): Promise<ServerStatus> {
        const result = await this.invoke(this.dummyOperation, {});
        return this.parseServerStatus(result);
    }

    // ---- Shared plumbing ----

    /** Sends `operation`, unwraps `{operation}Result`, and throws on an ARCA `Errors` block. */
    protected async invoke(operation: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        const response = await this.soap.call(this.endpoint(), this.namespace, operation, payload);
        const result = (response[`${operation}Result`] as Record<string, unknown>) ?? response;
        this.assertNoErrors(result);
        return result;
    }

    /** Raises {@link ArcaServiceError} if the result carries a non-empty `Errors.Err`. */
    protected assertNoErrors(result: Record<string, unknown>): void {
        const errors = (result as {Errors?: {Err?: unknown}}).Errors;
        const err = errors?.Err;
        if (!err) {
            return;
        }
        const list = Array.isArray(err) ? err : [err];
        const entries: Array<ArcaErrorEntry> = list.map((e: {Code?: unknown; Msg?: unknown}) => ({
            code: String(e.Code),
            message: String(e.Msg),
        }));
        throw new ArcaServiceError(entries.map((e) => `[${e.code}] ${e.message}`).join('; '), entries);
    }

    // ---- Operation-specific hooks (default: not implemented) ----

    protected readonly authorizeOperation: string = '';
    protected readonly lastAuthorizedOperation: string = '';
    protected readonly queryOperation: string = '';
    protected readonly pointsOfSaleOperation: string = '';
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
}
