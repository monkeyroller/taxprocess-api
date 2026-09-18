// GENERATED FILE — do not edit by hand. Regenerate with `node scripts/build-fce-registry.mjs`.
//
// ARCA's published "empresas grandes" listing for the Factura de Crédito Electrónica régimen, vendored so a
// fallback needs no network call and no database — this service holds nothing at rest but its own delegate
// certificate, and that is deliberate.
//
// This is the FALLBACK ONLY. WSFECRED is the primary and always answers first; this file is consulted when
// the authority cannot be reached at all, and any answer taken from it is labelled `LOCAL_REGISTRY` on the
// wire with the snapshot dates below attached. A voucher issued off a stale list is therefore identifiable
// afterwards rather than indistinguishable from a live answer.
//
// ── CURRENTLY A PLACEHOLDER ──────────────────────────────────────────────────────────────────────────────
// `rowCount` is 0 and there are no rows: the listing has not been fetched yet. The reader declines to answer
// from an empty snapshot, so the endpoint runs authority-only and a genuine WSFECRED outage surfaces as a
// `502` rather than a wrong verdict. That is correct behaviour, just without the fallback. Populating this
// is one run of the build script and lands as its own commit whose diff is pure data.
//
// Refresh calendar, from ARCA's own published rules for the universe: the annual notification lands by the
// seventh business day of May, bajas take effect from July, altas from September. Run the script a day
// after each milestone rather than on it — ARCA is not punctual with publication, and a fetch that runs on
// the nominal day and finds last year's list is worse than one that runs a day later and finds this year's.
// A one-day known-stale window is the smaller risk, and `fetchedAt` makes it readable either way.

import type {FceRegistrySnapshot} from './fce-registry.types.js';

/**
 * What was read, and when it takes effect. In code rather than a header comment because it is published:
 * `publishedAt` and `fetchedAt` go out on the wire inside `registrySnapshot`, so a caller holding an answer
 * months later can date it without asking us. Regenerating rewrites this and the rows together, so neither
 * can go stale alone.
 *
 * Annotated with {@link FceRegistrySnapshot} rather than `as const`: the literals in a placeholder would
 * otherwise narrow to their own types, making the reader's `publishedAt === ''` and `rowCount === 0` checks
 * provably true to the compiler — and provably false the moment this file is regenerated.
 */
export const FCE_REGISTRY_SNAPSHOT: FceRegistrySnapshot = {
    /**
     * The day the listing itself states it takes effect — read from the page, never from the clock. The
     * reader refuses to answer about any day before this one: a list published in April says nothing about
     * February, when both the membership and the threshold were different.
     */
    publishedAt: '',

    /** The page's own wording for that date, verbatim, so the parse can be audited in review. */
    publishedAtRaw: '',

    /** The day this service read the page. Published so "the list has not refreshed since May" is a fact
     * somebody can read rather than infer. */
    fetchedAt: '',

    sourceUrl: 'https://servicioscf.afip.gob.ar/facturadecreditoelectronica/Listado-RFCE-Mi-PyMe.asp',

    /** Rows below. `0` means "never generated", which the reader treats as "cannot speak". */
    rowCount: 0,

    /**
     * The general threshold as published at `publishedAt`.
     *
     * **A dated observation, not a constant.** The difference is the whole argument for this file existing:
     * a constant is an undated, unattributed number compiled into logic, which goes silently wrong the day
     * the resolución changes. This says *"as at this date, per this instrument, read from this URL on this
     * day"* — and every part of that is checked rather than promised. The figure appears nowhere else in the
     * source tree (a test asserts it), it never reaches the wire without `source: 'LOCAL_REGISTRY'` and its
     * snapshot beside it, it is never compared against or blended with the authority's `montoDesde`, and it
     * cannot be applied to a day before `publishedAt`.
     *
     * Per the régimen the floor varies by the *receiver's* principal activity, which a single figure cannot
     * express. That is exactly why the authority's value is the only fully correct one and this is the
     * fallback: it is the published general limit, and it is labelled as such.
     */
    generalThreshold: {
        amount: 0,
        /** The entity's own currency code, not ISO 4217 — AR pesos are `PES`. */
        currencyCode: 'PES',
        effectiveFrom: '',
        instrument: '',
    },
};

/**
 * One 11-digit CUIT per line, sorted, newline-delimited.
 *
 * Annotated `: string` rather than left to inference on purpose: without the annotation TypeScript widens
 * the literal into the emitted `.d.ts` and copies every row into it, which is the same reason
 * `localities.generated.ts` carries the annotation.
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const FCE_OBLIGATED_RECEIVER_ROWS: string = ``;
