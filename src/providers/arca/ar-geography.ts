import {AddressCodeScheme} from '../provider.js';
import {INDEC_LOCALITY_ROWS} from './data/indec-localities.js';
import {normalizeLocalityName, withoutPlaceKindPrefix} from './data/normalize-locality.js';

/**
 * Argentine geography codes for the neutral taxpayer address — the provider-side half of core's
 * CONTRACT-REQUESTS asks 1–3.
 *
 * ARCA states a province as its own `idProvincia` and a locality as free text, neither of which means
 * anything outside ARCA. CONTRACT §9 keeps that vocabulary in here, so this module is where it turns into
 * codes a caller can resolve without knowing ARCA exists: ISO 3166-1 for the country, ISO 3166-2 for the
 * province, INDEC for the locality.
 *
 * Which coding system each of those IS gets named on the wire beside the code, drawn from
 * {@link AddressCodeScheme} — the vocabulary is shared with every other provider, so no scheme spelling is
 * written out here. What this module owns is only the AR *answers*.
 *
 * Nothing here ever throws. An address whose province or locality does not resolve still belongs to a
 * taxpayer whose registration is otherwise complete, so an unmapped value yields `undefined` and the key is
 * omitted from the wire — unlike `code-maps.ts`, where an unknown code IS the caller's error.
 */

/** The country code for every address an ARCA registry can return, in {@link AR_COUNTRY_CODE_SCHEME}. */
export const AR_COUNTRY_CODE = 'AR';

/** ARCA answers the country in ISO 3166-1 alpha-2 — the form core's `common.country.iso_code` holds. */
export const AR_COUNTRY_CODE_SCHEME = AddressCodeScheme.ISO_3166_1_ALPHA_2;

/** ARCA answers the province in ISO 3166-2, resolved from `idProvincia` via {@link AR_PROVINCES}. */
export const AR_REGION_CODE_SCHEME = AddressCodeScheme.ISO_3166_2;

/** ARCA answers the locality in INDEC's national coding, resolved from free text. */
export const AR_CITY_CODE_SCHEME = AddressCodeScheme.INDEC;

/** One Argentine province in the three vocabularies this service has to bridge. */
export interface ArProvince {
    /** ARCA's `idProvincia`, as it arrives on the wire. */
    readonly arcaId: string;
    /** ARCA's `descripcionProvincia`, for reference — never matched on. */
    readonly name: string;
    /** ISO 3166-2:AR subdivision code, what the contract carries as `regionCode`. */
    readonly iso: string;
    /** INDEC's 2-digit province code — the first two digits of every locality code, and NOT `arcaId`. */
    readonly indec: string;
}

/**
 * The 24 Argentine provinces keyed by ARCA's `idProvincia` (AFIP padrón manual, tabla de provincias — note
 * it has no id `15`). Effectively immutable: the last change to this list was Tierra del Fuego becoming a
 * province in 1990.
 *
 * The three code spaces are genuinely unrelated — Córdoba is `3` to ARCA, `AR-X` to ISO and `14` to INDEC —
 * so all three live in one row rather than in three tables that could fall out of step. That is also why
 * ask 3 (INDEC locality codes) depends on ask 1: `indec` here is what scopes the locality search.
 */
export const AR_PROVINCES: ReadonlyArray<ArProvince> = [
    {arcaId: '0', name: 'CIUDAD AUTONOMA BUENOS AIRES', iso: 'AR-C', indec: '02'},
    {arcaId: '1', name: 'BUENOS AIRES', iso: 'AR-B', indec: '06'},
    {arcaId: '2', name: 'CATAMARCA', iso: 'AR-K', indec: '10'},
    {arcaId: '3', name: 'CORDOBA', iso: 'AR-X', indec: '14'},
    {arcaId: '4', name: 'CORRIENTES', iso: 'AR-W', indec: '18'},
    {arcaId: '5', name: 'ENTRE RIOS', iso: 'AR-E', indec: '30'},
    {arcaId: '6', name: 'JUJUY', iso: 'AR-Y', indec: '38'},
    {arcaId: '7', name: 'MENDOZA', iso: 'AR-M', indec: '50'},
    {arcaId: '8', name: 'LA RIOJA', iso: 'AR-F', indec: '46'},
    {arcaId: '9', name: 'SALTA', iso: 'AR-A', indec: '66'},
    {arcaId: '10', name: 'SAN JUAN', iso: 'AR-J', indec: '70'},
    {arcaId: '11', name: 'SAN LUIS', iso: 'AR-D', indec: '74'},
    {arcaId: '12', name: 'SANTA FE', iso: 'AR-S', indec: '82'},
    {arcaId: '13', name: 'SANTIAGO DEL ESTERO', iso: 'AR-G', indec: '86'},
    {arcaId: '14', name: 'TUCUMAN', iso: 'AR-T', indec: '90'},
    {arcaId: '16', name: 'CHACO', iso: 'AR-H', indec: '22'},
    {arcaId: '17', name: 'CHUBUT', iso: 'AR-U', indec: '26'},
    {arcaId: '18', name: 'FORMOSA', iso: 'AR-P', indec: '34'},
    {arcaId: '19', name: 'MISIONES', iso: 'AR-N', indec: '54'},
    {arcaId: '20', name: 'NEUQUEN', iso: 'AR-Q', indec: '58'},
    {arcaId: '21', name: 'LA PAMPA', iso: 'AR-L', indec: '42'},
    {arcaId: '22', name: 'RIO NEGRO', iso: 'AR-R', indec: '62'},
    {arcaId: '23', name: 'SANTA CRUZ', iso: 'AR-Z', indec: '78'},
    {arcaId: '24', name: 'TIERRA DEL FUEGO', iso: 'AR-V', indec: '94'},
];

const BY_ARCA_ID: ReadonlyMap<string, ArProvince> = new Map(
    AR_PROVINCES.map((province) => [province.arcaId, province]),
);

/**
 * The province behind an ARCA `idProvincia`, or `undefined` for a missing or unrecognized one. The id is
 * normalized past its leading zeros so `'0'` and `'00'` name the same province.
 */
export function provinceByArcaId(arcaId: string | undefined): ArProvince | undefined {
    if (arcaId === undefined) {
        return undefined;
    }
    const digits = arcaId.trim();
    if (!/^\d+$/.test(digits)) {
        return undefined;
    }
    return BY_ARCA_ID.get(String(Number(digits)));
}

/**
 * `province|NORMALIZED NAME` → the 8-digit INDEC code, or `null` where the catalog gives that name more
 * than one code within the same province and the address therefore cannot be resolved.
 *
 * Built once, on first lookup rather than at import, so the ~5k-row parse is paid only by a process that
 * actually serves a taxpayer lookup.
 */
let localityIndex: ReadonlyMap<string, string | null> | undefined;

/** Records a name→code pair, poisoning the key with `null` once two different codes claim it. */
function record(index: Map<string, string | null>, key: string, code: string): void {
    const existing = index.get(key);
    if (existing === undefined) {
        index.set(key, code);
    } else if (existing !== code) {
        // Two different localidades of one province answer to this name. Poisoned with `null` rather
        // than deleted, so a later row carrying either code cannot resurrect it.
        index.set(key, null);
    }
}

function indexOfLocalities(): ReadonlyMap<string, string | null> {
    if (localityIndex !== undefined) {
        return localityIndex;
    }
    const index = new Map<string, string | null>();
    // 187 catalog names genuinely begin with a place-kind word (`Barrio El Casal`). Each is indexed under
    // the name as stated AND under its stripped form, so ARCA resolves it whichever way it spells it.
    // The aliases are applied afterwards and only where the catalog states no such name outright: an
    // alias must never shadow — or, by colliding, poison — a name the catalog actually carries.
    const aliases = new Map<string, string | null>();
    // Split on either ending: the file is written with LF and `.gitattributes` pins `eol=lf`, but the
    // parse should not be the thing that depends on that holding.
    for (const row of INDEC_LOCALITY_ROWS.split(/\r?\n/)) {
        const fields = row.split('\t');
        // A row that is not exactly `provincia \t nombre \t codigo` is skipped, not trusted. The generator
        // rejects any name that could produce one (`build-indec-index.mjs`), so reaching here means the
        // vendored file was hand-edited or written by a broken build. Skipping costs one locality — the
        // address it would have coded falls back to free text, which the contract already allows for.
        // Reading the fields anyway would be worse in both directions: a shifted row keys an address on
        // the wrong value, and a row too short makes `name` `undefined`, which the compiler cannot see
        // (`noUncheckedIndexedAccess` is off) and which would throw inside `normalizeLocalityName` — on
        // every lookup for the life of the process, since the index is memoized only once it is built.
        // `ar-geography.test.ts` is where a malformed file fails loudly.
        if (fields.length !== 3) {
            continue;
        }
        const [provinceIndec, name, code] = fields;
        const normalized = normalizeLocalityName(name);
        if (normalized === undefined || code === '') {
            continue;
        }
        record(index, `${provinceIndec}|${normalized}`, code);
        const stripped = withoutPlaceKindPrefix(normalized);
        if (stripped !== undefined) {
            record(aliases, `${provinceIndec}|${stripped}`, code);
        }
    }
    for (const [key, code] of aliases) {
        if (!index.has(key) && code !== null) {
            index.set(key, code);
        }
    }
    localityIndex = index;
    return index;
}

/** INDEC's code for CABA — the one province whose *barrios* the national catalog models. */
const CABA_INDEC = '02';

/**
 * The 8-digit INDEC localidad censal code for an ARCA address, or `undefined` when it does not resolve —
 * a normal per-address outcome, not an error. Resolution is exact-match-only after
 * {@link normalizeLocalityName}, scoped to the province, and gives up on any ambiguity: a wrong code would
 * put a customer in the wrong city, which is worse for the caller than an absent one. Scoping is what
 * separates `MERLO` in Buenos Aires from `MERLO` in San Luis.
 *
 * Known gap: ARCA often reports a *barrio* of an interior city, which the national catalog does not model —
 * those addresses resolve to nothing.
 *
 * **The `BARRIO`/`B°` prefix is only ever stripped for CABA**, and that restriction is load-bearing rather
 * than conservative housekeeping. Stripping it everywhere reads a barrio as the locality of the same name:
 * Córdoba capital has a Barrio General Paz, Córdoba province has a *localidad* General Paz in another
 * departamento, and `BARRIO GENERAL PAZ` would resolve to the latter — a confidently wrong city, from the
 * one signal ARCA gave us that the text is not a locality at all. CABA is safe by construction: georef
 * carries its 48 barrios and every one of them points at the single CABA localidad, so a `PALERMO` or
 * `BARRIO PALERMO` address resolves to the same code either way.
 *
 * A name the catalog itself states with the prefix (`Barrio El Casal`) still resolves in any province,
 * with or without it — that symmetry lives in the index, not here.
 */
export function resolveIndecLocality(
    province: ArProvince | undefined,
    localityText: string | undefined,
): string | undefined {
    if (province === undefined || localityText === undefined) {
        return undefined;
    }
    const normalized = normalizeLocalityName(localityText);
    if (normalized === undefined) {
        return undefined;
    }
    const index = indexOfLocalities();
    const asStated = index.get(`${province.indec}|${normalized}`);
    if (asStated !== undefined || province.indec !== CABA_INDEC) {
        // `null` is the ambiguous case, and it is an answer: refuse rather than fall through to a guess.
        return asStated ?? undefined;
    }
    const withoutPrefix = withoutPlaceKindPrefix(normalized);
    if (withoutPrefix === undefined) {
        return undefined;
    }
    return index.get(`${province.indec}|${withoutPrefix}`) ?? undefined;
}
