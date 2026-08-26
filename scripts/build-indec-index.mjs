// Regenerates `src/providers/arca/data/indec-localities.ts` from the national geography catalog.
//
// Run: `node scripts/build-indec-index.mjs`
//
// Source: georef-ar (https://apis.datos.gob.ar/georef), the Ministerio del Interior service that
// publishes INDEC's geostatistical units. Two layers are read:
//
//   - `localidades-censales` — the localidad censal itself, whose `id` IS the 8-digit INDEC code
//     (provincia 2 + departamento 3 + localidad 3) the contract asks for.
//   - `asentamientos` (BAHRA) — entidades and parajes, each pointing at the localidad censal that
//     contains it. Indexing these lets a rural settlement name resolve to the code of its localidad.
//     Entries with no `localidad_censal.id` (standalone parajes) are skipped: they have no code.
//
// Names are emitted VERBATIM, not normalized. Normalization is the runtime's job
// (`normalize-locality.ts`) so there is exactly one implementation of it and the vendored file stays a
// faithful, reviewable copy of the source.

import {writeFile} from 'node:fs/promises';

const API = 'https://apis.datos.gob.ar/georef/api';
const PAGE = 5000;
const OUT = new URL('../src/providers/arca/data/indec-localities.ts', import.meta.url);

/** INDEC 2-digit province codes, read from the catalog itself so the script needs no hardcoded list. */
async function fetchProvinceIds() {
    const response = await fetch(`${API}/provincias?max=30&campos=id`);
    if (!response.ok) {
        throw new Error(`provincias: HTTP ${response.status}`);
    }
    const body = await response.json();
    return body.provincias.map((p) => p.id).sort();
}

/**
 * Every row of a georef collection, fetched province by province. The API refuses an `inicio` beyond
 * 10000, and `asentamientos` has more rows than that nationally — so the province filter is what keeps
 * every page inside the window, not an optimization.
 */
async function fetchAll(resource, key, fields, provinceIds) {
    const rows = [];
    for (const provincia of provinceIds) {
        for (let inicio = 0; ; inicio += PAGE) {
            const url = `${API}/${resource}?provincia=${provincia}&max=${PAGE}&inicio=${inicio}&campos=${fields}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`${resource} province ${provincia} page ${inicio}: HTTP ${response.status}`);
            }
            const body = await response.json();
            rows.push(...body[key]);
            if (body.inicio + body.cantidad >= body.total) {
                break;
            }
        }
    }
    return {rows, total: rows.length};
}

const provinceIds = await fetchProvinceIds();
const localidades = await fetchAll(
    'localidades-censales',
    'localidades_censales',
    'id,nombre,provincia.id',
    provinceIds,
);
const asentamientos = await fetchAll(
    'asentamientos',
    'asentamientos',
    'nombre,provincia.id,localidad_censal.id',
    provinceIds,
);

// Unique `provincia \t nombre \t codigo` triples. A name reported by both layers, or by several
// asentamientos of the same localidad, collapses to one row.
const triples = new Set();
for (const row of localidades.rows) {
    triples.add(`${row.provincia.id}\t${row.nombre}\t${row.id}`);
}
let skipped = 0;
for (const row of asentamientos.rows) {
    const code = row.localidad_censal?.id;
    if (typeof code !== 'string' || code === '') {
        skipped += 1;
        continue;
    }
    triples.add(`${row.provincia.id}\t${row.nombre}\t${code}`);
}

// Two ways a place name could corrupt the emitted file, and neither is visible once it has:
//
//   - a backtick, backslash or `${` breaks the template literal, so the file will not parse;
//   - a TAB or a NEWLINE is one of the format's own delimiters, so the file parses fine and the row
//     silently splits into the wrong fields — a locality keyed on a fragment, or coded to whatever landed
//     in the third column. The reader skips rows it can see are malformed, but a row that splits into
//     exactly three plausible fields is indistinguishable from a real one.
//
// No catalog name does either today. Failing the build is the only place this can be caught cheaply.
//
// Checked field by field, which is also what catches an embedded TAB: a name carrying one splits the row
// into four fields rather than three, and no character class has to describe the delimiter itself.
const UNSAFE_IN_A_FIELD = /[`\\\r\n]|\$\{/;
for (const triple of triples) {
    const fields = triple.split('\t');
    const [provincia, nombre, codigo] = fields;
    if (fields.length !== 3 || fields.some((field) => UNSAFE_IN_A_FIELD.test(field))) {
        throw new Error(`Row unsafe for the emitted format: ${JSON.stringify(triple)}`);
    }
    // The shape the reader and the contract both promise: provincia 2 + departamento 3 + localidad 3,
    // prefixed by the province it is filed under. A catalog that stops honouring it is a conversation,
    // not something to vendor silently.
    if (!/^\d{2}$/.test(provincia) || !/^\d{8}$/.test(codigo) || !codigo.startsWith(provincia)) {
        throw new Error(`Row is not a province-prefixed 8-digit code: ${JSON.stringify(triple)}`);
    }
    if (nombre.trim() === '') {
        throw new Error(`Row has no name: ${JSON.stringify(triple)}`);
    }
}

// The projection is a promise, not an implementation detail (CONTRACT §5): every code this file emits is
// a *localidad censal*, because asentamientos contribute only their `localidad_censal.id` and each
// localidad censal contributes its own row. So the distinct codes emitted must be exactly the number of
// localidades censales read — no more (a finer level leaked in) and no fewer (a localidad went missing).
//
// A caller catalogs the localidades-censales layer alone and resolves everything we send; going finer is
// a breaking contract change. This is the assertion that makes that a build failure rather than a silent
// wire change, so a future "improvement" to asentamiento or departamento ids stops here.
const distinctCodes = new Set([...triples].map((triple) => triple.split('\t')[2]));
if (distinctCodes.size !== localidades.total) {
    throw new Error(
        `Emitted ${distinctCodes.size} distinct codes for ${localidades.total} localidades censales. ` +
            `Every code must be a localidad censal — see CONTRACT §5, "the INDEC code space".`,
    );
}

const sorted = [...triples].sort();
// The day georef-ar was read. Vendored beside the rows so a caller can date a mismatch against its own
// snapshot of the same live dataset (core's CONTRACT-REQUESTS ask 6), and so the version can never drift
// from the data it describes — regenerating restamps both or neither.
const snapshotDate = new Date().toISOString().slice(0, 10);
const file = `// GENERATED FILE — do not edit by hand. Regenerate with \`node scripts/build-indec-index.mjs\`.
//
// INDEC localidad codes, vendored from georef-ar (Ministerio del Interior, datos.gob.ar) so a lookup
// needs no network call and no database. One row per unique province / name / code triple, sorted,
// tab-separated, newline-delimited:
//
//   - \`provincia\` — INDEC 2-digit province code (NOT ARCA's \`idProvincia\`; see \`ar-geography.ts\`).
//   - \`nombre\` — the place name verbatim from the catalog, accents and all. Normalization happens at
//     lookup time (\`normalize-locality.ts\`), so this file stays a faithful copy of the source.
//   - \`codigo\` — the 8-digit INDEC localidad censal code (provincia 2 + departamento 3 + localidad 3).
//
// Both localidades censales and BAHRA asentamientos are indexed, the latter projected up to the
// localidad censal containing them — so a rural entidad or paraje resolves to its localidad's code.
// A name that maps to more than one code within its province is ambiguous and is dropped when the
// lookup index is built; it is kept here because the ambiguity is a property of the catalog, not of us.
//
// **Known coverage gap: urban barrios.** BAHRA models settlements, not neighbourhoods, so a barrio of an
// interior city (ARCA regularly reports one — \`BARRIO YAPEYU\` for a Córdoba address) is simply not in
// here and its address resolves to no code. The one exception is CABA, whose 48 barrios georef does carry,
// every one of them pointing at the single localidad censal \`02000010\`. Closing the gap for the rest
// would need a postal-code index, which has no openly-licensed source — see docs/CONTRACT-CHANGES.md.

/**
 * What this snapshot is: when georef-ar was read, and how much of it. Stated in code rather than in a
 * header comment because it is published — \`ar-geography.ts\` reads {@link INDEC_SNAPSHOT.date} straight
 * into the wire's \`cityCodeSchemeVersion\` (CONTRACT §5), so a caller holding its own snapshot of the same
 * live dataset can date a mismatch instead of confusing drift with the barrio gap.
 *
 * Regenerating rewrites this and the rows together, which is the point: neither can go stale alone.
 */
export const INDEC_SNAPSHOT = {
    /** ISO date georef-ar was read. */
    date: '${snapshotDate}',
    /** Localidades censales read — and, by the generator's own assertion, the distinct codes below. */
    localidadesCensales: ${localidades.total},
    /** BAHRA asentamientos read, each projected up to the localidad censal containing it. */
    asentamientos: ${asentamientos.total},
    /** Rows below — unique province/name/code triples, so several names can share one code. */
    nameRows: ${sorted.length},
} as const;

// Annotated \`: string\` on purpose, which is why the inferrable-types rule is off for this one line:
// without the annotation TypeScript infers the literal type and copies all ${sorted.length} rows into
// the emitted \`.d.ts\`, tripling what ships for no benefit.
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const INDEC_LOCALITY_ROWS: string = \`${sorted.join('\n')}\`;
`;

await writeFile(OUT, file, 'utf8');
console.log(
    `wrote ${sorted.length} rows, snapshot ${snapshotDate} (${localidades.total} localidades, ` +
        `${asentamientos.total} asentamientos, ${skipped} skipped for having no localidad censal). ` +
        `The snapshot date is published as cityCodeSchemeVersion — this needs a CONTRACT-CHANGES entry.`,
);
