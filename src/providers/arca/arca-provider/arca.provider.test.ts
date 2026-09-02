import 'reflect-metadata';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {
    ArcaAuthError,
    ArcaServiceError,
    ArcaSoapError,
    ArcaTaxpayerNotFoundError,
    ArcaValidationError,
} from '../sdk/core/errors.js';
import type {CurrencyRateInfo, CurrencyTypeInfo, PointOfSaleInfo} from '../sdk/core/types.js';
import type {CommonInvoiceResult} from '../sdk/invoicing/common/common-invoice.types.js';
import type {TaxpayerData} from '../sdk/taxpayer-registry/padron.types.js';
import {
    DelegationNotAuthorizedError,
    DelegationNotConfiguredError,
    TaxpayerNotFoundError,
    VoucherNotFoundError,
    type ProviderFaultCategory,
} from '../../provider/faults.js';
import type {EntityAuthBlock} from '../../provider/entity-auth.js';
import type {NeutralInvoice} from '../../provider/neutral-invoice.js';
import type {DelegateCredentialStore} from '../auth/delegate-credentials/delegate-credentials.js';
import {NeutralInvoiceDto} from '../../../http/dto/invoice.dto.js';
import {NextNumbersRequestDto} from '../../../http/dto/invoice-request.dto.js';
import {PointsOfSaleRequestDto} from '../../../http/dto/points-of-sale-request.dto.js';
import {CurrencyRatesRequestDto} from '../../../http/dto/currency.dto.js';
import {RATE_DAY_RULE} from '../mapping/cotizacion/cotizacion.js';
import {ARCA_CURRENCY_CODES} from '../mapping/currency-codes/currency-codes.js';

/**
 * The provider reaches ARCA through two module-level singletons, the ticket store and the per-environment
 * invoice service. Both are mocked before the dynamic import of the provider, so these tests exercise the
 * numbering decision and the real invoice mapper without any network.
 */

const getLastAuthorizedNumber = jest.fn<() => Promise<number>>();
const requestAuthorization = jest.fn<(auth: unknown, req: any) => Promise<CommonInvoiceResult>>();
const queryVoucher = jest.fn<(auth: unknown, sp: number, vt: number, n: number) => Promise<CommonInvoiceResult>>();
const getPointsOfSale = jest.fn<() => Promise<Array<PointOfSaleInfo>>>();
const getCurrencyRate = jest.fn<(auth: unknown, code: string, day?: string) => Promise<CurrencyRateInfo>>();
const getCurrencyTypes = jest.fn<(auth: unknown) => Promise<Array<CurrencyTypeInfo>>>();
const resolve = jest.fn<
    (
        entityCode: string,
        issuerTaxId: string,
        service: string,
        environment: string,
        credentials?: unknown,
        delegated?: boolean,
    ) => Promise<{token: string; sign: string; cuit: number}>
>();
const constanciaGetTaxpayer = jest.fn<(auth: unknown, id: number) => Promise<TaxpayerData>>();
const identityGetTaxpayer = jest.fn<(auth: unknown, id: number) => Promise<TaxpayerData>>();
const getIdPersonaList = jest.fn<(auth: unknown, documentNumber: number) => Promise<Array<string>>>();
const invalidateDelegated = jest.fn<(entityCode: string, environment: string, service: string) => void>();

jest.unstable_mockModule('../clients.js', () => ({
    commonInvoiceService: () => ({
        getLastAuthorizedNumber,
        requestAuthorization,
        queryVoucher,
        getPointsOfSale,
        getCurrencyRate,
        getCurrencyTypes,
    }),
    // The padrón factories return concrete services carrying the WSAA service id the provider keys the
    // ticket on, so the fakes must expose `service` as well as the operations.
    constanciaService: () => ({service: CONSTANCIA_SERVICE, getTaxpayer: constanciaGetTaxpayer}),
    taxpayerIdentityService: () => ({
        service: A13_SERVICE,
        getTaxpayer: identityGetTaxpayer,
        getIdPersonaList,
    }),
    soap: {},
}));

const CONSTANCIA_SERVICE = 'ws_sr_constancia_inscripcion';
const A13_SERVICE = 'ws_sr_padron_a13';
const DELEGATE_CUIT = '30999999997';

jest.unstable_mockModule('../auth/ticket-store/ticket-store.js', () => ({
    ticketStore: {resolve, invalidateDelegated},
    CredentialsRequiredError: class extends Error {},
}));

const {ArcaProvider, CURRENCY_FAN_OUT_LIMIT} = await import('./arca.provider.js');

const ENTITY: EntityAuthBlock = {entityCode: 'ARCA', issuerTaxId: '20111111112', environment: 'testing'};

function invoice(overrides: Partial<NeutralInvoice> = {}): NeutralInvoice {
    return {
        documentTypeCode: 1,
        concept: 1,
        pointOfSaleNumber: 3,
        voucherNumberFrom: 17,
        voucherNumberTo: 17,
        receiver: {identificationTypeCode: 80, identificationNumber: '20111111112', fiscalConditionCode: 1},
        currencyIso: 'ARS',
        currencyRate: 1,
        issueDate: '2026-08-05',
        lines: [{netAmount: 100, taxRatePercent: 21, taxAmount: 21}],
        ...overrides,
    };
}

const approved: CommonInvoiceResult = {
    result: 'A',
    cae: '75123456789012',
    caeExpiration: '20260820',
    voucherNumberFrom: 17,
    voucherNumberTo: 17,
    observations: [],
    raw: {},
};

/** A soft `10016` rejection — ARCA's "not the next number to authorize" signal (default invoice total = 121). */
const rejected10016: CommonInvoiceResult = {
    ...approved,
    result: 'R',
    cae: undefined,
    caeExpiration: undefined,
    observations: [{code: '10016', message: 'El numero o fecha del comprobante no se corresponde…'}],
};

/**
 * What `queryVoucher` returns for an already-authorized voucher 17 — every field the recovery guard checks
 * matches the default `invoice()`.
 *
 * Values are strings on purpose: the SOAP client parses with `parseTagValue: false`, so this is the shape
 * the guard sees in production, and stubbing numbers would hide how a blank element behaves.
 */
const queriedAuthorized: CommonInvoiceResult = {
    result: 'A',
    cae: '75123456789012',
    caeExpiration: '20260820',
    voucherNumberFrom: 17,
    voucherNumberTo: 17,
    observations: [],
    raw: {
        ImpTotal: '121',
        DocTipo: '80',
        DocNro: '20111111112',
        Concepto: '1',
        MonId: 'PES',
        CbteFch: '20260805',
        CondicionIVAReceptorId: '1',
    },
};

/** ARCA's not-found response for a voucher that was never authorized (FECompConsultar ~602). */
const notFoundError = new ArcaServiceError('[602] No existe el comprobante', [
    {code: '602', message: 'No existe el comprobante'},
]);

/**
 * `authorizeInvoice` builds its request against the real clock, and a concept-1 voucher rejects an
 * out-of-window `issueDate`. Pinning the clock to the default invoice's issue date keeps the authorize
 * tests from going stale the moment real "now" drifts more than 5 days past it.
 */
beforeEach(() => {
    jest.useFakeTimers({advanceTimers: false});
    jest.setSystemTime(new Date('2026-08-05T12:00:00-03:00'));
});

afterEach(() => {
    jest.useRealTimers();
});

/**
 * The neutral shape an ARCA failure reaches a caller in. The base class translates every provider-native
 * error on the way out, so "this error propagates untouched" is asserted as the fault it translates to
 * rather than as object identity against the SDK class.
 */
function fault(category: ProviderFaultCategory, code: string, message?: string): Record<string, unknown> {
    return message === undefined ? {category, code} : {category, code, message};
}

/** An ARCA validation rejection: the stable wire category, with the specific reason under `details.code`. */
function validationFault(reason: string): Record<string, unknown> {
    return {category: 'VALIDATION', code: 'ARCA_VALIDATION', details: {code: reason}};
}

describe('ArcaProvider.authorizeInvoice', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resolve.mockResolvedValue({token: 'T', sign: 'S', cuit: 20111111112});
    });

    it('authorizes exactly the voucher number core sent and echoes it (no self-numbering)', async () => {
        requestAuthorization.mockResolvedValue(approved);

        const result = await new ArcaProvider().authorizeInvoice(ENTITY, invoice());

        // Core is the source of truth: the service must never ask ARCA for the last-authorized number.
        expect(getLastAuthorizedNumber).not.toHaveBeenCalled();
        // An approved authorize never reconciles — no query.
        expect(queryVoucher).not.toHaveBeenCalled();
        // The provided range maps straight to CbteDesde/CbteHasta.
        const sentRequest = requestAuthorization.mock.calls[0]?.[1];
        expect(sentRequest.voucherNumberFrom).toBe(17);
        expect(sentRequest.voucherNumberTo).toBe(17);
        // The echoed number is what ARCA confirmed.
        expect(result.status).toBe('AUTHORIZED');
        expect(result.authorizedNumber).toBe(17);
    });

    /**
     * ARCA routinely authorizes a voucher and observes it. Nothing in this service retains the
     * observations, so dropped on the approved path they are recoverable only by re-querying ARCA.
     */
    it('returns observations on an APPROVED voucher, with the CAE and QR intact', async () => {
        requestAuthorization.mockResolvedValue({
            ...approved,
            observations: [{code: '10063', message: 'El comprobante fue autorizado con observaciones'}],
        });

        const result = await new ArcaProvider().authorizeInvoice(ENTITY, invoice());

        expect(result.status).toBe('AUTHORIZED');
        expect(result.authorizationCode).toBe('75123456789012');
        expect(result.qr).toBeDefined();
        expect(result.observations).toEqual([
            {code: '10063', message: 'El comprobante fue autorizado con observaciones'},
        ]);
        // Observations are informational on an approval — never a reason to reconcile.
        expect(queryVoucher).not.toHaveBeenCalled();
    });

    /**
     * The recovery trigger is a `10016` rejection, so ARCA attaching `10016` to an approved voucher must not
     * send us reconciling: the CAE in hand is authoritative, and querying would risk replacing a fresh
     * approval with the mismatch guard's refusal.
     */
    it('does not reconcile an approved voucher that merely carries a 10016 observation', async () => {
        requestAuthorization.mockResolvedValue({
            ...approved,
            observations: [{code: '10016', message: 'El numero o fecha del comprobante no se corresponde…'}],
        });

        const result = await new ArcaProvider().authorizeInvoice(ENTITY, invoice());

        expect(queryVoucher).not.toHaveBeenCalled();
        expect(result.status).toBe('AUTHORIZED');
        expect(result.authorizationCode).toBe('75123456789012');
        expect(result.observations).toHaveLength(1);
    });

    it('recovers the existing CAE when core re-sends an already-authorized number (idempotent)', async () => {
        // ARCA rejects the re-send with 10016; the stored voucher is genuinely authorized.
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockResolvedValue(queriedAuthorized);

        const result = await new ArcaProvider().authorizeInvoice(ENTITY, invoice());

        // Reconciled against the exact number core sent.
        expect(queryVoucher).toHaveBeenCalledWith(expect.anything(), 3, expect.any(Number), 17);
        // The recovered CAE is returned as a complete, authorized result — QR rebuilt from the request.
        expect(result.status).toBe('AUTHORIZED');
        expect(result.authorizationCode).toBe('75123456789012');
        expect(result.authorizedNumber).toBe(17);
        expect(result.qr).toBeDefined();
    });

    /**
     * A recovered result is built from the queried voucher, so it carries the observations ARCA stored
     * against it rather than the `10016` from the rejected re-send.
     */
    it('returns the stored voucher’s observations on a recovered CAE, not the 10016 re-send rejection', async () => {
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockResolvedValue({
            ...queriedAuthorized,
            observations: [{code: '10063', message: 'autorizado con observaciones'}],
        });

        const result = await new ArcaProvider().authorizeInvoice(ENTITY, invoice());

        expect(result.status).toBe('AUTHORIZED');
        expect(result.observations).toEqual([{code: '10063', message: 'autorizado con observaciones'}]);
    });

    it('keeps a 10016 rejection REJECTED when the voucher is not actually authorized (number ahead of sequence)', async () => {
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockRejectedValue(notFoundError); // FECompConsultar → not found

        const result = await new ArcaProvider().authorizeInvoice(ENTITY, invoice());

        expect(queryVoucher).toHaveBeenCalledTimes(1);
        expect(result.status).toBe('REJECTED');
        expect(result.authorizedNumber).toBe(17);
        expect(result.qr).toBeUndefined();
        expect(result.observations).toHaveLength(1);
    });

    it('refuses to return a recovered CAE when the stored amount differs (mismatch guard)', async () => {
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockResolvedValue({...queriedAuthorized, raw: {ImpTotal: 999}});

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toThrow(/different amount/);
    });

    it('refuses to return a recovered CAE when the stored receiver doc type differs (mismatch guard)', async () => {
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockResolvedValue({...queriedAuthorized, raw: {...queriedAuthorized.raw, DocTipo: 96}});

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toThrow(/different receiver doc type/);
    });

    it('refuses to return a recovered CAE when the stored receiver doc number differs (mismatch guard)', async () => {
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockResolvedValue({...queriedAuthorized, raw: {...queriedAuthorized.raw, DocNro: 20222222223}});

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toThrow(/different receiver/);
    });

    it('refuses to return a recovered CAE when the stored concept differs (mismatch guard)', async () => {
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockResolvedValue({...queriedAuthorized, raw: {...queriedAuthorized.raw, Concepto: 2}});

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toThrow(/different concept/);
    });

    it('refuses to return a recovered CAE when the stored currency differs (mismatch guard)', async () => {
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockResolvedValue({...queriedAuthorized, raw: {...queriedAuthorized.raw, MonId: 'DOL'}});

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toThrow(/different currency/);
    });

    it('refuses to return a recovered CAE when the stored voucher date differs (mismatch guard)', async () => {
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockResolvedValue({...queriedAuthorized, raw: {...queriedAuthorized.raw, CbteFch: '20260101'}});

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toThrow(/different voucher date/);
    });

    it('refuses to return a recovered CAE when the stored receiver IVA condition differs (mismatch guard)', async () => {
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockResolvedValue({
            ...queriedAuthorized,
            raw: {...queriedAuthorized.raw, CondicionIVAReceptorId: 5},
        });

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toThrow(
            /different receiver IVA condition/,
        );
    });

    it('treats an EMPTY stored element as "not returned", not as a zero that mismatches', async () => {
        // `<CondicionIVAReceptorId/>` on a voucher predating RG 5616 parses to `''`, and `Number('')` is a
        // finite `0` — so coercing first would report a confirmed mismatch and wedge a legitimate retry.
        requestAuthorization.mockResolvedValue(rejected10016);
        queryVoucher.mockResolvedValue({
            ...queriedAuthorized,
            raw: {ImpTotal: '', DocTipo: '', DocNro: '', Concepto: '', MonId: '', CondicionIVAReceptorId: ''},
        });

        const result = await new ArcaProvider().authorizeInvoice(ENTITY, invoice());

        expect(result.status).toBe('AUTHORIZED');
        expect(result.authorizationCode).toBe('75123456789012');
    });

    it('recovers a delayed resend whose issueDate has aged out of the ±5-day window', async () => {
        // Core lost the CAE to a persistence failure and replays the identical invoice a week later.
        // Judging the date first would `400` it before recovery ran, orphaning a number ARCA has consumed.
        jest.setSystemTime(new Date('2026-08-19T12:00:00-03:00'));
        queryVoucher.mockResolvedValue(queriedAuthorized);

        const result = await new ArcaProvider().authorizeInvoice(ENTITY, invoice());

        // Recovered without ever attempting a fresh authorization.
        expect(requestAuthorization).not.toHaveBeenCalled();
        expect(result.status).toBe('AUTHORIZED');
        expect(result.authorizationCode).toBe('75123456789012');
    });

    it('rejects an out-of-window issueDate once recovery confirms the voucher is NOT already authorized', async () => {
        jest.setSystemTime(new Date('2026-08-19T12:00:00-03:00'));
        queryVoucher.mockRejectedValue(notFoundError);

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toThrow(
            /outside ARCA's ±5-day window/,
        );
        expect(requestAuthorization).not.toHaveBeenCalled();
    });

    it('recovers via query when ARCA throws the conflict instead of soft-rejecting it', async () => {
        requestAuthorization.mockRejectedValue(
            new ArcaServiceError('[10016] ya autorizado', [{code: '10016', message: 'ya autorizado'}]),
        );
        queryVoucher.mockResolvedValue(queriedAuthorized);

        const result = await new ArcaProvider().authorizeInvoice(ENTITY, invoice());

        expect(result.status).toBe('AUTHORIZED');
        expect(result.authorizationCode).toBe('75123456789012');
    });

    it('re-throws the original authorize error when the number is not recoverable', async () => {
        const thrown = new ArcaServiceError('[10016] ya autorizado', [{code: '10016', message: 'ya autorizado'}]);
        requestAuthorization.mockRejectedValue(thrown);
        queryVoucher.mockRejectedValue(notFoundError);

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toMatchObject(
            fault('AUTHORITY_SERVICE', 'ARCA_SERVICE', thrown.message),
        );
    });

    it('refuses a voucher range (voucherNumberTo > voucherNumberFrom) instead of silently truncating it', async () => {
        await expect(
            new ArcaProvider().authorizeInvoice(ENTITY, invoice({voucherNumberFrom: 17, voucherNumberTo: 18})),
        ).rejects.toMatchObject(validationFault('VOUCHER_RANGE_UNSUPPORTED'));
        // Rejected up front — no ticket minted, no authorize attempted.
        expect(resolve).not.toHaveBeenCalled();
        expect(requestAuthorization).not.toHaveBeenCalled();
    });

    it('re-throws an unrelated business rejection verbatim without attempting recovery', async () => {
        // A thrown error that is not the `10016` conflict must never trigger a reconciliation query, or a
        // coincidentally authorized voucher at the same number could mask the real failure.
        const thrown = new ArcaServiceError('[10015] datos del receptor invalidos', [
            {code: '10015', message: 'datos del receptor invalidos'},
        ]);
        requestAuthorization.mockRejectedValue(thrown);

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toMatchObject(
            fault('AUTHORITY_SERVICE', 'ARCA_SERVICE', thrown.message),
        );
        expect(queryVoucher).not.toHaveBeenCalled();
    });
});

describe('ArcaProvider delegated token/representación classification', () => {
    const DELEGATED: EntityAuthBlock = {...ENTITY, delegated: true};
    const DELEGATE_CUIT = '30711111118';

    /** A provider whose delegate store is configured, so the 403 can name our real delegate CUIT. */
    function provider(): InstanceType<typeof ArcaProvider> {
        const delegate = {
            get: () => ({certPem: 'C', keyPem: 'K', delegateCuit: DELEGATE_CUIT}),
            matchesDelegateCertificate: () => false,
        };
        return new ArcaProvider(delegate as never);
    }

    /** Builds a WSFEv1 `Errors` block (→ ArcaServiceError) carrying a single `{code, msg}` pair. */
    function arcaError(code: string, msg: string): ArcaServiceError {
        return new ArcaServiceError(`[${code}] ${msg}`, [{code, message: msg}]);
    }
    /** A WSFEv1 600 ValidacionDeToken rejection with `msg`. */
    function tokenError(msg: string): ArcaServiceError {
        return arcaError('600', msg);
    }

    beforeEach(() => {
        jest.clearAllMocks();
        resolve.mockResolvedValue({token: 'T', sign: 'S', cuit: 20111111112});
    });

    it('maps the representación-specific 601 (CUIT representada no incluida) to DelegationNotAuthorizedError (→ 403)', async () => {
        requestAuthorization.mockRejectedValue(arcaError('601', 'CUIT representada no incluida en token'));

        await expect(provider().authorizeInvoice(DELEGATED, invoice())).rejects.toBeInstanceOf(
            DelegationNotAuthorizedError,
        );
        // `601` is a missing delegation rather than a token fault, so the valid ticket must not be evicted.
        expect(invalidateDelegated).not.toHaveBeenCalled();
    });

    it('maps an authorization-flavored 600 on a delegated call to DelegationNotAuthorizedError (→ 403)', async () => {
        requestAuthorization.mockRejectedValue(
            tokenError('No se corresponden token y firma. Usuario no autorizado a realizar esta operación'),
        );

        await expect(provider().authorizeInvoice(DELEGATED, invoice())).rejects.toBeInstanceOf(
            DelegationNotAuthorizedError,
        );
        // The delegate ticket is valid and only the delegation missing, so it must not be evicted.
        expect(invalidateDelegated).not.toHaveBeenCalled();
    });

    it('maps a LAPSED representación (worded as an expiry) to a delegation error, not a token fault', async () => {
        // The message matches both classifiers. Reading it as a token fault would return a retryable `502`
        // instead of the actionable `403` and evict the shared delegate ticket for a permanent condition,
        // so every retry re-evicts and delegated invoicing stays wedged.
        requestAuthorization.mockRejectedValue(
            tokenError('La relación de representación se encuentra vencida; usuario no autorizado'),
        );

        await expect(provider().authorizeInvoice(DELEGATED, invoice())).rejects.toBeInstanceOf(
            DelegationNotAuthorizedError,
        );
        expect(invalidateDelegated).not.toHaveBeenCalled();
    });

    it('maps a genuine token fault (signature/hash) 600 to a token error, NOT a delegation error', async () => {
        requestAuthorization.mockRejectedValue(
            tokenError('ValidacionDeToken: VerificacionDeHash: No validó la firma digital'),
        );

        const p = provider().authorizeInvoice(DELEGATED, invoice());
        await expect(p).rejects.toMatchObject(fault('AUTHORITY_AUTH', 'ARCA_AUTH'));
        await expect(p).rejects.not.toBeInstanceOf(DelegationNotAuthorizedError);
        // A genuine token fault evicts the shared delegate ticket so the next request re-mints.
        expect(invalidateDelegated).toHaveBeenCalledWith('ARCA', 'testing', 'wsfe');
    });

    it('leaves an authorization 600 UNTOUCHED on a non-delegated call (never a delegation error)', async () => {
        const thrown = tokenError('Usuario no autorizado a realizar esta operación');
        requestAuthorization.mockRejectedValue(thrown);

        // With no `delegated` flag the classifier does not run, so this stays a plain authority rejection
        // rather than the delegation `403`.
        await expect(provider().authorizeInvoice(ENTITY, invoice())).rejects.toMatchObject(
            fault('AUTHORITY_SERVICE', 'ARCA_SERVICE', thrown.message),
        );
    });

    it('leaves a 601 UNTOUCHED on a non-delegated call (classifier does not run)', async () => {
        const thrown = arcaError('601', 'CUIT representada no incluida en token');
        requestAuthorization.mockRejectedValue(thrown);

        await expect(provider().authorizeInvoice(ENTITY, invoice())).rejects.toMatchObject(
            fault('AUTHORITY_SERVICE', 'ARCA_SERVICE', thrown.message),
        );
    });

    it('leaves an ambiguous 600 as the original authority error (does not guess "delegation")', async () => {
        const thrown = tokenError('ValidacionDeToken: error interno del servicio');
        requestAuthorization.mockRejectedValue(thrown);

        await expect(provider().authorizeInvoice(DELEGATED, invoice())).rejects.toMatchObject(
            fault('AUTHORITY_SERVICE', 'ARCA_SERVICE', thrown.message),
        );
    });

    it('names our configured delegate CUIT — the CUIT the user must grant the service to', async () => {
        requestAuthorization.mockRejectedValue(arcaError('601', 'CUIT representada no incluida en token'));

        await expect(provider().authorizeInvoice(DELEGATED, invoice())).rejects.toMatchObject({
            delegateTaxId: DELEGATE_CUIT,
            issuerTaxId: '20111111112',
        });
    });

    it('classifies the 10016 RECOVERY query too, instead of reporting it as the original conflict', async () => {
        // Authorize hits ARCA's already-authorized conflict, so recovery queries the voucher...
        requestAuthorization.mockRejectedValue(arcaError('10016', 'El numero o fecha del comprobante no se corresponde'));
        // ...and the query reveals the real cause: our delegation for this representado is missing.
        queryVoucher.mockRejectedValue(arcaError('601', 'CUIT representada no incluida en token'));

        await expect(provider().authorizeInvoice(DELEGATED, invoice())).rejects.toBeInstanceOf(
            DelegationNotAuthorizedError,
        );
    });
});

describe('ArcaProvider.queryVoucher', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resolve.mockResolvedValue({token: 'T', sign: 'S', cuit: 20111111112});
    });

    it('returns the neutral result for an existing voucher', async () => {
        queryVoucher.mockResolvedValue(queriedAuthorized);

        const result = await new ArcaProvider().queryVoucher(ENTITY, 3, 1, 17);

        // Pinned positionally, because loosening the CbteTipo slot would hide a PtoVta/CbteTipo
        // transposition — which reads as a missing voucher.
        expect(queryVoucher).toHaveBeenCalledWith(expect.anything(), 3, 1, 17);
        expect(result.status).toBe('AUTHORIZED');
        expect(result.authorizationCode).toBe('75123456789012');
        // No QR: rebuilding it needs the invoice body, which `/query` does not receive.
        expect(result.qr).toBeUndefined();
    });

    /**
     * This endpoint is the only recovery path for observations core failed to persist off the authorize
     * response, so a `/query` answering with an empty list for an observed voucher would lose them for good.
     */
    it('returns the observations ARCA stored against the voucher', async () => {
        queryVoucher.mockResolvedValue({
            ...queriedAuthorized,
            observations: [{code: '10063', message: 'El comprobante fue autorizado con observaciones'}],
        });

        const result = await new ArcaProvider().queryVoucher(ENTITY, 3, 1, 17);

        expect(result.status).toBe('AUTHORIZED');
        expect(result.observations).toEqual([
            {code: '10063', message: 'El comprobante fue autorizado con observaciones'},
        ]);
    });

    it('translates ARCA 602 not-found to VoucherNotFoundError (→ 404, not a 502)', async () => {
        // Orphan reconciliation hinges on this: a never-issued voucher must be a deterministic not-found,
        // never a `502` that would leave the sale stuck pending.
        queryVoucher.mockRejectedValue(notFoundError);

        await expect(new ArcaProvider().queryVoucher(ENTITY, 3, 1, 42)).rejects.toMatchObject({
            name: 'VoucherNotFoundError',
            entityCode: 'ARCA',
            pointOfSaleNumber: 3,
            documentTypeCode: 1,
            voucherNumber: 42,
        });
        await expect(new ArcaProvider().queryVoucher(ENTITY, 3, 1, 42)).rejects.toBeInstanceOf(VoucherNotFoundError);
    });

    it('propagates a non-602 service error unchanged (stays a 502, sale kept PENDING)', async () => {
        // An auth or transport failure is not proof the voucher is missing, and must not masquerade as a
        // not-found, or core could clear an orphan that was in fact already authorized.
        const thrown = new ArcaServiceError('[600] token', [{code: '600', message: 'ValidacionDeToken'}]);
        queryVoucher.mockRejectedValue(thrown);

        await expect(new ArcaProvider().queryVoucher(ENTITY, 3, 1, 42)).rejects.toMatchObject(
            fault('AUTHORITY_SERVICE', 'ARCA_SERVICE', thrown.message),
        );
    });
});

describe('ArcaProvider.pointsOfSale', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resolve.mockResolvedValue({token: 'T', sign: 'S', cuit: 20111111112});
    });

    it('maps SDK points of sale to the neutral shape (blocked boolean; discharge date rendered ISO)', async () => {
        getPointsOfSale.mockResolvedValue([
            {number: 1, issuanceMode: 'CAE', blocked: false, dischargeDate: undefined},
            {number: 2, issuanceMode: 'CAEA', blocked: true, dischargeDate: '20240115'},
        ]);

        const result = await new ArcaProvider().pointsOfSale(ENTITY);

        expect(result.pointsOfSale).toEqual([
            {number: 1, issuanceMode: 'CAE', blocked: false, dischargeDate: undefined},
            {number: 2, issuanceMode: 'CAEA', blocked: true, dischargeDate: '2024-01-15T03:00:00.000Z'},
        ]);
    });

    it('returns an empty list when the entity has no registered points of sale', async () => {
        getPointsOfSale.mockResolvedValue([]);

        const result = await new ArcaProvider().pointsOfSale(ENTITY);

        expect(result.pointsOfSale).toEqual([]);
    });

    it('normalizes ARCA 602 "Sin Resultados" to an empty list (not a 502)', async () => {
        getPointsOfSale.mockRejectedValue(
            new ArcaServiceError('[602] Sin Resultados', [{code: '602', message: 'Sin Resultados'}]),
        );

        const result = await new ArcaProvider().pointsOfSale(ENTITY);

        expect(result.pointsOfSale).toEqual([]);
    });

    it('propagates a non-602 service error unchanged', async () => {
        const thrown = new ArcaServiceError('[600] token', [{code: '600', message: 'ValidacionDeToken'}]);
        getPointsOfSale.mockRejectedValue(thrown);

        await expect(new ArcaProvider().pointsOfSale(ENTITY)).rejects.toMatchObject(
            fault('AUTHORITY_SERVICE', 'ARCA_SERVICE', thrown.message),
        );
    });
});

describe('ArcaProvider.nextNumbers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resolve.mockResolvedValue({token: 'T', sign: 'S', cuit: 20111111112});
    });

    it('returns last-authorized + 1 per code, mapping never-authorized (0) to 1', async () => {
        // Codes [1, 6, 11] → ARCA last-authorized 17, 4, 0 (11 never authorized on this point of sale).
        getLastAuthorizedNumber.mockResolvedValueOnce(17).mockResolvedValueOnce(4).mockResolvedValueOnce(0);

        const result = await new ArcaProvider().nextNumbers(ENTITY, 3, [1, 6, 11]);

        expect(result.numbers).toEqual([
            {documentTypeCode: 1, nextNumber: 18},
            {documentTypeCode: 6, nextNumber: 5},
            {documentTypeCode: 11, nextNumber: 1},
        ]);
        // The ticket is resolved exactly once for the whole batch, not once per document type.
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(getLastAuthorizedNumber).toHaveBeenCalledTimes(3);
    });

    it('handles a single-element set the same as last-authorized + 1', async () => {
        getLastAuthorizedNumber.mockResolvedValue(41);

        const result = await new ArcaProvider().nextNumbers(ENTITY, 3, [1]);

        expect(result.numbers).toEqual([{documentTypeCode: 1, nextNumber: 42}]);
    });

    it('echoes each requested code so core can map the response back regardless of order', async () => {
        getLastAuthorizedNumber.mockResolvedValueOnce(0).mockResolvedValueOnce(9);

        const result = await new ArcaProvider().nextNumbers(ENTITY, 3, [11, 1]);

        expect(result.numbers.map((n) => n.documentTypeCode)).toEqual([11, 1]);
    });

    it('de-duplicates a repeated code: one call, one entry', async () => {
        // A duplicate used to spend a SOAP call per copy and put two entries in a `numbers` array core maps
        // back by code. One entry per distinct code still echoes every requested code.
        getLastAuthorizedNumber.mockResolvedValueOnce(17).mockResolvedValueOnce(4);

        const result = await new ArcaProvider().nextNumbers(ENTITY, 3, [1, 6, 1, 1]);

        expect(result.numbers).toEqual([
            {documentTypeCode: 1, nextNumber: 18},
            {documentTypeCode: 6, nextNumber: 5},
        ]);
        expect(getLastAuthorizedNumber).toHaveBeenCalledTimes(2);
    });

    it('still fails a duplicated unrecognized code rather than de-duplicating it into silence', async () => {
        // Validation runs over the original list, so dropping duplicates can never drop a `400`.
        await expect(new ArcaProvider().nextNumbers(ENTITY, 3, [9999, 9999])).rejects.toMatchObject(
            validationFault('UNKNOWN_CODE'),
        );
        expect(resolve).not.toHaveBeenCalled();
    });

    it('fails the whole batch on an unrecognized code, before any authority call (no silent omission)', async () => {
        // 9999 is not a known canonical CbteTipo → toCbteTipo throws up front.
        await expect(new ArcaProvider().nextNumbers(ENTITY, 3, [1, 9999])).rejects.toMatchObject(
            validationFault('UNKNOWN_CODE'),
        );
        // Validated before minting a ticket or issuing any FECompUltimoAutorizado call.
        expect(resolve).not.toHaveBeenCalled();
        expect(getLastAuthorizedNumber).not.toHaveBeenCalled();
    });
});

describe('PointsOfSaleRequestDto validation', () => {
    it('accepts a body carrying a well-formed entity block', async () => {
        const dto = plainToInstance(PointsOfSaleRequestDto, {
            entity: {entityCode: 'ARCA', issuerTaxId: '20111111112', environment: 'testing'},
        });
        expect(await validate(dto)).toHaveLength(0);
    });

    it('rejects a body with no entity (→ 400, not a controller NPE → 500)', async () => {
        const errors = await validate(plainToInstance(PointsOfSaleRequestDto, {}));
        expect(errors.map((e) => e.property)).toContain('entity');
    });
});

describe('NextNumbersRequestDto validation', () => {
    const entity = {entityCode: 'ARCA', issuerTaxId: '20111111112', environment: 'testing'};

    it('accepts a well-formed batch request', async () => {
        const dto = plainToInstance(NextNumbersRequestDto, {entity, pointOfSaleNumber: 3, documentTypeCodes: [1, 6, 11]});
        expect(await validate(dto)).toHaveLength(0);
    });

    it('rejects an empty documentTypeCodes array', async () => {
        const dto = plainToInstance(NextNumbersRequestDto, {entity, pointOfSaleNumber: 3, documentTypeCodes: []});
        expect((await validate(dto)).map((e) => e.property)).toContain('documentTypeCodes');
    });

    it('rejects a body with no entity (→ 400, not a controller NPE → 500)', async () => {
        const errors = await validate(plainToInstance(NextNumbersRequestDto, {pointOfSaleNumber: 3, documentTypeCodes: [1]}));
        expect(errors.map((e) => e.property)).toContain('entity');
    });
});

describe('NeutralInvoiceDto voucher-number validation', () => {
    function base(): Record<string, unknown> {
        return {
            documentTypeCode: 1,
            concept: 1,
            pointOfSaleNumber: 3,
            voucherNumberFrom: 17,
            voucherNumberTo: 17,
            receiver: {identificationTypeCode: 80, identificationNumber: '20111111112', fiscalConditionCode: 1},
            currencyIso: 'ARS',
            currencyRate: 1,
            issueDate: '2026-08-05',
            lines: [{netAmount: 100, taxRatePercent: 21, taxAmount: 21}],
        };
    }

    it('accepts a payload carrying the required voucher range', async () => {
        const errors = await validate(plainToInstance(NeutralInvoiceDto, base()));
        expect(errors).toHaveLength(0);
    });

    it('rejects a payload missing the voucher number (authoritative — no auto-number fallback)', async () => {
        const {voucherNumberFrom, voucherNumberTo, ...withoutRange} = base();
        const errors = await validate(plainToInstance(NeutralInvoiceDto, withoutRange));
        const failed = errors.map((e) => e.property);
        expect(failed).toContain('voucherNumberFrom');
        expect(failed).toContain('voucherNumberTo');
    });
});

describe('NeutralInvoiceDto — an invoice must carry an amount', () => {
    function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            documentTypeCode: 11,
            concept: 1,
            pointOfSaleNumber: 3,
            voucherNumberFrom: 17,
            voucherNumberTo: 17,
            receiver: {identificationTypeCode: 80, identificationNumber: '20111111112', fiscalConditionCode: 1},
            currencyIso: 'ARS',
            currencyRate: 1,
            issueDate: '2026-08-05',
            lines: [],
            ...overrides,
        };
    }

    it('rejects an invoice with neither lines nor totals, without a round-trip to the authority', async () => {
        // `@ArrayMinSize(1)` used to catch this as a side effect; once an empty `lines` became legitimate an
        // `ImpTotal` of 0 went out to ARCA to be rejected there.
        const errors = await validate(plainToInstance(NeutralInvoiceDto, base()));
        expect(errors.map((e) => e.property)).toContain('lines');
    });

    it('rejects an invoice whose only amounts are zeroes', async () => {
        const errors = await validate(
            plainToInstance(
                NeutralInvoiceDto,
                base({
                    lines: [{netAmount: 0, taxRatePercent: 21, taxAmount: 0}],
                    totals: {untaxed: 0, exempt: 0, perceptions: 0},
                }),
            ),
        );
        expect(errors.map((e) => e.property)).toContain('lines');
    });

    it.each([
        ['taxed lines alone', {lines: [{netAmount: 100, taxRatePercent: 21, taxAmount: 21}]}],
        ['header totals alone', {totals: {untaxed: 23564.5}}],
        ['a zero-rated declared base', {lines: [{netAmount: 100, taxRatePercent: 0, taxAmount: 0}]}],
        ['perceptions alone', {totals: {perceptions: 871.29}}],
    ])('accepts an invoice carrying %s', async (_name, overrides) => {
        const errors = await validate(plainToInstance(NeutralInvoiceDto, base(overrides)));
        expect(errors).toHaveLength(0);
    });
});

/**
 * Padrón lookups, which never carry an issuer: the provider looks up under this service's own delegated
 * identity. These tests pin that the ticket is resolved delegated for our delegate CUIT and the right
 * padrón service, and that the identification type rather than a wire flag picks that service.
 */
describe('ArcaProvider.lookupTaxpayers', () => {
    /** A delegate store with our certificate configured for `testing` only. */
    function delegateStore(configured = true): DelegateCredentialStore {
        return {
            get: (environment: string) =>
                configured && environment === 'testing'
                    ? {certPem: 'cert', keyPem: 'key', delegateCuit: DELEGATE_CUIT}
                    : undefined,
        } as unknown as DelegateCredentialStore;
    }

    function provider(configured = true) {
        return new ArcaProvider(delegateStore(configured));
    }

    function registration(taxId: string): TaxpayerData {
        return {
            detail: 'REGISTRATION',
            taxId,
            taxIdType: 'CUIT',
            personType: 'INDIVIDUAL',
            name: 'PEREZ JUAN',
            registrationStatus: 'ACTIVE',
            addresses: [],
            activities: [],
            taxes: [],
            providerMetadata: {service: CONSTANCIA_SERVICE},
        };
    }

    function identity(taxId: string): TaxpayerData {
        return {
            detail: 'IDENTITY',
            taxId,
            documentNumber: '11709676',
            addresses: [],
            activities: [],
            providerMetadata: {service: A13_SERVICE},
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        resolve.mockResolvedValue({token: 't', sign: 's', cuit: Number(DELEGATE_CUIT)});
    });

    it('routes a CUIT to the constancia service and signs with the delegate identity', async () => {
        constanciaGetTaxpayer.mockResolvedValue(registration('20111111112'));

        const result = await provider().lookupTaxpayers('testing', 80, '20111111112');

        expect(result).toEqual({
            entityCode: 'ARCA',
            detail: 'REGISTRATION',
            taxpayers: [expect.objectContaining({taxId: '20111111112', taxes: []})],
        });
        expect(constanciaGetTaxpayer).toHaveBeenCalledWith(expect.anything(), 20111111112);
        // `Auth.Cuit` is our own delegate CUIT: the padrón asks only that `cuitRepresentada` be in the
        // token's relations, so the service acts as itself rather than for anyone.
        expect(resolve).toHaveBeenCalledWith(
            'ARCA',
            DELEGATE_CUIT,
            CONSTANCIA_SERVICE,
            'testing',
            undefined,
            true,
        );
    });

    it.each([
        [86, 'CUIL'],
        [87, 'CDI'],
    ])('routes %s (%s) to the constancia service too', async (code) => {
        constanciaGetTaxpayer.mockResolvedValue(registration('20111111112'));

        await provider().lookupTaxpayers('testing', code, '20111111112');

        expect(constanciaGetTaxpayer).toHaveBeenCalled();
        expect(getIdPersonaList).not.toHaveBeenCalled();
    });

    it('resolves a DNI to every clave and returns one entry per match, on a single ticket', async () => {
        getIdPersonaList.mockResolvedValue(['23117096769', '27117096764']);
        identityGetTaxpayer.mockImplementation((_auth, id) => Promise.resolve(identity(String(id))));

        const result = await provider().lookupTaxpayers('testing', 96, '11709676');

        expect(result.detail).toBe('IDENTITY');
        expect(result.taxpayers.map((t) => t.taxId)).toEqual(['23117096769', '27117096764']);
        expect(getIdPersonaList).toHaveBeenCalledWith(expect.anything(), 11709676);
        // One A13 ticket serves the search and both follow-up reads.
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(resolve).toHaveBeenCalledWith('ARCA', DELEGATE_CUIT, A13_SERVICE, 'testing', undefined, true);
    });

    it('keeps the matches it can read when one clave turns out to be unreadable', async () => {
        getIdPersonaList.mockResolvedValue(['23117096769', '27117096764']);
        identityGetTaxpayer.mockImplementation((_auth, id) =>
            id === 23117096769
                ? Promise.reject(new ArcaTaxpayerNotFoundError('23117096769'))
                : Promise.resolve(identity(String(id))),
        );

        const result = await provider().lookupTaxpayers('testing', 96, '11709676');

        expect(result.taxpayers.map((t) => t.taxId)).toEqual(['27117096764']);
    });

    it('reports a document that matches no clave as a not-found, never an empty list', async () => {
        getIdPersonaList.mockResolvedValue([]);

        await expect(provider().lookupTaxpayers('testing', 96, '11709676')).rejects.toBeInstanceOf(
            TaxpayerNotFoundError,
        );
    });

    it('reports every clave being unreadable as a not-found', async () => {
        getIdPersonaList.mockResolvedValue(['23117096769']);
        identityGetTaxpayer.mockRejectedValue(new ArcaTaxpayerNotFoundError('23117096769'));

        await expect(provider().lookupTaxpayers('testing', 96, '11709676')).rejects.toBeInstanceOf(
            TaxpayerNotFoundError,
        );
    });

    it("translates the SDK's not-found into the neutral one, carrying the caller's identification pair", async () => {
        constanciaGetTaxpayer.mockRejectedValue(
            new ArcaTaxpayerNotFoundError('20111111112', 'No existe persona con ese Id'),
        );
        identityGetTaxpayer.mockRejectedValue(new ArcaTaxpayerNotFoundError('20111111112'));

        await expect(provider().lookupTaxpayers('testing', 80, '20111111112')).rejects.toMatchObject({
            name: 'TaxpayerNotFoundError',
            entityCode: 'ARCA',
            identificationTypeCode: 80,
            identificationNumber: '20111111112',
            // The constancia's wording rather than A13's: only one of the two padrones says why.
            authorityMessage: expect.stringContaining('No existe persona'),
        });
    });

    it('falls back to A13 when the constancia padrón has no such clave', async () => {
        // A13 is the superset: a clave with no inscripción registered against it is absent from the
        // constancia and readable in A13, so the miss is a reason to ask the other padrón rather than a
        // `404` for someone who exists.
        constanciaGetTaxpayer.mockRejectedValue(
            new ArcaTaxpayerNotFoundError('20111111112', 'No existe persona con ese Id'),
        );
        identityGetTaxpayer.mockResolvedValue(identity('20111111112'));

        const result = await provider().lookupTaxpayers('testing', 80, '20111111112');

        expect(result).toEqual({
            entityCode: 'ARCA',
            detail: 'IDENTITY',
            taxpayers: [expect.objectContaining({taxId: '20111111112', taxes: undefined})],
        });
        expect(identityGetTaxpayer).toHaveBeenCalledWith(expect.anything(), 20111111112);
        // Each padrón is a separate WSAA service, so the fallback signs with its own ticket.
        expect(resolve).toHaveBeenCalledWith('ARCA', DELEGATE_CUIT, CONSTANCIA_SERVICE, 'testing', undefined, true);
        expect(resolve).toHaveBeenCalledWith('ARCA', DELEGATE_CUIT, A13_SERVICE, 'testing', undefined, true);
    });

    it.each([
        [86, 'CUIL'],
        [87, 'CDI'],
    ])('falls back to A13 for %s (%s) as well, since getPersonaV2 takes any clave', async (code) => {
        constanciaGetTaxpayer.mockRejectedValue(new ArcaTaxpayerNotFoundError('20111111112'));
        identityGetTaxpayer.mockResolvedValue(identity('20111111112'));

        const result = await provider().lookupTaxpayers('testing', code, '20111111112');

        expect(result.detail).toBe('IDENTITY');
        expect(identityGetTaxpayer).toHaveBeenCalledWith(expect.anything(), 20111111112);
    });

    it('leaves A13 alone when the constancia answers, so the fallback costs nothing', async () => {
        constanciaGetTaxpayer.mockResolvedValue(registration('20111111112'));

        await provider().lookupTaxpayers('testing', 80, '20111111112');

        expect(identityGetTaxpayer).not.toHaveBeenCalled();
        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('surfaces a fallback that never reached A13 rather than calling it a not-found', async () => {
        // With the superset unread we do not know that nobody is registered: a `404` would state something
        // the service cannot stand behind, and would hide an enrolment only we can fix.
        constanciaGetTaxpayer.mockRejectedValue(
            new ArcaTaxpayerNotFoundError('20111111112', 'No existe persona con ese Id'),
        );
        resolve.mockImplementation((_entityCode, _issuerTaxId, service) =>
            service === A13_SERVICE
                ? Promise.reject(new ArcaSoapError('Computador no autorizado a acceder al servicio'))
                : Promise.resolve({token: 't', sign: 's', cuit: Number(DELEGATE_CUIT)}),
        );

        await expect(provider().lookupTaxpayers('testing', 80, '20111111112')).rejects.toMatchObject({
            name: 'DelegationNotConfiguredError',
            reason: expect.stringContaining(A13_SERVICE),
        });
    });

    it('does not ask A13 about a clave the constancia refused as malformed', async () => {
        // Only "no such clave" is worth a second registry; a bad id is a `400` A13 answers no better.
        const thrown = new ArcaValidationError('El Id de la persona no es valido', 'INVALID_ID');
        constanciaGetTaxpayer.mockRejectedValue(thrown);

        await expect(provider().lookupTaxpayers('testing', 80, '20111111112')).rejects.toMatchObject(
            validationFault('INVALID_ID'),
        );
        expect(identityGetTaxpayer).not.toHaveBeenCalled();
    });

    it('refuses an identification type no padrón service can answer for, before any login', async () => {
        await expect(provider().lookupTaxpayers('testing', 94, 'AAB123456')).rejects.toMatchObject(
            validationFault('UNSUPPORTED_IDENTIFICATION_TYPE'),
        );
        expect(resolve).not.toHaveBeenCalled();
    });

    it('refuses an unknown identification type with the shared UNKNOWN_CODE reason', async () => {
        await expect(provider().lookupTaxpayers('testing', 1234, '20111111112')).rejects.toMatchObject(
            validationFault('UNKNOWN_CODE'),
        );
    });

    it('rejects a non-numeric identification number before any login', async () => {
        await expect(provider().lookupTaxpayers('testing', 80, '20-11111111-2')).rejects.toMatchObject(
            validationFault('INVALID_ID'),
        );
        expect(resolve).not.toHaveBeenCalled();
    });

    it('reports a certificate not enrolled in the padrón service as a misconfiguration, not a 502', async () => {
        // `coe.notAuthorized` on this path is permanent and ours to fix, so surfacing the raw transport
        // error would tell core to retry something retrying cannot fix.
        resolve.mockRejectedValue(
            new ArcaSoapError('SOAP HTTP 500: <faultstring>Computador no autorizado a acceder al servicio</faultstring>'),
        );

        await expect(provider().lookupTaxpayers('testing', 80, '20111111112')).rejects.toMatchObject({
            name: 'DelegationNotConfiguredError',
            reason: expect.stringContaining('ws_sr_constancia_inscripcion'),
        });
    });

    it('reports a missing delegate certificate as a server misconfiguration', async () => {
        await expect(provider(false).lookupTaxpayers('testing', 80, '20111111112')).rejects.toBeInstanceOf(
            DelegationNotConfiguredError,
        );
        expect(resolve).not.toHaveBeenCalled();
    });

    it('evicts the delegate ticket when ARCA rejects it, so the next lookup re-mints', async () => {
        // One delegate ticket serves every lookup, so a ticket ARCA has started rejecting would fail all of
        // them until local expiry. The invoicing classifier cannot do this here: it keys on the in-payload
        // `Errors` block, which the padrón services never produce.
        constanciaGetTaxpayer.mockRejectedValue(new ArcaSoapError('No autorizado, par token/sign invalido.'));

        await expect(provider().lookupTaxpayers('testing', 80, '20111111112')).rejects.toMatchObject(
            fault('AUTHORITY_AUTH', 'ARCA_AUTH'),
        );
        expect(invalidateDelegated).toHaveBeenCalledWith('ARCA', 'testing', CONSTANCIA_SERVICE);
    });

    it('evicts on the A13 leg too, keyed on the A13 ticket rather than the constancia one', async () => {
        getIdPersonaList.mockRejectedValue(new ArcaSoapError('El ticket de acceso se encuentra vencido'));

        await expect(provider().lookupTaxpayers('testing', 96, '11709676')).rejects.toMatchObject(
            fault('AUTHORITY_AUTH', 'ARCA_AUTH'),
        );
        expect(invalidateDelegated).toHaveBeenCalledWith('ARCA', 'testing', A13_SERVICE);
    });

    it('keeps a valid ticket cached when the refusal is about enrolment, not the ticket', async () => {
        // ARCA will not re-issue a ticket while a prior one lives, so evicting a good one for a condition
        // re-minting cannot fix would break every lookup for ~12h to no purpose.
        const thrown = new ArcaSoapError('Computador no autorizado a acceder al servicio');
        constanciaGetTaxpayer.mockRejectedValue(thrown);

        // Still a transport fault rather than the auth fault an eviction would accompany.
        await expect(provider().lookupTaxpayers('testing', 80, '20111111112')).rejects.toMatchObject(
            fault('AUTHORITY_TRANSPORT', 'ARCA_SOAP', thrown.message),
        );
        expect(invalidateDelegated).not.toHaveBeenCalled();
    });

    it('never answers a lookup with a delegation error — it represents nobody', async () => {
        // `Auth.Cuit` is our own delegate CUIT, so a `403` here would name the same CUIT as both delegate
        // and issuer and ask the caller to grant itself a delegation.
        constanciaGetTaxpayer.mockRejectedValue(
            new ArcaServiceError('ARCA rejected the request', [
                {code: '600', message: 'Usuario no autorizado a realizar esta operación'},
            ]),
        );

        await expect(provider().lookupTaxpayers('testing', 80, '20111111112')).rejects.not.toBeInstanceOf(
            DelegationNotAuthorizedError,
        );
        expect(invalidateDelegated).not.toHaveBeenCalled();
    });
});

/**
 * The cotización batch. Like the padrón lookups these carry no issuer, a rate belonging to no tenant. What
 * these tests pin is what a caller cannot see from the response alone: which calls were made, and — for the
 * reference currency and the unknown code — that none were.
 */
describe('ArcaProvider.currencyRates', () => {
    function delegateStore(configured = true): DelegateCredentialStore {
        return {
            get: (environment: string) =>
                configured && environment === 'testing'
                    ? {certPem: 'cert', keyPem: 'key', delegateCuit: DELEGATE_CUIT}
                    : undefined,
        } as unknown as DelegateCredentialStore;
    }

    function provider(configured = true) {
        return new ArcaProvider(delegateStore(configured));
    }

    /** ARCA's `602 Sin Resultados` — the documented "nothing published for this code" answer. */
    const noResults = new ArcaServiceError('[602] Sin Resultados', [{code: '602', message: 'Sin Resultados'}]);

    beforeEach(() => {
        jest.clearAllMocks();
        resolve.mockResolvedValue({token: 't', sign: 's', cuit: Number(DELEGATE_CUIT)});
        // Pinned to the hour the day-semantics probe ran, overriding the suite-wide clock, so the fixtures
        // below can use the very days that measurement saw.
        jest.setSystemTime(new Date('2026-09-01T11:52:00-03:00'));
    });

    it('signs with the delegate identity on the wsfe service, naming no issuer', async () => {
        getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1465.5, rateDate: '20260827'});

        const result = await provider().currencyRates('testing', ['DOL']);

        // `Auth.Cuit` is our own delegate CUIT: no tenant certificate is involved, so a caller can cache
        // the answer centrally for every tenant.
        expect(resolve).toHaveBeenCalledWith('ARCA', DELEGATE_CUIT, 'wsfe', 'testing', undefined, true);
        expect(result.rates).toEqual([
            {
                currencyCode: 'DOL',
                rate: 1465.5,
                // The measured band: a 0.02R floor and an R + 4R ceiling.
                lowerLimit: 29.31,
                upperLimit: 7327.5,
                rateDate: '2026-08-27',
                // The clock is Tuesday 2026-09-01 and no day was asked for, so the answer is about today —
                // even though the row that answered closed on the 27th. Argentine midnight, rendered UTC.
                validFrom: '2026-09-01T03:00:00Z',
                validUntil: '2026-09-02T03:00:00Z',
                bandBasis: 'TOLERANCE',
            },
        ]);
        expect(result.publishedAt).toBe('2026-08-27');
        // The identity the contract states for a live request: `refreshAfter` IS the window's end. It holds
        // only because `clampToAuthorityToday` caps the requested day at today — loosen that clamp and the
        // answer would promise a refresh earlier than the rate it ships stops applying.
        expect(result.refreshAfter).toBe(result.rates[0].validUntil);
    });

    it('keys the applicability window on the day asked for, not on the row that answered', async () => {
        // The whole point of the field being ours rather than a caller's. Saturday, Sunday and Monday all
        // price off Friday's close: one `rate` and one `rateDate` between them, three distinct windows.
        getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1465.5, rateDate: '20260828'});

        const days = ['2026-08-29', '2026-08-30', '2026-08-31'];
        const rates = [];
        for (const day of days) {
            const result = await provider().currencyRates('testing', ['DOL'], day);
            rates.push(result.rates[0]);
        }

        expect(rates.map((r) => r.rateDate)).toEqual(['2026-08-28', '2026-08-28', '2026-08-28']);
        expect(rates.map((r) => r.validFrom)).toEqual([
            '2026-08-29T03:00:00Z',
            '2026-08-30T03:00:00Z',
            '2026-08-31T03:00:00Z',
        ]);
        // Contiguous and half-open, so no instant is priced twice and none is priced by nothing.
        expect(rates[0].validUntil).toBe(rates[1].validFrom);
        expect(rates[1].validUntil).toBe(rates[2].validFrom);
    });

    it('reports a backdated window entirely in the past, while refreshAfter stays ahead', async () => {
        // Applicability, not entitlement to serve. A window in the past is this answer stating which day it
        // priced — permanently — rather than claiming to be stale. `refreshAfter` is the one field that
        // still looks forward on this path, which is why it survived the arrival of the range.
        getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1465.5, rateDate: '20260814'});

        const result = await provider().currencyRates('testing', ['DOL'], '2026-08-17');

        expect(result.rates[0]).toMatchObject({
            validFrom: '2026-08-17T03:00:00Z',
            validUntil: '2026-08-18T03:00:00Z',
        });
        expect(new Date(result.rates[0].validUntil).getTime()).toBeLessThan(Date.now());
        expect(new Date(result.refreshAfter).getTime()).toBeGreaterThan(Date.now());
    });

    it('gives every rate in a batch the same window, even where their rateDates differ', async () => {
        // The window is a property of the question, so a thinly-traded code that walked further back than
        // the dollar still applies to the same day. Only `rateDate` records which publication answered.
        getCurrencyRate.mockImplementation(async (_auth, code, day) => {
            if (code === 'DOL') {
                return {monId: code, rate: 1465.5, rateDate: '20260831'};
            }
            return day === '20260828'
                ? {monId: code, rate: 1700, rateDate: '20260828'}
                : Promise.reject(noResults);
        });

        const result = await provider().currencyRates('testing', ['DOL', '060', 'PES'], '2026-09-01');

        expect(result.rates.map((r) => r.rateDate)).toEqual(['2026-09-01', '2026-08-31', '2026-08-28']);
        // Including the locally-answered peso row, which never touches the authority at all.
        expect(new Set(result.rates.map((r) => `${r.validFrom}/${r.validUntil}`))).toEqual(
            new Set(['2026-09-01T03:00:00Z/2026-09-02T03:00:00Z']),
        );
    });

    it('answers the reference currency locally, resolving no ticket at all', async () => {
        // A peso-only till must not be able to fail because the authority was unreachable, so this path
        // never touches the network — including for the ticket.
        const result = await provider().currencyRates('testing', ['PES']);

        expect(resolve).not.toHaveBeenCalled();
        expect(getCurrencyRate).not.toHaveBeenCalled();
        expect(result.rates).toEqual([
            expect.objectContaining({currencyCode: 'PES', rate: 1, lowerLimit: 1, upperLimit: 1, bandBasis: 'REFERENCE'}),
        ]);
        // Not a publication, so it must not claim to be one: a caller's schedule would otherwise read a
        // peso-only request as evidence the authority had posted.
        expect(result.publishedAt).toBeUndefined();
    });

    it('refuses an unknown code locally, without a ticket or a round trip', async () => {
        const result = await provider().currencyRates('testing', ['DOLL']);

        expect(resolve).not.toHaveBeenCalled();
        expect(result.rates).toEqual([]);
        expect(result.unavailable).toEqual([{currencyCode: 'DOLL', reason: 'UNKNOWN_CODE'}]);
    });

    it('enumerates the whole table when no codes are given, and never asks for the reference currency', async () => {
        getCurrencyTypes.mockResolvedValue([
            {id: 'PES', description: 'Pesos Argentinos', validFrom: '20090403'},
            {id: 'DOL', description: 'Dólar Estadounidense', validFrom: '20090403'},
            {id: '060', description: 'Euro', validFrom: '20090403'},
        ]);
        getCurrencyRate.mockImplementation(async (_auth, code) =>
            code === 'DOL'
                ? {monId: 'DOL', rate: 1465.5, rateDate: '20260827'}
                : {monId: '060', rate: 1700, rateDate: '20260826'},
        );

        const result = await provider().currencyRates('testing');

        expect(getCurrencyTypes).toHaveBeenCalledTimes(1);
        // `PES` is answered locally even on the whole-table path, so only the other two are fetched.
        expect(getCurrencyRate.mock.calls.map((c) => c[1])).toEqual(['DOL', '060']);
        expect(result.rates.map((r) => r.currencyCode)).toEqual(['PES', 'DOL', '060']);
        // The vintage is the latest publication in the batch: a thinly-traded code legitimately carries an
        // older day, so a shared `rateDate` cannot be promised.
        expect(result.publishedAt).toBe('2026-08-27');
    });

    it('serves only catalogue codes an invoice may also name, so the two endpoints agree', async () => {
        // The authority's catalogue is intersected with the codes `/invoices/authorize` accepts. Without it,
        // a sync surfaced a rate for a code authorization would then refuse — a currency a caller could
        // offer in a picker but never bill in.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            getCurrencyTypes.mockResolvedValue([
                {id: 'PES', description: 'Pesos Argentinos', validFrom: '20090403'},
                {id: 'DOL', description: 'Dólar Estadounidense', validFrom: '20090403'},
                {id: 'XXX', description: 'Something ARCA added since', validFrom: '20260101'},
            ]);
            getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1465.5, rateDate: '20260827'});

            const result = await provider().currencyRates('testing');

            expect(getCurrencyRate.mock.calls.map((c) => c[1])).toEqual(['DOL']);
            expect(result.rates.map((r) => r.currencyCode)).toEqual(['PES', 'DOL']);
            // Not `unavailable` either: reporting a code the caller never named would read as a failure.
            expect(result.unavailable).toBeUndefined();

            // Logged rather than silent: the daily sync is the only place this service could notice that
            // ARCA's catalogue has moved past its own list.
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toContain('XXX');
        } finally {
            warn.mockRestore();
        }
    });

    it('says nothing when the catalogue holds no codes it does not know', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            getCurrencyTypes.mockResolvedValue([
                {id: 'PES', description: 'Pesos Argentinos', validFrom: '20090403'},
                {id: 'DOL', description: 'Dólar Estadounidense', validFrom: '20090403'},
            ]);
            getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1465.5, rateDate: '20260827'});

            await provider().currencyRates('testing');

            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('reads a catalogue entry the same way on both tests, whatever its casing', async () => {
        // The two questions asked about one `Id` used to disagree, only one of them normalizing. Since `Id`
        // arrives through `text`, which trims but does not case-fold, a lower-cased entry was reported as
        // drift for a code already in the set and then sent to ARCA in a spelling it answers `12000` to.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            getCurrencyTypes.mockResolvedValue([
                {id: ' pes ', description: 'Pesos Argentinos', validFrom: '20090403'},
                {id: 'dol', description: 'Dólar Estadounidense', validFrom: '20090403'},
            ]);
            getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1465.5, rateDate: '20260827'});

            const result = await provider().currencyRates('testing');

            // Recognized, not reported as drift — and asked for in the catalogue's own spelling.
            expect(warn).not.toHaveBeenCalled();
            expect(getCurrencyRate.mock.calls.map((c) => c[1])).toEqual(['DOL']);
            // ` pes ` is still the reference currency, answered locally rather than fetched.
            expect(result.rates.map((r) => r.currencyCode)).toEqual(['PES', 'DOL']);
        } finally {
            warn.mockRestore();
        }
    });

    it('reports one unpublished currency under unavailable without failing the batch', async () => {
        getCurrencyRate.mockImplementation(async (_auth, code) => {
            if (code === '060') {
                throw noResults;
            }
            return {monId: code, rate: 1465.5, rateDate: '20260827'};
        });

        const result = await provider().currencyRates('testing', ['DOL', '060']);

        expect(result.rates.map((r) => r.currencyCode)).toEqual(['DOL']);
        expect(result.unavailable).toEqual([{currencyCode: '060', reason: 'NO_PUBLICATION'}]);
    });

    it('propagates a ticket fault instead of reporting every currency as unavailable', async () => {
        // The failure that must not be swallowed: our ticket fails every code identically, and reporting
        // that as "no currency has data" would let a caller cache nothing and stop asking.
        getCurrencyRate.mockRejectedValue(new ArcaAuthError('ARCA rejected the delegate ticket'));

        await expect(provider().currencyRates('testing', ['DOL', '060'])).rejects.toMatchObject({
            category: 'AUTHORITY_AUTH',
        });
    });

    it('stops asking once the ticket is refused, instead of finishing the table around the failure', async () => {
        // An auth error is the one failure `fetchRate` rethrows, and it is never about a single code — it is
        // our shared delegate ticket. So the batch is over the moment one arrives: every further call spends
        // a round trip on a credential already known to be rejected and re-runs the eviction, and a late
        // eviction can purge a ticket another request has since re-minted.
        //
        // The mixed case is what pins this and the all-fail case cannot: a rejection propagates out of the
        // worker's loop, so when every code fails each worker dies on its first item anyway. It is when the
        // other codes succeed that the surviving workers used to drain the whole list around the failure.
        const codes = [...ARCA_CURRENCY_CODES].filter((code) => code !== 'PES');
        expect(codes.length).toBeGreaterThan(CURRENCY_FAN_OUT_LIMIT);
        getCurrencyRate.mockImplementation(async (_auth, code) => {
            if (code === codes[0]) {
                throw new ArcaAuthError('ARCA rejected the delegate ticket');
            }
            return {monId: code, rate: 1465.5, rateDate: '20260827'};
        });

        await expect(provider().currencyRates('testing', codes)).rejects.toMatchObject({
            category: 'AUTHORITY_AUTH',
        });

        // The rejection surfaces before the healthy workers have had a turn to pull another index, so
        // asserting straight away would pass either way. Draining the microtask queue first lets the
        // workers that would have carried on actually do it. Microtasks rather than a timer, because this
        // suite runs on fake timers with `advanceTimers: false`.
        for (let turn = 0; turn < 500; turn += 1) {
            await Promise.resolve();
        }

        // Bounded by the fan-out width, the calls already in flight being uncancellable, never by the size
        // of the batch. Asserted against the limit rather than a literal, so re-tuning does not weaken it.
        expect(getCurrencyRate.mock.calls.length).toBeLessThanOrEqual(CURRENCY_FAN_OUT_LIMIT);
    });

    it('rethrows when EVERY code failed transiently, rather than claiming nothing is published', async () => {
        getCurrencyRate.mockRejectedValue(new ArcaSoapError('socket hang up'));

        await expect(provider().currencyRates('testing', ['DOL', '060'])).rejects.toBeDefined();
    });

    it('refuses to publish a rate the authority gave no usable day for', async () => {
        // ARCA can answer with a `MonCotiz` and an empty `FchCotiz`. Shipping that as a rate hands the
        // caller a row it is told to key by a day, with no day — and the fallback it would reach for is the
        // requested date, the one value the contract rules out. `060` proves the batch is unaffected.
        getCurrencyRate.mockImplementation(async (_auth, code) =>
            code === 'DOL'
                ? {monId: 'DOL', rate: 1465.5, rateDate: ''}
                : {monId: '060', rate: 1700, rateDate: '20260826'},
        );

        const result = await provider().currencyRates('testing', ['DOL', '060']);

        expect(result.rates.map((r) => r.currencyCode)).toEqual(['060']);
        expect(result.unavailable).toEqual([{currencyCode: 'DOL', reason: 'UPSTREAM_ERROR'}]);
        // The vintage comes only from the code that named a day.
        expect(result.publishedAt).toBe('2026-08-26');
    });

    it('refuses a day that is eight digits but not a real date', async () => {
        // `20261345` passes a bare `\d{8}` and would have surfaced as the `rateDate` `2026-13-45`.
        getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1465.5, rateDate: '20261345'});

        const result = await provider().currencyRates('testing', ['DOL']);

        expect(result.rates).toEqual([]);
        expect(result.unavailable).toEqual([{currencyCode: 'DOL', reason: 'UPSTREAM_ERROR'}]);
        expect(result.publishedAt).toBeUndefined();
    });

    it('refuses a rate the answer carried no usable number for, day or no day', async () => {
        // The number is guarded exactly as the day beside it. `0` is caught here rather than in the parser
        // because "a rate is positive" is ARCA's rule, and it is the more dangerous value: it would resolve
        // to the band `[0, 0]` with `bandBasis: "EXACT"`, telling a caller ARCA accepts exactly zero.
        for (const rate of [undefined, 0, -1]) {
            getCurrencyRate.mockResolvedValue({monId: 'DOL', rate, rateDate: '20260827'});

            const result = await provider().currencyRates('testing', ['DOL']);

            expect(result.rates).toEqual([]);
            expect(result.unavailable).toEqual([{currencyCode: 'DOL', reason: 'UPSTREAM_ERROR'}]);
            // Nothing shippable came back, so the batch claims no vintage either.
            expect(result.publishedAt).toBeUndefined();
        }
    });

    it('reports a flaky call and a genuine non-publication separately, without failing the batch', async () => {
        // No code produced a rate, but the batch still learned a per-code fact: `060` has no publication.
        // Keying "systemic" off the rate count alone conflated that with an outage and threw, losing the
        // `NO_PUBLICATION` a caller can act on.
        getCurrencyRate.mockImplementation(async (_auth, code) => {
            if (code === 'DOL') {
                throw new ArcaSoapError('socket hang up');
            }
            throw noResults;
        });

        const result = await provider().currencyRates('testing', ['DOL', '060']);

        expect(result.rates).toEqual([]);
        expect(result.unavailable).toEqual([
            {currencyCode: 'DOL', reason: 'UPSTREAM_ERROR'},
            {currencyCode: '060', reason: 'NO_PUBLICATION'},
        ]);
        // Nothing was published, so there is no vintage to claim — but the answer is still an answer.
        expect(result.publishedAt).toBeUndefined();
        expect(new Date(result.refreshAfter).getTime()).toBeGreaterThan(Date.now());
    });

    it('still fails the batch when a whole homologación table flakes, with no per-code fact anywhere', async () => {
        // The other side of the same line: every code failed the same transient way, so there is nothing to
        // report and caching "nothing is published here" would hide the outage.
        getCurrencyRate.mockRejectedValue(new ArcaSoapError('socket hang up'));

        await expect(provider().currencyRates('testing', ['DOL', '060', '002'])).rejects.toBeDefined();
    });

    it('fails a WHOLE-TABLE sync during a total outage, despite holding the local peso row', async () => {
        // The case the systemic rule exists for, and the one a merged-batch reading disables: the
        // whole-table path always emits `PES` locally, so "did this batch produce a rate" is trivially yes
        // however dead ARCA is. Counted that way, a sync during an outage returns `200` with one peso row
        // and every other code failed — which a caller then caches until tomorrow.
        getCurrencyTypes.mockResolvedValue([
            {id: 'PES', description: 'Pesos Argentinos', validFrom: '20090403'},
            {id: 'DOL', description: 'Dólar Estadounidense', validFrom: '20090403'},
            {id: '060', description: 'Euro', validFrom: '20090403'},
        ]);
        getCurrencyRate.mockRejectedValue(new ArcaSoapError('socket hang up'));

        await expect(provider().currencyRates('testing')).rejects.toMatchObject({
            category: 'AUTHORITY_TRANSPORT',
        });
    });

    it('fails a mixed request too — naming PES does not make an unreachable authority reportable', async () => {
        // The peso's independence is protected by never calling: a request naming only codes we answer
        // ourselves returns before a ticket is resolved, as pinned above. This one also asked about the
        // dollar, so it asked about the authority, and an unreachable authority is what it is told.
        getCurrencyRate.mockRejectedValue(new ArcaSoapError('socket hang up'));

        await expect(provider().currencyRates('testing', ['PES', 'DOL'])).rejects.toMatchObject({
            category: 'AUTHORITY_TRANSPORT',
        });
    });

    it('still reports when the authority itself answered about even one code', async () => {
        // Where the rule draws the line: `060`'s `602` is the authority stating a fact about that code, so
        // the batch learned something and reports rather than failing.
        getCurrencyRate.mockImplementation(async (_auth, code) => {
            if (code === 'DOL') {
                throw new ArcaSoapError('socket hang up');
            }
            throw noResults;
        });

        const result = await provider().currencyRates('testing', ['DOLL', 'DOL', '060']);

        expect(result.rates).toEqual([]);
        expect(result.unavailable).toEqual([
            {currencyCode: 'DOLL', reason: 'UNKNOWN_CODE'},
            {currencyCode: 'DOL', reason: 'UPSTREAM_ERROR'},
            {currencyCode: '060', reason: 'NO_PUBLICATION'},
        ]);
    });

    it('rethrows the first failure by REQUEST order, not by whichever call settled first', async () => {
        // Eight calls run in flight, so picking the first tolerated failure off a variable the workers close
        // over picked whichever socket died first — a message that changed run to run. Here the code asked
        // about first fails last, so a completion-ordered pick would report `060`.
        //
        // Deferred by draining microtasks rather than a timer: this suite runs on fake timers with
        // `advanceTimers: false`, so a `setTimeout` never fires and the call would hang.
        getCurrencyRate.mockImplementation(async (_auth, code) => {
            if (code === 'DOL') {
                for (let turn = 0; turn < 10; turn += 1) {
                    await Promise.resolve();
                }
                throw new ArcaSoapError('dollar hung up');
            }
            throw new ArcaSoapError('euro hung up');
        });

        await expect(provider().currencyRates('testing', ['DOL', '060'])).rejects.toThrow('dollar hung up');
    });

    it('evicts the delegate ticket on a genuine WSFEv1 token fault', async () => {
        // The `wsfe` half of the eviction: a credential fault arrives as an in-payload `Errors` block
        // rather than the SOAP fault the padrón services raise, so it has to be recognized by code.
        getCurrencyRate.mockRejectedValue(
            new ArcaServiceError('[600] ValidacionDeToken: Token expirado', [
                {code: '600', message: 'ValidacionDeToken: Token expirado'},
            ]),
        );

        await expect(provider().currencyRates('testing', ['DOL'])).rejects.toMatchObject({
            category: 'AUTHORITY_AUTH',
        });
        expect(invalidateDelegated).toHaveBeenCalledWith('ARCA', 'testing', 'wsfe');
    });

    it('KEEPS the delegate ticket when a 600 names who is refused rather than the credential', async () => {
        // The regression: WSFEv1 prefixes every overloaded `600` with `ValidacionDeToken:`, so a substring
        // classifier read this enrolment rejection as a credential fault and purged the shared `wsfe`
        // delegate ticket, which ARCA will not re-mint for ~12h. The ticket is valid here; the enrolment is
        // what is missing, and re-minting cannot supply it.
        getCurrencyRate.mockRejectedValue(
            new ArcaServiceError('[600] ValidacionDeToken: No apareció CUIT en lista de relaciones', [
                {code: '600', message: 'ValidacionDeToken: No apareció CUIT en lista de relaciones'},
            ]),
        );

        await expect(provider().currencyRates('testing', ['DOL'])).rejects.toMatchObject({
            category: 'AUTHORITY_SERVICE',
        });
        expect(invalidateDelegated).not.toHaveBeenCalled();
    });

    it('tolerates one transient failure when others succeeded', async () => {
        getCurrencyRate.mockImplementation(async (_auth, code) => {
            if (code === '060') {
                throw new ArcaSoapError('socket hang up');
            }
            return {monId: code, rate: 1465.5, rateDate: '20260827'};
        });

        const result = await provider().currencyRates('testing', ['DOL', '060']);

        expect(result.rates.map((r) => r.currencyCode)).toEqual(['DOL']);
        expect(result.unavailable).toEqual([{currencyCode: '060', reason: 'UPSTREAM_ERROR'}]);
    });

    it('asks for the previous WORKING day, converting an instant to the AR day first', async () => {
        // ARCA labels a row by the business day it closed on, so Tuesday the 25th is priced off Monday the
        // 24th. A same-day case would hide this: today has no row either way, so only a backdated sale can
        // tell the two readings apart.
        getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1452, rateDate: '20260824'});

        await provider().currencyRates('testing', ['DOL'], '2026-08-25');
        expect(getCurrencyRate).toHaveBeenLastCalledWith(expect.anything(), 'DOL', '20260824');

        // 01:00Z on the 12th is 22:00 on the 11th in Buenos Aires, and slicing the string verbatim would
        // read the 12th. The 11th is a Saturday, so the working-day rule takes it back to Friday the 10th.
        await provider().currencyRates('testing', ['DOL'], '2026-07-12T01:00:00Z');
        expect(getCurrencyRate).toHaveBeenLastCalledWith(expect.anything(), 'DOL', '20260710');
    });

    it('resolves a Monday to Friday in one read, and applies that in TESTING too', async () => {
        // Weekends are skipped rather than probed, so a Monday costs one read. The rule is production's in
        // every environment: homologación serves weekend rows, and following those would make a testing
        // sale agree with generated data and disagree with ARCA.
        getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1512, rateDate: '20260828'});

        const result = await provider().currencyRates('testing', ['DOL'], '2026-08-31');

        expect(getCurrencyRate).toHaveBeenCalledTimes(1);
        expect(getCurrencyRate).toHaveBeenCalledWith(expect.anything(), 'DOL', '20260828');
        expect(result.rates[0]?.rateDate).toBe('2026-08-28');
    });

    it('walks back a day on a 602 and reports the day that ANSWERED', async () => {
        // The case only the authority can settle. A `602` is its own statement that it holds no row for
        // that day, so the lookup steps back rather than reporting the currency as unpublished.
        getCurrencyRate.mockImplementation(async (_auth, code, day) =>
            day === '20260826'
                ? {monId: code, rate: 1461.25, rateDate: '20260826'}
                : Promise.reject(noResults),
        );

        const result = await provider().currencyRates('testing', ['DOL'], '2026-08-31');

        // Asked in order, working days only, so a `602` on a candidate means "that day was a feriado" and
        // never "that day was a Sunday" — the case a weekday rule cannot cover and the authority can. The
        // sequence is pinned, not just the outcome.
        expect(getCurrencyRate.mock.calls.map((c) => c[2])).toEqual(['20260828', '20260827', '20260826']);
        // `rateDate` is ARCA's echoed `FchCotiz`, never a day this service chose: it is the only record of
        // which publication the voucher was actually priced against.
        expect(result.rates).toEqual([expect.objectContaining({currencyCode: 'DOL', rateDate: '2026-08-26'})]);
        expect(result.publishedAt).toBe('2026-08-26');
    });

    it('gives up after the bounded walk and reports NO_PUBLICATION', async () => {
        getCurrencyRate.mockRejectedValue(noResults);

        const result = await provider().currencyRates('testing', ['DOL'], '2026-08-31');

        // Bounded deliberately: a currency ARCA has no publication for at all answers `602` on every
        // candidate. Five calls, not "until something answers".
        expect(getCurrencyRate).toHaveBeenCalledTimes(RATE_DAY_RULE.walkBackLimit + 1);
        expect(result.unavailable).toEqual([{currencyCode: 'DOL', reason: 'NO_PUBLICATION'}]);
    });

    it('never walks when no day was asked about', async () => {
        // An absent `FchCotiz` means "the latest row", so a `602` against it is a fact about the currency
        // rather than a day — asking again could only produce the same answer at four times the cost.
        getCurrencyRate.mockRejectedValue(noResults);

        const result = await provider().currencyRates('testing', ['DOL']);

        expect(getCurrencyRate).toHaveBeenCalledTimes(1);
        expect(getCurrencyRate).toHaveBeenCalledWith(expect.anything(), 'DOL', undefined);
        expect(result.unavailable).toEqual([{currencyCode: 'DOL', reason: 'NO_PUBLICATION'}]);
    });

    it('does not walk for a failure that says nothing about the day', async () => {
        // A `12000` says the code is not in the catalogue and a socket failure says we could not ask. Both
        // answer identically on every candidate, so re-asking spends four reads to learn the same thing.
        getCurrencyRate.mockRejectedValue(
            new ArcaServiceError('[12000] Moneda inexistente', [{code: '12000', message: 'Moneda inexistente'}]),
        );
        expect((await provider().currencyRates('testing', ['DOL'], '2026-08-31')).unavailable).toEqual([
            {currencyCode: 'DOL', reason: 'UNKNOWN_CODE'},
        ]);
        expect(getCurrencyRate).toHaveBeenCalledTimes(1);

        jest.clearAllMocks();
        resolve.mockResolvedValue({token: 't', sign: 's', cuit: Number(DELEGATE_CUIT)});
        getCurrencyRate.mockRejectedValue(new ArcaSoapError('socket hang up'));
        await expect(provider().currencyRates('testing', ['DOL'], '2026-08-31')).rejects.toMatchObject({
            category: 'AUTHORITY_TRANSPORT',
        });
        expect(getCurrencyRate).toHaveBeenCalledTimes(1);
    });

    it('does not walk when the authority answered unintelligibly', async () => {
        // A `MonCotiz` of 0 is not a day with no row but the authority answering something unusable, so
        // re-asking would report a broken response as absent data.
        getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 0, rateDate: '20260830'});

        const result = await provider().currencyRates('testing', ['DOL'], '2026-08-31');

        expect(getCurrencyRate).toHaveBeenCalledTimes(1);
        expect(result.unavailable).toEqual([{currencyCode: 'DOL', reason: 'UPSTREAM_ERROR'}]);
    });

    it('clamps a future day to today before asking, per 10038 second clause', async () => {
        // A voucher dated later than today is priced off the working day before today, the authority not
        // having published for a day that has not happened. Without the clamp this asked about 2027 and
        // spent the whole walk-back finding out.
        getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1465.5, rateDate: '20260831'});
        // The clock is pinned to Tuesday 2026-09-01, so the previous working day is Monday the 31st.
        const expected = '20260831';

        await provider().currencyRates('testing', ['DOL'], '2027-12-31');

        expect(getCurrencyRate).toHaveBeenCalledTimes(1);
        expect(getCurrencyRate).toHaveBeenCalledWith(expect.anything(), 'DOL', expected);
    });

    it('asks every code in a batch about the same day, in the same order', async () => {
        // Batched for consistency: a set where the dollar is one publication and the euro another is what
        // this endpoint exists to prevent, and resolving the days per code would reintroduce it.
        getCurrencyRate.mockImplementation(async (_auth, code, day) =>
            day === '20260827'
                ? {monId: code, rate: 1461.25, rateDate: '20260827'}
                : Promise.reject(noResults),
        );

        const result = await provider().currencyRates('testing', ['DOL', '060'], '2026-08-31');

        expect(result.rates.map((r) => r.rateDate)).toEqual(['2026-08-27', '2026-08-27']);
        expect(getCurrencyRate.mock.calls.filter((c) => c[1] === 'DOL').map((c) => c[2])).toEqual(
            getCurrencyRate.mock.calls.filter((c) => c[1] === '060').map((c) => c[2]),
        );
    });

    it('rejects a zoneless datetime before minting a ticket', async () => {
        await expect(
            provider().currencyRates('testing', ['DOL'], '2026-08-25T22:00:00'),
        ).rejects.toMatchObject({category: 'VALIDATION'});
        expect(resolve).not.toHaveBeenCalled();
    });

    it('reads an explicit null for either optional field as the omitted case', async () => {
        // `@IsOptional()` skips a property's validators for `null` as well as `undefined`, so an explicit
        // `null` arrives here unvalidated. Read strictly the two threw a `TypeError` — a `500` for a body
        // that names the whole table at the latest publication.
        getCurrencyTypes.mockResolvedValue([
            {id: 'PES', description: 'Pesos Argentinos', validFrom: '20090403'},
            {id: 'DOL', description: 'Dólar Estadounidense', validFrom: '20090403'},
        ]);
        getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1465.5, rateDate: '20260827'});

        const result = await provider().currencyRates(
            'testing',
            null as unknown as undefined,
            null as unknown as undefined,
        );

        expect(getCurrencyTypes).toHaveBeenCalledTimes(1);
        // `null` date means "latest publication" — no `FchCotiz` on the wire, not an empty one.
        expect(getCurrencyRate).toHaveBeenLastCalledWith(expect.anything(), 'DOL', undefined);
        expect(result.rates.map((r) => r.currencyCode)).toEqual(['PES', 'DOL']);
    });

    it('de-duplicates and normalizes requested codes', async () => {
        getCurrencyRate.mockResolvedValue({monId: 'DOL', rate: 1465.5, rateDate: '20260827'});

        const result = await provider().currencyRates('testing', ['dol', 'DOL', ' DOL ']);

        expect(getCurrencyRate).toHaveBeenCalledTimes(1);
        expect(result.rates).toHaveLength(1);
    });

    it('always reports refreshAfter, in the future, even when nothing is available', async () => {
        getCurrencyRate.mockRejectedValue(noResults);

        const result = await provider().currencyRates('testing', ['DOL']);

        expect(result.rates).toEqual([]);
        expect(result.unavailable).toEqual([{currencyCode: 'DOL', reason: 'NO_PUBLICATION'}]);
        // The all-unavailable case is precisely the one a client would otherwise poll hot, and the one no
        // applicability range can answer — there is no rate to carry one. That is why the field outlived
        // the range rather than being retired with it.
        expect(new Date(result.refreshAfter).getTime()).toBeGreaterThan(Date.now());
        expect(result.refreshAfter.endsWith('Z')).toBe(true);
    });

    it('reports a missing delegate certificate as a server misconfiguration, not an authority failure', async () => {
        // A neutral error rather than a provider fault: it passes through untouched to a `500`, never a
        // `502`, because no amount of retrying installs a certificate.
        await expect(provider(false).currencyRates('testing', ['DOL'])).rejects.toBeInstanceOf(
            DelegationNotConfiguredError,
        );
    });
});

/**
 * The currency fields during the migration window. `currencyIso` is optional now, so what its being
 * required used to guarantee — that a voucher names a currency at all — has to be asserted.
 */
describe('NeutralInvoiceDto — exactly one currency field', () => {
    function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        const {currencyIso, currencyCode, ...rest} = {
            documentTypeCode: 1,
            concept: 1,
            pointOfSaleNumber: 3,
            voucherNumberFrom: 17,
            voucherNumberTo: 17,
            receiver: {identificationTypeCode: 80, identificationNumber: '20111111112', fiscalConditionCode: 1},
            currencyRate: 1,
            issueDate: '2026-08-05',
            lines: [{netAmount: 100, taxRatePercent: 21, taxAmount: 21}],
            ...overrides,
        } as Record<string, unknown>;
        // Only the keys the case actually set, so absent means absent rather than present-and-undefined —
        // the distinction the validator turns on.
        return {
            ...rest,
            ...(currencyIso === undefined ? {} : {currencyIso}),
            ...(currencyCode === undefined ? {} : {currencyCode}),
        };
    }

    it('accepts the new canonical code alone', async () => {
        const errors = await validate(plainToInstance(NeutralInvoiceDto, base({currencyCode: 'DOL'})));
        expect(errors).toHaveLength(0);
    });

    it('accepts the deprecated ISO code alone, so the window is real', async () => {
        const errors = await validate(plainToInstance(NeutralInvoiceDto, base({currencyIso: 'ARS'})));
        expect(errors).toHaveLength(0);
    });

    it('rejects BOTH — the failure that would file a peso voucher for a dollar sale', async () => {
        // A silent preference would let `{currencyIso: "USD", currencyCode: "PES"}` through and produce a
        // peso voucher for a dollar sale. Refusing the pair turns that caller bug into a `400`.
        const errors = await validate(
            plainToInstance(NeutralInvoiceDto, base({currencyIso: 'USD', currencyCode: 'PES'})),
        );
        expect(errors.map((e) => e.property)).toContain('currencyRate');
    });

    it('rejects NEITHER, which relaxing currencyIso would otherwise have allowed', async () => {
        const errors = await validate(plainToInstance(NeutralInvoiceDto, base()));
        expect(errors.map((e) => e.property)).toContain('currencyRate');
    });

    it('allows a zero-padded and a longer-than-three code', async () => {
        // `002` and `060` are zero-padded and the padding is part of the code, and ARCA types `MonId` as
        // `String(8)` on the cotización response — so a fixed width of three would be wrong.
        for (const currencyCode of ['002', '060', 'RUB', 'ABCDEFGH']) {
            const errors = await validate(plainToInstance(NeutralInvoiceDto, base({currencyCode})));
            expect(errors).toHaveLength(0);
        }
    });

    it('rejects a code longer than the catalogue could hold', async () => {
        const errors = await validate(plainToInstance(NeutralInvoiceDto, base({currencyCode: 'TOOLONGCODE'})));
        expect(errors.map((e) => e.property)).toContain('currencyCode');
    });
});

/**
 * The date rule at the boundary. The provider refuses these too, but a `400` from the DTO is what a caller
 * actually meets, and what keeps a zoneless datetime from ever reaching `new Date`.
 */
describe('NeutralInvoiceDto — authority date fields', () => {
    function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            documentTypeCode: 1,
            concept: 1,
            pointOfSaleNumber: 3,
            voucherNumberFrom: 17,
            voucherNumberTo: 17,
            receiver: {identificationTypeCode: 80, identificationNumber: '20111111112', fiscalConditionCode: 1},
            currencyCode: 'PES',
            currencyRate: 1,
            issueDate: '2026-08-05',
            lines: [{netAmount: 100, taxRatePercent: 21, taxAmount: 21}],
            ...overrides,
        };
    }

    it('accepts a calendar day and a zone-qualified instant', async () => {
        for (const issueDate of ['2026-08-05', '2026-07-12T01:00:00Z', '2026-07-11T22:00:00-03:00']) {
            const errors = await validate(plainToInstance(NeutralInvoiceDto, base({issueDate})));
            expect(errors).toHaveLength(0);
        }
    });

    it('rejects a datetime with no timezone — the form that resolved per deployment', async () => {
        for (const issueDate of ['2026-08-26T01:00:00', '2026-08-05 12:00:00']) {
            const errors = await validate(plainToInstance(NeutralInvoiceDto, base({issueDate})));
            expect(errors.map((e) => e.property)).toContain('issueDate');
        }
    });

    it('rejects the loose ISO-8601 forms @IsISO8601 used to admit', async () => {
        for (const issueDate of ['2026-W01-1', '2026-366', '20260231', '2026-02-31']) {
            const errors = await validate(plainToInstance(NeutralInvoiceDto, base({issueDate})));
            expect(errors.map((e) => e.property)).toContain('issueDate');
        }
    });

    it('applies the same rule to the service and payment dates', async () => {
        for (const field of ['serviceDateFrom', 'serviceDateTo', 'paymentDueDate']) {
            const errors = await validate(
                plainToInstance(NeutralInvoiceDto, base({concept: 2, [field]: '2026-08-26T01:00:00'})),
            );
            expect(errors.map((e) => e.property)).toContain(field);
        }
    });
});

/** The credential-free rate request; no entity block by design. */
describe('CurrencyRatesRequestDto validation', () => {
    it('accepts the daily-sync shape: entity and environment only', async () => {
        const errors = await validate(
            plainToInstance(CurrencyRatesRequestDto, {entityCode: 'ARCA', environment: 'production'}),
        );
        expect(errors).toHaveLength(0);
    });

    it('accepts a single code and a day', async () => {
        const errors = await validate(
            plainToInstance(CurrencyRatesRequestDto, {
                entityCode: 'ARCA',
                environment: 'production',
                currencyCodes: ['DOL'],
                date: '2026-08-25',
            }),
        );
        expect(errors).toHaveLength(0);
    });

    it('refuses an empty code list rather than reading it as "the whole table"', async () => {
        // The two mean different things: omitting the field asks for everything, `[]` for nothing. A caller
        // sending `[]` has a bug, not an intention.
        const errors = await validate(
            plainToInstance(CurrencyRatesRequestDto, {
                entityCode: 'ARCA',
                environment: 'production',
                currencyCodes: [],
            }),
        );
        expect(errors.map((e) => e.property)).toContain('currencyCodes');
    });

    it('refuses a zoneless datetime for the requested day', async () => {
        const errors = await validate(
            plainToInstance(CurrencyRatesRequestDto, {
                entityCode: 'ARCA',
                environment: 'production',
                date: '2026-08-25T22:00:00',
            }),
        );
        expect(errors.map((e) => e.property)).toContain('date');
    });
});
