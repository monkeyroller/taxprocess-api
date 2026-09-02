import fs from 'node:fs';

/**
 * A cache of values that expire, keyed by `(owner, scope)`, optionally surviving process restarts.
 *
 * Entity-agnostic: nothing here knows what a ticket is, only the shape of the problem. An authority hands
 * out a credential with an expiry, refuses to issue a second while the first is valid, and issues them per
 * asker and subject. That is what makes this more than a `Map`:
 *
 * - Expiry with a margin, so a value is never handed out with too little life left to finish its call.
 * - Single-flight, so concurrent misses on one key share one fetch. Without it, N requests mint N
 *   credentials and an authority that refuses to re-issue rejects all but the first.
 * - Persistence across restarts, without which a restarted process cannot obtain a credential until the old
 *   one expires. Writes go through a temp file and `rename`, so a crash mid-write cannot leave a torn file.
 * - Scoped invalidation, so a rejection drops exactly the rejected pair and leaves an owner's other scopes
 *   mintable.
 *
 * The on-disk format is a compatibility surface: keys are `${owner}:${scope}` and the file is a
 * `Record<key, S>` with two-space indentation. A deploy that changes either invalidates every persisted
 * value, so the layout is pinned by a round-trip test.
 */
export interface ExpiringCacheOptions<V, S> {
    /** File to persist to. Omitted leaves the cache in-memory only, every persistence path a no-op. */
    readonly cachePath?: string;

    /** Treat a value as gone this many ms before it actually expires. */
    readonly expiryMarginMs: number;

    /** When the value expires. */
    readonly expiresAt: (value: V) => Date;

    /** The value in its persisted form. Must round-trip through `deserialize`. */
    readonly serialize: (value: V) => S;

    /** The value back from its persisted form. */
    readonly deserialize: (stored: S) => V;
}

export class ExpiringCache<V, S> {
    private readonly memory = new Map<string, V>();
    private readonly pending = new Map<string, Promise<V>>();

    constructor(private readonly options: ExpiringCacheOptions<V, S>) {}

    /**
     * The cache key for a pair. Owned here rather than by callers because scoped invalidation reads it back
     * as a prefix, and two spellings would make `clear(owner)` silently miss entries.
     *
     * `:` is a separator rather than a reserved character, and callers do put it inside `owner` — a ticket
     * owner is `ARCA:testing:20111111112`. So it cannot be validated away, and the invariant it leaves
     * behind belongs to whoever mints the owner keys: no owner key may be another owner key followed by `:`
     * and more. Where that fails, clearing the shorter owner clears the longer one too, which against an
     * authority that refuses to re-issue is a ~12h outage for an owner nobody asked about.
     *
     * Changing the separator would fix it structurally and is not available: the key layout is the on-disk
     * format, so changing it would invalidate every persisted value.
     */
    private static keyOf(owner: string, scope: string): string {
        return `${owner}:${scope}`;
    }

    /**
     * A cached value that is still comfortably valid, or `undefined`. Reads the file when memory has nothing
     * usable and reseats what it finds, so a value persisted by an earlier or concurrent process is used
     * rather than re-fetched.
     *
     * A remembered value that has gone stale is forgotten rather than treated as the answer. Read as
     * `memory.get(key) ?? loadOne(key)` it would fall through only on a missing entry, so an expired one
     * shadowed the file — the exact case where the file is most likely ahead, a second process sharing the
     * cache renewing on its own schedule. The caller then fetched, and against an authority that refuses to
     * re-issue while its previous credential lives the fetch is refused for as long as the file's value.
     */
    peek(owner: string, scope: string): V | undefined {
        const key = ExpiringCache.keyOf(owner, scope);
        const remembered = this.memory.get(key);
        if (remembered !== undefined) {
            if (this.isFresh(remembered)) {
                return remembered;
            }
            // Dropped rather than left in place: it can only shadow the file again, and nothing else here
            // would evict it.
            this.memory.delete(key);
        }

        const stored = this.loadOne(key);
        if (stored === undefined || !this.isFresh(stored)) {
            return undefined;
        }
        this.memory.set(key, stored);
        return stored;
    }

    /** A valid cached value, calling `create` only when there is none. Concurrent callers share one call. */
    async getOrCreate(owner: string, scope: string, create: () => Promise<V>): Promise<V> {
        const fresh = this.peek(owner, scope);
        if (fresh !== undefined) {
            return fresh;
        }

        const key = ExpiringCache.keyOf(owner, scope);
        const inFlight = this.pending.get(key);
        if (inFlight !== undefined) {
            return inFlight;
        }

        const creating = create()
            .then((value) => {
                this.memory.set(key, value);
                this.persist(key, value);
                return value;
            })
            .finally(() => {
                this.pending.delete(key);
            });

        this.pending.set(key, creating);
        return creating;
    }

    /**
     * Which keys a pair names, widening as arguments are omitted: both name exactly that entry, `owner`
     * alone every scope under it, neither everything.
     *
     * A predicate so memory and the file are swept by the same rule. Spelled out twice, the two halves could
     * disagree about a scope and leave a value that was meant to be evicted alive in the other store.
     *
     * The `owner`-only form matches on a prefix, which is exact only under `keyOf`'s key-grammar invariant.
     * Not narrowed to one more segment: an owner legitimately contains the separator, so counting segments
     * would under-match instead.
     */
    private static matcher(owner?: string, scope?: string): (key: string) => boolean {
        if (owner === undefined) {
            return () => true;
        }
        if (scope === undefined) {
            const prefix = `${owner}:`;
            return (key) => key.startsWith(prefix);
        }
        const exact = ExpiringCache.keyOf(owner, scope);
        return (key) => key === exact;
    }

    /**
     * Drops cached values from memory and the file, so one evicted after a rejection cannot resurrect from
     * disk on the next `peek`. Widens as arguments are omitted, the way `matcher` describes.
     */
    clear(owner?: string, scope?: string): void {
        const matches = ExpiringCache.matcher(owner, scope);
        for (const key of this.memory.keys()) {
            if (matches(key)) {
                this.memory.delete(key);
            }
        }
        this.unpersist(matches);
    }

    private isFresh(value: V): boolean {
        return this.options.expiresAt(value).getTime() - Date.now() > this.options.expiryMarginMs;
    }

    /** The whole persisted file, or `{}` when there is none, or it is unreadable. */
    private readFile(): Record<string, S> {
        if (this.options.cachePath === undefined) {
            return {};
        }
        try {
            return JSON.parse(fs.readFileSync(this.options.cachePath, 'utf8')) as Record<string, S>;
        } catch {
            return {};
        }
    }

    /**
     * Replaces the file atomically, via a per-pid temp file renamed over the target. Best-effort:
     * persistence failing degrades to in-memory and never fails the call that triggered it.
     */
    private writeFile(all: Record<string, S>): void {
        const cachePath = this.options.cachePath;
        if (cachePath === undefined) {
            return;
        }
        try {
            const tmpPath = `${cachePath}.${process.pid}.tmp`;
            fs.writeFileSync(tmpPath, JSON.stringify(all, null, 2));
            fs.renameSync(tmpPath, cachePath);
        } catch {
            // best-effort; fall back to in-memory only
        }
    }

    private loadOne(key: string): V | undefined {
        const stored = this.readFile()[key];
        return stored === undefined ? undefined : this.options.deserialize(stored);
    }

    /**
     * Re-read, merge, write. Synchronous throughout, so within one process it is a serial critical section
     * and two concurrent creations cannot drop each other's entry.
     */
    private persist(key: string, value: V): void {
        if (this.options.cachePath === undefined) {
            return;
        }
        const all = this.readFile();
        all[key] = this.options.serialize(value);
        this.writeFile(all);
    }

    /** The file half of `clear`, swept by the predicate memory was swept with. */
    private unpersist(matches: (key: string) => boolean): void {
        if (this.options.cachePath === undefined) {
            return;
        }
        // Rebuilt rather than deleted-from, which keeps the surviving entries in their original order so the
        // file does not churn on every eviction.
        const all = this.readFile();
        const kept: Record<string, S> = {};
        let dropped = false;
        for (const [key, value] of Object.entries(all)) {
            if (matches(key)) {
                dropped = true;
            } else {
                kept[key] = value;
            }
        }
        if (dropped) {
            this.writeFile(kept);
        }
    }
}
