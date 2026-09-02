import {describe, expect, it} from '@jest/globals';
import {
    ArcaAuthError,
    ArcaError,
    ArcaServiceError,
    ArcaSoapError,
    ArcaTaxpayerNotFoundError,
    ArcaValidationError,
    NotImplementedError,
} from '../sdk/core/errors.js';
import {ServiceId} from '../sdk/core/constants.js';
import {
    isDelegateTicketFault,
    isPadronTicketFault,
    isWsfeTicketFault,
    toProviderFault,
} from './faults.js';
import {
    CredentialsRequiredError,
    DelegationNotAuthorizedError,
    DelegationNotConfiguredError,
    ProviderFault,
    TaxpayerNotFoundError,
    VoucherNotFoundError,
} from '../../provider/faults.js';

/**
 * The ARCA half of the error contract: which SDK failure becomes which neutral category, wire `code` and
 * `details`. The codes and detail shapes asserted here are the ones core branches on, so this file is what
 * stops the translation drifting. `error-mapper.test.ts` pins the other half, category to status.
 */

/** Narrows to a fault, failing with the real value rather than a null-deref if the mapping missed. */
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
        // Codes come straight off ARCA's XML, so a fault or proxy page can put any string here. With `in`,
        // `'constructor'` matches and the lookup returns a function — which would become the wire `code`.
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
        // The base class is the fallback, so it must be tested last: every class above extends it, and
        // checking it first would swallow all of them into one `500`.
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
     * These are raised deliberately by the provider and carry their own status. Wrapping one in a generic
     * fault would flatten it — the `404` core's orphan reconciliation depends on would become a `500`.
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
        // If this started producing a provider fault, a lookup would report a `500` for an unregistered
        // CUIT instead of a `404`.
        const err = new ArcaTaxpayerNotFoundError('20111111112');
        expect(toProviderFault(err)).toMatchObject({category: 'PROVIDER_INTERNAL'});
    });
});

/**
 * Which failures may evict the delegate ticket — the one decision here whose false positives cost more than
 * its false negatives: one ticket is shared across every represented CUIT and ARCA refuses to re-mint for
 * ~12h, so evicting on a condition re-minting cannot fix takes delegated invoicing down for half a day.
 *
 * The two classifiers exist because the two services report the same condition in different shapes, and
 * each one's wording is wrong on the other's vocabulary. These tests pin that separation.
 */
describe('delegate-ticket eviction classifiers', () => {
    /** A WSFEv1 `Errors` block as the SDK builds it: `[code] message`, with the entries attached. */
    function serviceError(code: string, message: string): ArcaServiceError {
        return new ArcaServiceError(`[${code}] ${message}`, [{code, message}]);
    }

    describe('isPadronTicketFault (padrón SOAP faults)', () => {
        it('evicts on a fault naming the credential itself', () => {
            for (const message of [
                'No autorizado, par token/sign invalido.',
                'El ticket de acceso se encuentra vencido',
                'Error de firma digital',
            ]) {
                expect(isPadronTicketFault(new ArcaSoapError(message))).toBe(true);
            }
        });

        it('leaves an enrolment or relación rejection cached — the ticket is valid, the permission is not', () => {
            for (const message of [
                'Computador no autorizado a acceder al servicio',
                'la relación de representación se encuentra vencida',
            ]) {
                expect(isPadronTicketFault(new ArcaSoapError(message))).toBe(false);
            }
        });

        it('evicts on a fault naming only the sign, as a whole word', () => {
            // The `\bsign\b` alternative, isolated. Every other message here that mentions the sign also
            // says `token`, so this one was never exercised — which is how it survived being written with
            // a single backslash inside a string fed to `new RegExp`, where it can never match.
            expect(isPadronTicketFault(new ArcaSoapError('El Sign presentado no es valido'))).toBe(true);
            // And still a whole word: `consigna` contains `sign` and names no credential.
            expect(isPadronTicketFault(new ArcaSoapError('La consigna del envio es incorrecta'))).toBe(false);
        });

        it('treats a hash-verification fault as a credential fault, like padron-faults.ts now does', () => {
            // `VerificacionDeHash` is the CMS signature failing to verify — a credential problem. The two
            // classifiers spelled the vocabulary out independently and one was the other's union minus
            // `hash`, so a hash fault fell through its credential gate and could be reported as a bad
            // identifier. Both now compose from the shared vocabulary.
            expect(isPadronTicketFault(new ArcaSoapError('VerificacionDeHash: hash no valido'))).toBe(true);
        });

        it('does NOT read a WSFEv1 Errors block, whose vocabulary it is not calibrated for', () => {
            // WSFEv1 prefixes every overloaded `600` with `ValidacionDeToken:`, so the bare substring
            // `token` is present on rejections the cached ticket is valid for.
            expect(
                isPadronTicketFault(
                    serviceError('600', 'ValidacionDeToken: No apareció CUIT en lista de relaciones'),
                ),
            ).toBe(false);
            expect(isPadronTicketFault(serviceError('600', 'ValidacionDeToken: Token expirado'))).toBe(false);
        });
    });

    describe('isWsfeTicketFault (WSFEv1 in-payload Errors)', () => {
        it('evicts on a genuine credential fault', () => {
            for (const message of [
                'ValidacionDeToken: Token expirado',
                'ValidacionDeToken: El CEE no se corresponde con la firma digital',
                'ValidacionDeToken: VerificacionDeHash no validó',
            ]) {
                expect(isWsfeTicketFault(serviceError('600', message))).toBe(true);
            }
        });

        it('keeps the ticket on an authorization 600, despite the ValidacionDeToken prefix', () => {
            // The pair that made the padrón classifier unsafe here: both name who is refused, and both
            // carry `Token` inside `ValidacionDeToken`.
            for (const message of [
                'ValidacionDeToken: No apareció CUIT en lista de relaciones para acceder al WS',
                'ValidacionDeToken: Computador no autorizado a acceder al servicio',
            ]) {
                expect(isWsfeTicketFault(serviceError('600', message))).toBe(false);
            }
        });

        it('keeps the ticket on an ambiguous 600, erring towards the cheaper mistake', () => {
            // Neither authorization nor crypto wording. A missed eviction costs one request and a wrong one
            // ~12h of delegated invoicing, so silence is the safe default.
            expect(isWsfeTicketFault(serviceError('600', 'ValidacionDeToken: Token invalido'))).toBe(false);
        });

        it('ignores every other code, including the ones the rates batch handles per currency', () => {
            expect(isWsfeTicketFault(serviceError('602', 'Sin Resultados'))).toBe(false);
            expect(
                isWsfeTicketFault(serviceError('12000', 'Campo <MonId> debe ser algunos de los habilitados')),
            ).toBe(false);
            // `601` is a missing delegation, which re-minting the same ticket cannot fix.
            expect(isWsfeTicketFault(serviceError('601', 'CUIT representada no incluida en token'))).toBe(false);
        });

        it('does NOT read a SOAP fault, whose vocabulary it is not calibrated for', () => {
            expect(isWsfeTicketFault(new ArcaSoapError('No autorizado, par token/sign invalido.'))).toBe(false);
        });
    });

    /**
     * The dispatch itself, and the only one of the three a call path may use. Scoping the padrón classifier
     * to `ArcaSoapError` reads like it confines that vocabulary to the padrón and does not, WSFEv1 raising
     * the same class for genuine SOAP faults. These pin that the choice is made by service.
     */
    describe('isDelegateTicketFault (the per-service dispatch)', () => {
        it('reads a padrón SOAP fault with the padrón vocabulary', () => {
            expect(
                isDelegateTicketFault(
                    new ArcaSoapError('No autorizado, par token/sign invalido.'),
                    ServiceId.CONSTANCIA_INSCRIPCION,
                ),
            ).toBe(true);
            expect(
                isDelegateTicketFault(new ArcaSoapError('Error de firma digital'), ServiceId.PADRON_A13),
            ).toBe(true);
        });

        it('keeps the wsfe ticket on a SOAP fault whose text merely mentions the credential', () => {
            // The regression. ARCA's `faultstring` travels verbatim, so a WSFEv1 transport fault can carry
            // Spanish text containing `token` or `firma`. OR-ing the two classifiers let the padrón
            // vocabulary read it and evict the shared `wsfe` delegate ticket. On `wsfe` a credential
            // rejection is an in-payload `600`, so a SOAP fault there is a retryable transport failure.
            for (const message of [
                'No autorizado, par token/sign invalido.',
                'El ticket de acceso se encuentra vencido',
                'Error de firma digital',
                'certificado invalido',
            ]) {
                expect(isDelegateTicketFault(new ArcaSoapError(message), ServiceId.WSFEV1)).toBe(false);
            }
        });

        it('reads a wsfe Errors block with the wsfe vocabulary', () => {
            expect(
                isDelegateTicketFault(serviceError('600', 'ValidacionDeToken: Token expirado'), ServiceId.WSFEV1),
            ).toBe(true);
            expect(
                isDelegateTicketFault(
                    serviceError('600', 'ValidacionDeToken: No apareció CUIT en lista de relaciones'),
                    ServiceId.WSFEV1,
                ),
            ).toBe(false);
        });

        it('covers WSFEXv1 by the same reading as WSFEv1 — both report in-payload Errors', () => {
            expect(
                isDelegateTicketFault(serviceError('600', 'ValidacionDeToken: Token expirado'), ServiceId.WSFEXV1),
            ).toBe(true);
            expect(
                isDelegateTicketFault(new ArcaSoapError('par token/sign invalido'), ServiceId.WSFEXV1),
            ).toBe(false);
        });

        it('never reads a wsfe Errors block with the padrón vocabulary, whichever service asked', () => {
            // The padrón services never produce this class, so the case is inert rather than wrong — but
            // pinned, so the dispatch cannot be simplified back into an OR.
            expect(
                isDelegateTicketFault(
                    serviceError('600', 'ValidacionDeToken: No apareció CUIT en lista de relaciones'),
                    ServiceId.CONSTANCIA_INSCRIPCION,
                ),
            ).toBe(false);
        });
    });
});
