import {describe, expect, it} from '@jest/globals';
import {
    ArcaAuthError,
    ArcaError,
    ArcaServiceError,
    ArcaSoapError,
    ArcaTaxpayerNotFoundError,
    ArcaValidationError,
    NotImplementedError,
} from '../sdk/index.js';
import {toProviderFault} from './faults.js';
import {
    CredentialsRequiredError,
    DelegationNotAuthorizedError,
    DelegationNotConfiguredError,
    ProviderFault,
    TaxpayerNotFoundError,
    VoucherNotFoundError,
} from '../../provider/provider.js';

/**
 * The ARCA half of the error contract: which SDK failure becomes which neutral category, wire `code` and
 * `details`. The codes and detail shapes asserted here are the ones CONTRACT §8 documents and core branches
 * on, so this file is what stops the translation from drifting — the mapping used to live in
 * `http/error-mapper/error-mapper.ts`, and these are its assertions, moved to the layer that now owns them.
 *
 * `error-mapper.test.ts` pins the other half (category → status). Together they cover the same envelopes
 * end to end without either layer importing the other.
 */

/** Narrows to a ProviderFault, failing with the real value rather than a null-deref if the mapping missed. */
function faultFor(err: unknown): ProviderFault {
    const translated = toProviderFault(err);
    if (!(translated instanceof ProviderFault)) {
        throw new Error(`expected a ProviderFault, got ${String(translated)}`);
    }
    return translated;
}

describe('toProviderFault — validation', () => {
    it('carries ARCA_VALIDATION with the specific reason in details.code', () => {
        const fault = faultFor(new ArcaValidationError('amount mismatch', 'VOUCHER_ALREADY_AUTHORIZED_MISMATCH'));
        expect(fault.category).toBe('VALIDATION');
        expect(fault.code).toBe('ARCA_VALIDATION');
        expect(fault.message).toBe('amount mismatch');
        expect(fault.details).toEqual({code: 'VOUCHER_ALREADY_AUTHORIZED_MISMATCH'});
    });

    it('omits details when the validation error carried no code', () => {
        const fault = faultFor(new ArcaValidationError('unknown VAT rate'));
        expect(fault.code).toBe('ARCA_VALIDATION');
        expect(fault.details).toBeUndefined();
    });
});

describe('toProviderFault — authority failures', () => {
    it('maps an unclassified service rejection to ARCA_SERVICE, exposing the raw {code,message} entries', () => {
        const fault = faultFor(new ArcaServiceError('rejected', [{code: '10015', message: 'bad'}]));
        expect(fault.category).toBe('AUTHORITY_SERVICE');
        expect(fault.code).toBe('ARCA_SERVICE');
        expect(fault.details).toEqual({arcaErrors: [{code: '10015', message: 'bad'}]});
    });

    it('promotes ARCA 10069 (receiver == issuer) to a stable caller-fixable category, not a 502 one', () => {
        const fault = faultFor(
            new ArcaServiceError('[10069] Campo DocNro no puede ser igual al del emisor.', [
                {code: '10069', message: 'Campo DocNro no puede ser igual al del emisor.'},
            ]),
        );
        expect(fault.category).toBe('AUTHORITY_REJECTED');
        expect(fault.code).toBe('RECEIVER_MATCHES_ISSUER');
        // The authority's own wording for the promoted code, not the SDK's bracketed summary.
        expect(fault.message).toBe('Campo DocNro no puede ser igual al del emisor.');
        expect(fault.details).toEqual({
            arcaCode: '10069',
            arcaErrors: [{code: '10069', message: 'Campo DocNro no puede ser igual al del emisor.'}],
        });
    });

    it('keeps an unmapped sibling code alongside a promoted one, rather than dropping it', () => {
        const fault = faultFor(
            new ArcaServiceError('two problems', [
                {code: '10069', message: 'same as issuer'},
                {code: '10015', message: 'something else'},
            ]),
        );
        expect(fault.code).toBe('RECEIVER_MATCHES_ISSUER');
        expect(fault.details).toEqual({
            arcaCode: '10069',
            arcaErrors: [
                {code: '10069', message: 'same as issuer'},
                {code: '10015', message: 'something else'},
            ],
        });
    });

    it('does not treat an inherited Object key as a known code', () => {
        // Codes come straight off ARCA's XML with no validation, so a fault or proxy page can put any string
        // here. With `in`, 'constructor' matches and the lookup returns the Object function — which would
        // become the wire `code` and, downstream, an undefined HTTP status.
        for (const code of ['constructor', 'toString', 'valueOf']) {
            const fault = faultFor(new ArcaServiceError('odd', [{code, message: 'odd'}]));
            expect(fault.category).toBe('AUTHORITY_SERVICE');
            expect(fault.code).toBe('ARCA_SERVICE');
        }
    });

    it('separates a credential refusal, a transport failure and an unclassified SDK error', () => {
        expect(faultFor(new ArcaAuthError('bad ticket'))).toMatchObject({
            category: 'AUTHORITY_AUTH',
            code: 'ARCA_AUTH',
        });
        expect(faultFor(new ArcaSoapError('HTTP 503', 503))).toMatchObject({
            category: 'AUTHORITY_TRANSPORT',
            code: 'ARCA_SOAP',
        });
        // The base class is the fallback, so it must be tested LAST in the chain — every class above
        // extends it, and checking it first would swallow all of them into one 500.
        expect(faultFor(new ArcaError('something odd'))).toMatchObject({
            category: 'PROVIDER_INTERNAL',
            code: 'ARCA_ERROR',
        });
    });

    it('maps a not-yet-implemented operation to its own category', () => {
        const fault = faultFor(new NotImplementedError('ExportInvoiceService.requestAuthorization'));
        expect(fault.category).toBe('NOT_IMPLEMENTED');
        expect(fault.code).toBe('NOT_IMPLEMENTED');
    });
});

describe('toProviderFault — already-neutral errors pass through untouched', () => {
    /**
     * These are raised deliberately by the provider and carry their own status (403/404/409/500). Wrapping
     * one in a generic fault would flatten it — the `404` core's orphan reconciliation depends on would
     * become a `500`, which is precisely the signal it must never confuse.
     */
    const neutral = [
        new VoucherNotFoundError('ARCA', 3, 1, 42),
        new TaxpayerNotFoundError('ARCA', 80, '20111111112'),
        new DelegationNotAuthorizedError('30111111118', '20111111112', '601', 'no incluida'),
        new DelegationNotConfiguredError('testing', 'no delegate certificate is configured'),
        new CredentialsRequiredError('ARCA', '20111111112', 'wsfe', 'testing'),
    ];

    it.each(neutral.map((err) => [err.constructor.name, err] as const))('returns %s as-is', (_name, err) => {
        expect(toProviderFault(err)).toBe(err);
    });

    it('leaves a non-ARCA error alone so the mapper can fall back to its own handling', () => {
        const err = new Error('something from express');
        expect(toProviderFault(err)).toBe(err);
    });

    it('does not translate the SDK not-found — the provider converts it to the neutral 404 itself', () => {
        // If this ever started producing a ProviderFault, `lookupTaxpayers` would report a `500` for an
        // unregistered CUIT instead of the documented `404 TAXPAYER_NOT_FOUND`.
        const err = new ArcaTaxpayerNotFoundError('20111111112');
        expect(toProviderFault(err)).toMatchObject({category: 'PROVIDER_INTERNAL'});
    });
});
