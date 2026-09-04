/**
 * Measures which day an ARCA cotizacion is for -- what `FEParamGetCotizacion`'s `FchCotiz` selects.
 *
 * The manual's one line on the field, "Fecha a la cual se consulta la cotizacion de la moneda ingresada", is
 * ambiguous between two readings, and which one holds decides whether a voucher's own day can be passed
 * through:
 *
 *   dated by APPLICABILITY   FchCotiz = X returns the rate VALID ON X        ->  pass X through
 *   dated by CLOSE           FchCotiz = X returns the rate that CLOSED on X  ->  ask for X - 1
 *
 * Production settles it: every Saturday, Sunday and feriado comes back 602 there, and only working days have
 * rows. So a row is the close of its day -- under the other reading a Saturday would have to carry the rate
 * in force on it, and a voucher issued on a Saturday has to declare something. The day needing a rate is
 * therefore priced off the previous working day, weekends skipped by arithmetic and feriados discovered
 * through 602.
 *
 * Homologacion cannot answer it: its DOL series is synthetic, a smooth compounding curve over every calendar
 * day with no plateau across a weekend. Where a repeated value falls is exactly what would tell the two
 * readings apart, so do not try to read the answer off homologacion's values -- PROBE_SERIES=1 shows why.
 *
 * Costs nothing irreversible: six reads of a public number under our own delegate identity, no vouchers and
 * no numbering consumed, so it is safe to re-run whenever the answer might have moved.
 *
 * Usage:
 *
 *   pnpm probe:cotizacion-day                    # the six discriminating calls
 *   PROBE_SERIES=1 pnpm probe:cotizacion-day     # + 24 consecutive days, to see whether the data is real
 *
 * Requires ARCA_DELEGATE_CERT_PATH_TESTING / ARCA_DELEGATE_KEY_PATH_TESTING (or the _PEM_ forms). Optional:
 * PROBE_CURRENCY (default DOL), PROBE_FERIADO (default 20260817), PROBE_SERIES.
 *
 * The hour ART of every call is recorded and printed, not as decoration: the 2026-08-31 measurement is hard
 * to interpret largely because its hour was not written down, and whether ARCA's "latest" had rolled over
 * cannot be reconstructed afterwards.
 */
import 'reflect-metadata';
import {env} from '../src/config/env.js';
import {ServiceId} from '../src/providers/arca/sdk/core/constants.js';
import {commonInvoiceService} from '../src/providers/arca/clients.js';
import {ticketStore} from '../src/providers/arca/auth/ticket-store/ticket-store.js';
import {delegateCredentialStore} from '../src/providers/arca/auth/delegate-credentials/delegate-credentials.js';
import {argentinaClockParts, formatArcaDate} from '../src/providers/arca/sdk/invoicing/arca-qr/arca-qr.js';
import {
    arcaDayToUtcDate,
    isArcaDay,
    shiftArcaDay,
} from '../src/providers/arca/mapping/authority-day/authority-day.js';
import {RATE_DAY_RULE} from '../src/providers/arca/mapping/cotizacion/cotizacion.js';
import {toArcaEnvironment} from '../src/providers/arca/auth/environment/environment.js';
import type {ArcaAuth} from '../src/providers/arca/sdk/core/types.js';
import type {GenericEnvironment} from '../src/providers/provider/environment.js';

/**
 * Which environment to ask. Homologacion by default; PROBE_ENVIRONMENT=production opts in explicitly.
 *
 * Production is allowed here, unlike in `probe:band`, because that one authorizes vouchers while this only
 * reads a public number -- and production is where the question can actually be answered. It still has to
 * be opted into, so nobody reaches the real authority by running the default.
 */
const ENVIRONMENT: GenericEnvironment =
    process.env.PROBE_ENVIRONMENT === 'production' ? 'production' : 'testing';
const ARCA_ENVIRONMENT = toArcaEnvironment(ENVIRONMENT);

const CURRENCY = process.env.PROBE_CURRENCY ?? 'DOL';
/** Third Monday of August 2026 — a feriado safely in the past, so ARCA has had time to not publish. */
const FERIADO = process.env.PROBE_FERIADO ?? '20260817';
/** Opt-in: twenty-four extra reads to answer a question the six calls cannot. */
const SERIES = process.env.PROBE_SERIES === '1';
/** Long enough to span two weekends and a feriado, which is where a plateau would show up. */
const SERIES_DAYS = 24;

/** One call: what was asked, when it was asked in Argentine time, and what came back. */
interface Call {
    /** Row number in the published table, matching the asks in the contract request. */
    readonly index: string;
    readonly label: string;
    /** `undefined` means the element is omitted entirely -- "give me the latest row". */
    readonly sent: string | undefined;
    hourArt: string;
    rate: number | undefined;
    answeredDay: string;
    codes: Array<string>;
    error: string;
}

function fail(message: string): never {
    console.error('  ' + message);
    process.exit(1);
}

/** Today in ARCA's own calendar. Never `toISOString().slice(0, 10)`: after 21:00 ART that is tomorrow. */
function authorityToday(): string {
    return formatArcaDate(new Date());
}

/** The ART wall clock of THIS moment, to the minute. Recorded per call, not per run. */
function hourArt(): string {
    const parts = argentinaClockParts(new Date());
    return `${parts.hour}:${parts.minute} ART`;
}

/** Day of the week of an ARCA day, 0 = Sunday. Via the shared UTC proxy, so this is not a fourth slice. */
function weekdayOf(arcaDay: string): number {
    return arcaDayToUtcDate(arcaDay).getUTCDay();
}

/** The most recent `weekday` strictly before `from` -- "last Saturday" even when today is Saturday. */
function previousWeekday(from: string, weekday: number): string {
    const back = (weekdayOf(from) - weekday + 7) % 7;
    return shiftArcaDay(from, -(back === 0 ? 7 : back));
}

function names(day: string): string {
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${day} (${WEEKDAYS[weekdayOf(day)] ?? '?'})`;
}

/** The calls the contract request asked for, in its own numbering. */
function plan(): Array<Call> {
    const today = authorityToday();
    const blank = {hourArt: '', rate: undefined, answeredDay: '', codes: [], error: ''};
    return [
        {index: '1', label: 'today', sent: today, ...blank},
        {index: '2', label: 'yesterday', sent: shiftArcaDay(today, -1), ...blank},
        {index: '3', label: 'omitted', sent: undefined, ...blank},
        {index: '4a', label: 'last Saturday', sent: previousWeekday(today, 6), ...blank},
        {index: '4b', label: 'last Sunday', sent: previousWeekday(today, 0), ...blank},
        {index: '5', label: 'a feriado', sent: FERIADO, ...blank},
    ];
}

async function ask(auth: ArcaAuth, call: Call): Promise<void> {
    const service = commonInvoiceService(ARCA_ENVIRONMENT);
    call.hourArt = hourArt();
    try {
        const info = await service.getCurrencyRate(auth, CURRENCY, call.sent);
        call.rate = info.rate;
        call.answeredDay = info.rateDate;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        call.error = message;
        call.codes = Array.from(message.matchAll(/\[(\d+)\]/g)).map((m) => String(m[1]));
    }
}

function outcomeOf(call: Call): string {
    if (call.error !== '') {
        const code = call.codes[0];
        return code === undefined ? call.error.slice(0, 60) : `**\`${code}\`** ${call.error.slice(0, 48)}`;
    }
    if (call.rate === undefined) {
        return 'answered, but no usable `MonCotiz`';
    }
    return `\`MonCotiz ${call.rate}\`, \`FchCotiz ${call.answeredDay}\``;
}

/**
 * Compares the measured offset against the constant this service is running with, printing the literal to
 * paste back: a finding that has to be translated into a code change by hand gets applied wrongly once.
 */
function report(workingDaysBefore: number): void {
    if (RATE_DAY_RULE.workingDaysBeforeVoucher === workingDaysBefore) {
        console.log(
            '  This is what the service already sends (RATE_DAY_RULE.workingDaysBeforeVoucher = ' +
                workingDaysBefore +
                ', measured ' +
                RATE_DAY_RULE.measuredOn +
                ' against ' +
                RATE_DAY_RULE.measuredAgainst +
                '). Nothing to change; update measuredOn if you want this run on the record.',
        );
        return;
    }
    console.log(
        '  THIS DISAGREES WITH THE RUNNING CONSTANT (' +
            RATE_DAY_RULE.workingDaysBeforeVoucher +
            '). Paste into src/providers/arca/mapping/cotizacion/cotizacion.ts:',
    );
    console.log('  export const RATE_DAY_RULE = {');
    console.log('      workingDaysBeforeVoucher: ' + workingDaysBefore + ',');
    console.log('      walkBackLimit: ' + RATE_DAY_RULE.walkBackLimit + ',');
    console.log("      measuredOn: '<today, ISO>',");
    console.log("      measuredAgainst: '" + RATE_DAY_RULE.measuredAgainst + "',");
    console.log('  } as const;');
    console.log('  Then re-read docs/CONTRACT.md §3 on `date`: the guarantee it states is this rule.');
}

/**
 * The verdict, stated rather than inferred -- including when it is "this does not decide it", which is what
 * the 2026-09-01 run produced.
 *
 * Call #1 answering is positive evidence that a row is keyed by the day it applies to, a day that has not
 * closed still having an applicable rate. #1 returning a `602` is ambiguous between "the day has not closed"
 * and "today's row is not loaded at this hour", which only the hour separates — hence the hour in the output
 * and the suggestion to re-run in the evening.
 */
function read(calls: Array<Call>): void {
    const byIndex = new Map(calls.map((c) => [c.index, c]));
    const today = byIndex.get('1');
    const yesterday = byIndex.get('2');
    const latest = byIndex.get('3');
    if (today === undefined || yesterday === undefined || latest === undefined) {
        fail('The plan lost a call; nothing to read.');
    }

    console.log('-- Reading --');
    const todayMissing = today.codes.includes('602');
    const yesterdayAnswered = yesterday.rate !== undefined;

    const weekend = calls.filter((c) => c.index.startsWith('4'));
    const weekendMissing = weekend.length > 0 && weekend.every((c) => c.codes.includes('602'));

    if (weekendMissing) {
        console.log('  ROWS ARE KEYED BY CLOSE, and only business days have them. The weekend decides it:');
        console.log('  under the other reading a SATURDAY must carry a value -- the rate in force on a');
        console.log("  Saturday is Friday's close, and a voucher issued then has to declare something. ARCA");
        console.log('  has no Saturday row at all, so a row is the close OF its day. The day needing a rate');
        console.log('  is therefore priced off the PREVIOUS WORKING DAY: skip weekends, walk feriados.');
        report(1);
    } else if (today.rate !== undefined) {
        console.log('  TODAY HAS A ROW, so a row is keyed by the day it APPLIES to and not by its close: a');
        console.log('  day that has not finished cannot have closed. The voucher day passes through, and');
        console.log("  ARCA's own answer for it is the previous close, which is what 10038 asks for.");
        report(0);
    } else if (todayMissing && yesterdayAnswered) {
        console.log('  NOT DECIDED BY THIS RUN. FchCotiz = today is a 602 while yesterday answers, which');
        console.log('  fits both readings, and the weekend calls did not discriminate either. If you are');
        console.log('  running against homologacion, that is expected -- its series is generated');
        console.log('  (PROBE_SERIES=1 shows a smooth curve over every calendar day, weekends included) and');
        console.log('  no reading taken there can settle this. RUN IT AGAINST PRODUCTION:');
        console.log('    PROBE_ENVIRONMENT=production pnpm probe:cotizacion-day');
        report(RATE_DAY_RULE.workingDaysBeforeVoucher);
    } else {
        console.log('  INCONCLUSIVE. #1 and #2 do not discriminate:');
        console.log('    #1 today     -> ' + (today.error === '' ? String(today.rate) : today.error));
        console.log(
            '    #2 yesterday -> ' + (yesterday.error === '' ? String(yesterday.rate) : yesterday.error),
        );
        console.log(
            '  Do NOT write a day-keying rule out of this run. Re-run at a different hour, or against',
        );
        console.log('  a currency homologacion actually publishes, and publish what was seen either way.');
    }

    console.log('');
    if (latest.rate === undefined) {
        console.log(
            '  #3 (no FchCotiz) did not answer, so "omitting it means the latest row" stays unverified.',
        );
    } else {
        const matches =
            latest.answeredDay === today.answeredDay
                ? '#1'
                : latest.answeredDay === yesterday.answeredDay
                  ? '#2'
                  : 'neither #1 nor #2';
        console.log(
            `  #3 (no FchCotiz) answered FchCotiz ${latest.answeredDay} -- the same row as ${matches}.`,
        );
    }

    const answeredWeekend = weekend.filter((c) => c.rate !== undefined);
    console.log(
        `  #4 weekend: ${answeredWeekend.length} of ${weekend.length} answered` +
            (answeredWeekend.length > 0
                ? ' (' +
                  answeredWeekend.map((c) => c.answeredDay).join(', ') +
                  ') -- unlike production,' +
                  ' so this is generated data and the weekend skip is NOT derived from it'
                : ' -- so weekends are SKIPPED by weekday arithmetic rather than probed, which is what makes' +
                  ' a Monday cost one read instead of three'),
    );

    const feriado = byIndex.get('5');
    if (feriado !== undefined) {
        console.log(
            `  #5 feriado ${names(FERIADO)}: ` +
                (feriado.rate === undefined
                    ? 'no row -- and unlike a weekend this CANNOT be skipped by arithmetic, since nothing ' +
                      'here models feriados. It is what the 602 walk-back exists for.'
                    : `answered FchCotiz ${feriado.answeredDay} -- the walk-back would never fire here.`),
        );
    }
}

/**
 * Prints the rate for every calendar day in a window, so a reader can see whether the data has any market
 * structure at all — the check that stopped a wrong constant being published.
 *
 * A real daily reference rate cannot have a distinct value for a Saturday: something has to be carried
 * forward, and where the run of equal values starts is what distinguishes the two keyings. Against
 * homologacion on 2026-09-01 the series compounded smoothly across two weekends and a feriado, deltas
 * +0.222 rising to +0.244 with no repeat anywhere, so no value-based test can settle the question there.
 * The same twenty-four calls against production would settle it immediately.
 */
async function series(auth: ArcaAuth): Promise<void> {
    const service = commonInvoiceService(ARCA_ENVIRONMENT);
    const from = shiftArcaDay(authorityToday(), -SERIES_DAYS);
    console.log('');
    console.log('-- ' + SERIES_DAYS + ' consecutive days: is there a plateau anywhere? --');
    let previous: number | undefined;
    for (let step = 0; step <= SERIES_DAYS; step += 1) {
        const day = shiftArcaDay(from, step);
        try {
            const info = await service.getCurrencyRate(auth, CURRENCY, day);
            const delta =
                info.rate !== undefined && previous !== undefined
                    ? (info.rate - previous).toFixed(3).padStart(7)
                    : '      -';
            const flat = info.rate !== undefined && info.rate === previous ? '   <-- PLATEAU' : '';
            console.log(
                '  ' + names(day) + '  ' + String(info.rate).padStart(12) + '  delta ' + delta + flat,
            );
            previous = info.rate;
        } catch (err) {
            console.log(
                '  ' + names(day) + '  ' + (err instanceof Error ? err.message : String(err)).slice(0, 40),
            );
            previous = undefined;
        }
    }
    console.log('  What to read here. GAPS on every Saturday, Sunday and feriado (production, 2026-09-01)');
    console.log('  mean rows are business-day CLOSES: nothing closes on a Saturday, and a row that were the');
    console.log(
        '  rate IN FORCE on a Saturday would have to exist, since a voucher issued then declares one.',
    );
    console.log(
        '  A full series with no gap and no repeat anywhere is generated data (homologacion) and can',
    );
    console.log(
        '  settle nothing. A full series WITH a repeat is real and keyed by applicability -- and then',
    );
    console.log('  where the repeat starts decides it: a FRIDAY label means close, a SATURDAY label means');
    console.log('  applicability.');
}

async function main(): Promise<void> {
    // No NODE_ENV guard: this probe writes nothing anywhere, and PROBE_ENVIRONMENT already stops it
    // reaching production by accident.
    if (env.nodeEnv === 'production' && ENVIRONMENT === 'testing') {
        console.log(
            '  (NODE_ENV=production, but asking homologacion -- set PROBE_ENVIRONMENT to change that)',
        );
    }
    if (!isArcaDay(FERIADO)) {
        fail('PROBE_FERIADO must be an ARCA calendar day (yyyymmdd); got "' + FERIADO + '".');
    }

    const delegate = delegateCredentialStore.get(ENVIRONMENT);
    if (delegate === undefined) {
        fail(
            'No delegate certificate configured for `testing`. Set ARCA_DELEGATE_CERT_PATH_TESTING and ' +
                'ARCA_DELEGATE_KEY_PATH_TESTING (see .env.example).',
        );
    }

    console.log('-- Which day is an ARCA cotizacion FOR? --');
    console.log('  environment   : ' + ENVIRONMENT + ' (' + ARCA_ENVIRONMENT + ')');
    console.log('  delegate CUIT : ' + delegate.delegateCuit);
    console.log('  currency      : ' + CURRENCY);
    console.log('  today, ART    : ' + names(authorityToday()) + ', ' + hourArt());
    console.log('  Read-only: six reads of a public number, no vouchers, no numbering consumed.');

    const auth = await ticketStore.resolve(
        'ARCA',
        delegate.delegateCuit,
        ServiceId.WSFEV1,
        ENVIRONMENT,
        undefined,
        true,
    );

    const calls = plan();
    // Sequentially rather than fanned out: each row records its own hour ART, and six concurrent calls
    // would all stamp the same minute.
    for (const call of calls) {
        await ask(auth, call);
    }

    console.log('');
    console.log('-- Paste into docs/CONTRACT-CHANGES.md --');
    console.log('');
    console.log('| # | `FchCotiz` sent | hour ART | result |');
    console.log('| --- | --- | --- | --- |');
    for (const call of calls) {
        const sent = call.sent === undefined ? '*omitted*' : '`' + names(call.sent) + '`';
        console.log(`| ${call.index} | ${sent} | ${call.hourArt} | ${outcomeOf(call)} |`);
    }
    console.log('');

    read(calls);

    if (SERIES) {
        await series(auth);
    }
}

await main();
