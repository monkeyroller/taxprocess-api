import {describe, expect, it} from '@jest/globals';
import {ArcaServiceError, ArcaValidationError} from '../providers/arca/sdk/core/errors.js';
import {toProviderFault} from '../providers/arca/faults/faults.js';
import {toHttpError, type HttpErrorResult} from './error-mapper/error-mapper.js';

/**
 * The composed error contract: an ARCA SDK failure, through the provider's translation and this layer's
 * status table, must produce exactly the envelope core branches on.
 *
 * The one file that deliberately imports both layers, and a test rather than production code for that
 * reason. `faults.test.ts` pins the first half and `error-mapper.test.ts` the second; each can be correct
 * in isolation while the composition silently changes, which is what this catches.
 *
 * The translation is called explicitly here, standing in for the base-class guard that applies it in
 * production.
 */
function envelope(err: unknown): HttpErrorResult {
    return toHttpError(toProviderFault(err));
}

describe('error envelope — ARCA SDK failure end to end', () => {
    it('400 ARCA_VALIDATION with the specific reason in details.code', () => {
        const result = envelope(new ArcaValidationError('amount mismatch', 'VOUCHER_ALREADY_AUTHORIZED_MISMATCH'));
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('ARCA_VALIDATION');
        expect(result.body.error.details).toEqual({code: 'VOUCHER_ALREADY_AUTHORIZED_MISMATCH'});
        expect(result.body.error.message).toBe('amount mismatch');
    });

    it('omits details when the validation error carried no code', () => {
        const result = envelope(new ArcaValidationError('unknown VAT rate'));
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('ARCA_VALIDATION');
        expect(result.body.error.details).toBeUndefined();
    });

    it('502 ARCA_SERVICE for an unclassified rejection, exposing the raw {code,message} entries', () => {
        const result = envelope(new ArcaServiceError('rejected', [{code: '10015', message: 'bad'}]));
        expect(result.status).toBe(502);
        expect(result.body.error.code).toBe('ARCA_SERVICE');
        expect(result.body.error.details).toEqual({arcaErrors: [{code: '10015', message: 'bad'}]});
    });

    it('promotes ARCA 10069 (receiver == issuer) to a stable 400 category instead of 502', () => {
        const result = envelope(
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
            const result = envelope(new ArcaServiceError('odd', [{code, message: 'odd'}]));
            expect(result.status).toBe(502);
            expect(result.body.error.code).toBe('ARCA_SERVICE');
        }
    });
});
