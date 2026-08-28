import {describe, expect, it} from '@jest/globals';
import {
    AddressCodeScheme,
    ProviderFault,
    TaxEntityProvider,
    VoucherNotFoundError,
    type AuthorityStatusResult,
    type CredentialValidationResult,
    type EntityAuthBlock,
    type NextNumbersResult,
    type PointsOfSaleResult,
    type TaxAuthorizationResult,
    type TaxpayerResult,
} from './provider.js';

/**
 * The shared address-scheme vocabulary. A caller resolves an address level by matching
 * `(code, codeScheme)` against its own catalogs, so these values are join keys — and a bad one fails
 * *silently*, matching no row and leaving the field null rather than raising anything. These assertions
 * are the only place that failure mode can be caught.
 */

describe('AddressCodeScheme', () => {
    const values = Object.values(AddressCodeScheme);

    it('is key-safe: nothing a stray space or a lowercase letter could break', () => {
        // The reason the values are tokens rather than prose. `"ISO 3166-1 alpha-2"` and
        // `"ISO 3166-1 Alpha-2"` are different keys and neither side would ever be told.
        for (const value of values) {
            expect(value).toMatch(/^[A-Z0-9-]+$/);
        }
    });

    it('never repeats a token across coding systems', () => {
        // Pair-matching depends on this. Sharing a bare `ISO` between country and region would make
        // `(code, scheme)` ambiguous and leave the level to disambiguate what the pair is supposed to.
        expect(new Set(values).size).toBe(values.length);
    });

    it('names the ISO forms precisely enough to tell them apart', () => {
        // ISO 3166-1 defines three codes for the same country (alpha-2 AR, alpha-3 ARG, numeric 032), so
        // the country scheme has to say which — core stores alpha-2. ISO 3166-2 has one code form, so no
        // variant is named there.
        expect(AddressCodeScheme.ISO_3166_1_ALPHA_2).toBe('ISO-3166-1-ALPHA-2');
        expect(AddressCodeScheme.ISO_3166_2).toBe('ISO-3166-2');
        expect(AddressCodeScheme.ISO_3166_1_ALPHA_2).not.toBe(AddressCodeScheme.ISO_3166_2);
    });

    it('pins the values as the contract, since a change to one is breaking for every caller', () => {
        // Member NAMES are free to be renamed; these strings are not — a caller has them in its schema.
        expect(values.sort()).toEqual(['INDEC', 'ISO-3166-1-ALPHA-2', 'ISO-3166-2']);
    });
});

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
        protected async lastAuthorizedImpl(): Promise<{number: number}> {
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
