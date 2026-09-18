// Regenerates `obligated-receivers.generated.ts` from ARCA's published "empresas grandes" listing for the
// Factura de Crédito Electrónica régimen.
//
// Run: `node scripts/build-fce-registry.mjs`
//
// This file is the FALLBACK's data. WSFECRED is always the primary; the snapshot is consulted only when the
// authority cannot be reached, and any answer taken from it goes out labelled `LOCAL_REGISTRY` with the
// dates below attached.
//
// ── TWO SOURCES, because ARCA publishes the two halves on different pages ─────────────────────────────────
//
// 1. The membership, from the JSON endpoint the listing page's DataTable calls. NOT from the page's HTML:
//    that table is server-rendered ten rows at a time behind a pager, so scraping it would silently vendor
//    the first page and call it the régimen. The endpoint returns all ~1,180 rows in one POST.
// 2. The general threshold, its effective date and its instrument, from the régimen's landing page. The
//    listing page does not state a figure anywhere.
//
// Refresh calendar, from ARCA's own published rules: the annual notification lands by the seventh business
// day of May, bajas take effect from July, altas from September. Run this a day AFTER each milestone rather
// than on it — ARCA is not punctual with publication, and a run that finds last year's list is worse than
// one that waits a day and finds this year's.
//
// A run that finds last year's list is therefore REPORTED, not refused. There is no date to refuse it on —
// the listing publishes none (see `fetchedAt` below) — so what is compared is the membership itself, and an
// unchanged one is legitimate: the universe moves twice a year and most runs will find it identical. `main`
// prints a NOTE and writes anyway. The one hard date failure left is the threshold's `effectiveFrom`, which
// is about the figure rather than about staleness.
//
// VALIDATES AND THROWS rather than emitting suspect data, following `build-rec20-units.mjs`. Every check
// below has the same rationale — a reshaped page must break the build, never quietly empty the fallback or
// date it wrongly. A missing fallback is a `502` somebody notices; a wrong one is a wrong fiscal document.

import {readFile, writeFile} from 'node:fs/promises';

const LISTING_URL = 'https://servicioscf.afip.gob.ar/facturadecreditoelectronica/Listado-RFCE-Mi-PyMe.asp';
const ROWS_URL =
    'https://servicioscf.afip.gob.ar/FCEServicioConsulta/api/fceconsulta.aspx/getGrandesEmpresas';
const THRESHOLD_URL = 'https://servicioscf.afip.gob.ar/facturadecreditoelectronica/default.asp';

const OUT = new URL(
    '../src/providers/arca/mapping/fce-registry/obligated-receivers.generated.ts',
    import.meta.url,
);

/**
 * Below this, assume the fetch or the parse broke rather than that the régimen emptied. The universe is
 * over a thousand companies and changes twice a year; it does not drop to double digits.
 */
const MIN_ROWS = 100;


/**
 * The landing page's threshold sentence, which reads:
 *
 *   "Desde el 14 de abril de 2026, el monto mínimo a partir del cual las empresas están obligadas a emitir
 *    Facturas de Crédito Electrónicas se actualizó a $ 5.549.862 (Resolución 1/2026 …)"
 *
 * Anchored on `monto mínimo` rather than matching any number on the page. Unanchored, the first run of 7+
 * digits and dots wins, and on these pages that can be a CUIT — which is finite and positive, so it would
 * sail through the sanity check below and ship as a floor no voucher can clear.
 */
const THRESHOLD_PATTERN =
    /Desde\s+el\s+(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})[\s\S]{0,200}?monto\s+m[ií]nimo[\s\S]{0,200}?\$\s*([\d.]{7,})(?:,(\d{2}))?/i;

/** The resolución the figure comes from, named in the same sentence. */
const INSTRUMENT_PATTERN = /(Resoluci[oó]n\s+(?:General\s+)?N?[°º]?\s*[\d/]+)/i;

const MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function fail(message) {
    throw new Error(
        `${message}\n\nNothing has been written — the previous snapshot is still in place. Read the source ` +
            `by hand and fix the patterns in this script rather than relaxing a check: every one of them ` +
            `exists so a reshaped page cannot quietly empty or misdate the fallback.`,
    );
}

/** Argentina's `1.234.567,89` as a number. */
function parseArgentineAmount(whole, cents) {
    return Number(`${whole.replaceAll('.', '')}.${cents ?? '00'}`);
}

/** `dd/mm/yyyy` as an ISO day. */
function isoFromSlashes(value) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value).trim());
    return match === null ? undefined : `${match[3]}-${match[2]}-${match[1]}`;
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

async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
        fail(`HTTP ${response.status} fetching ${url}.`);
    }
    return response.text();
}

/**
 * The membership rows, from the endpoint the page's own table calls.
 *
 * ASP.NET wraps a page-method result as `{d: "<json string>"}` — double-encoded, so the payload is parsed
 * twice. Unwrapped blindly it reads as an object with one key and no rows, which the row-count floor would
 * then report as an empty régimen rather than as the shape surprise it is.
 */
async function fetchRows() {
    const response = await fetch(ROWS_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json; charset=utf-8'},
        body: '{}',
    });
    if (!response.ok) {
        fail(`HTTP ${response.status} fetching the membership endpoint.`);
    }

    const envelope = await response.json();
    if (typeof envelope?.d !== 'string') {
        fail('The membership endpoint did not answer with the ASP.NET `{d: "…"}` envelope it used to.');
    }
    const rows = JSON.parse(envelope.d);
    if (!Array.isArray(rows)) {
        fail('The membership payload is no longer a JSON array of rows.');
    }
    return rows;
}

function parseThreshold(html) {
    const match = THRESHOLD_PATTERN.exec(html);
    if (match === null) {
        fail('No "Desde el … el monto mínimo … $ …" sentence found on the régimen landing page.');
    }
    const monthIndex = MONTHS.indexOf(match[2].toLowerCase());
    if (monthIndex < 0) {
        fail(`Unrecognised Spanish month "${match[2]}" in the threshold sentence.`);
    }
    const amount = parseArgentineAmount(match[4], match[5]);
    if (!Number.isFinite(amount) || amount <= 0) {
        fail(`Parsed a nonsensical threshold amount: ${match[0]}`);
    }
    // Searched in the tail *after* the match rather than inside it: the sentence names the resolución in a
    // parenthesis that follows the figure, so the amount pattern has already stopped short of it. Starting
    // the slice at the end of the match is load-bearing — the pattern spans up to 400 characters of markup
    // through its two lazy gaps, so a prior resolución cited between the date and the figure ("conforme
    // Resolución 5/2025 … se actualizó a $ 5.549.862 (Resolución 1/2026)") would otherwise be picked up and
    // vendored as the provenance of a figure it did not set.
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 200);
    const instrument = INSTRUMENT_PATTERN.exec(tail)?.[1].replace(/\s+/g, ' ').trim();
    if (instrument === undefined) {
        // Not fatal — the figure and its date are what the answer needs, and the instrument is provenance
        // for a human reading the file later. But an unnamed one is worth seeing in the run output.
        console.warn('  No resolución named beside the threshold; `instrument` will be empty.');
    }

    return {
        amount,
        effectiveFrom: `${match[3]}-${String(monthIndex + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`,
        instrument: instrument ?? '',
    };
}

/**
 * `cuit\tfechaInicio\tdenominación` per row, sorted.
 *
 * `Fecha_Inicio` is kept because it is load-bearing rather than decorative. ARCA notifies the year's
 * universe in May but its altas do not take effect until September, so between those months the published
 * list contains companies that are **not yet obligated**. Without the per-row day, every one of them would
 * be answered `obligated: true` up to four months early — the expensive direction, since it puts a credit
 * invoice on a sale the buyer had no obligation to receive.
 *
 * `Denominacion` is kept for a different reason, and not because anything reads it: **the diff has to be
 * reviewable.** Vendoring into the repository rather than fetching on a schedule is only worth anything if
 * a human can look at a refresh and judge it, and a diff of a thousand bare CUITs cannot be judged by
 * anyone — you cannot tell this September's altas from a parse that shifted a column. With names, a
 * reviewer can. It also gives an operator asking "why was this sale an FCE" an answer in words.
 *
 * `Actividad_Principal` stays out: it is long free text that would multiply the file size several times
 * over, and unlike the name it does not help review — the activity of a company you cannot identify says
 * nothing. Worth revisiting only if the fallback ever needs a per-activity floor, which would need figures
 * ARCA does not publish here anyway.
 */
function toRows(raw) {
    const seen = new Map();
    let malformed = 0;

    for (const entry of raw) {
        const cuit = String(entry?.Cuit ?? '').trim();
        const since = isoFromSlashes(entry?.Fecha_Inicio);
        if (!isValidCuit(cuit) || since === undefined) {
            malformed += 1;
            continue;
        }
        // Tabs and newlines are the row and column separators, so a name carrying one would shift every
        // field after it — silently, since the result still parses. Collapsed to spaces rather than
        // escaped: the name is read by people, not matched on.
        const name = String(entry?.Denominacion ?? '').replace(/\s+/g, ' ').trim();

        // A duplicated CUIT keeps its earliest start, which is the reading that cannot invent an
        // obligation the authority has not stated yet.
        const earlier = seen.get(cuit);
        seen.set(
            cuit,
            earlier === undefined || since < earlier.since ? {since, name} : earlier,
        );
    }

    if (malformed > 0) {
        console.warn(`  ${malformed} rows failed the CUIT check digit or carried no usable date; skipped.`);
    }
    const unnamed = [...seen.values()].filter((row) => row.name === '').length;
    if (unnamed > 0) {
        console.warn(`  ${unnamed} rows carried no denominación; their CUIT and date are kept.`);
    }
    const rows = [...seen.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cuit, {since, name}]) => [cuit, since, name]);
    if (rows.length < MIN_ROWS) {
        fail(`Only ${rows.length} usable rows, below the floor of ${MIN_ROWS}.`);
    }
    return rows;
}

/** One emitted row, as the generated file spells it. */
const EMITTED_ROW_PATTERN = /^"(\d{11})": \{since: "([^"]*)", name: "(.*)"\},$/;

/**
 * The membership the committed snapshot already holds, as `cuit\tsince\tname` lines.
 *
 * Parsed back out of the emitted spelling rather than compared against it: the comparison below builds the
 * current membership in this tab-joined form, and lines in the two formats can never be equal — which would
 * silently disable the only check in this script that fires on an *unchanged* page.
 *
 * Which is why a parse that comes up short SAYS SO. {@link EMITTED_ROW_PATTERN} has to stay in lockstep with
 * the emit template two hundred lines below it, and nothing but this warning would notice them drifting
 * apart: every `exec` would return `null`, this would hand back `[]`, the `previous.length > 0` guard would
 * short-circuit, and the run would look clean while the staleness NOTE quietly stopped existing. That is the
 * same self-disabling failure this function was rewritten to fix, and a check that can turn itself off
 * without saying so is the thing this whole script is built against.
 */
async function previousRows() {
    let lines = [];
    try {
        const committed = await readFile(OUT, 'utf8');
        const block = /FCE_OBLIGATED_RECEIVERS: FceObligatedReceivers = \{([\s\S]*?)\n\};/.exec(committed)?.[1] ?? '';
        lines = block.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    } catch {
        // No committed snapshot to compare against — the first-ever run. Not a drift, and not worth a word.
        return [];
    }

    // Per row, and never fatal. This whole comparison exists to print a NOTE; losing a refresh to a
    // `SyntaxError` from a hand-edited name, or from a conflict marker sitting inside the receivers block,
    // would trade the thing that matters for the thing that does not. A row that will not re-read is a row
    // this did not read, which is what the warning below already reports.
    const parsed = [];
    for (const line of lines) {
        const match = EMITTED_ROW_PATTERN.exec(line);
        if (match === null) {
            continue;
        }
        try {
            parsed.push(`${match[1]}\t${match[2]}\t${JSON.parse(`"${match[3]}"`)}`);
        } catch {
            // Counted as unparsed by the check below.
        }
    }

    if (parsed.length < lines.length) {
        console.warn(
            `  WARNING: ${lines.length - parsed.length} of ${lines.length} committed rows did not match ` +
                `EMITTED_ROW_PATTERN. The unchanged-membership check below is comparing against a partial ` +
                `reading, or none at all — fix the pattern to match the emit template rather than trusting ` +
                `the result of this run.`,
        );
    }
    return parsed;
}

async function main() {
    console.log(`Fetching ${ROWS_URL} ...`);
    const raw = await fetchRows();
    const landingHtml = await fetchText(THRESHOLD_URL);

    const threshold = parseThreshold(landingHtml);
    const rows = toRows(raw);
    const fetchedAt = new Date().toISOString().slice(0, 10);

    // A figure that has not taken effect yet cannot be vendored, because the reader has no way to decline
    // it. The reader's floor is `fetchedAt` — it refuses to answer about any earlier day — and that used to
    // imply the threshold was in force, back when the floor was the listing's own effective day and the two
    // were the same value. They are independent now. ARCA announces a rise ahead of time and this sentence
    // reads a future "Desde el …" perfectly well, so without this check a run in the gap would ship next
    // year's floor against this year's vouchers, stamped with a `thresholdEffectiveFrom` in their future.
    if (threshold.effectiveFrom > fetchedAt) {
        fail(
            `The landing page states a threshold effective ${threshold.effectiveFrom}, which is after ` +
                `today (${fetchedAt}). ARCA has announced a rise that has not taken effect — re-run on or ` +
                `after that day, since the reader cannot decline a figure this file hands it.`,
        );
    }

    // Not a failure, and deliberately so.
    //
    // An earlier draft failed here unless the listing reported a later publication date than the committed
    // snapshot — the guard against re-vendoring last year's list around a milestone. That guard could not
    // be written, because **the listing publishes no date**: its "Fecha de actualización" is
    // `new Date()` rendered client-side by the page's own script, so it always reads as today whatever ARCA
    // last did. Parsing it would have stamped our run date onto the snapshot as though it were an authority
    // fact, and the staleness check would then have compared today against yesterday and passed every time
    // — certifying exactly the silent no-op it existed to catch.
    //
    // What can be compared honestly is the membership itself. An unchanged one is legitimate: the universe
    // moves twice a year and most runs will find it identical. So this reports rather than refuses, and
    // advancing `fetchedAt` over identical rows is itself worth recording — it says we looked on that day
    // and it was still this.
    const previous = await previousRows();
    const current = rows.map(([cuit, since, name]) => `${cuit}\t${since}\t${name}`);
    const unchanged = previous.length === current.length && previous.every((line, i) => line === current[i]);
    if (previous.length > 0 && unchanged) {
        console.log('');
        console.log('  NOTE: the membership is byte-identical to the committed snapshot. Only `fetchedAt`');
        console.log('  will move. If you ran this expecting a milestone update, ARCA has not published it');
        console.log('  yet — re-run in a day rather than treating this diff as the refresh.');
        console.log('');
    }

    console.log(`  threshold   : ${threshold.amount} from ${threshold.effectiveFrom}`);
    console.log(`  instrument  : ${threshold.instrument || '(none named)'}`);
    console.log(`  rows        : ${rows.length}${unchanged ? ' (unchanged)' : ''}`);

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
        "// it — ARCA is not punctual, and a fetch that finds last year's list is worse than one that waits a",
        '// day. `fetchedAt` below makes the one-day window readable either way.',
        '',
    ].join('\n');

    const body = `import type {FceObligatedReceivers, FceRegistrySnapshot} from './fce-registry.types.js';

/**
 * What was read, and when. In code rather than a header comment because it is published: \`fetchedAt\` goes
 * out on the wire inside \`registrySnapshot\`, so a caller holding an answer months later can date it
 * without asking us. Regenerating rewrites this and the rows together, so neither can go stale alone.
 */
export const FCE_REGISTRY_SNAPSHOT: FceRegistrySnapshot = {
    /**
     * The day this service read the sources — and the earliest day this snapshot will answer about.
     *
     * **There is no publication date to hold.** The listing's own "Fecha de actualización" is
     * \`new Date()\` rendered client-side by the page's script, so it always reads as today whatever ARCA
     * last did; parsing it would stamp our run date onto the snapshot as though it were an authority fact.
     * This is our read date, labelled as exactly that.
     *
     * It is also the floor, for a reason the per-row days cannot cover: a company removed by a baja before
     * we read is simply absent, so for an earlier voucher this snapshot cannot tell "never obligated" from
     * "no longer obligated". It declines rather than guess.
     */
    fetchedAt: '${fetchedAt}',

    sourceUrl: '${LISTING_URL}',

    /** Rows below. \`0\` means "never generated", which the reader treats as "cannot speak". */
    rowCount: ${rows.length},

    /**
     * The general threshold as published at \`effectiveFrom\`.
     *
     * **A dated observation, not a constant.** The difference is the whole argument for this file existing:
     * a constant is an undated, unattributed number compiled into logic, which goes silently wrong the day
     * the resolución changes. This says *"as at this date, per this instrument, read from this page on this
     * day"* — and every part of that is checked rather than promised. The figure appears nowhere else in the
     * source tree (a test asserts it), it never reaches the wire without \`source: 'LOCAL_REGISTRY'\` and its
     * snapshot beside it, and it is never compared against or blended with the authority's \`montoDesde\`.
     *
     * Per the régimen the floor varies by the *receiver's* principal activity, which a single figure cannot
     * express. That is exactly why the authority's value is the only fully correct one and this is the
     * fallback: it is the published general limit, and it is labelled as such.
     */
    generalThreshold: {
        amount: ${threshold.amount},
        /** The entity's own currency code, not ISO 4217 — AR pesos are \`PES\`. */
        currencyCode: 'PES',
        effectiveFrom: '${threshold.effectiveFrom}',
        instrument: ${JSON.stringify(threshold.instrument)},
    },
};

/**
 * The listing, keyed by CUIT — one company per line, so a refresh reads as a diff a human can judge.
 *
 * A map rather than an array because every use is a lookup by tax id; an array would have to be indexed
 * into one anyway. Its fields are named rather than positional, so a diff says what changed and a column
 * cannot silently shift.
 *
 * \`since\` is load-bearing: ARCA notifies the year's universe in May but its altas take effect in
 * September, so between those months this holds companies that are not yet obligated, and without it every
 * one of them would be answered \`obligated: true\` up to four months early.
 *
 * \`name\` decides nothing, and is what makes the rest reviewable — a diff of a thousand bare CUITs cannot
 * be judged by anyone, and vendoring this file rather than fetching it on a schedule is only worth
 * something if someone can judge it.
 *
 * Annotated with {@link FceObligatedReceivers} rather than left to inference: without the annotation
 * TypeScript widens the literal into the emitted \`.d.ts\` and copies every company into it, the same reason
 * \`localities.generated.ts\` annotates its own table.
 */
export const FCE_OBLIGATED_RECEIVERS: FceObligatedReceivers = {
${rows.map(([cuit, since, name]) => `    ${JSON.stringify(cuit)}: {since: ${JSON.stringify(since)}, name: ${JSON.stringify(name)}},`).join('\n')}
};
`;

    await writeFile(OUT, header + '\n' + body, 'utf8');
    console.log(`Wrote ${rows.length} rows to ${OUT.pathname}`);
}

main().catch((err) => {
    console.error(String(err));
    process.exit(1);
});
