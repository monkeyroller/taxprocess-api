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
    type CommonInvoiceResult,
    type PointOfSaleInfo,
    type TaxpayerData,
} from '../sdk/index.js';
import {
    DelegationNotAuthorizedError,
    DelegationNotConfiguredError,
    TaxpayerNotFoundError,
    VoucherNotFoundError,
    type EntityAuthBlock,
    type ProviderFaultCategory,
    type NeutralInvoice,
} from '../../provider/provider.js';
import type {DelegateCredentialStore} from '../auth/delegate-credentials/delegate-credentials.js';
import {NeutralInvoiceDto, NextNumbersRequestDto, PointsOfSaleRequestDto} from '../../../http/dto/invoice.dto.js';

/**
 * The provider reaches ARCA through two module-level singletons — the ticket store and the
 * per-environment invoice service. We mock both (ESM `unstable_mockModule`, resolved before the dynamic
 * `import` of the provider) so the test exercises the numbering decision + the real invoice mapper without
 * any network. Contract 2026-08-10: core owns the voucher number; the service authorizes exactly what it
 * sent and never computes the next correlative for authorize.
 */

const getLastAuthorizedNumber = jest.fn<() => Promise<number>>();
const requestAuthorization = jest.fn<(auth: unknown, req: any) => Promise<CommonInvoiceResult>>();
const queryVoucher = jest.fn<(auth: unknown, sp: number, vt: number, n: number) => Promise<CommonInvoiceResult>>();
const getPointsOfSale = jest.fn<() => Promise<Array<PointOfSaleInfo>>>();
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
    commonInvoiceService: () => ({getLastAuthorizedNumber, requestAuthorization, queryVoucher, getPointsOfSale}),
    // The padrón factories return their concrete services, each carrying the WSAA service id the provider
    // keys the ticket on — so the fakes must expose `service` too, not just the operations.
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

const {ArcaProvider} = await import('./arca.provider.js');

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
 * What `queryVoucher` returns for an already-authorized voucher 17 — every field
 * `assertRecoveredVoucherMatches` checks matches the default `invoice()`: total 121, CUIT 20111111112/
 * DocTipo 80, concept 1, currency PES, voucher date 20260805, CondicionIVAReceptorId 1.
 *
 * Values are STRINGS on purpose: the SOAP client parses with `parseTagValue: false`, so this is the shape
 * the guard actually sees in production. Stubbing numbers here would hide how a blank element behaves.
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
 * `authorizeInvoice` builds its request against the real clock (`new Date()`), and concept-1 vouchers
 * now reject an out-of-window `issueDate` instead of clamping it (contract 2026-08-20). Pinning the clock
 * to the default `invoice()`'s issue date keeps every authorize test deterministic regardless of when the
 * suite actually runs, rather than going stale the moment real "now" drifts more than 5 days past 2026-08-05.
 */
beforeEach(() => {
    jest.useFakeTimers({advanceTimers: false});
    jest.setSystemTime(new Date('2026-08-05T12:00:00-03:00'));
});

afterEach(() => {
    jest.useRealTimers();
});

/**
 * The neutral shape an ARCA failure reaches a caller in. `TaxEntityProvider` translates every
 * provider-native error on the way out of a public method, so "this error propagates untouched" is asserted
 * as the fault it translates to - same category, same wire code, same message - rather than as object
 * identity against the SDK class. Which SDK error maps to which category is pinned in `faults.test.ts`.
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
     * ARCA routinely authorizes a voucher AND observes it. The observations must reach core on the approved
     * path, since nothing in this service logs or otherwise retains them (`docs/CONTRACT.md`,
     * `/invoices/authorize`) — dropped here they are recoverable only by re-querying ARCA.
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
     * The idempotent-recovery trigger is a `10016` *rejection*. ARCA attaching `10016` to an APPROVED voucher
     * must not send us reconciling: the CAE in hand is the authoritative one, and querying instead would risk
     * replacing a fresh approval with the mismatch guard's refusal.
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
     * A recovered result is built from the *queried* voucher, so it carries the observations ARCA stored
     * against it — not the `10016` from the rejected re-send. That is what makes `/invoices/query` a usable
     * recovery path for observations core failed to persist the first time.
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
        // `<CondicionIVAReceptorId/>` on a voucher predating RG 5616 parses to ''. `Number('')` is a
        // perfectly finite 0, so coercing first would report a confirmed mismatch against the sent 1 and
        // wedge a legitimate retry forever. Same trap for every numeric field, and for a blank MonId.
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
        // Judging the date first would 400 it before recovery ever ran, orphaning a voucher number ARCA
        // has already consumed — the exact case the idempotency guarantee exists for.
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
        // A thrown error that is NOT the 10016 already-authorized conflict must never trigger a reconciliation
        // query — otherwise a coincidentally authorized voucher at the same number could mask the real failure.
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
        // 601 is a missing delegation, not a token fault — the ticket is valid, so it must NOT be evicted.
        expect(invalidateDelegated).not.toHaveBeenCalled();
    });

    it('maps an authorization-flavored 600 on a delegated call to DelegationNotAuthorizedError (→ 403)', async () => {
        requestAuthorization.mockRejectedValue(
            tokenError('No se corresponden token y firma. Usuario no autorizado a realizar esta operación'),
        );

        await expect(provider().authorizeInvoice(DELEGATED, invoice())).rejects.toBeInstanceOf(
            DelegationNotAuthorizedError,
        );
        // The delegate ticket is valid — only the delegation is missing — so it must NOT be evicted.
        expect(invalidateDelegated).not.toHaveBeenCalled();
    });

    it('maps a LAPSED representación (worded as an expiry) to a delegation error, not a token fault', async () => {
        // The message matches both classifiers. Reading it as a token fault would return a retryable 502
        // instead of the actionable 403 AND evict the delegate ticket every representado shares — for a
        // permanent condition, so every retry re-evicts and delegated invoicing stays wedged.
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
        // A genuine token fault ⇒ evict the shared delegate ticket so the next request re-mints.
        expect(invalidateDelegated).toHaveBeenCalledWith('ARCA', 'testing', 'wsfe');
    });

    it('leaves an authorization 600 UNTOUCHED on a non-delegated call (never a delegation error)', async () => {
        const thrown = tokenError('Usuario no autorizado a realizar esta operación');
        requestAuthorization.mockRejectedValue(thrown);

        // ENTITY has no `delegated` flag → the classifier does not run, so this stays a plain authority
        // rejection (never the delegation 403) through the neutral translation.
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

        // Pinned positionally: point of sale 3, CbteTipo 1 (canonical code 1 → ARCA 1), number 17. Loosening
        // the CbteTipo slot would hide a PtoVta/CbteTipo transposition, which reads as a missing voucher.
        expect(queryVoucher).toHaveBeenCalledWith(expect.anything(), 3, 1, 17);
        expect(result.status).toBe('AUTHORIZED');
        expect(result.authorizationCode).toBe('75123456789012');
        // No QR: rebuilding it needs the invoice body, which /query does not receive (docs/CONTRACT.md).
        expect(result.qr).toBeUndefined();
    });

    /**
     * `docs/CONTRACT.md` makes this endpoint the ONLY recovery path for observations core failed to persist off
     * the authorize response, so the pass-through is contractual, not incidental — a `/query` that answered with
     * `observations: []` for an observed voucher would leave them unrecoverable for good.
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
        // The orphan-reconciliation contract hinges on this: a never-issued voucher must be a distinct,
        // deterministic not-found — never a 502 ARCA_SERVICE that would leave the sale stuck PENDING forever.
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
        // A token/auth/transport failure is NOT proof the voucher is missing — it must not masquerade as
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
        // `@ArrayMinSize(1)` used to catch this as a side effect; once an empty `lines` became legitimate it
        // stopped being caught anywhere, and an ImpTotal of 0 went out to ARCA to be rejected there.
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
 * Padrón lookups. These never carry an issuer: the provider looks up under this service's OWN delegated
 * identity, so what the tests pin is (a) that the ticket is resolved delegated, for our delegate CUIT and
 * the right padrón service, and (b) that the identification type — not a wire flag — picks the service.
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
        // Auth.Cuit is OUR delegate CUIT — padrón asks only that cuitRepresentada be in the token's
        // relations, so the service acts as itself rather than in representación of anyone.
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
        // A13 is the superset. A clave ARCA issued with no inscripción registered against it is absent from
        // the constancia and perfectly readable in A13, so the miss is a reason to ask the other padrón —
        // the caller gets the identity picture instead of a 404 for someone who exists.
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
        // With the superset unread we do not know that nobody is registered: a 404 would state something
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
        // Only "no such clave" is worth a second registry; a bad id is a 400 A13 would answer no better.
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
        // WSAA's coe.notAuthorized on this path is permanent and ours to fix (adherir the service to our
        // certificate); surfacing the raw transport error would tell core to retry something retrying
        // cannot fix. Verified against homologación 2026-08-21.
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
        // One delegate ticket serves every lookup, so a ticket ARCA has started rejecting would otherwise
        // fail all of them until local expiry. The invoicing path's classifier cannot do this here: it keys
        // on ArcaServiceError (WSFEv1's in-payload `Errors`), which the padrón services never produce.
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
        // ARCA will not re-issue a ticket while a prior one lives, so evicting a GOOD ticket for a condition
        // re-minting cannot fix would break every lookup for ~12h to no purpose.
        const thrown = new ArcaSoapError('Computador no autorizado a acceder al servicio');
        constanciaGetTaxpayer.mockRejectedValue(thrown);

        // Still a transport fault, NOT the auth fault an eviction would accompany - that distinction is the
        // point of the test, and it survives the neutral translation as the category.
        await expect(provider().lookupTaxpayers('testing', 80, '20111111112')).rejects.toMatchObject(
            fault('AUTHORITY_TRANSPORT', 'ARCA_SOAP', thrown.message),
        );
        expect(invalidateDelegated).not.toHaveBeenCalled();
    });

    it('never answers a lookup with a delegation error — it represents nobody', async () => {
        // `Auth.Cuit` is our own delegate CUIT, so a 403 here would name the same CUIT as delegate AND issuer
        // and ask the caller to grant itself a delegation. CONTRACT §10 promises this endpoint never does.
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
