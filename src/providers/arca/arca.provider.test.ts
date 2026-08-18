import 'reflect-metadata';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {ArcaAuthError, ArcaServiceError, type CommonInvoiceResult, type PointOfSaleInfo} from './sdk/index.js';
import {
    DelegationNotAuthorizedError,
    VoucherNotFoundError,
    type EntityAuthBlock,
    type NeutralInvoice,
} from '../provider.js';
import {NeutralInvoiceDto, NextNumbersRequestDto, PointsOfSaleRequestDto} from '../../http/dto/invoice.dto.js';

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
const resolve = jest.fn<() => Promise<{token: string; sign: string; cuit: number}>>();
const invalidateDelegated = jest.fn<(entityCode: string, environment: string, service: string) => void>();

jest.unstable_mockModule('./clients.js', () => ({
    commonInvoiceService: () => ({getLastAuthorizedNumber, requestAuthorization, queryVoucher, getPointsOfSale}),
    // Unused by authorizeInvoice but part of the module's surface — provide inert stubs.
    padronService: () => ({}),
    padronServiceId: () => '',
    soap: {},
}));

jest.unstable_mockModule('./ticket-store.js', () => ({
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

/** What `queryVoucher` returns for an already-authorized voucher 17 (stored total matches the invoice's 121). */
const queriedAuthorized: CommonInvoiceResult = {
    result: 'A',
    cae: '75123456789012',
    caeExpiration: '20260820',
    voucherNumberFrom: 17,
    voucherNumberTo: 17,
    observations: [],
    raw: {ImpTotal: 121},
};

/** ARCA's not-found response for a voucher that was never authorized (FECompConsultar ~602). */
const notFoundError = new ArcaServiceError('[602] No existe el comprobante', [
    {code: '602', message: 'No existe el comprobante'},
]);

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

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toBe(thrown);
    });

    it('refuses a voucher range (voucherNumberTo > voucherNumberFrom) instead of silently truncating it', async () => {
        await expect(
            new ArcaProvider().authorizeInvoice(ENTITY, invoice({voucherNumberFrom: 17, voucherNumberTo: 18})),
        ).rejects.toMatchObject({code: 'VOUCHER_RANGE_UNSUPPORTED'});
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

        await expect(new ArcaProvider().authorizeInvoice(ENTITY, invoice())).rejects.toBe(thrown);
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

    it('maps a genuine token fault (signature/hash) 600 to a token error, NOT a delegation error', async () => {
        requestAuthorization.mockRejectedValue(
            tokenError('ValidacionDeToken: VerificacionDeHash: No validó la firma digital'),
        );

        const p = provider().authorizeInvoice(DELEGATED, invoice());
        await expect(p).rejects.toBeInstanceOf(ArcaAuthError);
        await expect(p).rejects.not.toBeInstanceOf(DelegationNotAuthorizedError);
        // A genuine token fault ⇒ evict the shared delegate ticket so the next request re-mints.
        expect(invalidateDelegated).toHaveBeenCalledWith('ARCA', 'testing', 'wsfe');
    });

    it('leaves an authorization 600 UNTOUCHED on a non-delegated call (never a delegation error)', async () => {
        const thrown = tokenError('Usuario no autorizado a realizar esta operación');
        requestAuthorization.mockRejectedValue(thrown);

        // ENTITY has no `delegated` flag → the classifier does not run.
        await expect(provider().authorizeInvoice(ENTITY, invoice())).rejects.toBe(thrown);
    });

    it('leaves a 601 UNTOUCHED on a non-delegated call (classifier does not run)', async () => {
        const thrown = arcaError('601', 'CUIT representada no incluida en token');
        requestAuthorization.mockRejectedValue(thrown);

        await expect(provider().authorizeInvoice(ENTITY, invoice())).rejects.toBe(thrown);
    });

    it('leaves an ambiguous 600 as the original authority error (does not guess "delegation")', async () => {
        const thrown = tokenError('ValidacionDeToken: error interno del servicio');
        requestAuthorization.mockRejectedValue(thrown);

        await expect(provider().authorizeInvoice(DELEGATED, invoice())).rejects.toBe(thrown);
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

        expect(queryVoucher).toHaveBeenCalledWith(expect.anything(), 3, expect.any(Number), 17);
        expect(result.status).toBe('AUTHORIZED');
        expect(result.authorizationCode).toBe('75123456789012');
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

        await expect(new ArcaProvider().queryVoucher(ENTITY, 3, 1, 42)).rejects.toBe(thrown);
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

        await expect(new ArcaProvider().pointsOfSale(ENTITY)).rejects.toBe(thrown);
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
        await expect(new ArcaProvider().nextNumbers(ENTITY, 3, [1, 9999])).rejects.toMatchObject({
            code: 'UNKNOWN_CODE',
        });
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
