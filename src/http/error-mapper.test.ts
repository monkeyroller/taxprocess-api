import {describe, expect, it} from '@jest/globals';
import {ArcaServiceError, ArcaValidationError} from '../providers/arca/sdk/index.js';
import {VoucherNotFoundError} from '../providers/provider.js';
import {toHttpError} from './error-mapper.js';

describe('toHttpError — ArcaValidationError', () => {
    it('keeps ARCA_VALIDATION as the category and surfaces the specific reason in details.code', () => {
        const result = toHttpError(
            new ArcaValidationError('amount mismatch', 'VOUCHER_ALREADY_AUTHORIZED_MISMATCH'),
        );
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('ARCA_VALIDATION');
        expect(result.body.error.details).toEqual({code: 'VOUCHER_ALREADY_AUTHORIZED_MISMATCH'});
        expect(result.body.error.message).toBe('amount mismatch');
    });

    it('omits details when the validation error carried no code', () => {
        const result = toHttpError(new ArcaValidationError('unknown VAT rate'));
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('ARCA_VALIDATION');
        expect(result.body.error.details).toBeUndefined();
    });

    it('maps an unclassified ArcaServiceError to 502 ARCA_SERVICE, exposing the raw {code,message} entries', () => {
        const result = toHttpError(new ArcaServiceError('rejected', [{code: '10015', message: 'bad'}]));
        expect(result.status).toBe(502);
        expect(result.body.error.code).toBe('ARCA_SERVICE');
        expect(result.body.error.details).toEqual({arcaErrors: [{code: '10015', message: 'bad'}]});
    });

    it('promotes ARCA 10069 (receiver == issuer) to a stable 400 category instead of 502', () => {
        const result = toHttpError(
            new ArcaServiceError('[10069] Campo DocNro no puede ser igual al del emisor.', [
                {code: '10069', message: 'Campo DocNro no puede ser igual al del emisor.'},
            ]),
        );
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('RECEIVER_MATCHES_ISSUER');
        expect(result.body.error.message).toBe('Campo DocNro no puede ser igual al del emisor.');
        expect(result.body.error.details).toEqual({
            arcaCode: '10069',
            arcaErrors: [{code: '10069', message: 'Campo DocNro no puede ser igual al del emisor.'}],
        });
    });

    it('does not treat an inherited Object key as a known code (would yield an undefined status)', () => {
        // Codes come straight off ARCA's XML with no validation, so a fault or proxy page can put any
        // string here. With `in`, 'constructor' matches and the lookup returns the Object function —
        // `res.status(undefined)` throws inside the error handler and the caller gets nothing back.
        for (const code of ['constructor', 'toString', 'valueOf']) {
            const result = toHttpError(new ArcaServiceError('odd', [{code, message: 'odd'}]));
            expect(result.status).toBe(502);
            expect(result.body.error.code).toBe('ARCA_SERVICE');
        }
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
    /** A routing-controllers BadRequestError: an Error subclass with `httpCode` + class-validator `errors`. */
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
