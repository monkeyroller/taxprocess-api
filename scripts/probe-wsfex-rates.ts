/**
 * Asks WSFEv1 and WSFEXv1 for the same currency on the same day, and prints the two answers side by side.
 *
 * The question this exists to settle: a Factura E's `Moneda_ctz` is validated by WSFEXv1 against WSFEXv1's
 * own reference (validation 1667), and a WSFEv1 voucher's against WSFEv1's (10119). Both manuals describe
 * the source with the same sentence -- "la ultima cotizacion de la base de datos aduanera... este valor es
 * orientativo" -- so nothing in the documentation says whether the two numbers agree. If they do not, a rate
 * fetched from one service and used on the other can sit outside the band that actually judges it, and a
 * cache keyed on (currency, day) alone silently merges the two.
 *
 * Three answers come out of one run:
 *
 *   1. Do the per-currency rates differ between services for the same day?
 *   2. Does WSFEXv1's batch (`FEXGetPARAM_MON_CON_COTIZACION`, one call for the whole table) agree with its
 *      own per-currency method (`FEXGetPARAM_Ctz`)? The batch is what a sync should use; it is only safe if
 *      it says the same thing.
 *   3. Which currencies the batch omits for the day. That set is rule 1600's practical effect -- a service
 *      export invoice may only name a currency that has a close for the previous business day -- and it is
 *      narrower than the catalogue.
 *
 * Ask PRODUCTION. Homologacion's cotizaciones are generated, so a difference measured there means nothing.
 *
 * Costs nothing irreversible: reference-table and cotizacion reads under our own delegate identity, no
 * vouchers and no numbering consumed. The delegate certificate must be enrolled for BOTH `wsfe` and `wsfex`.
 *
 * Usage:
 *
 *   PROBE_ENVIRONMENT=production pnpm probe:wsfex-rates              # ARCA's today
 *   PROBE_ENVIRONMENT=production pnpm probe:wsfex-rates 20260903     # a specific authority day
 *
 * Requires the ARCA_DELEGATE_CERT_PATH_* / ARCA_DELEGATE_KEY_PATH_* pair (see .env.example).
 */
import 'reflect-metadata';
import {ServiceId, ENDPOINTS, Namespaces} from '../src/providers/arca/sdk/core/constants.js';
import {soap} from '../src/providers/arca/clients.js';
import {ticketStore} from '../src/providers/arca/auth/ticket-store/ticket-store.js';
import {delegateCredentialStore} from '../src/providers/arca/auth/delegate-credentials/delegate-credentials.js';
import {toArcaEnvironment} from '../src/providers/arca/auth/environment/environment.js';
import {formatArcaDate} from '../src/providers/arca/sdk/invoicing/arca-qr/arca-qr.js';
import {isArcaDay} from '../src/providers/arca/mapping/authority-day/authority-day.js';
import type {GenericEnvironment} from '../src/providers/provider/environment.js';
import type {ServiceIdValue} from '../src/providers/arca/sdk/core/constants.js';

const ENVIRONMENT: GenericEnvironment =
    process.env.PROBE_ENVIRONMENT === 'production' ? 'production' : 'testing';
const ARCA_ENVIRONMENT = toArcaEnvironment(ENVIRONMENT);

function fail(message: string): never {
    console.error('  ' + message);
    process.exit(1);
}

async function auth(service: ServiceIdValue): Promise<{token: string; sign: string; cuit: number}> {
    const delegate = delegateCredentialStore.get(ENVIRONMENT);
    if (delegate === undefined) {
        fail(
            `No delegate certificate configured for \`${ENVIRONMENT}\`. Set the ARCA_DELEGATE_CERT_PATH_* ` +
                'and ARCA_DELEGATE_KEY_PATH_* pair for it (see .env.example).',
        );
    }
    const ticket = await ticketStore.resolve(
        'ARCA',
        delegate.delegateCuit,
        service,
        ENVIRONMENT,
        undefined,
        true,
    );
    return {token: ticket.token, sign: ticket.sign, cuit: ticket.cuit};
}

function authElement(a: {token: string; sign: string; cuit: number}): Record<string, unknown> {
    return {Token: a.token, Sign: a.sign, Cuit: a.cuit};
}

/** `fast-xml-parser` collapses a one-element sequence to a bare object; a table of one is still a table. */
function asArray(value: unknown): Array<Record<string, unknown>> {
    if (value === undefined || value === null) {
        return [];
    }
    return (Array.isArray(value) ? value : [value]) as Array<Record<string, unknown>>;
}

/** WSFEX reports failure in the body, and `ErrCode` 0 means success -- an unchecked read prints a lie. */
function fexError(result: Record<string, any> | undefined): string | undefined {
    const err = result?.FEXErr;
    if (err !== undefined && String(err.ErrCode ?? '0') !== '0') {
        return `[${String(err.ErrCode)}] ${String(err.ErrMsg ?? '')}`;
    }
    return undefined;
}

/** WSFEv1 reports failure as a repeated in-payload `Errors/Err`, a different shape from WSFEX's. */
function wsfeError(result: Record<string, any> | undefined): string | undefined {
    const entries = asArray(result?.Errors?.Err);
    if (entries.length === 0) {
        return undefined;
    }
    return entries.map((e) => `[${String(e.Code ?? '')}] ${String(e.Msg ?? '')}`).join('; ');
}

interface Answer {
    readonly rate?: string;
    readonly day?: string;
    readonly error?: string;
}

async function wsfeRate(code: string, day: string): Promise<Answer> {
    const response = (await soap.call(
        ENDPOINTS[ARCA_ENVIRONMENT].wsfev1,
        Namespaces.WSFEV1,
        'FEParamGetCotizacion',
        {Auth: authElement(await auth(ServiceId.WSFEV1)), MonId: code, FchCotiz: day},
    )) as Record<string, any>;
    const result = response.FEParamGetCotizacionResult;
    const error = wsfeError(result);
    if (error !== undefined) {
        return {error};
    }
    return {rate: String(result?.ResultGet?.MonCotiz ?? ''), day: String(result?.ResultGet?.FchCotiz ?? '')};
}

/** WSFEX's per-currency method. `FchCotiz` here is `YYYY-MM-DD`, not the `yyyymmdd` WSFEv1 wants (err 1003). */
async function fexRate(code: string, day: string): Promise<Answer> {
    const dashed = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    const response = (await soap.call(
        ENDPOINTS[ARCA_ENVIRONMENT].wsfexv1,
        Namespaces.WSFEXV1,
        'FEXGetPARAM_Ctz',
        {Auth: authElement(await auth(ServiceId.WSFEXV1)), Mon_id: code, FchCotiz: dashed},
    )) as Record<string, any>;
    const result = response.FEXGetPARAM_CtzResult;
    const error = fexError(result);
    if (error !== undefined) {
        return {error};
    }
    return {rate: String(result?.FEXResultGet?.Mon_ctz ?? ''), day: String(result?.FEXResultGet?.Mon_fecha ?? '')};
}

/** WSFEX's whole-table method: every currency that has a close for the day, in one call. */
async function fexBatch(day: string): Promise<Map<string, Answer>> {
    const response = (await soap.call(
        ENDPOINTS[ARCA_ENVIRONMENT].wsfexv1,
        Namespaces.WSFEXV1,
        'FEXGetPARAM_MON_CON_COTIZACION',
        {Auth: authElement(await auth(ServiceId.WSFEXV1)), Fecha_CTZ: day},
    )) as Record<string, any>;
    const result = response.FEXGetPARAM_MON_CON_COTIZACIONResult;
    const error = fexError(result);
    if (error !== undefined) {
        fail(`FEXGetPARAM_MON_CON_COTIZACION ${error}`);
    }
    const out = new Map<string, Answer>();
    for (const row of asArray(result?.FEXResultGet?.ClsFEXResponse_Mon_CON_Cotizacion)) {
        const id = String(row.Mon_Id ?? '').trim();
        if (id !== '') {
            out.set(id, {rate: String(row.Mon_ctz ?? ''), day: String(row.Fecha_ctz ?? '')});
        }
    }
    return out;
}

/** Same number to the precision both services publish, so `1756.5184` and `1756.518400` agree. */
function sameRate(a?: string, b?: string): boolean {
    if (a === undefined || b === undefined || a === '' || b === '') {
        return false;
    }
    return Number(a) === Number(b);
}

function show(a: Answer): string {
    return a.error !== undefined ? a.error : `${a.rate ?? ''} (${a.day ?? ''})`;
}

async function main(): Promise<void> {
    const day = process.argv[2] ?? formatArcaDate(new Date());
    if (!isArcaDay(day)) {
        fail(`Day must be an ARCA calendar day (yyyymmdd); got "${day}".`);
    }

    console.log('-- wsfe vs wsfex cotizacion --');
    console.log('  environment : ' + ENVIRONMENT + ' (' + ARCA_ENVIRONMENT + ')');
    console.log('  day         : ' + day);
    console.log('  Read-only: reference and cotizacion reads, no vouchers, no numbering consumed.');
    console.log('');

    const batch = await fexBatch(day);
    console.log(`  FEXGetPARAM_MON_CON_COTIZACION priced ${batch.size} currencies for ${day}.`);
    console.log('');

    // Every currency the batch priced, so the comparison covers the whole export-quotable set rather than a
    // sample -- plus DOL, which is the one every caller cares about even on a day it is absent.
    const codes = [...new Set(['DOL', ...batch.keys()])].sort();

    console.log('| code | wsfe `FEParamGetCotizacion` | wsfex `FEXGetPARAM_Ctz` | wsfex batch | agree? |');
    console.log('| --- | --- | --- | --- | --- |');

    let differing = 0;
    let batchDisagrees = 0;
    for (const code of codes) {
        const [wsfe, fex] = await Promise.all([wsfeRate(code, day), fexRate(code, day)]);
        const inBatch = batch.get(code) ?? {};
        const crossAgrees = sameRate(wsfe.rate, fex.rate);
        const batchAgrees = sameRate(fex.rate, inBatch.rate);
        if (!crossAgrees) {
            differing += 1;
        }
        if (!batchAgrees) {
            batchDisagrees += 1;
        }
        console.log(
            `| ${code} | ${show(wsfe)} | ${show(fex)} | ${inBatch.rate ?? '(absent)'} | ` +
                `${crossAgrees ? 'yes' : '**NO**'} |`,
        );
    }

    console.log('');
    console.log(`  ${codes.length} currencies compared.`);
    console.log(`  wsfe vs wsfex differ or error : ${differing}`);
    console.log(`  wsfex single vs batch differ  : ${batchDisagrees}`);
    console.log('');
    console.log('  Read the two counts separately. The first decides whether a cached rate has to be keyed by');
    console.log('  service; the second decides whether the batch is safe to sync from.');
}

await main();
