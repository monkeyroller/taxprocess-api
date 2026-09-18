/**
 * The shape of the vendored FCE registry snapshot.
 *
 * Its own file so the generated module can be annotated with it without importing its reader, which would
 * close a cycle. The annotation is not decoration: without it the placeholder's `''` and `0` narrow to
 * literal types, and every check in the reader — `publishedAt === ''`, `rowCount === 0` — becomes
 * provably-true to the compiler and provably-false the moment the file is regenerated. Lint catches that
 * today; the annotation is what stops it being reintroduced.
 */
export interface FceRegistrySnapshot {
    /** ISO day the listing states it takes effect. `''` when never generated. */
    readonly publishedAt: string;
    /** The page's own wording for that day, verbatim, so the parse is auditable. */
    readonly publishedAtRaw: string;
    /** ISO day this service read the page. */
    readonly fetchedAt: string;
    readonly sourceUrl: string;
    /** `0` means never generated, which the reader treats as "cannot speak". */
    readonly rowCount: number;
    readonly generalThreshold: {
        readonly amount: number;
        /** The entity's own currency code, not ISO 4217 — AR pesos are `PES`. */
        readonly currencyCode: string;
        readonly effectiveFrom: string;
        readonly instrument: string;
    };
}
