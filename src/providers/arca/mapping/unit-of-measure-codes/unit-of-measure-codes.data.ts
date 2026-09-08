/**
 * ARCA's `Pro_umed` catalogue, transcribed verbatim from PRODUCTION `FEXGetPARAM_UMed` on 2026-09-04.
 * Re-take with:
 *
 *   PROBE_ENVIRONMENT=production pnpm dump:wsfex-table umed
 *
 * `0` carries no description in ARCA's own table. It is one of the ids that are not units at all -- see
 * `unit-of-measure-codes.ts`.
 *
 * 49 rows.
 */
export const UNIT_OF_MEASURE_NAMES: ReadonlyArray<readonly [string, string]> = [
    ['0', ''],
    ['1', 'kilogramos'],
    ['2', 'metros'],
    ['3', 'metros cuadrados'],
    ['4', 'metros cúbicos'],
    ['5', 'litros'],
    ['6', '1000 kWh'],
    ['7', 'unidades'],
    ['8', 'pares'],
    ['9', 'docenas'],
    ['10', 'quilates'],
    ['11', 'millares'],
    ['14', 'gramos'],
    ['15', 'milimetros'],
    ['16', 'mm cúbicos'],
    ['17', 'kilómetros'],
    ['18', 'hectolitros'],
    ['20', 'centímetros'],
    ['25', 'jgo. pqt. mazo naipes'],
    ['27', 'cm cúbicos'],
    ['29', 'toneladas'],
    ['30', 'dam cúbicos'],
    ['31', 'hm cúbicos'],
    ['32', 'km cúbicos'],
    ['33', 'microgramos'],
    ['34', 'nanogramos'],
    ['35', 'picogramos'],
    ['41', 'miligramos'],
    ['47', 'mililitros'],
    ['48', 'curie'],
    ['49', 'milicurie'],
    ['50', 'microcurie'],
    ['51', 'uiacthor'],
    ['52', 'muiacthor'],
    ['53', 'kg base'],
    ['54', 'gruesa'],
    ['61', 'kg bruto'],
    ['62', 'uiactant'],
    ['63', 'muiactant'],
    ['64', 'uiactig'],
    ['65', 'muiactig'],
    ['66', 'kg activo'],
    ['67', 'gramo activo'],
    ['68', 'gramo base'],
    // ARCA publishes this row double-encoded — its own data carries the UTF-8 bytes of `ó` read back as
    // Latin-1. Repaired here rather than republished to every consumer of the catalogue; it is the only
    // damaged row of the 359 across this table and the destination one. The code is what validates, so
    // only the wording is touched.
    ['95', 'anulación/devolución'],
    ['96', 'packs'],
    ['97', 'seña/anticipo'],
    ['98', 'otras unidades'],
    ['99', 'bonificación'],
];
