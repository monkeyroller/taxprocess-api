/**
 * The shape of the vendored FCE registry snapshot.
 *
 * Its own file so the generated module can be annotated with these without importing its reader, which
 * would close a cycle. The annotations are not decoration: an unannotated literal is widened into the
 * emitted `.d.ts`, which for the receiver table would copy all ~1,180 companies into the declarations, and
 * for the snapshot would narrow `''` and `0` to literal types — making the reader's placeholder checks
 * provably true to the compiler and provably false the moment the file is regenerated.
 */

export interface FceRegistrySnapshot {
    /**
     * ISO day this service read the sources. `''` when never generated.
     *
     * **There is deliberately no `publishedAt`.** ARCA's listing states no date of its own: the "Fecha de
     * actualización" on the page is `new Date()` rendered client-side by the page's own script, so it
     * always reads as the day you happen to look. Holding it would have put our run date on the wire as an
     * authority fact — and, worse, would have made a staleness check comparing it against yesterday pass on
     * every run.
     */
    readonly fetchedAt: string;
    readonly sourceUrl: string;
    /** `0` means never generated, which the reader treats as "cannot speak". */
    readonly rowCount: number;
    readonly generalThreshold: {
        readonly amount: number;
        /** The entity's own currency code, not ISO 4217 — AR pesos are `PES`. */
        readonly currencyCode: string;
        /** ISO day the figure took effect, per the instrument below. Published, unlike the listing's date. */
        readonly effectiveFrom: string;
        readonly instrument: string;
    };
}

/** One company ARCA lists as an *empresa grande*. */
export interface FceObligatedReceiver {
    /**
     * ISO day this company's obligation begins.
     *
     * Load-bearing rather than informational. ARCA notifies the year's universe by May but its altas take
     * effect in September, so between those months the listing holds companies that are not yet obligated
     * — and answering `true` for one issues a credit invoice up to four months before the buyer owes it.
     */
    readonly since: string;
    /**
     * The denominación ARCA publishes.
     *
     * Never read to decide anything. It is here so a refresh is reviewable — a diff of a thousand bare
     * CUITs cannot be judged by a human, and vendoring this file rather than fetching it on a schedule is
     * only worth something if someone can judge it. It also lets an operator asking "why was this sale a
     * credit invoice" get an answer in words.
     */
    readonly name: string;
}

/**
 * The listing, keyed by CUIT.
 *
 * A map rather than an array because every use is a lookup by tax id; an array would have to be indexed
 * into one anyway. Read through a `Map` built from `Object.entries` rather than by property access, so an
 * inherited key like `constructor` cannot answer as though it were a listed company — the same hazard
 * `faults.ts` avoids with `Object.hasOwn`.
 */
export type FceObligatedReceivers = Readonly<Record<string, FceObligatedReceiver>>;
