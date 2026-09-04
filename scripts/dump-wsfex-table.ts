/**
 * Dumps a WSFEX reference table -- what the `FEXGetPARAM_*` methods return for the codes a foreign-trade
 * voucher has to carry (`Dst_cmp`, `Moneda_Id`, `Incoterms`, `Idioma_cbte`, `Umed`, ...).
 *
 * None of these tables are in the developer manual, and none are in the WSDL either: v3.1.1 documents only
 * the methods, and the WSDL types every row as a bare `ClsFEXResponse_*` of open strings with no
 * enumeration. The values exist only at runtime behind a WSAA ticket, so this is the only way to read them.
 *
 * Ask PRODUCTION for anything that will back validation. Homologacion's tables lag: measured 2026-09-03,
 * its country table was missing eight codes production has (Curazao, four zonas francas, Timor Oriental)
 * and still carried a retired duplicate `138 SUDAN` that production has dropped.
 *
 * Costs nothing irreversible: one read of a public reference table under our own delegate identity, no
 * vouchers and no numbering consumed. The delegate certificate must be enrolled for `wsfex`; a certificate
 * good for `wsfe` alone gets a WSAA `coe.notAuthorized` here, not an empty list.
 *
 * Usage:
 *
 *   pnpm dump:wsfex-table moneda                                  # homologacion
 *   PROBE_ENVIRONMENT=production pnpm dump:wsfex-table moneda     # the table that actually validates
 *   DUMP_JSON=out.json pnpm dump:wsfex-table pais                 # also write the rows there
 *   pnpm dump:wsfex-table                                         # lists the tables
 *
 * Requires ARCA_DELEGATE_CERT_PATH_TESTING / ARCA_DELEGATE_KEY_PATH_TESTING (see .env.example), or the
 * _PRODUCTION_ pair when asking production.
 */
import 'reflect-metadata';
import {writeFileSync} from 'node:fs';
import {ServiceId, ENDPOINTS, Namespaces} from '../src/providers/arca/sdk/core/constants.js';
import {soap} from '../src/providers/arca/clients.js';
import {ticketStore} from '../src/providers/arca/auth/ticket-store/ticket-store.js';
import {delegateCredentialStore} from '../src/providers/arca/auth/delegate-credentials/delegate-credentials.js';
import {toArcaEnvironment} from '../src/providers/arca/auth/environment/environment.js';
import {formatArcaDate} from '../src/providers/arca/sdk/invoicing/arca-qr/arca-qr.js';
import {isArcaDay} from '../src/providers/arca/mapping/authority-day/authority-day.js';
import type {GenericEnvironment} from '../src/providers/provider/environment.js';

const ENVIRONMENT: GenericEnvironment =
    process.env.PROBE_ENVIRONMENT === 'production' ? 'production' : 'testing';
const ARCA_ENVIRONMENT = toArcaEnvironment(ENVIRONMENT);

interface TableSpec {
    /** The `FEXGetPARAM_*` operation, in the WSDL's own casing -- `DST_pais` and `MON` are not typos. */
    readonly operation: string;
    /** The repeated child of `FEXResultGet`, which does not follow from the operation name. */
    readonly row: string;
    readonly what: string;
    /**
     * A day parameter the operation takes, defaulting to ARCA's today. The WSDL marks these `minOccurs="0"`
     * and the service disagrees: omitting `Fecha_CTZ` is a `2054` telling you it is "de integracion
     * obligatoria". Optional in the contract, mandatory on the wire.
     */
    readonly dayParam?: string;
}

/**
 * The parameter tables that are plain lists. `Ctz` and `PtoVenta` are deliberately absent: the first takes
 * arguments and answers a single row, the second is per-CUIT rather than a reference table.
 */
const TABLES: Record<string, TableSpec> = {
    pais: {operation: 'FEXGetPARAM_DST_pais', row: 'ClsFEXResponse_DST_pais', what: 'Dst_cmp / Dst_merc'},
    cuit: {operation: 'FEXGetPARAM_DST_CUIT', row: 'ClsFEXResponse_DST_cuit', what: 'Cuit_pais_cliente'},
    moneda: {operation: 'FEXGetPARAM_MON', row: 'ClsFEXResponse_Mon', what: 'Moneda_Id'},
    'moneda-ctz': {
        operation: 'FEXGetPARAM_MON_CON_COTIZACION',
        row: 'ClsFEXResponse_Mon_CON_Cotizacion',
        what: 'Moneda_Id + Moneda_ctz, the whole catalogue priced in one call',
        dayParam: 'Fecha_CTZ',
    },
    incoterms: {operation: 'FEXGetPARAM_Incoterms', row: 'ClsFEXResponse_Inc', what: 'Incoterms'},
    idiomas: {operation: 'FEXGetPARAM_Idiomas', row: 'ClsFEXResponse_Idi', what: 'Idioma_cbte'},
    umed: {operation: 'FEXGetPARAM_UMed', row: 'ClsFEXResponse_UMed', what: 'Umed'},
    'cbte-tipo': {operation: 'FEXGetPARAM_Cbte_Tipo', row: 'ClsFEXResponse_Cbte_Tipo', what: 'Cbte_Tipo'},
    'tipo-expo': {operation: 'FEXGetPARAM_Tipo_Expo', row: 'ClsFEXResponse_Tex', what: 'Tipo_expo'},
    opcionales: {operation: 'FEXGetPARAM_Opcionales', row: 'ClsFEXResponse_Opc', what: 'Opcionales'},
    actividades: {
        operation: 'FEXGetPARAM_Actividades',
        row: 'ClsFEXResponse_ActividadTipo',
        what: 'Actividades',
    },
};

function fail(message: string): never {
    console.error('  ' + message);
    process.exit(1);
}

/** `fast-xml-parser` collapses a one-element sequence to a bare object; a table of one is still a table. */
function asArray(value: unknown): Array<Record<string, unknown>> {
    if (value === undefined || value === null) {
        return [];
    }
    return (Array.isArray(value) ? value : [value]) as Array<Record<string, unknown>>;
}

/** Every column the rows actually carry, in wire order -- the tables differ in shape and arity. */
function columnsOf(rows: Array<Record<string, string>>): Array<string> {
    const seen: Array<string> = [];
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (!seen.includes(key)) {
                seen.push(key);
            }
        }
    }
    return seen;
}

async function fetchTable(spec: TableSpec, day: string): Promise<Array<Record<string, string>>> {
    const delegate = delegateCredentialStore.get(ENVIRONMENT);
    if (delegate === undefined) {
        fail(
            `No delegate certificate configured for \`${ENVIRONMENT}\`. Set the ARCA_DELEGATE_CERT_PATH_* ` +
                'and ARCA_DELEGATE_KEY_PATH_* pair for it (see .env.example).',
        );
    }

    // A wsfex ticket, not a wsfe one: WSAA issues per service, and wsfev1's ticket is rejected here.
    const auth = await ticketStore.resolve(
        'ARCA',
        delegate.delegateCuit,
        ServiceId.WSFEXV1,
        ENVIRONMENT,
        undefined,
        true,
    );

    const response = (await soap.call(
        ENDPOINTS[ARCA_ENVIRONMENT].wsfexv1,
        Namespaces.WSFEXV1,
        spec.operation,
        {
            Auth: {Token: auth.token, Sign: auth.sign, Cuit: auth.cuit},
            ...(spec.dayParam === undefined ? {} : {[spec.dayParam]: day}),
        },
    )) as Record<string, any>;

    const result = response[`${spec.operation}Result`];
    // WSFEX reports failure in the body with ErrCode 0 meaning success, not as a SOAP fault, so an
    // unchecked read here would print an empty table and call it the answer.
    const err = result?.FEXErr;
    if (err !== undefined && String(err.ErrCode ?? '0') !== '0') {
        fail(`WSFEX [${String(err.ErrCode)}] ${String(err.ErrMsg ?? '')}`);
    }

    // The row element is `nillable="true"` and production uses it: `FEXGetPARAM_MON` answers 52 rows of
    // which three are a bare `xsi:nil="true"`. Attributes are dropped and the empty rows with them —
    // without this they arrive as phantom currencies with no id, which is worse than a short table.
    const rows = asArray(result?.FEXResultGet?.[spec.row])
        .map((row) =>
            Object.fromEntries(
                Object.entries(row)
                    .filter(([key]) => !key.startsWith('@_'))
                    .map(([key, value]) => [key, String(value ?? '').trim()]),
            ),
        )
        .filter((row) => Object.values(row).some((value) => value !== ''));

    // Numerically when every id is a number, so `162` does not sort before `99`; otherwise the authority's
    // own order is left alone, which for `moneda` keeps `PES`/`DOL` where ARCA puts them.
    const idColumn = columnsOf(rows)[0];
    if (idColumn !== undefined && rows.every((row) => /^\d+$/.test(row[idColumn] ?? ''))) {
        rows.sort((a, b) => Number(a[idColumn]) - Number(b[idColumn]));
    }
    return rows;
}

async function main(): Promise<void> {
    const name = process.argv[2];
    if (name === undefined || !(name in TABLES)) {
        console.error(name === undefined ? '  Which table?' : `  Unknown table "${name}".`);
        for (const [key, spec] of Object.entries(TABLES)) {
            console.error(`    ${key.padEnd(12)} ${spec.operation.padEnd(34)} ${spec.what}`);
        }
        process.exit(1);
    }
    const spec = TABLES[name] as TableSpec;

    // `formatArcaDate` rather than an ISO slice: after 21:00 ART the UTC date is already tomorrow, and a
    // day ARCA has not reached is a `602`, not a rate.
    const day = process.argv[3] ?? formatArcaDate(new Date());
    if (spec.dayParam !== undefined && !isArcaDay(day)) {
        fail(`${spec.dayParam} must be an ARCA calendar day (yyyymmdd); got "${day}".`);
    }

    console.log('-- ' + spec.operation + ' --');
    console.log('  environment : ' + ENVIRONMENT + ' (' + ARCA_ENVIRONMENT + ')');
    console.log('  endpoint    : ' + ENDPOINTS[ARCA_ENVIRONMENT].wsfexv1);
    console.log('  fills       : ' + spec.what);
    if (spec.dayParam !== undefined) {
        console.log('  ' + spec.dayParam.padEnd(12) + ': ' + day);
    }
    console.log('  Read-only: one reference-table read, no vouchers, no numbering consumed.');
    console.log('');

    const rows = await fetchTable(spec, day);
    const columns = columnsOf(rows);

    console.log('| ' + columns.map((c) => '`' + c + '`').join(' | ') + ' |');
    console.log('| ' + columns.map(() => '---').join(' | ') + ' |');
    for (const row of rows) {
        console.log('| ' + columns.map((c) => row[c] ?? '').join(' | ') + ' |');
    }
    console.log('');
    console.log('  ' + rows.length + ' rows.');

    const jsonPath = process.env.DUMP_JSON;
    if (jsonPath !== undefined && jsonPath !== '') {
        writeFileSync(jsonPath, JSON.stringify(rows, null, 2) + '\n', 'utf8');
        console.log('  Written to ' + jsonPath);
    }
}

await main();
