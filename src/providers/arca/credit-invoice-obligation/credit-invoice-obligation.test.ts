import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {decideReceptionObligation, isAuthorityUnavailable} from './credit-invoice-obligation.js';
import {ArcaAuthError, ArcaServiceError, ArcaSoapError, ArcaValidationError} from '../sdk/core/errors.js';
import {
    CredentialsRequiredError,
    DelegationNotAuthorizedError,
    DelegationNotConfiguredError,
} from '../../provider/faults.js';
import type {ObligationAnswer} from '../../../http/dto/credit-invoice-obligation-result.dto.js';

/**
 * The branch decision, with both sources as plain object literals — no network, no clock, no cache.
 *
 * The property under test is not "does it fall back" but "can it ever blend". Every assertion below is
 * aimed at one of the two ways a blend could appear: a threshold surviving from the branch that lost, or a
 * `source` describing something other than the answer actually returned.
 */
describe('decideReceptionObligation', () => {
    const AUTHORITY_ANSWER: ObligationAnswer = {
        obligated: true,
        threshold: {amount: 7000000, currencyCode: 'PES'},
        source: 'AUTHORITY',
        asOf: '2026-09-17T09:00:00Z',
        providerMetadata: {service: 'wsfecred'},
    };

    const REGISTRY_ANSWER: ObligationAnswer = {
        obligated: true,
        threshold: {amount: 4000000, currencyCode: 'PES'},
        source: 'LOCAL_REGISTRY',
        asOf: '2026-04-14T03:00:00Z',
        registrySnapshot: {fetchedAt: '2026-09-01', thresholdEffectiveFrom: '2026-04-14'},
        providerMetadata: {rowCount: 12},
    };

    let warn: jest.SpiedFunction<typeof console.warn>;

    beforeEach(() => {
        warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('returns the authority answer whole, without ever consulting the registry', async () => {
        // The anti-mixing assertion. If the registry is not even asked, no field of the returned answer can
        // have come from it — which is a stronger guarantee than comparing the values afterwards.
        const registry = jest.fn<() => ObligationAnswer | undefined>(() => REGISTRY_ANSWER);

        const answer = await decideReceptionObligation({
            authority: async () => AUTHORITY_ANSWER,
            registry,
        });

        expect(answer).toEqual(AUTHORITY_ANSWER);
        expect(registry).not.toHaveBeenCalled();
    });

    it('falls back whole, so the threshold is the registry own and not the authority last one', async () => {
        const answer = await decideReceptionObligation({
            authority: () => Promise.reject(new ArcaSoapError('WSFECRED unreachable', 503)),
            registry: () => REGISTRY_ANSWER,
        });

        expect(answer).toEqual(REGISTRY_ANSWER);
        expect(answer.source).toBe('LOCAL_REGISTRY');
        expect(answer.threshold?.amount).toBe(4000000);
        expect(answer.registrySnapshot).toBeDefined();
    });

    it('rethrows the identical error object when neither source can answer', async () => {
        // `toBe`, not `toEqual`: the status this becomes is decided by `translateFault` reading the error's
        // own class, so a future well-meaning wrapper would flatten `ARCA_SOAP`/`ARCA_SERVICE`/`ARCA_AUTH`
        // into one opaque code without changing anything this test would otherwise notice.
        const failure = new ArcaSoapError('WSFECRED unreachable', 503);

        await expect(
            decideReceptionObligation({
                authority: () => Promise.reject(failure),
                registry: () => undefined,
            }),
        ).rejects.toBe(failure);

        expect(warn).toHaveBeenCalled();
    });

    it.each([
        // The two this endpoint can actually raise, since it reads under our own delegated identity.
        ['DelegationNotConfiguredError', new DelegationNotConfiguredError('testing', 'no delegate certificate')],
        ['ArcaValidationError', new ArcaValidationError('receiverTaxId must be all digits', 'INVALID_ID')],
        // Unreachable on this path — no tenant credential is asked for and no party represents us. Kept
        // because an allow-list is judged by what it refuses to swallow, so the rule should already hold
        // the day either becomes reachable again.
        ['CredentialsRequiredError', new CredentialsRequiredError('ARCA', '20111111112', 'wsfecred', 'testing')],
        ['DelegationNotAuthorizedError', new DelegationNotAuthorizedError('30999999997', '20111111112', '601', 'no')],
    ])('propagates %s instead of hiding an actionable failure behind a 200', async (_name, failure) => {
        // Each of these is something a caller or an operator can act on, and each has its own status. A
        // fallback here would answer `200` and make the real problem permanent and invisible — a missing
        // enrolment in particular is a configuration fix no amount of retrying reaches.
        const registry = jest.fn<() => ObligationAnswer | undefined>(() => REGISTRY_ANSWER);

        await expect(
            decideReceptionObligation({authority: () => Promise.reject(failure), registry}),
        ).rejects.toBe(failure);

        expect(registry).not.toHaveBeenCalled();
    });

    it('treats a not-obligated verdict as an answer, never as a reason to fall back', async () => {
        const notObligated: ObligationAnswer = {
            obligated: false,
            source: 'AUTHORITY',
            asOf: '2026-09-17T09:00:00Z',
            providerMetadata: {},
        };
        const registry = jest.fn<() => ObligationAnswer | undefined>(() => REGISTRY_ANSWER);

        const answer = await decideReceptionObligation({authority: async () => notObligated, registry});

        expect(answer.obligated).toBe(false);
        expect(answer.source).toBe('AUTHORITY');
        expect(answer.threshold).toBeUndefined();
        expect(registry).not.toHaveBeenCalled();
    });

    it('logs a live refusal, since nothing on the wire distinguishes it from an outage fallback', async () => {
        // `ArcaServiceError` covers both an unreadable answer and an `arrayErrores` the authority
        // deliberately sent, and this layer cannot yet tell them apart — splitting them needs codes the
        // probe has not measured. Either way the caller gets a `LOCAL_REGISTRY` answer that looks exactly
        // like one taken during an outage, so the log line is the only place the refusal survives.
        const answer = await decideReceptionObligation({
            authority: () => Promise.reject(new ArcaServiceError('rejected', [{code: '1001', message: 'no'}])),
            registry: () => REGISTRY_ANSWER,
        });

        expect(answer.source).toBe('LOCAL_REGISTRY');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('rather than from the authority'));
    });

    it('logs a ticket refusal specifically, so a persistent one is visible rather than only degraded', async () => {
        await decideReceptionObligation({
            authority: () => Promise.reject(new ArcaAuthError('ticket rejected')),
            registry: () => REGISTRY_ANSWER,
        });

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('wsfecred enrolment'));
    });
});

describe('isAuthorityUnavailable', () => {
    it('is an allow-list, so an error class added later is propagated rather than silently swallowed', () => {
        // The direction matters. A deny-list would classify anything unrecognised as "authority down" and
        // answer `200 LOCAL_REGISTRY` for the next actionable failure somebody introduces.
        expect(isAuthorityUnavailable(new ArcaSoapError('down'))).toBe(true);
        expect(isAuthorityUnavailable(new ArcaServiceError('rejected', []))).toBe(true);
        expect(isAuthorityUnavailable(new ArcaAuthError('bad ticket'))).toBe(true);

        expect(isAuthorityUnavailable(new Error('something new'))).toBe(false);
        expect(isAuthorityUnavailable(new ArcaValidationError('bad id', 'INVALID_ID'))).toBe(false);
    });
});
