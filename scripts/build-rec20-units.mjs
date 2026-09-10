// Emits `src/providers/provider/rec20-units/rec20-units.data.ts` from the UN/ECE Recommendation 20 workbook.
//
//   node scripts/build-rec20-units.mjs "../rec20_Rev17e-2021.xlsx"
//
// The workbook is NOT vendored — it is a multi-megabyte binary that Prettier, Jest and `git diff` all handle
// badly — so the path is an argument and the file name lands in the emitted header. That makes the input
// identifiable rather than reproducible; the standing guard is `rec20-units.test.ts`, which re-applies the
// checkable half of the curation rule to the committed rows.
//
// No dependency: an .xlsx is a ZIP of XML, and `node:zlib` inflates it. Reading the sheet by hand rather than
// through a parser is deliberate — we need four columns out of one known sheet, and the shape assertions
// below are worth more here than a general parser would be.
//
// Like `build-indec-index.mjs`, this VALIDATES AND THROWS rather than emitting suspect data.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {dirname, basename, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const OUT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../src/providers/provider/rec20-units/rec20-units.data.ts',
);

/**
 * The sheet to read. Annex II & III is the COMPLETE code list — it carries all 1383 Annex I codes as well,
 * with no duplicates, so it is the one sheet worth reading. (Sheet 1 is the intro, sheet 2 is Annex I.)
 */
const SHEET = 'xl/worksheets/sheet3.xml';

/** The sheet's seven columns, in order. Asserted against row 1 so a re-shaped workbook fails loudly. */
const COLUMNS = ['Status', 'Common Code', 'Name', 'Description', 'Level / Category', 'Symbol', 'Conversion Factor'];

/**
 * Rule A — every countable trade unit. Rec 20 writes these descriptions to a fixed template, which is what
 * makes the rule a rule rather than a taste.
 */
const RULE_A = /^A unit of count defining the number of/i;

/**
 * Rule B — the metric units an invoice line is plausibly priced in: mass, length, area, volume, time, energy
 * and radioactivity, at any SI prefix. `tonne (metric ton)` precedes `tonne` because alternation is ordered.
 */
const SI_PREFIX =
    '(?:yocto|zepto|atto|femto|pico|nano|micro|milli|centi|deci|deca|hecto|kilo|mega|giga|tera|peta|exa|zetta|yotta)?';
const BASE_UNIT =
    '(?:gram|metre|litre|tonne \\(metric ton\\)|tonne|second|minute|hour|day|week|month|year|curie|watt hour|joule|calorie)';
const RULE_B = new RegExp(`^(?:square |cubic )?${SI_PREFIX}${BASE_UNIT}$`, 'i');

/**
 * Rule C — the only judgement in the file, and it is six rows. Each is a unit an ARCA `Pro_umed` maps onto
 * that neither A nor B admits, so leaving it out would make the mapping unexpressible.
 *
 * The full 33-code closure against the ARCA map is asserted by `unit-of-measure-codes.test.ts`, which can
 * read the real map. Duplicating those 33 here would be a second source of truth for it; these six are this
 * file's own, so this file checks them.
 */
const RULE_C = new Map([
    ['C62', 'AR Pro_umed 7 unidades — the countable one, whose Rec 20 synonym is literally "unit"'],
    ['CTM', 'AR Pro_umed 10 quilates'],
    ['E4', 'AR Pro_umed 61 kg bruto'],
    ['MIL', 'AR Pro_umed 11 millares'],
    ['MWH', 'AR Pro_umed 6 "1000 kWh" — Rec 20 names this one in the same words'],
    ['ZZ', 'AR Pro_umed 98 otras unidades — "as agreed in common between two or more parties"'],
]);

// ---------------------------------------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------------------------------------

/** Reads the members of a ZIP by its central directory. Returns `name -> Buffer`. */
function unzip(buffer) {
    const eocd = findEocd(buffer);
    const entries = buffer.readUInt16LE(eocd + 10);
    let at = buffer.readUInt32LE(eocd + 16);
    const members = new Map();
    for (let i = 0; i < entries; i += 1) {
        if (buffer.readUInt32LE(at) !== 0x02014b50) {
            throw new Error(`Central directory entry ${i} has no signature — the workbook is not a ZIP`);
        }
        const method = buffer.readUInt16LE(at + 10);
        const compressedSize = buffer.readUInt32LE(at + 20);
        const nameLength = buffer.readUInt16LE(at + 28);
        const extraLength = buffer.readUInt16LE(at + 30);
        const commentLength = buffer.readUInt16LE(at + 32);
        const localAt = buffer.readUInt32LE(at + 42);
        const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);

        // The local header repeats the name and extra field at its own lengths, which need not match the
        // central directory's — read them from the local header rather than reusing the ones above.
        const localNameLength = buffer.readUInt16LE(localAt + 26);
        const localExtraLength = buffer.readUInt16LE(localAt + 28);
        const dataAt = localAt + 30 + localNameLength + localExtraLength;
        const raw = buffer.subarray(dataAt, dataAt + compressedSize);
        members.set(name, method === 0 ? raw : inflateRawSync(raw));

        at += 46 + nameLength + extraLength + commentLength;
    }
    return members;
}

function findEocd(buffer) {
    for (let at = buffer.length - 22; at >= 0; at -= 1) {
        if (buffer.readUInt32LE(at) === 0x06054b50) {
            return at;
        }
    }
    throw new Error('No end-of-central-directory record — the file is not a ZIP');
}

// ---------------------------------------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------------------------------------

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

function decode(text) {
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body) => {
        if (body.startsWith('#x') || body.startsWith('#X')) {
            return String.fromCodePoint(parseInt(body.slice(2), 16));
        }
        if (body.startsWith('#')) {
            return String.fromCodePoint(parseInt(body.slice(1), 10));
        }
        return ENTITIES[body] ?? whole;
    });
}

/** Every `<t>` run inside `xml`, concatenated — how a shared string with mixed formatting is spelled. */
function textRuns(xml) {
    const runs = xml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? [];
    return runs.map((run) => decode(run.replace(/^<t(?:\s[^>]*)?>/, '').replace(/<\/t>$/, ''))).join('');
}

function sharedStrings(xml) {
    return (xml.match(/<si>[\s\S]*?<\/si>/g) ?? []).map(textRuns);
}

/** The sheet's rows, each as `{A: '…', B: '…'}` keyed by column letter. Empty cells are absent. */
function sheetRows(xml, strings) {
    return (xml.match(/<row[\s>][\s\S]*?<\/row>/g) ?? []).map((row) => {
        const cells = {};
        for (const cell of row.match(/<c[\s>][\s\S]*?(?:<\/c>|\/>)/g) ?? []) {
            const reference = /\sr="([A-Z]+)\d+"/.exec(cell);
            if (reference === null) {
                continue;
            }
            const type = /\st="([^"]+)"/.exec(cell);
            const value = /<v>([\s\S]*?)<\/v>/.exec(cell);
            let text = '';
            if (type?.[1] === 's' && value !== null) {
                text = strings[Number(value[1])] ?? '';
            } else if (type?.[1] === 'inlineStr') {
                text = textRuns(cell);
            } else if (value !== null) {
                text = decode(value[1]);
            }
            cells[reference[1]] = text;
        }
        return cells;
    });
}

/** Excel spells a hard line break inside a cell as a literal `_x000D_` plus a newline. */
function flatten(text) {
    return (text ?? '').replaceAll('_x000D_', ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------------------

function build(workbookPath) {
    const members = unzip(readFileSync(workbookPath));
    const stringsXml = members.get('xl/sharedStrings.xml');
    const sheetXml = members.get(SHEET);
    if (stringsXml === undefined || sheetXml === undefined) {
        throw new Error(`${workbookPath} carries no ${SHEET} — is it Recommendation 20?`);
    }
    const rows = sheetRows(sheetXml.toString('utf8'), sharedStrings(stringsXml.toString('utf8')));

    const header = COLUMNS.map((_, index) => flatten(rows[0]?.[String.fromCharCode(65 + index)]));
    const key = (values) => values.map((value) => value.toLowerCase().replace(/\s+/g, '')).join('|');
    if (key(header) !== key(COLUMNS)) {
        throw new Error(`Unexpected sheet header.\n  expected ${COLUMNS.join(' | ')}\n  found    ${header.join(' | ')}`);
    }

    // Keyed on `B`, the Common Code, for the reason the duplicate check below is: the code is the key, so a
    // row that has one is a published row whatever else it carries. Filtering on the Name instead would drop
    // such a row silently and shift `publishedRows`/`activeRows`, which are stamped into REC20_SNAPSHOT and
    // published in CONTRACT.md §5.
    const published = rows.slice(1).filter((row) => flatten(row.B) !== '');
    // `D` is deleted and `X` is withdrawn — mostly the packaging codes that moved to UN/ECE Rec 21. Shipping
    // either would put a code on a fiscal document that the recommendation itself has taken back.
    const active = published.filter((row) => !['D', 'X'].includes(flatten(row.A)));
    // An active code with no Name is a cell this reader failed rather than a row the recommendation meant,
    // so it throws: rule B reads the Name, and the test asserts every emitted row has one. Checked on
    // `active` rather than `published`, since a withdrawn row is discarded either way.
    const unnamed = active.filter((row) => flatten(row.C) === '').map((row) => flatten(row.B));
    if (unnamed.length > 0) {
        throw new Error(`Active common code(s) ${unnamed.join(', ')} carry no Name — a cell did not parse`);
    }

    const kept = [];
    const seen = new Set();
    for (const row of active) {
        const commonCode = flatten(row.B);
        const name = flatten(row.C);
        if (!(RULE_A.test(flatten(row.D)) || RULE_B.test(name) || RULE_C.has(commonCode))) {
            continue;
        }
        if (seen.has(commonCode)) {
            throw new Error(`Common code ${commonCode} appears twice — the code is the key`);
        }
        seen.add(commonCode);
        const symbol = flatten(row.F);
        kept.push({commonCode, name, symbol: symbol === '' ? null : symbol, levelCategory: flatten(row.E)});
    }

    const missing = [...RULE_C.keys()].filter((code) => !seen.has(code));
    if (missing.length > 0) {
        throw new Error(`Rule C names ${missing.join(', ')}, which this revision does not publish as active`);
    }
    if (kept.length === 0) {
        throw new Error('The curation rule kept nothing — the sheet parsed but the columns are wrong');
    }

    return {kept, publishedRows: published.length, activeRows: active.length};
}

const quote = (text) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

function emit({kept, publishedRows, activeRows}, workbookPath) {
    const rows = kept
        .map(
            (unit) =>
                `    {commonCode: ${quote(unit.commonCode)}, name: ${quote(unit.name)}, ` +
                `symbol: ${unit.symbol === null ? 'null' : quote(unit.symbol)}, ` +
                `levelCategory: ${quote(unit.levelCategory)}},`,
        )
        .join('\n');

    return `// GENERATED FILE — do not edit by hand. Regenerate with \`node scripts/build-rec20-units.mjs <workbook>\`.
//
// UN/ECE Recommendation 20 Revision 17 (2021), sheet "Annex II & Annex III" of ${basename(workbookPath)} —
// the complete published list, curated down to the units an invoice line is plausibly priced in.
//
// The curation rule, re-appliable by a reader (\`rec20-units.test.ts\` re-applies the checkable half: rule A
// keys off \`Description\`, which is not carried below, so no test re-checks that branch):
//
//   keep(row) = row.Status is neither 'D' (deleted) nor 'X' (withdrawn, mostly packaging codes that moved to
//               UN/ECE Rec 21)
//               AND ( row.Description starts "A unit of count defining the number of"     -- rule A
//                   | row.Name is an SI-prefixed metric mass/length/area/volume/time/     -- rule B
//                     energy/radioactivity unit
//                   | row.CommonCode is one of the six rule C names in the generator )    -- rule C
//
// ${publishedRows} published rows; ${activeRows} active; ${kept.length} kept.
//
// \`Status\` is not carried: every row here is active by construction, so a constant column would be noise
// that also lets a withdrawn code look legitimate. The absence is the assertion.
//
// \`Conversion Factor\` is deliberately NOT carried. It is free text (\`10⁻³ kg\`) relative to a base the
// column does not name, and machine-reading it to convert an invoice quantity would be exactly the "must not
// drive a fiscal decision" hazard \`country-tax-id-rows.data.ts\` flags for \`countryIso\`. Nothing on this wire
// converts quantities — a quantity is sent as the caller states it. Do not re-add this as a feature.

/**
 * One unit of measure as the recommendation publishes it. The property names are its own column headings,
 * lower-camelled — \`country-tax-id-rows.data.ts\` keeps the authority's spelling verbatim, which is not
 * available here because Rec 20's headings are prose rather than identifiers.
 */
export interface Rec20Unit {
    /** \`Common Code\` — the value that travels on the wire (\`KGM\`, \`C62\`, \`ZZ\`). */
    readonly commonCode: string;
    /** \`Name\`, verbatim (\`kilogram\`, \`one\`, \`mutually defined\`). Rendered to a human; never matched on. */
    readonly name: string;
    /** \`Symbol\`, verbatim (\`kg\`, \`m³\`), or \`null\` where the recommendation publishes none. */
    readonly symbol: string | null;
    /** \`Level/Category\`, verbatim. Kept so the curation rule above stays checkable rather than merely stated. */
    readonly levelCategory: string;
}

/**
 * What this snapshot was taken from, in code rather than only in the comment above — the reason
 * \`INDEC_SNAPSHOT\` is shaped this way: a number a test can assert against cannot go stale beside the rows.
 */
export const REC20_SNAPSHOT = {
    /** The recommendation's own revision. */
    revision: 17,
    /** Its publication year — what a scheme version would carry, if one ever goes on the wire. */
    published: '2021',
    /** Rows the revision publishes in Annex II & III. */
    publishedRows: ${publishedRows},
    /** Of those, the ones whose \`Status\` is neither \`D\` nor \`X\`. */
    activeRows: ${activeRows},
    /** Of those, the ones the curation rule keeps. Asserted equal to \`REC20_UNITS.size\`. */
    rows: ${kept.length},
} as const;

/** One row per line, so a re-take against a new revision diffs row-for-row instead of reflowing the file. */
// prettier-ignore
export const REC20_UNIT_ROWS: ReadonlyArray<Rec20Unit> = [
${rows}
];
`;
}

const workbookPath = process.argv[2];
if (workbookPath === undefined) {
    throw new Error('Usage: node scripts/build-rec20-units.mjs <path-to-rec20.xlsx>');
}
const result = build(workbookPath);
mkdirSync(dirname(OUT), {recursive: true});
writeFileSync(OUT, emit(result, workbookPath), 'utf8');
console.log(
    `${result.publishedRows} published, ${result.activeRows} active, ${result.kept.length} kept -> ${OUT}`,
);
