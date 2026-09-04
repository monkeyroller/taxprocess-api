import {describe, expect, it} from '@jest/globals';
import {
    CredentialsRequiredError,
    ProviderFault,
    TaxpayerNotFoundError,
    VoucherNotFoundError,
    type ProviderFaultCategory,
} from '../../providers/provider/faults.js';
import {toHttpError} from './error-mapper.js';

/**
 * This layer is provider-agnostic, so every case here is built from the neutral vocabulary — no ARCA error
 * class appears, which is as much the property under test as the statuses are. The other half of the wire
 * contract is pinned in `faults.test.ts`, and neither file needs the other's layer.
 */
describe('toHttpError — ProviderFault category → status', () => {
    const cases: ReadonlyArray<[ProviderFaultCategory, number]> = [
        ['VALIDATION', 400],
        ['AUTHORITY_REJECTED', 400],
        ['AUTHORITY_AUTH', 502],
        ['AUTHORITY_SERVICE', 502],
        ['AUTHORITY_TRANSPORT', 502],
        ['NOT_IMPLEMENTED', 501],
        ['PROVIDER_INTERNAL', 500],
    ];

    it.each(cases)('maps %s to %i', (category, status) => {
        expect(toHttpError(new ProviderFault(category, 'SOME_CODE', 'boom')).status).toBe(status);
    });

    it("passes the provider's code, message and details through verbatim", () => {
        const result = toHttpError(
            new ProviderFault('VALIDATION', 'ARCA_VALIDATION', 'amount mismatch', {
                code: 'VOUCHER_ALREADY_AUTHORIZED_MISMATCH',
            }),
        );
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('ARCA_VALIDATION');
        expect(result.body.error.message).toBe('amount mismatch');
        expect(result.body.error.details).toEqual({code: 'VOUCHER_ALREADY_AUTHORIZED_MISMATCH'});
    });

    it('omits details entirely when the fault carried none', () => {
        const result = toHttpError(new ProviderFault('VALIDATION', 'ARCA_VALIDATION', 'unknown VAT rate'));
        expect(result.body.error.details).toBeUndefined();
    });

    it('does not interpret the details shape — a provider-specific payload rides through untouched', () => {
        const details = {arcaCode: '10069', arcaErrors: [{code: '10069', message: 'same as issuer'}]};
        const result = toHttpError(
            new ProviderFault('AUTHORITY_REJECTED', 'RECEIVER_MATCHES_ISSUER', 'same as issuer', details),
        );
        expect(result.status).toBe(400);
        expect(result.body.error.details).toEqual(details);
    });
});

describe('toHttpError — CredentialsRequiredError', () => {
    it('maps a ticket-cache miss to the 409 handshake with the neutral identity in details', () => {
        const result = toHttpError(new CredentialsRequiredError('ARCA', '20111111112', 'wsfe', 'testing'));
        expect(result.status).toBe(409);
        expect(result.body.error.code).toBe('CREDENTIALS_REQUIRED');
        expect(result.body.error.details).toEqual({
            entityCode: 'ARCA',
            issuerTaxId: '20111111112',
            service: 'wsfe',
            environment: 'testing',
        });
    });
});

describe('toHttpError — VoucherNotFoundError', () => {
    it('maps a never-issued voucher to 404 VOUCHER_NOT_FOUND with the query coordinates in details', () => {
        const result = toHttpError(new VoucherNotFoundError('ARCA', 3, 1, 42));
        expect(result.status).toBe(404);
        expect(result.body.error.code).toBe('VOUCHER_NOT_FOUND');
        expect(result.body.error.details).toEqual({
            entityCode: 'ARCA',
            pointOfSaleNumber: 3,
            documentTypeCode: 1,
            voucherNumber: 42,
        });
    });
});

describe('toHttpError — framework validation (400) details', () => {
    /** A framework `BadRequestError`: an `Error` subclass with `httpCode` and class-validator `errors`. */
    function validationError(errors: unknown): Error {
        const err = new Error("Invalid body, check 'errors' property…") as Error & {
            httpCode: number;
            errors: unknown;
        };
        err.name = 'BadRequestError';
        err.httpCode = 400;
        err.errors = errors;
        return err;
    }

    it('surfaces the failing field + constraints under details', () => {
        const result = toHttpError(
            validationError([{property: 'entity', constraints: {isDefined: 'entity should not be null or undefined'}}]),
        );
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('BadRequestError');
        expect(result.body.error.details).toEqual([
            {property: 'entity', constraints: {isDefined: 'entity should not be null or undefined'}},
        ]);
    });

    it('recurses into nested (children) validation errors', () => {
        const result = toHttpError(
            validationError([
                {property: 'entity', children: [{property: 'environment', constraints: {isIn: 'invalid'}}]},
            ]),
        );
        expect(result.body.error.details).toEqual([
            {property: 'entity', children: [{property: 'environment', constraints: {isIn: 'invalid'}}]},
        ]);
    });

    it('never echoes submitted values (value/target) back — credentials cannot leak', () => {
        const result = toHttpError(
            validationError([
                {
                    property: 'entity',
                    value: {credentials: {keyPem: '-----BEGIN PRIVATE KEY-----secret'}},
                    target: {credentials: {keyPem: '-----BEGIN PRIVATE KEY-----secret'}},
                    constraints: {isDefined: 'bad'},
                },
            ]),
        );
        expect(JSON.stringify(result.body)).not.toContain('secret');
        expect(result.body.error.details).toEqual([{property: 'entity', constraints: {isDefined: 'bad'}}]);
    });

    it('leaves details undefined when the 400 carries no errors array', () => {
        const result = toHttpError({httpCode: 400, name: 'BadRequestError', message: 'nope'});
        expect(result.body.error.details).toBeUndefined();
    });
});

describe('toHttpError — TaxpayerNotFoundError', () => {
    it('maps an unregistered identifier to 404 TAXPAYER_NOT_FOUND with the identification pair', () => {
        const result = toHttpError(new TaxpayerNotFoundError('ARCA', 80, '20111111112'));
        expect(result.status).toBe(404);
        expect(result.body.error.code).toBe('TAXPAYER_NOT_FOUND');
        expect(result.body.error.details).toEqual({
            entityCode: 'ARCA',
            identificationTypeCode: 80,
            identificationNumber: '20111111112',
        });
    });

    it("keeps the authority's own wording in the message, for support to recognize", () => {
        const result = toHttpError(
            new TaxpayerNotFoundError('ARCA', 80, '12345678901', 'No existe persona con ese Id'),
        );
        expect(result.body.error.message).toContain('No existe persona con ese Id');
    });
});
