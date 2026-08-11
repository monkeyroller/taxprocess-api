import {describe, expect, it} from '@jest/globals';
import {ArcaServiceError, ArcaValidationError} from '../providers/arca/sdk/index.js';
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

    it('maps a business ArcaServiceError to 502 ARCA_SERVICE (category unchanged)', () => {
        const result = toHttpError(new ArcaServiceError('rejected', [{code: '10015', message: 'bad'}]));
        expect(result.status).toBe(502);
        expect(result.body.error.code).toBe('ARCA_SERVICE');
    });
});
