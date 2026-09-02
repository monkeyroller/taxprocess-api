import {describe, expect, it} from '@jest/globals';
import {TaxEntityProvider} from './provider.js';
import {ProviderFault, VoucherNotFoundError} from './faults.js';
import type {EntityAuthBlock} from './entity-auth.js';
import type {CredentialValidationResult} from './credential-validation.js';
import type {
    AuthorityStatusResult,
    CurrencyRatesResult,
    LastAuthorizedResult,
    NextNumbersResult,
    PointsOfSaleResult,
    TaxAuthorizationResult,
    TaxpayerResult,
} from './neutral-results.js';

/**
 * The outbound guard every public method runs its implementation through. This is what lets the HTTP layer
 * stay free of any provider's error classes, so the two properties below are load-bearing rather than
 * incidental: a native error must not escape, and a *neutral* one must not get re-wrapped.
 */
describe('TaxEntityProvider fault guard', () => {
    /** A provider whose native failure is a bare string-tagged Error, translated to a fault on the way out. */
    class FakeProvider extends TaxEntityProvider {
        constructor(private readonly boom: () => never) {
            super();
        }

        protected override translateFault(err: unknown): unknown {
            if (err instanceof Error && err.name === 'NativeFailure') {
                return new ProviderFault('AUTHORITY_SERVICE', 'FAKE_SERVICE', err.message);
            }
            return err;
        }

        // Deliberately NOT `async`: a sync throw here is the production shape of `validateCredentials`,
        // which returns `Promise.resolve(...)` around a validator that can throw before any await.
        protected validateCredentialsImpl(): Promise<CredentialValidationResult> {
            this.boom();
        }
        protected async authorizeInvoiceImpl(): Promise<TaxAuthorizationResult> {
            this.boom();
        }
        protected async lastAuthorizedImpl(): Promise<LastAuthorizedResult> {
            this.boom();
        }
        protected async nextNumbersImpl(): Promise<NextNumbersResult> {
            this.boom();
        }
        protected async queryVoucherImpl(): Promise<TaxAuthorizationResult> {
            this.boom();
        }
        protected async authorityStatusImpl(): Promise<AuthorityStatusResult> {
            this.boom();
        }
        protected async lookupTaxpayersImpl(): Promise<TaxpayerResult> {
            this.boom();
        }
        protected async pointsOfSaleImpl(): Promise<PointsOfSaleResult> {
            this.boom();
        }
        protected async currencyRatesImpl(): Promise<CurrencyRatesResult> {
            this.boom();
        }
    }

    function native(): never {
        const err = new Error('authority said no');
        err.name = 'NativeFailure';
        throw err;
    }

    const entity: EntityAuthBlock = {entityCode: 'FAKE', issuerTaxId: '1', environment: 'testing'};

    it('translates a synchronous throw, not just a rejected promise', async () => {
        // `validateCredentialsImpl` throws before returning a promise. The guard calls it INSIDE its `try`
        // for exactly this case; called outside, the throw would escape untranslated to the wire.
        const provider = new FakeProvider(native);
        await expect(provider.validateCredentials({} as never)).rejects.toMatchObject({
            category: 'AUTHORITY_SERVICE',
            code: 'FAKE_SERVICE',
            message: 'authority said no',
        });
    });

    it('translates on every public method, so none of them can leak a native error', async () => {
        const provider = new FakeProvider(native);
        const calls: ReadonlyArray<[string, Promise<unknown>]> = [
            ['authorizeInvoice', provider.authorizeInvoice(entity, {} as never)],
            ['lastAuthorized', provider.lastAuthorized(entity, 1, 1)],
            ['nextNumbers', provider.nextNumbers(entity, 1, [1])],
            ['queryVoucher', provider.queryVoucher(entity, 1, 1, 1)],
            ['authorityStatus', provider.authorityStatus('testing')],
            ['lookupTaxpayers', provider.lookupTaxpayers('testing', 80, '1')],
            ['pointsOfSale', provider.pointsOfSale(entity)],
            ['validateCredentials', provider.validateCredentials({} as never)],
        ];
        for (const [name, call] of calls) {
            await expect(call).rejects.toBeInstanceOf(ProviderFault);
            await expect(call).rejects.not.toMatchObject({name: 'NativeFailure'});
            expect(name).toBeTruthy();
        }
    });

    it('leaves an already-neutral error alone rather than flattening its status', async () => {
        // A provider raises these deliberately and each carries its own status. Re-wrapping the 404 core's
        // orphan reconciliation keys on would turn it into a 502 — the one confusion it must never make.
        const notFound = new VoucherNotFoundError('FAKE', 3, 1, 42);
        const provider = new FakeProvider(() => {
            throw notFound;
        });
        await expect(provider.queryVoucher(entity, 3, 1, 42)).rejects.toBe(notFound);
    });
});
