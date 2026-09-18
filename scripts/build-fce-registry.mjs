// Regenerates `obligated-receivers.generated.ts` from ARCA's published "empresas grandes" listing for the
// Factura de Crédito Electrónica régimen.
//
// Run: `node scripts/build-fce-registry.mjs`
//
// This file is the FALLBACK's data. WSFECRED is always the primary; the snapshot is consulted only when the
// authority cannot be reached, and any answer taken from it goes out labelled `LOCAL_REGISTRY` with the
// dates below attached.
//
// Refresh calendar, from ARCA's own published rules for the universe: the annual notification lands by the
// seventh business day of May, bajas take effect from July, altas from September. Run this a day AFTER each
// milestone rather than on it — ARCA is not punctual with publication, and a run that finds last year's
// list is worse than one that waits a day and finds this year's. That is also why the date check below is a
// hard failure: a silent no-op refresh is the thing this script exists to make impossible.
//
// VALIDATES AND THROWS rather than emitting suspect data, following `build-rec20-units.mjs`. Every check
// below has the same rationale — a reshaped page must break the build, never quietly empty the fallback or
// date it wrongly. A missing fallback is a `502` somebody notices; a wrong one is a wrong fiscal document.

import {readFile, writeFile} from 'node:fs/promises';

const SOURCE_URL = 'https://servicioscf.afip.gob.ar/facturadecreditoelectronica/Listado-RFCE-Mi-PyMe.asp';
const OUT = new URL(
    '../src/providers/arca/mapping/fce-registry/obligated-receivers.generated.ts',
    import.meta.url,
);

/**
 * Below this, assume the parse broke rather than that the régimen emptied. The universe is thousands of
 * companies and changes twice a year; it does not drop to double digits.
 */
const MIN_ROWS = 100;

/** `dd/mm/yyyy` as it appears in the page's vigencia wording. */
const PUBLISHED_PATTERN = /vigente\s+desde\s+el\s+(\d{2})\/(\d{2})\/(\d{4})/i;

/**
 * The published general floor, as an Argentine-formatted amount near the word `monto`, `importe` or
 * `pesos`. Deliberately loose about the wording, which moves between publications — but NOT about the
 * anchor, which is load-bearing: unanchored, the first run of 7+ digits and dots anywhere in the document
 * wins, and on this page that is an 11-digit CUIT from the listing itself. `30711111119` is finite and
 * positive, so it sails through the check below and ships as a floor no voucher can clear.
 *
 * The gap allows for markup and a currency symbol between the word and the figure, and excludes digits so
 * the anchor cannot skip over one number to reach another.
 */
const THRESHOLD_PATTERN = /(?:monto|importe|pesos)[^\d]{0,120}?([\d.]{7,})(?:,(\d{2}))?/i;

/** The resolución the current figure comes from, when the page names one. */
const INSTRUMENT_PATTERN = /(Resoluci[oó]n\s+(?:General\s+)?N?[°º]?\s*[\d/]+)/i;

function fail(message) {
    throw new Error(
        `${message}\n\nThe page at ${SOURCE_URL} did not parse as expected. Nothing has been written — ` +
            `the previous snapshot is still in place. Read the page by hand and fix the patterns in this ` +
            `script rather than relaxing a check: every one of them exists so a reshaped page cannot ` +
            `quietly empty or misdate the fallback.`,
    );
}

/** Argentina's `1.234.567,89` as a number. */
function parseArgentineAmount(whole, cents) {
    return Number(`${whole.replaceAll('.', '')}.${cents ?? '00'}`);
}

/** The mod-11 check digit rule for a CUIT. Re-implemented because an `.mjs` cannot import the TS helper. */
function isValidCuit(value) {
    if (!/^\d{11}$/.test(value)) {
        return false;
    }
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + weight * Number(value[index]), 0);
    const remainder = 11 - (sum % 11);
    const checkDigit = remainder === 11 ? 0 : remainder === 10 ? 9 : remainder;
    return checkDigit === Number(value[10]);
}

/**
 * The `publishedAt` the committed snapshot already holds, or `undefined` when it is a placeholder.
 *
 * Read as text rather than imported: this is an `.mjs` and the generated module is TypeScript. The regex
 * only ever matches a real ISO day, so the placeholder's `''` reads as "no previous snapshot".
 */
async function previousPublishedAt() {
    try {
        const committed = await readFile(OUT, 'utf8');
        return /publishedAt:\s*'(\d{4}-\d{2}-\d{2})'/.exec(committed)?.[1];
    } catch {
        return undefined;
    }
}

async function fetchListing() {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) {
        fail(`HTTP ${response.status} fetching the listing.`);
    }
    return response.text();
}

function parsePublishedAt(html) {
    const match = PUBLISHED_PATTERN.exec(html);
    if (match === null) {
        // The check most likely to fire, and the one most worth having. A snapshot that cannot say when it
        // takes effect is unusable: the reader refuses to answer about any day before `publishedAt`, so a
        // blank one would silently disable the fallback everywhere.
        fail('No "vigente desde el dd/mm/yyyy" wording found, so the listing cannot be dated.');
    }
    return {
        iso: `${match[3]}-${match[2]}-${match[1]}`,
        raw: match[0].replace(/\s+/g, ' ').trim(),
    };
}

function parseThreshold(html) {
    const match = THRESHOLD_PATTERN.exec(html);
    if (match === null) {
        fail('No general threshold amount found on or beside the listing.');
    }
    const amount = parseArgentineAmount(match[1], match[2]);
    if (!Number.isFinite(amount) || amount <= 0) {
        fail(`Parsed a nonsensical threshold amount: ${match[0]}`);
    }
    return amount;
}

function parseRows(html) {
    const candidates = html.match(/\b\d{11}\b/g) ?? [];
    const rows = [...new Set(candidates)].filter(isValidCuit).sort();

    if (rows.length < MIN_ROWS) {
        fail(`Only ${rows.length} valid CUITs found, below the floor of ${MIN_ROWS}.`);
    }
    const rejected = [...new Set(candidates)].filter((value) => !isValidCuit(value));
    if (rejected.length > 0) {
        console.warn(`  ${rejected.length} 11-digit values failed the CUIT check digit and were skipped.`);
    }
    return rows;
}

async function main() {
    console.log(`Fetching ${SOURCE_URL} ...`);
    const html = await fetchListing();

    const published = parsePublishedAt(html);

    // The hard failure the header promises, and the one check whose absence is invisible: every other check
    // fires on a reshaped page, this one fires on an unchanged one. ARCA is not punctual with publication,
    // so a run on or near a milestone regularly finds last year's listing — and writing it would rewrite
    // `fetchedAt` over stale membership and a stale threshold, producing a diff that reads as a successful
    // refresh and a wire answer that claims a currency it does not have.
    const previous = await previousPublishedAt();
    if (previous !== undefined && published.iso <= previous) {
        fail(
            `The page still states it takes effect ${published.iso}, which is no later than the committed ` +
                `snapshot's ${previous}. ARCA has not published the new listing yet — re-run in a day.`,
        );
    }

    const amount = parseThreshold(html);
    const rows = parseRows(html);
    const instrument = INSTRUMENT_PATTERN.exec(html)?.[1].replace(/\s+/g, ' ').trim() ?? '';
    const fetchedAt = new Date().toISOString().slice(0, 10);

    console.log(`  publishedAt : ${published.iso} (${published.raw})`);
    console.log(`  threshold   : ${amount}`);
    console.log(`  instrument  : ${instrument || '(none named on the page)'}`);
    console.log(`  rows        : ${rows.length}`);

    const header = [
        '// GENERATED FILE — do not edit by hand. Regenerate with `node scripts/build-fce-registry.mjs`.',
        '//',
        "// ARCA's published \"empresas grandes\" listing for the Factura de Crédito Electrónica régimen,",
        '// vendored so a fallback needs no network call and no database — this service holds nothing at rest',
        '// but its own delegate certificate, and that is deliberate.',
        '//',
        '// This is the FALLBACK ONLY. WSFECRED is the primary and always answers first; this file is consulted',
        '// when the authority cannot be reached at all, and any answer taken from it is labelled',
        '// `LOCAL_REGISTRY` on the wire with the snapshot dates below attached. A voucher issued off a stale',
        '// list is therefore identifiable afterwards rather than indistinguishable from a live answer.',
        '//',
        '// Refresh calendar: the annual notification lands by the seventh business day of May, bajas take',
        '// effect from July, altas from September. Run the script a day after each milestone rather than on',
        '// it — ARCA is not punctual, and a fetch that finds last year\'s list is worse than one that waits a',
        '// day. `fetchedAt` below makes the one-day window readable either way.',
        '',
    ].join('\n');

    const body = `import type {FceRegistrySnapshot} from './fce-registry.types.js';

/**
 * What was read, and when it takes effect. In code rather than a header comment because it is published:
 * \`publishedAt\` and \`fetchedAt\` go out on the wire inside \`registrySnapshot\`, so a caller holding an
 * answer months later can date it without asking us. Regenerating rewrites this and the rows together, so
 * neither can go stale alone.
 *
 * Annotated with {@link FceRegistrySnapshot} rather than \`as const\`, so the reader's placeholder checks
 * stay meaningful to the compiler whichever values are in here.
 */
export const FCE_REGISTRY_SNAPSHOT: FceRegistrySnapshot = {
    /**
     * The day the listing itself states it takes effect — read from the page, never from the clock. The
     * reader refuses to answer about any day before this one: a list published in April says nothing about
     * February, when both the membership and the threshold were different.
     */
    publishedAt: '${published.iso}',

    /** The page's own wording for that date, verbatim, so the parse can be audited in review. */
    publishedAtRaw: ${JSON.stringify(published.raw)},

    /**
     * The day this service read the page. Published so "the list has not refreshed since May" is a fact
     * somebody can read rather than infer.
     */
    fetchedAt: '${fetchedAt}',

    sourceUrl: '${SOURCE_URL}',

    /** Rows below. \`0\` means "never generated", which the reader treats as "cannot speak". */
    rowCount: ${rows.length},

    /**
     * The general threshold as published at \`publishedAt\`.
     *
     * **A dated observation, not a constant.** The difference is the whole argument for this file existing:
     * a constant is an undated, unattributed number compiled into logic, which goes silently wrong the day
     * the resolución changes. This says *"as at this date, per this instrument, read from this URL on this
     * day"* — and every part of that is checked rather than promised. The figure appears nowhere else in the
     * source tree (a test asserts it), it never reaches the wire without \`source: 'LOCAL_REGISTRY'\` and its
     * snapshot beside it, it is never compared against or blended with the authority's \`montoDesde\`, and it
     * cannot be applied to a day before \`publishedAt\`.
     *
     * Per the régimen the floor varies by the *receiver's* principal activity, which a single figure cannot
     * express. That is exactly why the authority's value is the only fully correct one and this is the
     * fallback: it is the published general limit, and it is labelled as such.
     */
    generalThreshold: {
        amount: ${amount},
        /** The entity's own currency code, not ISO 4217 — AR pesos are \`PES\`. */
        currencyCode: 'PES',
        effectiveFrom: '${published.iso}',
        instrument: ${JSON.stringify(instrument)},
    },
};

/**
 * One 11-digit CUIT per line, sorted, newline-delimited.
 *
 * Annotated \`: string\` rather than left to inference on purpose: without the annotation TypeScript widens
 * the literal into the emitted \`.d.ts\` and copies every row into it, which is the same reason
 * \`localities.generated.ts\` carries the annotation.
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const FCE_OBLIGATED_RECEIVER_ROWS: string = \`${rows.join('\\n')}\`;
`;

    await writeFile(OUT, header + '\n' + body, 'utf8');
    console.log(`Wrote ${rows.length} rows to ${OUT.pathname}`);
}

main().catch((err) => {
    console.error(String(err));
    process.exit(1);
});
