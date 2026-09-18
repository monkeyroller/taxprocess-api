import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {cachedAuthorityObligation, clearObligationCache} from './obligation-cache.js';
import type {ObligationAnswer} from '../../../http/dto/credit-invoice-obligation-result.dto.js';

/**
 * What the obligation cache may and may not hold.
 *
 * The keying tests are ordinary. The last one is the point of the file: it pins an invariant that is
 * currently guaranteed by the call graph, so that an "optimisation" which moves the cache above the branch
 * decision fails here by name instead of silently serving stale fallbacks.
 */
describe('cachedAuthorityObligation', () => {
    const RECEIVER = 30711111119;
    const DAY = '20260917';

    function answer(overrides: Partial<ObligationAnswer> = {}): ObligationAnswer {
        return {
            obligated: true,
            threshold: {amount: 7000000, currencyCode: 'PES'},
            source: 'AUTHORITY',
            asOf: '2026-09-17T09:00:00Z',
            providerMetadata: {service: 'wsfecred'},
            ...overrides,
        };
    }

    beforeEach(() => {
        clearObligationCache();
    });

    it('asks once for a repeated (receiver, day), however many times the total moves', async () => {
        // The reason this cache exists: a sale form re-decides the document type on every change to the
        // invoice total, and the obligation does not depend on the amount.
        const ask = jest.fn<() => Promise<ObligationAnswer>>(async () => answer());

        const first = await cachedAuthorityObligation('testing', RECEIVER, DAY, ask);
        const second = await cachedAuthorityObligation('testing', RECEIVER, DAY, ask);

        expect(ask).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
    });

    it('shares one in-flight call between concurrent askers', async () => {
        // Without single-flight, concurrent edits fire concurrent WSFECRED calls for an answer already on
        // its way back.
        const ask = jest.fn<() => Promise<ObligationAnswer>>(
            () => new Promise((resolve) => setTimeout(() => resolve(answer()), 5)),
        );

        await Promise.all([
            cachedAuthorityObligation('testing', RECEIVER, DAY, ask),
            cachedAuthorityObligation('testing', RECEIVER, DAY, ask),
            cachedAuthorityObligation('testing', RECEIVER, DAY, ask),
        ]);

        expect(ask).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a different receiver', {receiver: 30722222228, day: DAY, environment: 'testing' as const}],
        ['a different day', {receiver: RECEIVER, day: '20260918', environment: 'testing' as const}],
        ['a different environment', {receiver: RECEIVER, day: DAY, environment: 'production' as const}],
    ])('does not answer %s from this entry', async (_name, other) => {
        const ask = jest.fn<() => Promise<ObligationAnswer>>(async () => answer());

        await cachedAuthorityObligation('testing', RECEIVER, DAY, ask);
        await cachedAuthorityObligation(other.environment, other.receiver, other.day, ask);

        expect(ask).toHaveBeenCalledTimes(2);
    });

    it('serves every tenant from one entry, the answer not depending on who asked', async () => {
        // There is no issuer in the key, and that follows from the call path rather than being an
        // optimisation: every request reaches WSFECRED under this service's own delegate identity, so the
        // authority never learns which tenant is asking and cannot scope its answer to one. Two tenants
        // asking about the same receiver on the same day are asking the identical question.
        //
        // The signature is what pins this — there is no issuer argument to pass — so this test exists to
        // say the absence is deliberate, not to catch a key bug.
        const ask = jest.fn<() => Promise<ObligationAnswer>>(async () => answer());

        await cachedAuthorityObligation('testing', RECEIVER, DAY, ask);
        await cachedAuthorityObligation('testing', RECEIVER, DAY, ask);

        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('never caches a failure, so an outage is not extended by the TTL', async () => {
        const ask = jest
            .fn<() => Promise<ObligationAnswer>>()
            .mockRejectedValueOnce(new Error('WSFECRED unreachable'))
            .mockResolvedValueOnce(answer());

        await expect(cachedAuthorityObligation('testing', RECEIVER, DAY, ask)).rejects.toThrow();
        const recovered = await cachedAuthorityObligation('testing', RECEIVER, DAY, ask);

        expect(recovered.source).toBe('AUTHORITY');
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it('stores only AUTHORITY answers, because a cached fallback would extend an outage', async () => {
        const ask = jest.fn<() => Promise<ObligationAnswer>>(async () => answer());

        const cached = await cachedAuthorityObligation('testing', RECEIVER, DAY, ask);

        expect(cached.source).toBe('AUTHORITY');
        expect(cached.registrySnapshot).toBeUndefined();
    });

    it('refuses a LOCAL_REGISTRY answer outright, rather than quietly caching a fallback', async () => {
        // The assertion above only re-reads what its own mock returned, so it cannot fail. This one can: it
        // is what breaks if someone later moves the cache above the branch decision in
        // `creditInvoiceObligationImpl` and starts memoizing the *composed* answer. A thirty-second ARCA
        // blip would otherwise become a TTL-long degradation the next reader sees as a cache hit rather
        // than as a failure, and nothing else in the suite would notice.
        const ask = jest.fn<() => Promise<ObligationAnswer>>(async () =>
            answer({source: 'LOCAL_REGISTRY', registrySnapshot: {fetchedAt: '2026-09-01', thresholdEffectiveFrom: '2026-04-14'}}),
        );

        await expect(cachedAuthorityObligation('testing', RECEIVER, DAY, ask)).rejects.toThrow(
            /only AUTHORITY answers/,
        );

        // And the refusal is not itself cached, so the next caller gets a real attempt.
        ask.mockResolvedValueOnce(answer());
        expect((await cachedAuthorityObligation('testing', RECEIVER, DAY, ask)).source).toBe(
            'AUTHORITY',
        );
    });

    it('keeps the asOf the authority answered with, not the time it was read back', async () => {
        // A cached answer must report when it was *true*. Read-time would let a six-hour-old answer claim
        // to be current, which is exactly the claim a caller storing it against a voucher relies on.
        const ask = jest.fn<() => Promise<ObligationAnswer>>(async () => answer({asOf: '2026-09-17T09:00:00Z'}));

        await cachedAuthorityObligation('testing', RECEIVER, DAY, ask);
        const second = await cachedAuthorityObligation('testing', RECEIVER, DAY, ask);

        expect(second.asOf).toBe('2026-09-17T09:00:00Z');
    });
});
