/**
 * Measures the exchange-rate band ARCA enforces, and whether our delegate CUIT may read a cotizacion at all.
 *
 * WSFEv1 validation 10119 reads "el tipo de cambio no podra ser inferior al 2% ni superior en un 400%" of
 * the rate ARCA supplies as orientativo. That one sentence names two rules in different forms:
 *
 *   "inferior al 2%"       a fraction OF the rate    ->  0.02 * R
 *   "superior en un 400%"  an excess OVER the rate   ->  R + 4R  =  5 * R
 *
 * Assuming both bounds share a form is wrong in both directions, giving either [0.02R, 4R] or [0.98R, 5R].
 * Measured against homologacion on 2026-08-31 the real band is [0.02R, 5R].
 *
 * ARCA has rewritten that sentence three times since 2023, so the answer has a shelf life and re-taking it
 * should cost one command rather than a re-reading of the PDF. This prints the literal to paste back.
 *
 * PROBE_MODE=full authorizes real vouchers in homologacion and consumes one number per probe, so point it
 * at a point of sale whose numbering you may burn. It refuses to run against production.
 *
 * Usage:
 *
 *   pnpm probe:band                                        # read-only: the cotizacion read + points of sale
 *   PROBE_MODE=full PROBE_POINT_OF_SALE=1 pnpm probe:band  # measure the band
 *
 * Requires ARCA_DELEGATE_CERT_PATH_TESTING / ARCA_DELEGATE_KEY_PATH_TESTING (or the _PEM_ forms). Optional:
 * PROBE_ISSUER_TAXID (to issue in representacion of a taxpayer that has a point of sale), PROBE_CURRENCY
 * (default DOL), PROBE_RECEIVER_TAXID.
 */
import 'reflect-metadata';
import {env} from '../src/config/env.js';
import {ServiceId} from '../src/providers/arca/sdk/core/constants.js';
import {commonInvoiceService} from '../src/providers/arca/clients.js';
import {ticketStore} from '../src/providers/arca/auth/ticket-store/ticket-store.js';
import {delegateCredentialStore} from '../src/providers/arca/auth/delegate-credentials/delegate-credentials.js';
import {formatArcaDate} from '../src/providers/arca/sdk/invoicing/arca-qr/arca-qr.js';
import type {ArcaAuth} from '../src/providers/arca/sdk/core/types.js';
import type {CommonInvoiceRequest} from '../src/providers/arca/sdk/invoicing/common/common-invoice.types.js';
import type {BandBoundMode} from '../src/providers/provider/rate-band/rate-band.js';

/** Homologacion only: a probe authorizes real vouchers, which production is not the place for. */
const ENVIRONMENT = 'testing' as const;

const CURRENCY = process.env.PROBE_CURRENCY ?? 'DOL';
const POINT_OF_SALE = Number(process.env.PROBE_POINT_OF_SALE ?? '');
const RECEIVER_TAXID = process.env.PROBE_RECEIVER_TAXID ?? '20111111112';

/**
 * `read`, the default, runs only the cotizacion read: it authorizes nothing and consumes no voucher numbers,
 * so it is safe to re-run whenever our certificate or enrolment changes. `full` adds the ladder. Defaulted
 * to the safe half because a tool that irreversibly consumes voucher numbering should be opted into.
 */
const MODE = process.env.PROBE_MODE === 'full' ? 'full' : 'read';

/** How close the bisection gets before it stops, as a fraction of the published rate. */
const BISECT_TOLERANCE = 0.0005;
/** Hard cap on authorized vouchers, so a bad bracket cannot burn a point of sale's numbering. */
const MAX_PROBES = 40;

interface ProbeResult {
    rate: number;
    /** Multiple of the published rate, for reading the ladder at a glance. */
    factor: number;
    authorized: boolean;
    /** ARCA's own codes, so 10119 against 10240 is visible rather than inferred. */
    codes: Array<string>;
    message: string;
}

let probesUsed = 0;

function fail(message: string): never {
    console.error('  ' + message);
    process.exit(1);
}

/**
 * Does `FEParamGetCotizacion` answer with `Auth.Cuit` set to our own delegate CUIT and no representacion?
 *
 * Reported separately from the band because the outcomes imply different things: a rate means the endpoint
 * can be served credential-free and cached centrally, while a `600` and a `601` need different fallbacks.
 * Answered GRANTED on 2026-08-31 against homologacion.
 */
async function probeDelegateRead(): Promise<{
    auth: ArcaAuth;
    delegateCuit: string;
    rate: number;
    rateDate: string;
}> {
    const delegate = delegateCredentialStore.get(ENVIRONMENT);
    if (delegate === undefined) {
        fail(
            'No delegate certificate configured for `testing`. Set ARCA_DELEGATE_CERT_PATH_TESTING and ' +
                'ARCA_DELEGATE_KEY_PATH_TESTING (see .env.example).',
        );
    }

    console.log('-- Can our delegate CUIT read a cotizacion, representing nobody? --');
    console.log('  delegate CUIT : ' + delegate.delegateCuit);
    console.log('  currency      : ' + CURRENCY);

    const auth = await ticketStore.resolve(
        'ARCA',
        delegate.delegateCuit,
        ServiceId.WSFEV1,
        ENVIRONMENT,
        undefined,
        true,
    );
    const service = commonInvoiceService('homologacion');

    try {
        const info = await service.getCurrencyRate(auth, CURRENCY);
        if (info.rate === undefined) {
            // Every band step is a multiple of the published rate, so there is nothing to probe without
            // one. `undefined` is an unreadable `MonCotiz`, distinct from the 602 handled in the catch.
            fail('ARCA answered no usable MonCotiz for ' + CURRENCY + '; nothing to measure a band around.');
        }
        console.log('  GRANTED - ARCA answered ' + info.rate + ' for ' + info.monId + ' (FchCotiz ' + info.rateDate + ')');
        console.log('  No tenant certificate is involved, so a caller may cache this centrally.');
        return {auth, delegateCuit: delegate.delegateCuit, rate: info.rate, rateDate: info.rateDate};
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log('  REFUSED - ' + message);
        console.log('  Record this verbatim: a 600 ("not authorized for this operation") and a 601');
        console.log('  ("CUIT representada no incluida") imply different fallbacks for a caller.');
        if (/602/.test(message)) {
            console.log('  NOTE: a 602 means homologacion serves no cotizaciones, not that the read was refused.');
        }
        throw err;
    }
}

/** A minimal Factura A in the probed currency. The issuer is `Auth.Cuit` rather than a field. */
function voucher(number: number, monCotiz: number): CommonInvoiceRequest {
    // Amounts kept trivial and self-consistent, so the rate is the only variable under test.
    return {
        pointOfSaleNumber: POINT_OF_SALE,
        voucherType: 1,
        concept: 1,
        docType: 80,
        docNumber: Number(RECEIVER_TAXID),
        voucherNumberFrom: number,
        voucherNumberTo: number,
        voucherDate: formatArcaDate(new Date()),
        totalAmount: 121,
        netUntaxed: 0,
        netTaxed: 100,
        exempt: 0,
        vatAmount: 21,
        tributesAmount: 0,
        currencyId: CURRENCY,
        currencyRate: monCotiz,
        receiverIvaConditionId: 1,
        // The ARCA wire shape verbatim (Id 5 = 21%), not the SDK's English naming.
        vatSubtotals: [{Id: 5, BaseImp: 100, Importe: 21}],
    };
}

/** Authorizes one voucher at `monCotiz` and reports what ARCA said, without throwing on a rejection. */
async function probe(auth: ArcaAuth, published: number, monCotiz: number): Promise<ProbeResult> {
    if (probesUsed >= MAX_PROBES) {
        fail('Probe cap (' + MAX_PROBES + ') reached - refusing to burn more voucher numbers.');
    }
    probesUsed += 1;

    const service = commonInvoiceService('homologacion');
    const last = await service.getLastAuthorizedNumber(auth, POINT_OF_SALE, 1);
    const request = voucher(last + 1, monCotiz);
    const base = {rate: monCotiz, factor: Number((monCotiz / published).toFixed(5))};

    try {
        const result = await service.requestAuthorization(auth, request);
        return {
            ...base,
            authorized: result.result === 'A',
            codes: result.observations.map((o) => o.code),
            message:
                result.observations.map((o) => '[' + o.code + '] ' + o.message).join('; ') || result.result,
        };
    } catch (err) {
        // A thrown `Errors` block is the ordinary shape of an excluding validation, so it is a result here
        // rather than a failure — it is the whole thing being measured.
        const message = err instanceof Error ? err.message : String(err);
        const codes = Array.from(message.matchAll(/\[(\d+)\]/g)).map((m) => String(m[1]));
        return {...base, authorized: false, codes, message};
    }
}

function report(result: ProbeResult): ProbeResult {
    const verdict = result.authorized ? 'AUTHORIZED' : 'REJECTED  ';
    console.log(
        '  ' +
            verdict +
            '  MonCotiz=' +
            result.rate.toFixed(6).padStart(16) +
            '  (' +
            result.factor +
            'xR)  ' +
            result.message.slice(0, 88),
    );
    return result;
}

/**
 * The discriminating ladder, which has to bracket both bounds: an earlier version stopped at 0.5R, which
 * ARCA authorizes, so the floor was never bracketed and the bottom rung was reported as though measured.
 * Rungs chosen around the 2026-08-31 measurement of [0.02R, 5R].
 */
function ladder(published: number): Array<{label: string; rate: number}> {
    return [
        {label: 'at the published rate (control - must be authorized)', rate: published},
        {label: 'R + 1.5 (rejected only if 10240 binds unconditionally)', rate: published + 1.5},
        {label: '0.5R', rate: published * 0.5},
        {label: '0.03R', rate: published * 0.03},
        {label: '0.02R (the floor measured 2026-08-31)', rate: published * 0.02},
        {label: '0.0199R (just under that floor)', rate: published * 0.0199},
        {label: '2R', rate: published * 2},
        {label: '4.01R (authorized - so the ceiling is not 4R)', rate: published * 4.01},
        {label: '5.0002R (just over the ceiling)', rate: published * 5.0002},
        {label: '5.01R', rate: published * 5.01},
    ];
}

/** Narrows a bound between a known-authorized and a known-rejected rate. Each step costs one number. */
async function bisect(
    auth: ArcaAuth,
    published: number,
    accepted: number,
    refused: number,
): Promise<number> {
    let ok = accepted;
    let bad = refused;
    while (Math.abs(bad - ok) / published > BISECT_TOLERANCE && probesUsed < MAX_PROBES) {
        const mid = (ok + bad) / 2;
        if (report(await probe(auth, published, mid)).authorized) {
            ok = mid;
        } else {
            bad = mid;
        }
    }
    return ok;
}

/** Lists the points of sale the read-only mode reports, so a caller knows what the ladder could use. */
async function listPointsOfSale(auth: ArcaAuth): Promise<void> {
    console.log('  Points of sale registered for this identity:');
    try {
        const points = await commonInvoiceService('homologacion').getPointsOfSale(auth);
        if (points.length === 0) {
            console.log('    (none - the ladder needs an identity that has one; see PROBE_ISSUER_TAXID)');
        }
        for (const point of points) {
            const notes: Array<string> = [];
            if (point.blocked) {
                notes.push('BLOCKED');
            }
            if (point.dischargeDate !== undefined) {
                notes.push('de-registered ' + point.dischargeDate);
            }
            const suffix = notes.length > 0 ? ' - ' + notes.join(', ') : '';
            const mode = point.issuanceMode ?? 'mode unreported';
            console.log('    PtoVta ' + point.number + ' (' + mode + ')' + suffix);
        }
    } catch (err) {
        console.log('    could not list them: ' + (err instanceof Error ? err.message : String(err)));
    }
}

async function main(): Promise<void> {
    if (env.nodeEnv === 'production') {
        fail('Refusing to run with NODE_ENV=production. This probe authorizes real vouchers.');
    }

    const {auth: delegateAuth, delegateCuit, rate: published, rateDate} = await probeDelegateRead();

    if (MODE === 'read') {
        console.log('-- Stopping here (PROBE_MODE=read) --');
        console.log('  Nothing was authorized and no voucher numbers were consumed.');
        await listPointsOfSale(delegateAuth);
        console.log('  To measure the band: PROBE_MODE=full PROBE_POINT_OF_SALE=<n> pnpm probe:band');
        return;
    }

    if (!Number.isInteger(POINT_OF_SALE) || POINT_OF_SALE <= 0) {
        fail('Set PROBE_POINT_OF_SALE to a homologacion point of sale whose numbering you may burn.');
    }

    // The cotizacion is read as ourselves. Issuing is a different question — the delegate CUIT may have no
    // homologacion point of sale — so PROBE_ISSUER_TAXID issues in representacion of a taxpayer that does.
    // Same certificate either way; only `Auth.Cuit` differs.
    const issuerTaxId = process.env.PROBE_ISSUER_TAXID ?? delegateCuit;
    const auth =
        issuerTaxId === delegateCuit
            ? delegateAuth
            : await ticketStore.resolve('ARCA', issuerTaxId, ServiceId.WSFEV1, ENVIRONMENT, undefined, true);

    console.log('-- Which band does ARCA actually enforce? --');
    console.log('  published rate: ' + published + ' (FchCotiz ' + rateDate + ')');
    console.log('  issuing as    : ' + issuerTaxId + ', PtoVta ' + POINT_OF_SALE + ', Factura A in ' + CURRENCY);
    if (issuerTaxId !== delegateCuit) {
        console.log('  (in representacion - ' + issuerTaxId + ' must have granted wsfe to ' + delegateCuit + ')');
    }

    const results: Array<ProbeResult> = [];
    for (const step of ladder(published)) {
        console.log('  . ' + step.label);
        results.push(report(await probe(auth, published, step.rate)));
    }

    console.log('-- Reading --');

    const control = results[0];
    if (control === undefined || !control.authorized) {
        fail(
            'The control probe (MonCotiz = the published rate) was REJECTED, so nothing below can be ' +
                'attributed to the band. Fix the voucher shape first, then re-run.',
        );
    }

    const authorized = results.filter((r) => r.authorized);
    const rejected = results.filter((r) => !r.authorized);
    if (rejected.length === 0) {
        console.log('  Homologacion authorized EVERY rate on the ladder - it enforces neither 10119 nor 10240.');
        console.log('  Record that and keep the WIDEST reading: a band narrower than the real one makes a');
        console.log('  caller claim a rejection that will not happen.');
        return;
    }

    const codes = new Set(rejected.flatMap((r) => r.codes));
    console.log('  ARCA rejection codes seen: ' + (Array.from(codes).join(', ') || '(none reported)'));
    if (codes.has('10240') && !codes.has('10119')) {
        console.log('  -> 10240 is binding. The bound is in currency UNITS (PLUS_UNITS), and 10119 is dead.');
    } else if (codes.has('10119')) {
        console.log('  -> 10119 is the binding rule, as of the 2026-08-31 measurement.');
    }

    const lowestOk = Math.min(...authorized.map((r) => r.rate));
    const highestOk = Math.max(...authorized.map((r) => r.rate));
    const rejectedBelow = rejected.filter((r) => r.rate < lowestOk).map((r) => r.rate);
    const rejectedAbove = rejected.filter((r) => r.rate > highestOk).map((r) => r.rate);

    console.log('-- Bisecting the bounds --');

    // A bound is only measured if a rejection brackets it. Without one, all that is known is "at least
    // this wide", and reporting the lowest rung tried as the floor is how an earlier version of this
    // script produced a confidently wrong constant.
    const lower =
        rejectedBelow.length > 0
            ? await bisect(auth, published, lowestOk, Math.max(...rejectedBelow))
            : undefined;
    const upper =
        rejectedAbove.length > 0
            ? await bisect(auth, published, highestOk, Math.min(...rejectedAbove))
            : undefined;

    if (lower === undefined) {
        console.log('  LOWER BOUND NOT BRACKETED - nothing was rejected below ' + lowestOk.toFixed(6));
        console.log('    Extend the ladder downward and re-run. Do not treat the lowest rung as the floor.');
    }
    if (upper === undefined) {
        console.log('  UPPER BOUND NOT BRACKETED - nothing was rejected above ' + highestOk.toFixed(6));
        console.log('    Extend the ladder upward and re-run.');
    }

    console.log('  vouchers consumed: ' + probesUsed);
    if (lower === undefined || upper === undefined) {
        console.log('-- Incomplete: not emitting a constant from an unbracketed bound --');
        return;
    }

    const lowerFactor = Number((lower / published).toFixed(5));
    const upperFactor = Number((upper / published).toFixed(5));
    console.log('  measured band ~ [' + lower.toFixed(6) + ', ' + upper.toFixed(6) + ']');
    console.log('  as factors of R ~ [' + lowerFactor + ', ' + upperFactor + ']');

    // Emitted independently because the bounds do not share a form: the floor is a fraction of the rate,
    // the ceiling an excess over it, and one shared mode cannot express [0.02R, 5R] at all.
    //
    // The two modes are typed rather than bare strings, so renaming a member fails this file's typecheck
    // instead of printing a literal that no longer compiles where it is pasted.
    const lowerMode: BandBoundMode = 'FRACTION_OF';
    const upperMode: BandBoundMode = 'EXCESS_OVER';
    console.log('-- Paste into src/providers/arca/mapping/cotizacion/cotizacion.ts --');
    console.log('  export const BAND_RULE: BandRule = {');
    console.log("      lower: {mode: '" + lowerMode + "', value: " + lowerFactor + '},');
    console.log("      upper: {mode: '" + upperMode + "', value: " + Number((upperFactor - 1).toFixed(5)) + '},');
    console.log("      measuredOn: '<today, ISO>',");
    console.log('  };');
    console.log('  Sanity-check the modes against the rungs before pasting: a floor near 0.98R would be');
    console.log('  EXCESS_OVER rather than FRACTION_OF, and a ceiling near 4R would be FRACTION_OF.');
    console.log('  Then record the ladder in docs/CONTRACT.md and say plainly how wide the band is: a');
    console.log('  caller needs to know whether its out-of-band warning will ever fire.');
}

await main();
