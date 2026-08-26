import {describe, expect, it} from '@jest/globals';
import {
    AR_CITY_CODE_SCHEME,
    AR_CITY_CODE_SCHEME_VERSION,
    AR_COUNTRY_CODE,
    AR_COUNTRY_CODE_SCHEME,
    AR_PROVINCES,
    AR_REGION_CODE_SCHEME,
    provinceByArcaId,
    resolveIndecLocality,
} from './geography.js';
import {AddressCodeScheme} from '../../provider.js';
import {INDEC_LOCALITY_ROWS, INDEC_SNAPSHOT} from './indec/localities.generated.js';
import {LOCALITY_ABBREVIATIONS, normalizeLocalityName} from './indec/normalize-locality.js';

/**
 * The province table and the INDEC locality resolver. Two things are worth testing here and they are
 * different in kind: that the hand-written table is internally consistent (a typo in 24 rows of three
 * unrelated code spaces is otherwise invisible), and that resolution refuses to guess.
 */

describe('what AR answers for each address level', () => {
    it('draws every scheme from the shared vocabulary rather than spelling one out', () => {
        // No scheme string exists anywhere but the enum, so a provider cannot drift from the vocabulary
        // core keys on — which is the whole reason it does not live in this module.
        expect(AR_COUNTRY_CODE_SCHEME).toBe(AddressCodeScheme.ISO_3166_1_ALPHA_2);
        expect(AR_REGION_CODE_SCHEME).toBe(AddressCodeScheme.ISO_3166_2);
        expect(AR_CITY_CODE_SCHEME).toBe(AddressCodeScheme.INDEC);
    });

    it('dates the locality code, and only the locality code', () => {
        // The published version is read out of the generated data rather than restated here, so it cannot
        // outlive a regeneration that changed the rows under it.
        expect(AR_CITY_CODE_SCHEME_VERSION).toBe(INDEC_SNAPSHOT.date);
        expect(AR_CITY_CODE_SCHEME_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('answers the country in the form core stores', () => {
        // `common.country.iso_code` holds alpha-2, which is what the country scheme promises.
        expect(AR_COUNTRY_CODE).toBe('AR');
        expect(AR_COUNTRY_CODE).toMatch(/^[A-Z]{2}$/);
    });
});

describe('AR_PROVINCES', () => {
    it('covers the 24 subdivisions exactly once in each of the three code spaces', () => {
        // ISO 3166-2:AR is 24 subdivisions; INDEC codes the same 24; ARCA has an id for each. Any
        // duplicate or omission means a row was mistyped, which no other assertion here would catch.
        expect(AR_PROVINCES).toHaveLength(24);
        expect(new Set(AR_PROVINCES.map((p) => p.arcaId)).size).toBe(24);
        expect(new Set(AR_PROVINCES.map((p) => p.iso)).size).toBe(24);
        expect(new Set(AR_PROVINCES.map((p) => p.indec)).size).toBe(24);
    });

    it('holds well-formed codes in both standards', () => {
        for (const province of AR_PROVINCES) {
            expect(province.iso).toMatch(/^AR-[A-Z]$/);
            expect(province.indec).toMatch(/^\d{2}$/);
            expect(province.arcaId).toMatch(/^\d{1,2}$/);
        }
    });

    it('keeps ARCA and INDEC numbering apart — they disagree, and conflating them would be silent', () => {
        // The two live padrón fixtures: ARCA calls Córdoba `3` and Buenos Aires `1`; INDEC calls them
        // `14` and `06`. Nothing derives one from the other.
        expect(provinceByArcaId('3')).toMatchObject({iso: 'AR-X', indec: '14'});
        expect(provinceByArcaId('1')).toMatchObject({iso: 'AR-B', indec: '06'});
    });
});

describe('provinceByArcaId', () => {
    it('resolves CABA, which ARCA numbers zero', () => {
        expect(provinceByArcaId('0')?.iso).toBe('AR-C');
        expect(provinceByArcaId('00')?.iso).toBe('AR-C');
    });

    it('reports nothing rather than throwing for a missing or unrecognized id', () => {
        // A province ARCA never sends must not fail a lookup whose registration is otherwise complete.
        expect(provinceByArcaId(undefined)).toBeUndefined();
        expect(provinceByArcaId('15')).toBeUndefined(); // the gap in ARCA's own table
        expect(provinceByArcaId('99')).toBeUndefined();
        expect(provinceByArcaId('CORDOBA')).toBeUndefined();
    });
});

describe('the vendored catalog', () => {
    const rows = INDEC_LOCALITY_ROWS.split('\n');

    it('is well-formed on every row — the resolver skips what it cannot parse, so this is the alarm', () => {
        // A malformed row degrades to "this address gets no code", which is a legitimate outcome the
        // contract already documents and therefore invisible in production. The build script rejects the
        // names that could produce one; this is the check that the file on disk actually came from it.
        const malformed = rows.filter((row) => !/^\d{2}\t[^\t]+\t\d{8}$/.test(row));

        expect(malformed).toEqual([]);
    });

    it('files every locality under the province its own code names', () => {
        // An INDEC code is provincia 2 + departamento 3 + localidad 3, so the first two digits and the
        // province column are the same fact twice. Disagreement means the row's fields have shifted.
        const misfiled = rows.filter((row) => {
            const [provinceIndec, , code] = row.split('\t');
            return !code.startsWith(provinceIndec);
        });

        expect(misfiled).toEqual([]);
    });

    it('covers the 24 provinces, in the codes AR_PROVINCES holds', () => {
        // Guards the other direction from `AR_PROVINCES`' own consistency test: that the table and the
        // catalog agree on the numbering, not just that each is internally sound.
        const inCatalog = new Set(rows.map((row) => row.split('\t')[0]));

        expect([...inCatalog].sort()).toEqual(AR_PROVINCES.map((p) => p.indec).sort());
    });

    it('describes itself accurately — the snapshot is published, so a wrong count is a wrong promise', () => {
        // `INDEC_SNAPSHOT` is the one hand-written block in a generated file (backfilled once, for the
        // snapshot that predates the stamp) and its `date` reaches a caller as `cityCodeSchemeVersion`. A
        // count disagreeing with the rows means the file was edited without being regenerated.
        expect(rows).toHaveLength(INDEC_SNAPSHOT.nameRows);
        expect(INDEC_SNAPSHOT.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(new Date(INDEC_SNAPSHOT.date).toISOString().slice(0, 10)).toBe(INDEC_SNAPSHOT.date);
    });

    it('codes localidades censales and nothing finer, which is what makes the code space a promise', () => {
        // CONTRACT §5 guarantees every INDEC code on the wire is a localidad censal: asentamientos are
        // projected *up* to the one containing them rather than emitted, which is the only reason a caller
        // cataloguing that single layer resolves everything we send. The generator asserts this against the
        // API's own totals; here it is asserted against what actually shipped, where a finer code would
        // show up as more distinct codes than there are localidades censales.
        const distinctCodes = new Set(rows.map((row) => row.split('\t')[2]));

        expect(distinctCodes.size).toBe(INDEC_SNAPSHOT.localidadesCensales);
        // Several names sharing one code is the expected shape of that projection, not a fault.
        expect(rows.length).toBeGreaterThan(distinctCodes.size);
    });
});

describe('resolveIndecLocality', () => {
    const cordoba = provinceByArcaId('3');
    const buenosAires = provinceByArcaId('1');
    const sanLuis = provinceByArcaId('11');
    const caba = provinceByArcaId('0');

    it('codes a city the contract names as its own example', () => {
        expect(resolveIndecLocality(cordoba, 'CORDOBA')).toBe('14014010');
    });

    it('folds ARCA’s unaccented uppercase onto the catalog’s display spelling', () => {
        // ARCA says `CORDOBA`, the catalog says `Córdoba`. Neither side is normalized on disk; the
        // resolver folds both at lookup time, which is why one implementation serves both.
        expect(resolveIndecLocality(cordoba, 'córdoba')).toBe('14014010');
        expect(resolveIndecLocality(buenosAires, 'BANFIELD')).toBe('06490010');
    });

    it('separates same-named localities by province — the reason scoping is mandatory', () => {
        // `MERLO` is a Buenos Aires partido head town AND a San Luis locality. Given only the name they
        // are indistinguishable; given the province they are two different codes.
        const inBuenosAires = resolveIndecLocality(buenosAires, 'MERLO');
        const inSanLuis = resolveIndecLocality(sanLuis, 'MERLO');

        expect(inBuenosAires).toBe('06539010');
        expect(inSanLuis).toBe('74049060');
        expect(inBuenosAires).not.toBe(inSanLuis);
    });

    it('codes a CABA barrio, because the catalog models those and they share one locality', () => {
        expect(resolveIndecLocality(caba, 'PALERMO')).toBe('02000010');
        expect(resolveIndecLocality(caba, 'CABALLITO')).toBe('02000010');
    });

    it('reports nothing for a barrio of an interior city — the known coverage gap', () => {
        // `BARRIO YAPEYU` is a real Córdoba fiscal address (see padron.parsers.test.ts) and the national
        // catalog does not code neighbourhoods outside CABA. Omitting is the contract-sanctioned outcome;
        // this test exists so the gap is a recorded decision rather than a surprise.
        expect(resolveIndecLocality(cordoba, 'BARRIO YAPEYU')).toBeUndefined();
    });

    it('strips the place-kind prefix in CABA, where the catalog models barrios', () => {
        expect(resolveIndecLocality(caba, 'BARRIO PALERMO')).toBe('02000010');
        expect(resolveIndecLocality(caba, 'B° PALERMO')).toBe('02000010');
        // `BARRIO` alone is a name we cannot resolve, not an empty one.
        expect(resolveIndecLocality(caba, 'BARRIO')).toBeUndefined();
    });

    it('never strips it outside CABA, where the same name is a DIFFERENT place', () => {
        // The prefix is the one signal ARCA gives that the text names a neighbourhood rather than a
        // locality, and outside CABA the catalog does not model neighbourhoods. Stripping it would invert
        // that signal: Córdoba capital has a Barrio General Paz, Córdoba province has a *localidad*
        // General Paz in another departamento, and the address would be coded to the latter — a customer
        // in the wrong city, with nothing on the wire to say anything was guessed.
        expect(resolveIndecLocality(cordoba, 'GENERAL PAZ')).toBe('14021130');
        expect(resolveIndecLocality(cordoba, 'BARRIO GENERAL PAZ')).toBeUndefined();
        expect(resolveIndecLocality(cordoba, 'B° GENERAL PAZ')).toBeUndefined();
        // Same shape, a different Córdoba barrio: `SAN MARTIN` is a locality of the province too.
        expect(resolveIndecLocality(cordoba, 'BARRIO SAN MARTIN')).toBeUndefined();
    });

    it('resolves a name the catalog itself states with the prefix, spelled either way', () => {
        // 187 catalog names really do begin with `Barrio`. Those are indexed under both spellings, so the
        // no-stripping rule above costs nothing for a place whose actual name carries the word.
        expect(resolveIndecLocality(buenosAires, 'BARRIO BANCO PROVINCIA')).toBe(
            resolveIndecLocality(buenosAires, 'BANCO PROVINCIA'),
        );
        expect(resolveIndecLocality(buenosAires, 'BARRIO BANCO PROVINCIA')).toMatch(/^06\d{6}$/);
    });

    it('never lets a stripped alias shadow or poison a name the catalog states outright', () => {
        // `BANFIELD` is a localidad in its own right. An alias generated from some `Barrio Banfield` row
        // must not collide with it and take both out — aliases only ever fill keys the catalog leaves free.
        expect(resolveIndecLocality(buenosAires, 'BANFIELD')).toBe('06490010');
    });

    it('writes out the abbreviations ARCA’s free text uses', () => {
        // The catalog spells every one of these out, ARCA frequently does not. Expansion is what closes
        // that gap; without it each of these resolves to nothing.
        expect(resolveIndecLocality(buenosAires, 'GRAL. RODRIGUEZ')).toBe(
            resolveIndecLocality(buenosAires, 'GENERAL RODRIGUEZ'),
        );
        expect(resolveIndecLocality(buenosAires, 'GRAL. RODRIGUEZ')).toMatch(/^06\d{6}$/);
        expect(resolveIndecLocality(cordoba, 'CNEL. MOLDES')).toBe(
            resolveIndecLocality(cordoba, 'CORONEL MOLDES'),
        );
        expect(resolveIndecLocality(cordoba, 'STA. ROSA DE CALAMUCHITA')).toBe(
            resolveIndecLocality(cordoba, 'SANTA ROSA DE CALAMUCHITA'),
        );
    });

    it('expands every abbreviated word, not just a leading one', () => {
        // A first-word-only rewrite would miss `VILLA GRAL. BELGRANO` and `CNIA. STA. MARIA`, and the
        // second of those abbreviates two words running.
        expect(resolveIndecLocality(cordoba, 'VILLA GRAL. BELGRANO')).toBe('14007310');
        expect(resolveIndecLocality(cordoba, 'CNIA. STA. RITA')).toBe('14042045');
    });

    it('resolves a name the catalog itself abbreviates, spelled either way', () => {
        // The mirror of the case above: 13 catalog names carry an abbreviation, and expansion runs on the
        // index side too, so the spelled-out form ARCA might send still finds them.
        const entreRios = provinceByArcaId('5');
        const mendoza = provinceByArcaId('7');

        expect(resolveIndecLocality(entreRios, 'Villa Gdor. Luis F. Etchevehere')).toBe('30084290');
        expect(resolveIndecLocality(entreRios, 'Villa Gobernador Luis F. Etchevehere')).toBe('30084290');
        expect(resolveIndecLocality(mendoza, 'Barrio Ntra. Sra. De Fátima')).toBe('50098055');
        expect(resolveIndecLocality(mendoza, 'Barrio Nuestra Señora de Fátima')).toBe('50098055');
    });

    it('reads the text literally before it reads it as an abbreviation', () => {
        // Expansion is a fallback, never an override. `EST` is a token the catalog itself uses, so a name
        // stated literally must win outright — otherwise a rewrite could answer where the literal reading
        // deliberately would not.
        expect(resolveIndecLocality(provinceByArcaId('13'), 'Forres (Est. Chaguar Punco)')).toBe('86161040');
        expect(resolveIndecLocality(provinceByArcaId('13'), 'Forres (Estación Chaguar Punco)')).toBe(
            '86161040',
        );
    });

    it('never expands an abbreviation that has two readings', () => {
        // `PTE.` is *Presidente* or *Puente*, and the catalog holds five `Puente …` localities, so it is
        // left alone — the table only ever makes a rewrite that cannot be the wrong one. Reading it as
        // *Presidente* here would code a Buenos Aires customer to whatever `Presidente Urquiza` turned up.
        expect(resolveIndecLocality(buenosAires, 'PUENTE URQUIZA')).toBe('06882090');
        expect(resolveIndecLocality(buenosAires, 'PTE. URQUIZA')).toBeUndefined();
        // `PDTE.` and `PRES.` have only the one reading, so those are expanded.
        expect(resolveIndecLocality(buenosAires, 'PDTE. DERQUI')).toBe('06638040');
        expect(resolveIndecLocality(buenosAires, 'PRES. DERQUI')).toBe('06638040');
    });

    it('combines the CABA prefix strip with expansion, in that order', () => {
        // `B° VILLA GRAL. MITRE` needs both rewrites and neither alone: strip the prefix, then write out
        // `GRAL.`, and only the fourth spelling tried is the one the catalog states.
        expect(resolveIndecLocality(caba, 'B° VILLA GRAL. MITRE')).toBe('02000010');
        expect(resolveIndecLocality(caba, 'VILLA GENERAL MITRE')).toBe('02000010');
    });

    it('gives up on anything it cannot resolve exactly, instead of picking a near match', () => {
        expect(resolveIndecLocality(cordoba, 'NO SUCH PLACE')).toBeUndefined();
        expect(resolveIndecLocality(cordoba, '   ')).toBeUndefined();
        expect(resolveIndecLocality(undefined, 'CORDOBA')).toBeUndefined();
        expect(resolveIndecLocality(cordoba, undefined)).toBeUndefined();
        // A locality that exists, but in a different province than the address states.
        expect(resolveIndecLocality(sanLuis, 'BANFIELD')).toBeUndefined();
    });

    it('refuses a name its own province gives more than one code', () => {
        // Read the ambiguity out of the vendored catalog rather than hardcoding an example, which would
        // rot the next time the index is regenerated. Every (province, name) pair carrying two distinct
        // codes must resolve to nothing — returning whichever row was read first would put a customer in
        // the wrong city with no signal that anything was guessed.
        const codesByPair = new Map<string, Set<string>>();
        for (const row of INDEC_LOCALITY_ROWS.split('\n')) {
            const [provinceIndec, name, code] = row.split('\t');
            const normalized = normalizeLocalityName(name);
            if (normalized === undefined) {
                continue;
            }
            const key = `${provinceIndec}|${normalized}`;
            const codes = codesByPair.get(key) ?? new Set<string>();
            codes.add(code);
            codesByPair.set(key, codes);
        }

        const ambiguousKeys = [...codesByPair].filter(([, codes]) => codes.size > 1).map(([key]) => key);
        expect(ambiguousKeys.length).toBeGreaterThan(0);

        for (const key of ambiguousKeys) {
            const [provinceIndec, normalized] = key.split('|');
            const province = AR_PROVINCES.find((p) => p.indec === provinceIndec);
            expect(resolveIndecLocality(province, normalized)).toBeUndefined();
        }
    });

    it('never expands its way to the WRONG code, for any name in the catalog', () => {
        // The guarantee that matters for the abbreviation table, checked against all ~4.9k catalog rows
        // rather than the handful of examples above. Abbreviate every name back down — `GENERAL` → `GRAL`,
        // the reverse of the table — and re-resolve it. Each one must come back either as its own code or
        // as nothing at all. A hit on some OTHER code is the failure this table could plausibly cause and
        // is what would put a customer in the wrong city.
        const contractions = new Map<string, Array<string>>();
        for (const [abbreviation, full] of LOCALITY_ABBREVIATIONS) {
            const spellings = contractions.get(full);
            if (spellings === undefined) {
                contractions.set(full, [abbreviation]);
            } else {
                // Two keys can share one expansion (`GRAL` and `GRL` both write out to `GENERAL`). Keeping
                // only the first would leave the other never spelled by this test and so never checked.
                spellings.push(abbreviation);
            }
        }

        // One variant per abbreviatable word per spelling of it, plus one abbreviating every word at once —
        // that last is what covers a name abbreviating two words running (`NUESTRA SENORA` → `NTRA SRA`).
        const spelled = new Set<string>();
        const contractionsOf = (normalized: string): ReadonlySet<string> => {
            const words = normalized.split(' ');
            const variants = new Set<string>();
            words.forEach((word, i) => {
                for (const abbreviation of contractions.get(word) ?? []) {
                    spelled.add(abbreviation);
                    variants.add([...words.slice(0, i), abbreviation, ...words.slice(i + 1)].join(' '));
                }
            });
            const every = words.map((word) => contractions.get(word)?.[0] ?? word).join(' ');
            if (every !== normalized) {
                variants.add(every);
            }
            return variants;
        };

        let exercised = 0;
        for (const row of INDEC_LOCALITY_ROWS.split('\n')) {
            const [provinceIndec, name, code] = row.split('\t');
            const normalized = normalizeLocalityName(name);
            if (normalized === undefined) {
                continue;
            }
            const province = AR_PROVINCES.find((p) => p.indec === provinceIndec);
            // Guards the guard: an unrecognized province makes every lookup below return `undefined`, which
            // the `resolved !== undefined` check reads as a pass — a whole province could stop being tested
            // in silence, and `exercised` would keep counting its rows.
            expect(province).toBeDefined();
            for (const abbreviated of contractionsOf(normalized)) {
                exercised++;
                const resolved = resolveIndecLocality(province, abbreviated);
                if (resolved !== undefined) {
                    expect(resolved).toBe(code);
                }
            }
        }

        // Guards the guard: if the table or the catalog ever stopped overlapping, the loop above would
        // pass by testing nothing.
        expect(exercised).toBeGreaterThan(500);
        // And every key must have been spelled at least once. A key whose expansion the catalog does not
        // carry is unreachable here, which is exactly the dead entry criterion 1 of the table forbids.
        expect([...LOCALITY_ABBREVIATIONS.keys()].filter((abbreviation) => !spelled.has(abbreviation))).toEqual(
            [],
        );
    });
});
