import 'reflect-metadata';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {ArcaServiceError, type CommonInvoiceResult} from './sdk/index.js';
import type {EntityAuthBlock, NeutralInvoice} from '../provider.js';
import {NeutralInvoiceDto} from '../../http/dto/invoice.dto.js';

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
const resolve = jest.fn<() => Promise<{token: string; sign: string; cuit: number}>>();

jest.unstable_mockModule('./clients.js', () => ({
    commonInvoiceService: () => ({getLastAuthorizedNumber, requestAuthorization, queryVoucher}),
    // Unused by authorizeInvoice but part of the module's surface — provide inert stubs.
    padronService: () => ({}),
    padronServiceId: () => '',
    soap: {},
}));

jest.unstable_mockModule('./ticket-store.js', () => ({
    ticketStore: {resolve},
    CredentialsRequiredError: class extends Error {},
}));

const {ArcaProvider} = await import('./arca.provider.js');

const ENTITY: EntityAuthBlock = {entityCode: 'ARCA', issuerTaxId: '20111111112', environment: 'testing'};

function invoice(overrides: Partial<NeutralInvoice> = {}): NeutralInvoice {
    return {
        documentTypeId: 1,
        concept: 1,
        salesPointNumber: 3,
        voucherNumberFrom: 17,
        voucherNumberTo: 17,
        receiver: {identificationTypeId: 80, identificationNumber: '20111111112', fiscalConditionId: 1},
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

describe('NeutralInvoiceDto voucher-number validation', () => {
    function base(): Record<string, unknown> {
        return {
            documentTypeId: 1,
            concept: 1,
            salesPointNumber: 3,
            voucherNumberFrom: 17,
            voucherNumberTo: 17,
            receiver: {identificationTypeId: 80, identificationNumber: '20111111112', fiscalConditionId: 1},
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
