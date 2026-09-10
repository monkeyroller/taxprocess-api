// GENERATED FILE — do not edit by hand. Regenerate with `node scripts/build-rec20-units.mjs <workbook>`.
//
// UN/ECE Recommendation 20 Revision 17 (2021), sheet "Annex II & Annex III" of rec20_Rev17e-2021.xlsx —
// the complete published list, curated down to the units an invoice line is plausibly priced in.
//
// The curation rule, re-appliable by a reader (`rec20-units.test.ts` re-applies the checkable half: rule A
// keys off `Description`, which is not carried below, so no test re-checks that branch):
//
//   keep(row) = row.Status is neither 'D' (deleted) nor 'X' (withdrawn, mostly packaging codes that moved to
//               UN/ECE Rec 21)
//               AND ( row.Description starts "A unit of count defining the number of"     -- rule A
//                   | row.Name is an SI-prefixed metric mass/length/area/volume/time/     -- rule B
//                     energy/radioactivity unit
//                   | row.CommonCode is one of the six rule C names in the generator )    -- rule C
//
// 2136 published rows; 1756 active; 208 kept.
//
// `Status` is not carried: every row here is active by construction, so a constant column would be noise
// that also lets a withdrawn code look legitimate. The absence is the assertion.
//
// `Conversion Factor` is deliberately NOT carried. It is free text (`10⁻³ kg`) relative to a base the
// column does not name, and machine-reading it to convert an invoice quantity would be exactly the "must not
// drive a fiscal decision" hazard `country-tax-id-rows.data.ts` flags for `countryIso`. Nothing on this wire
// converts quantities — a quantity is sent as the caller states it. Do not re-add this as a feature.

/**
 * One unit of measure as the recommendation publishes it. The property names are its own column headings,
 * lower-camelled — `country-tax-id-rows.data.ts` keeps the authority's spelling verbatim, which is not
 * available here because Rec 20's headings are prose rather than identifiers.
 */
export interface Rec20Unit {
    /** `Common Code` — the value that travels on the wire (`KGM`, `C62`, `ZZ`). */
    readonly commonCode: string;
    /** `Name`, verbatim (`kilogram`, `one`, `mutually defined`). Rendered to a human; never matched on. */
    readonly name: string;
    /** `Symbol`, verbatim (`kg`, `m³`), or `null` where the recommendation publishes none. */
    readonly symbol: string | null;
    /** `Level/Category`, verbatim. Kept so the curation rule above stays checkable rather than merely stated. */
    readonly levelCategory: string;
}

/**
 * What this snapshot was taken from, in code rather than only in the comment above — the reason
 * `INDEC_SNAPSHOT` is shaped this way: a number a test can assert against cannot go stale beside the rows.
 */
export const REC20_SNAPSHOT = {
    /** The recommendation's own revision. */
    revision: 17,
    /** Its publication year — what a scheme version would carry, if one ever goes on the wire. */
    published: '2021',
    /** Rows the revision publishes in Annex II & III. */
    publishedRows: 2136,
    /** Of those, the ones whose `Status` is neither `D` nor `X`. */
    activeRows: 1756,
    /** Of those, the ones the curation rule keeps. Asserted equal to `REC20_UNITS.size`. */
    rows: 208,
} as const;

/** One row per line, so a re-take against a new revision diffs row-for-row instead of reflowing the file. */
// prettier-ignore
export const REC20_UNIT_ROWS: ReadonlyArray<Rec20Unit> = [
    {commonCode: '10', name: 'group', symbol: null, levelCategory: '3.9'},
    {commonCode: '11', name: 'outfit', symbol: null, levelCategory: '3.9'},
    {commonCode: '13', name: 'ration', symbol: null, levelCategory: '3.9'},
    {commonCode: '15', name: 'stick, military', symbol: null, levelCategory: '3.9'},
    {commonCode: '20', name: 'twenty foot container', symbol: null, levelCategory: '3.4'},
    {commonCode: '21', name: 'forty foot container', symbol: null, levelCategory: '3.4'},
    {commonCode: '57', name: 'mesh', symbol: null, levelCategory: '3.9'},
    {commonCode: '2R', name: 'kilocurie', symbol: 'kCi', levelCategory: '2S'},
    {commonCode: '2U', name: 'megagram', symbol: 'Mg', levelCategory: '1S'},
    {commonCode: '3B', name: 'megajoule', symbol: 'MJ', levelCategory: '1S'},
    {commonCode: '3C', name: 'manmonth', symbol: null, levelCategory: '3.9'},
    {commonCode: '4G', name: 'microlitre', symbol: 'µl', levelCategory: '1M'},
    {commonCode: '5B', name: 'batch', symbol: null, levelCategory: '3.9'},
    {commonCode: 'A13', name: 'attojoule', symbol: 'aJ', levelCategory: '1S'},
    {commonCode: 'A44', name: 'decalitre', symbol: 'dal', levelCategory: '1M'},
    {commonCode: 'A45', name: 'decametre', symbol: 'dam', levelCategory: '1M'},
    {commonCode: 'A59', name: '8-part cloud cover', symbol: null, levelCategory: '3.9'},
    {commonCode: 'A68', name: 'exajoule', symbol: 'EJ', levelCategory: '1S'},
    {commonCode: 'A70', name: 'femtojoule', symbol: 'fJ', levelCategory: '1S'},
    {commonCode: 'A71', name: 'femtometre', symbol: 'fm', levelCategory: '1S'},
    {commonCode: 'AA', name: 'ball', symbol: null, levelCategory: '3.9'},
    {commonCode: 'AB', name: 'bulk pack', symbol: 'pk', levelCategory: '3.9'},
    {commonCode: 'ACT', name: 'activity', symbol: null, levelCategory: '3.2'},
    {commonCode: 'AI', name: 'average minute per call', symbol: null, levelCategory: '3.5'},
    {commonCode: 'AL', name: 'access line', symbol: null, levelCategory: '3.5'},
    {commonCode: 'ANN', name: 'year', symbol: 'y', levelCategory: '2'},
    {commonCode: 'AS', name: 'assortment', symbol: null, levelCategory: '3.9'},
    {commonCode: 'AY', name: 'assembly', symbol: null, levelCategory: '3.9'},
    {commonCode: 'B17', name: 'credit', symbol: null, levelCategory: '3.9'},
    {commonCode: 'B52', name: 'kilosecond', symbol: 'ks', levelCategory: '1S'},
    {commonCode: 'B7', name: 'cycle', symbol: null, levelCategory: '3.9'},
    {commonCode: 'B98', name: 'microsecond', symbol: 'µs', levelCategory: '1S'},
    {commonCode: 'C0', name: 'call', symbol: null, levelCategory: '3.5'},
    {commonCode: 'C15', name: 'millijoule', symbol: 'mJ', levelCategory: '1S'},
    {commonCode: 'C26', name: 'millisecond', symbol: 'ms', levelCategory: '1S'},
    {commonCode: 'C45', name: 'nanometre', symbol: 'nm', levelCategory: '1S'},
    {commonCode: 'C47', name: 'nanosecond', symbol: 'ns', levelCategory: '1S'},
    {commonCode: 'C52', name: 'picometre', symbol: 'pm', levelCategory: '1S'},
    {commonCode: 'C62', name: 'one', symbol: '1', levelCategory: '1'},
    {commonCode: 'C68', name: 'petajoule', symbol: 'PJ', levelCategory: '1S'},
    {commonCode: 'C9', name: 'coil group', symbol: null, levelCategory: '3.9'},
    {commonCode: 'CEN', name: 'hundred', symbol: null, levelCategory: '3.7'},
    {commonCode: 'CG', name: 'card', symbol: null, levelCategory: '3.9'},
    {commonCode: 'CGM', name: 'centigram', symbol: 'cg', levelCategory: '1M'},
    {commonCode: 'CLF', name: 'hundred leave', symbol: null, levelCategory: '3.8'},
    {commonCode: 'CLT', name: 'centilitre', symbol: 'cl', levelCategory: '1S'},
    {commonCode: 'CMK', name: 'square centimetre', symbol: 'cm²', levelCategory: '1S'},
    {commonCode: 'CMQ', name: 'cubic centimetre', symbol: 'cm³', levelCategory: '1S'},
    {commonCode: 'CMT', name: 'centimetre', symbol: 'cm', levelCategory: '1S 3.5'},
    {commonCode: 'CNP', name: 'hundred pack', symbol: null, levelCategory: '3.2 3.8'},
    {commonCode: 'CTM', name: 'metric carat', symbol: null, levelCategory: '3.5'},
    {commonCode: 'CUR', name: 'curie', symbol: 'Ci', levelCategory: '2'},
    {commonCode: 'D23', name: 'pen gram (protein)', symbol: null, levelCategory: '3.9'},
    {commonCode: 'D30', name: 'terajoule', symbol: 'TJ', levelCategory: '1S'},
    {commonCode: 'D32', name: 'terawatt hour', symbol: 'TW·h', levelCategory: '1S'},
    {commonCode: 'D63', name: 'book', symbol: null, levelCategory: '3.9'},
    {commonCode: 'D65', name: 'round', symbol: null, levelCategory: '3.9'},
    {commonCode: 'D68', name: 'number of words', symbol: null, levelCategory: '3.7'},
    {commonCode: 'DAY', name: 'day', symbol: 'd', levelCategory: '1'},
    {commonCode: 'DEC', name: 'decade', symbol: null, levelCategory: '3.8'},
    {commonCode: 'DG', name: 'decigram', symbol: 'dg', levelCategory: '1M'},
    {commonCode: 'DJ', name: 'decagram', symbol: 'dag', levelCategory: '1M'},
    {commonCode: 'DLT', name: 'decilitre', symbol: 'dl', levelCategory: '1M'},
    {commonCode: 'DMA', name: 'cubic decametre', symbol: 'dam³', levelCategory: '1S'},
    {commonCode: 'DMK', name: 'square decimetre', symbol: 'dm²', levelCategory: '1S'},
    {commonCode: 'DMQ', name: 'cubic decimetre', symbol: 'dm³', levelCategory: '1S'},
    {commonCode: 'DMT', name: 'decimetre', symbol: 'dm', levelCategory: '1M'},
    {commonCode: 'DPC', name: 'dozen piece', symbol: null, levelCategory: '3.2'},
    {commonCode: 'DPR', name: 'dozen pair', symbol: null, levelCategory: '3.2'},
    {commonCode: 'DRL', name: 'dozen roll', symbol: null, levelCategory: '3.2'},
    {commonCode: 'DTN', name: 'decitonne', symbol: 'dt or dtn', levelCategory: '1M 3.5'},
    {commonCode: 'DZN', name: 'dozen', symbol: 'DOZ', levelCategory: '3.7'},
    {commonCode: 'DZP', name: 'dozen pack', symbol: null, levelCategory: '3.2'},
    {commonCode: 'E12', name: 'mille', symbol: null, levelCategory: '3.9'},
    {commonCode: 'E21', name: 'shares', symbol: null, levelCategory: '3.7'},
    {commonCode: 'E22', name: 'TEU', symbol: null, levelCategory: '3.4'},
    {commonCode: 'E23', name: 'tyre', symbol: null, levelCategory: '3.7'},
    {commonCode: 'E25', name: 'active unit', symbol: null, levelCategory: '3.9'},
    {commonCode: 'E27', name: 'dose', symbol: null, levelCategory: '3.9'},
    {commonCode: 'E30', name: 'strand', symbol: null, levelCategory: '3.7'},
    {commonCode: 'E31', name: 'square metre per litre', symbol: 'm²/l', levelCategory: '3.1'},
    {commonCode: 'E32', name: 'litre per hour', symbol: 'l/h', levelCategory: '3.1'},
    {commonCode: 'E33', name: 'foot per thousand', symbol: null, levelCategory: '3.1'},
    {commonCode: 'E37', name: 'pixel', symbol: null, levelCategory: '3.6'},
    {commonCode: 'E4', name: 'gross kilogram', symbol: null, levelCategory: '3.1'},
    {commonCode: 'E48', name: 'service unit', symbol: null, levelCategory: '3.5'},
    {commonCode: 'E49', name: 'working day', symbol: null, levelCategory: '3.5'},
    {commonCode: 'E50', name: 'accounting unit', symbol: null, levelCategory: '3.5'},
    {commonCode: 'E51', name: 'job', symbol: null, levelCategory: '3.5'},
    {commonCode: 'E53', name: 'test', symbol: null, levelCategory: '3.5'},
    {commonCode: 'E54', name: 'trip', symbol: null, levelCategory: '3.5'},
    {commonCode: 'E55', name: 'use', symbol: null, levelCategory: '3.5'},
    {commonCode: 'E56', name: 'well', symbol: null, levelCategory: '3.5'},
    {commonCode: 'E57', name: 'zone', symbol: null, levelCategory: '3.5'},
    {commonCode: 'EA', name: 'each', symbol: null, levelCategory: '3.2'},
    {commonCode: 'EB', name: 'electronic mail box', symbol: null, levelCategory: '3.9'},
    {commonCode: 'FIT', name: 'failures in time', symbol: 'FIT', levelCategory: '3.8'},
    {commonCode: 'GGR', name: 'great gross', symbol: null, levelCategory: '3.7'},
    {commonCode: 'GRM', name: 'gram', symbol: 'g', levelCategory: '1S'},
    {commonCode: 'GRO', name: 'gross', symbol: 'gr', levelCategory: '3.7'},
    {commonCode: 'GV', name: 'gigajoule', symbol: 'GJ', levelCategory: '1S'},
    {commonCode: 'GWH', name: 'gigawatt hour', symbol: 'GW·h', levelCategory: '1S'},
    {commonCode: 'H16', name: 'square decametre', symbol: 'dam²', levelCategory: '1S'},
    {commonCode: 'H18', name: 'square hectometre', symbol: 'hm²', levelCategory: '1S'},
    {commonCode: 'H19', name: 'cubic hectometre', symbol: 'hm³', levelCategory: '1S'},
    {commonCode: 'H20', name: 'cubic kilometre', symbol: 'km³', levelCategory: '1S'},
    {commonCode: 'H21', name: 'blank', symbol: null, levelCategory: '3.2'},
    {commonCode: 'H70', name: 'picosecond', symbol: 'ps', levelCategory: '1'},
    {commonCode: 'H87', name: 'piece', symbol: null, levelCategory: '3.8'},
    {commonCode: 'HBX', name: 'hundred boxes', symbol: null, levelCategory: '3.2'},
    {commonCode: 'HC', name: 'hundred count', symbol: null, levelCategory: '3.7'},
    {commonCode: 'HEA', name: 'head', symbol: null, levelCategory: '3.5'},
    {commonCode: 'HGM', name: 'hectogram', symbol: 'hg', levelCategory: '1M'},
    {commonCode: 'HIU', name: 'hundred international unit', symbol: null, levelCategory: '3.7'},
    {commonCode: 'HLT', name: 'hectolitre', symbol: 'hl', levelCategory: '1S'},
    {commonCode: 'HMT', name: 'hectometre', symbol: 'hm', levelCategory: '1M'},
    {commonCode: 'HUR', name: 'hour', symbol: 'h', levelCategory: '1'},
    {commonCode: 'IE', name: 'person', symbol: null, levelCategory: '3.9'},
    {commonCode: 'IUG', name: 'international unit per gram', symbol: null, levelCategory: '3.7'},
    {commonCode: 'JOU', name: 'joule', symbol: 'J', levelCategory: '1'},
    {commonCode: 'JPS', name: 'hundred metre', symbol: null, levelCategory: '3.1'},
    {commonCode: 'JWL', name: 'number of jewels', symbol: null, levelCategory: '3.7'},
    {commonCode: 'K6', name: 'kilolitre', symbol: 'kl', levelCategory: '1M'},
    {commonCode: 'KA', name: 'cake', symbol: null, levelCategory: '3.9'},
    {commonCode: 'KGM', name: 'kilogram', symbol: 'kg', levelCategory: '1'},
    {commonCode: 'KJO', name: 'kilojoule', symbol: 'kJ', levelCategory: '1S'},
    {commonCode: 'KMK', name: 'square kilometre', symbol: 'km²', levelCategory: '1S'},
    {commonCode: 'KMT', name: 'kilometre', symbol: 'km', levelCategory: '1S'},
    {commonCode: 'KO', name: 'milliequivalence caustic potash per gram of product', symbol: null, levelCategory: '3.9'},
    {commonCode: 'KT', name: 'kit', symbol: null, levelCategory: '3.2'},
    {commonCode: 'KTN', name: 'kilotonne', symbol: 'kt', levelCategory: '1M'},
    {commonCode: 'KWH', name: 'kilowatt hour', symbol: 'kW·h', levelCategory: '1S'},
    {commonCode: 'LEF', name: 'leaf', symbol: null, levelCategory: '3.5'},
    {commonCode: 'LF', name: 'linear foot', symbol: null, levelCategory: '3.1'},
    {commonCode: 'LM', name: 'linear metre', symbol: null, levelCategory: '3.1'},
    {commonCode: 'LO', name: 'lot [unit of procurement]', symbol: null, levelCategory: '3.9'},
    {commonCode: 'LR', name: 'layer', symbol: null, levelCategory: '3.9'},
    {commonCode: 'LS', name: 'lump sum', symbol: null, levelCategory: '3.9'},
    {commonCode: 'LTR', name: 'litre', symbol: 'l', levelCategory: '1'},
    {commonCode: 'LY', name: 'linear yard', symbol: null, levelCategory: '3.1'},
    {commonCode: 'M36', name: '30-day month', symbol: 'mo (30 days)', levelCategory: '3.7'},
    {commonCode: 'M37', name: 'actual/360', symbol: 'y (360 days)', levelCategory: '3.7'},
    {commonCode: 'M5', name: 'microcurie', symbol: 'µCi', levelCategory: '2S'},
    {commonCode: 'MAL', name: 'megalitre', symbol: 'Ml', levelCategory: '1M'},
    {commonCode: 'MAM', name: 'megametre', symbol: 'Mm', levelCategory: '2'},
    {commonCode: 'MBE', name: 'thousand standard brick equivalent', symbol: null, levelCategory: '3.5'},
    {commonCode: 'MC', name: 'microgram', symbol: 'µg', levelCategory: '1S'},
    {commonCode: 'MCU', name: 'millicurie', symbol: 'mCi', levelCategory: '2S'},
    {commonCode: 'MD', name: 'air dry metric ton', symbol: null, levelCategory: '3.1'},
    {commonCode: 'MGM', name: 'milligram', symbol: 'mg', levelCategory: '1S'},
    {commonCode: 'MIL', name: 'thousand', symbol: null, levelCategory: '3.7'},
    {commonCode: 'MIU', name: 'million international unit', symbol: null, levelCategory: '3.7'},
    {commonCode: 'MLT', name: 'millilitre', symbol: 'ml', levelCategory: '1S'},
    {commonCode: 'MMK', name: 'square millimetre', symbol: 'mm²', levelCategory: '1S'},
    {commonCode: 'MMQ', name: 'cubic millimetre', symbol: 'mm³', levelCategory: '1S'},
    {commonCode: 'MMT', name: 'millimetre', symbol: 'mm', levelCategory: '1S'},
    {commonCode: 'MON', name: 'month', symbol: 'mo', levelCategory: '2'},
    {commonCode: 'MTK', name: 'square metre', symbol: 'm²', levelCategory: '1'},
    {commonCode: 'MTQ', name: 'cubic metre', symbol: 'm³', levelCategory: '1'},
    {commonCode: 'MTR', name: 'metre', symbol: 'm', levelCategory: '1'},
    {commonCode: 'MWH', name: 'megawatt hour (1000 kW.h)', symbol: 'MW·h', levelCategory: '1S'},
    {commonCode: 'N1', name: 'pen calorie', symbol: null, levelCategory: '3.9'},
    {commonCode: 'NAR', name: 'number of articles', symbol: null, levelCategory: '3.7'},
    {commonCode: 'NCL', name: 'number of cells', symbol: null, levelCategory: '3.7'},
    {commonCode: 'NF', name: 'message', symbol: null, levelCategory: '3.9'},
    {commonCode: 'NIL', name: 'nil', symbol: '()', levelCategory: '3.8'},
    {commonCode: 'NIU', name: 'number of international units', symbol: null, levelCategory: '3.7'},
    {commonCode: 'NMP', name: 'number of packs', symbol: null, levelCategory: '3.7'},
    {commonCode: 'NPT', name: 'number of parts', symbol: null, levelCategory: '3.7'},
    {commonCode: 'OA', name: 'panel', symbol: null, levelCategory: '3.9'},
    {commonCode: 'P5', name: 'five pack', symbol: null, levelCategory: '3.2'},
    {commonCode: 'PD', name: 'pad', symbol: null, levelCategory: '3.9'},
    {commonCode: 'PI', name: 'pitch', symbol: null, levelCategory: '3.5'},
    {commonCode: 'PR', name: 'pair', symbol: null, levelCategory: '3.7'},
    {commonCode: 'Q32', name: 'femtolitre', symbol: 'fl', levelCategory: '1S'},
    {commonCode: 'Q33', name: 'picolitre', symbol: 'pl', levelCategory: '1S'},
    {commonCode: 'Q34', name: 'nanolitre', symbol: 'nl', levelCategory: '1S'},
    {commonCode: 'Q3', name: 'meal', symbol: null, levelCategory: '3.9'},
    {commonCode: 'QA', name: 'page - facsimile', symbol: null, levelCategory: '3.5'},
    {commonCode: 'QB', name: 'page - hardcopy', symbol: null, levelCategory: '3.5'},
    {commonCode: 'R1', name: 'pica', symbol: null, levelCategory: '3.5'},
    {commonCode: 'ROM', name: 'room', symbol: null, levelCategory: '3.9'},
    {commonCode: 'SCO', name: 'score', symbol: null, levelCategory: '3.7'},
    {commonCode: 'SET', name: 'set', symbol: null, levelCategory: '3.2'},
    {commonCode: 'SQ', name: 'square', symbol: null, levelCategory: '3.9'},
    {commonCode: 'SQR', name: 'square, roofing', symbol: null, levelCategory: '3.1'},
    {commonCode: 'SR', name: 'strip', symbol: null, levelCategory: '3.9'},
    {commonCode: 'STC', name: 'stick', symbol: null, levelCategory: '3.9'},
    {commonCode: 'STK', name: 'stick, cigarette', symbol: null, levelCategory: '3.9'},
    {commonCode: 'STW', name: 'straw', symbol: null, levelCategory: '3.9'},
    {commonCode: 'SW', name: 'skein', symbol: null, levelCategory: '3.9'},
    {commonCode: 'SX', name: 'shipment', symbol: null, levelCategory: '3.4'},
    {commonCode: 'SYR', name: 'syringe', symbol: null, levelCategory: '3.9'},
    {commonCode: 'T0', name: 'telecommunication line in service', symbol: null, levelCategory: '3.5'},
    {commonCode: 'T3', name: 'thousand piece', symbol: null, levelCategory: '3.8'},
    {commonCode: 'TNE', name: 'tonne (metric ton)', symbol: 't', levelCategory: '1S'},
    {commonCode: 'TP', name: 'ten pack', symbol: null, levelCategory: '3.2'},
    {commonCode: 'TPR', name: 'ten pair', symbol: null, levelCategory: '3.8'},
    {commonCode: 'TST', name: 'ten set', symbol: null, levelCategory: '3.9'},
    {commonCode: 'TTS', name: 'ten thousand sticks', symbol: null, levelCategory: '3.9'},
    {commonCode: 'U1', name: 'treatment', symbol: null, levelCategory: '3.9'},
    {commonCode: 'U2', name: 'tablet', symbol: null, levelCategory: '3.9'},
    {commonCode: 'UC', name: 'telecommunication port', symbol: null, levelCategory: '3.5'},
    {commonCode: 'WEE', name: 'week', symbol: 'wk', levelCategory: '2'},
    {commonCode: 'WHR', name: 'watt hour', symbol: 'W·h', levelCategory: '1'},
    {commonCode: 'Z11', name: 'hanging container', symbol: null, levelCategory: '3.9'},
    {commonCode: 'ZP', name: 'page', symbol: null, levelCategory: '3.5'},
    {commonCode: 'ZZ', name: 'mutually defined', symbol: null, levelCategory: '3.9'},
];
