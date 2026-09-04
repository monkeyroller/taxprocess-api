// Regenerates `localities.generated.ts` from georef-ar (https://apis.datos.gob.ar/georef), the Ministerio
// del Interior service publishing INDEC's geostatistical units.
//
// Run: `node scripts/build-indec-index.mjs`
//
// Two layers are read. `localidades-censales` gives the localidad censal itself, whose `id` is the 8-digit
// INDEC code the contract asks for. `asentamientos` (BAHRA) gives entidades and parajes, each pointing at
// the localidad censal containing it, so a rural settlement name resolves to its localidad's code; entries
// with no `localidad_censal.id` are skipped, having no code.
//
// Names are emitted verbatim. Normalization is the runtime's job, so there is one implementation of it and
// the vendored file stays a reviewable copy of the source.

import {writeFile} from 'node:fs/promises';

const API = 'https://apis.datos.gob.ar/georef/api';
const PAGE = 5000;
const OUT = new URL('../src/providers/arca/mapping/indec/localities.generated.ts', import.meta.url);

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
 * Every row of a georef collection, fetched province by province. The API refuses an `inicio` beyond 10000
 * and `asentamientos` has more rows than that nationally, so the province filter is what keeps every page
 * inside the window rather than an optimization.
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

// Two ways a place name could corrupt the emitted file, neither visible once it has. A backtick, backslash
// or `${` breaks the template literal, so the file will not parse. A tab or newline is one of the format's
// own delimiters, so the file parses fine and the row splits into the wrong fields — and a row that splits
// into three plausible fields is indistinguishable from a real one.
//
// No catalog name does either today, and failing the build is the only cheap place to catch it. Checked
// field by field, which is also what catches an embedded tab: the row then splits into four fields, so no
// character class has to describe the delimiter itself.
const UNSAFE_IN_A_FIELD = /[`\\\r\n]|\$\{/;
for (const triple of triples) {
    const fields = triple.split('\t');
    const [provincia, nombre, codigo] = fields;
    if (fields.length !== 3 || fields.some((field) => UNSAFE_IN_A_FIELD.test(field))) {
        throw new Error(`Row unsafe for the emitted format: ${JSON.stringify(triple)}`);
    }
    // The shape the reader and the contract both promise, prefixed by the province the row is filed under.
    // A catalog that stops honouring it is a conversation rather than something to vendor silently.
    if (!/^\d{2}$/.test(provincia) || !/^\d{8}$/.test(codigo) || !codigo.startsWith(provincia)) {
        throw new Error(`Row is not a province-prefixed 8-digit code: ${JSON.stringify(triple)}`);
    }
    if (nombre.trim() === '') {
        throw new Error(`Row has no name: ${JSON.stringify(triple)}`);
    }
}

// The projection is a promise rather than an implementation detail: every code emitted is a localidad
// censal, since asentamientos contribute only their `localidad_censal.id` and each localidad censal
// contributes its own row. So the distinct codes must number exactly the localidades censales read — no more
// (a finer level leaked in) and no fewer (a localidad went missing).
//
// A caller catalogs the localidades-censales layer alone, so going finer is a breaking contract change. This
// assertion is what makes that a build failure rather than a silent wire change.
const distinctCodes = new Set([...triples].map((triple) => triple.split('\t')[2]));
if (distinctCodes.size !== localidades.total) {
    throw new Error(
        `Emitted ${distinctCodes.size} distinct codes for ${localidades.total} localidades censales. ` +
            `Every code must be a localidad censal.`,
    );
}

const sorted = [...triples].sort();
// The day georef-ar was read, vendored beside the rows so a caller can date a mismatch against its own
// snapshot of the same live dataset — and so the version cannot drift from the data it describes.
const snapshotDate = new Date().toISOString().slice(0, 10);
const file = `// GENERATED FILE — do not edit by hand. Regenerate with \`node scripts/build-indec-index.mjs\`.
//
// INDEC localidad codes, vendored from georef-ar (Ministerio del Interior, datos.gob.ar) so a lookup needs
// no network call and no database. One row per unique province / name / code triple, sorted, tab-separated,
// newline-delimited:
//
//   - \`provincia\` — INDEC 2-digit province code, not ARCA's \`idProvincia\`.
//   - \`nombre\` — the place name verbatim from the catalog. Normalization happens at lookup time, so this
//     file stays a faithful copy of the source.
//   - \`codigo\` — the 8-digit INDEC localidad censal code.
//
// Both localidades censales and BAHRA asentamientos are indexed, the latter projected up to the localidad
// censal containing them, so a rural entidad or paraje resolves to its localidad's code. A name mapping to
// more than one code within its province is dropped when the lookup index is built, but kept here: the
// ambiguity is a property of the catalog.
//
// Known coverage gap: urban barrios. BAHRA models settlements rather than neighbourhoods, so a barrio of an
// interior city is not in here and its address resolves to no code. The exception is CABA, whose 48 barrios
// georef does carry, every one pointing at the single localidad censal \`02000010\`. Closing the gap
// elsewhere would need a postal-code index, which has no openly-licensed source, so it is contract rather
// than a TODO.

/**
 * When georef-ar was read, and how much of it. In code rather than a header comment because it is
 * published: \`geography.ts\` reads the date straight into the wire's \`cityCodeSchemeVersion\`, so a caller
 * holding its own snapshot of the same live dataset can date a mismatch instead of confusing drift with the
 * barrio gap. Regenerating rewrites this and the rows together, so neither can go stale alone.
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

// Annotated \`: string\` on purpose, which is why the inferrable-types rule is off here: without it
// TypeScript infers the literal type and copies all ${sorted.length} rows into the emitted \`.d.ts\`.
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const INDEC_LOCALITY_ROWS: string = \`${sorted.join('\n')}\`;
`;

await writeFile(OUT, file, 'utf8');
console.log(
    `wrote ${sorted.length} rows, snapshot ${snapshotDate} (${localidades.total} localidades, ` +
        `${asentamientos.total} asentamientos, ${skipped} skipped for having no localidad censal). ` +
        `The snapshot date is published as cityCodeSchemeVersion.`,
);
