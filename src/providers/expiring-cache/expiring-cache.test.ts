import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from '@jest/globals';
import {ExpiringCache, type ExpiringCacheOptions} from './expiring-cache.js';

/**
 * The caching mechanism, and the on-disk format it must not break.
 *
 * The format tests matter more than they look: a persisted credential that cannot be read back is not a
 * cache miss you pay a round trip for but, against an authority that refuses to re-issue while the old one
 * is valid, an outage until that credential expires. Nothing in a normal test run notices.
 */

interface Value {
    readonly token: string;
    readonly expirationTime: Date;
}

interface Stored {
    token: string;
    expirationTime: string;
}

function tmpPath(name: string): string {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'expiring-cache-')), name);
}

function makeCache(overrides: Partial<ExpiringCacheOptions<Value, Stored>> = {}): ExpiringCache<Value, Stored> {
    return new ExpiringCache<Value, Stored>({
        expiryMarginMs: 60_000,
        expiresAt: (value) => value.expirationTime,
        serialize: (value) => ({token: value.token, expirationTime: value.expirationTime.toISOString()}),
        deserialize: (stored) => ({token: stored.token, expirationTime: new Date(stored.expirationTime)}),
        ...overrides,
    });
}

const inAnHour = (): Date => new Date(Date.now() + 60 * 60 * 1000);

describe('ExpiringCache — caching', () => {
    it('serves a cached value without calling create again', async () => {
        const cache = makeCache();
        let created = 0;
        const create = async (): Promise<Value> => {
            created += 1;
            return {token: 'TOK', expirationTime: inAnHour()};
        };

        expect((await cache.getOrCreate('owner', 'svc', create)).token).toBe('TOK');
        expect((await cache.getOrCreate('owner', 'svc', create)).token).toBe('TOK');
        expect(created).toBe(1);
    });

    it('keys by the pair, so one owner\'s scopes and one scope\'s owners stay separate', async () => {
        const cache = makeCache();
        const create = (token: string) => async (): Promise<Value> => ({token, expirationTime: inAnHour()});

        await cache.getOrCreate('ownerA', 'svc', create('A'));
        await cache.getOrCreate('ownerB', 'svc', create('B'));
        await cache.getOrCreate('ownerA', 'other', create('A-other'));

        expect(cache.peek('ownerA', 'svc')?.token).toBe('A');
        expect(cache.peek('ownerB', 'svc')?.token).toBe('B');
        expect(cache.peek('ownerA', 'other')?.token).toBe('A-other');
    });

    it('de-duplicates concurrent misses into a single create', async () => {
        // Without this, N concurrent requests mint N credentials, and an authority that refuses to issue a
        // second while the first is valid rejects all but one.
        const cache = makeCache();
        let created = 0;
        const create = async (): Promise<Value> => {
            created += 1;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return {token: 'TOK', expirationTime: inAnHour()};
        };

        const results = await Promise.all([
            cache.getOrCreate('owner', 'svc', create),
            cache.getOrCreate('owner', 'svc', create),
            cache.getOrCreate('owner', 'svc', create),
        ]);

        expect(results.map((r) => r.token)).toEqual(['TOK', 'TOK', 'TOK']);
        expect(created).toBe(1);
    });

    it('treats a value inside the expiry margin as already gone', async () => {
        // 30s of life against a 60s margin: still valid, but not enough to finish the call it would serve.
        const cache = makeCache();
        const nearlyExpired = {token: 'OLD', expirationTime: new Date(Date.now() + 30_000)};
        await cache.getOrCreate('owner', 'svc', async () => nearlyExpired);

        expect(cache.peek('owner', 'svc')).toBeUndefined();
        const replaced = await cache.getOrCreate('owner', 'svc', async () => ({
            token: 'NEW',
            expirationTime: inAnHour(),
        }));
        expect(replaced.token).toBe('NEW');
    });
});

describe('ExpiringCache — a stale memory entry never shadows the file', () => {
    it('reads the file when what memory holds has expired, not only when memory holds nothing', async () => {
        // Two processes sharing one cache file: `first` remembers a value that expires while `second`
        // renews and persists. `first` must pick that up rather than re-fetch, since against an authority
        // that refuses to re-issue the re-fetch is refused for as long as the file held the answer. Reading
        // memory as `get(key) ?? loadOne(key)` fell through only on a missing entry.
        const cachePath = tmpPath('shared.json');
        const first = makeCache({cachePath});
        const second = makeCache({cachePath});

        const expired = {token: 'OLD', expirationTime: new Date(Date.now() - 1000)};
        await first.getOrCreate('owner', 'svc', async () => expired);
        expect(first.peek('owner', 'svc')).toBeUndefined(); // stale, as it should be

        await second.getOrCreate('owner', 'svc', async () => ({token: 'RENEWED', expirationTime: inAnHour()}));

        expect(first.peek('owner', 'svc')?.token).toBe('RENEWED');
        // ...and `getOrCreate` therefore serves it instead of minting a second one.
        let created = 0;
        const renewed = await first.getOrCreate('owner', 'svc', async () => {
            created += 1;
            return {token: 'SHOULD-NOT-MINT', expirationTime: inAnHour()};
        });
        expect(renewed.token).toBe('RENEWED');
        expect(created).toBe(0);
    });

    it('still reports nothing when the file is stale too', async () => {
        const cachePath = tmpPath('shared.json');
        const cache = makeCache({cachePath});

        await cache.getOrCreate('owner', 'svc', async () => ({
            token: 'OLD',
            expirationTime: new Date(Date.now() - 1000),
        }));

        expect(cache.peek('owner', 'svc')).toBeUndefined();
        expect(cache.peek('owner', 'svc')).toBeUndefined(); // and stays that way once memory has forgotten it
    });
});

describe('ExpiringCache — scoped invalidation', () => {
    const seed = async (cache: ExpiringCache<Value, Stored>): Promise<void> => {
        await cache.getOrCreate('ownerA', 'svc1', async () => ({token: 'A1', expirationTime: inAnHour()}));
        await cache.getOrCreate('ownerA', 'svc2', async () => ({token: 'A2', expirationTime: inAnHour()}));
        await cache.getOrCreate('ownerB', 'svc1', async () => ({token: 'B1', expirationTime: inAnHour()}));
    };

    it('drops exactly one pair when both arguments are given', async () => {
        // The form to use after a rejection: dropping an owner's other scopes would leave those unmintable
        // until they expire.
        const cache = makeCache({cachePath: tmpPath('c.json')});
        await seed(cache);

        cache.clear('ownerA', 'svc1');

        expect(cache.peek('ownerA', 'svc1')).toBeUndefined();
        expect(cache.peek('ownerA', 'svc2')?.token).toBe('A2');
        expect(cache.peek('ownerB', 'svc1')?.token).toBe('B1');
    });

    it('drops every scope under one owner when the scope is omitted', async () => {
        const cache = makeCache({cachePath: tmpPath('c.json')});
        await seed(cache);

        cache.clear('ownerA');

        expect(cache.peek('ownerA', 'svc1')).toBeUndefined();
        expect(cache.peek('ownerA', 'svc2')).toBeUndefined();
        expect(cache.peek('ownerB', 'svc1')?.token).toBe('B1');
    });

    it('does not clear a sibling whose owner merely SHARES a leading segment', async () => {
        // An owner legitimately contains the separator, so the prefix `clear` matches on is `${owner}:`
        // rather than `${owner}`. Without it, clearing a short owner would take a longer one with it.
        const cache = makeCache({cachePath: tmpPath('c.json')});
        await cache.getOrCreate('ARCA:testing:2011', 'wsfe', async () => ({
            token: 'short',
            expirationTime: inAnHour(),
        }));
        await cache.getOrCreate('ARCA:testing:20111111112', 'wsfe', async () => ({
            token: 'long',
            expirationTime: inAnHour(),
        }));

        cache.clear('ARCA:testing:2011');

        expect(cache.peek('ARCA:testing:2011', 'wsfe')).toBeUndefined();
        expect(cache.peek('ARCA:testing:20111111112', 'wsfe')?.token).toBe('long');
    });

    it('DOES sweep an owner that extends another at a separator — the invariant callers must honour', async () => {
        // The limit of prefix matching, pinned rather than left to be discovered: `clear` cannot tell a
        // longer owner from a scope under this one, since both are `${owner}:…`. A key grammar letting one
        // owner extend another would over-evict, which for a ticket cache is a ~12h outage for an owner
        // nobody asked about — hence the fixed-width CUIT tail on both of the ticket store's shapes.
        const cache = makeCache({cachePath: tmpPath('c.json')});
        await cache.getOrCreate('ARCA:testing', 'wsfe', async () => ({
            token: 'outer',
            expirationTime: inAnHour(),
        }));
        await cache.getOrCreate('ARCA:testing:delegate', 'wsfe', async () => ({
            token: 'inner',
            expirationTime: inAnHour(),
        }));

        cache.clear('ARCA:testing');

        expect(cache.peek('ARCA:testing', 'wsfe')).toBeUndefined();
        // Swept as collateral. Not a bug in the cache — a violation of the grammar rule its callers keep.
        expect(cache.peek('ARCA:testing:delegate', 'wsfe')).toBeUndefined();
    });

    it('drops everything when both are omitted', async () => {
        const cache = makeCache({cachePath: tmpPath('c.json')});
        await seed(cache);

        cache.clear();

        expect(cache.peek('ownerA', 'svc1')).toBeUndefined();
        expect(cache.peek('ownerB', 'svc1')).toBeUndefined();
    });

    it('purges the file too, so a cleared value cannot resurrect from disk', async () => {
        // The whole reason clearing touches the file: an evicted credential that came back on the next peek
        // would be re-sent to the authority that just rejected it.
        const cachePath = tmpPath('c.json');
        const cache = makeCache({cachePath});
        await seed(cache);

        cache.clear('ownerA', 'svc1');

        const onDisk = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Record<string, Stored>;
        expect(Object.keys(onDisk).sort()).toEqual(['ownerA:svc2', 'ownerB:svc1']);
        expect(makeCache({cachePath}).peek('ownerA', 'svc1')).toBeUndefined();
    });
});

describe('ExpiringCache — the on-disk format', () => {
    it('reads a file written before this class existed', () => {
        // A verbatim cache file as the pre-extraction client wrote it. If this stops parsing, a deploy
        // silently invalidates every persisted credential.
        const cachePath = tmpPath('legacy.json');
        fs.writeFileSync(
            cachePath,
            JSON.stringify(
                {
                    'tenantA:20111111112:wsfe': {
                        token: 'LEGACY-TOKEN',
                        expirationTime: inAnHour().toISOString(),
                    },
                },
                null,
                2,
            ),
        );

        const found = makeCache({cachePath}).peek('tenantA:20111111112', 'wsfe');

        expect(found?.token).toBe('LEGACY-TOKEN');
    });

    it('writes the key spelling and indentation the old writer used', async () => {
        const cachePath = tmpPath('c.json');
        const expirationTime = inAnHour();
        await makeCache({cachePath}).getOrCreate('tenantA:20111111112', 'wsfe', async () => ({
            token: 'TOK',
            expirationTime,
        }));

        // Byte-for-byte against the old `JSON.stringify(all, null, 2)` of the same content.
        expect(fs.readFileSync(cachePath, 'utf8')).toBe(
            JSON.stringify(
                {'tenantA:20111111112:wsfe': {token: 'TOK', expirationTime: expirationTime.toISOString()}},
                null,
                2,
            ),
        );
    });

    it('merges into an existing file rather than replacing it', async () => {
        // Two owners share one cache file, so a write dropping the other's entry would evict a credential
        // belonging to a tenant not involved in this call.
        const cachePath = tmpPath('c.json');
        const cache = makeCache({cachePath});
        await cache.getOrCreate('ownerA', 'svc', async () => ({token: 'A', expirationTime: inAnHour()}));
        await cache.getOrCreate('ownerB', 'svc', async () => ({token: 'B', expirationTime: inAnHour()}));

        const onDisk = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Record<string, Stored>;
        expect(Object.keys(onDisk).sort()).toEqual(['ownerA:svc', 'ownerB:svc']);
    });

    it('leaves no temp file behind', async () => {
        const cachePath = tmpPath('c.json');
        await makeCache({cachePath}).getOrCreate('owner', 'svc', async () => ({
            token: 'TOK',
            expirationTime: inAnHour(),
        }));

        expect(fs.readdirSync(path.dirname(cachePath))).toEqual([path.basename(cachePath)]);
    });

    it('treats an unreadable or corrupt file as empty rather than throwing', () => {
        // Persistence is best-effort: a torn or hand-edited file degrades to a cache miss rather than
        // failing the call that touched it.
        const corrupt = tmpPath('corrupt.json');
        fs.writeFileSync(corrupt, '{not json');
        expect(makeCache({cachePath: corrupt}).peek('owner', 'svc')).toBeUndefined();

        expect(makeCache({cachePath: tmpPath('missing.json')}).peek('owner', 'svc')).toBeUndefined();
    });

    it('is in-memory only when no path is given, with every persistence path a no-op', async () => {
        const cache = makeCache();
        await cache.getOrCreate('owner', 'svc', async () => ({token: 'TOK', expirationTime: inAnHour()}));

        expect(cache.peek('owner', 'svc')?.token).toBe('TOK');
        expect(() => {
            cache.clear('owner', 'svc');
        }).not.toThrow();
    });
});
