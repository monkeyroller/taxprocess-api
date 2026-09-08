/**
 * Drives the real `FexInvoiceService` against ARCA over its read-only operations, so the service class is
 * exercised against the authority rather than only against a fake transport.
 *
 * What it settles that a unit test cannot:
 *
 *   - `FEXDummy`'s element names. The manual does not give them, and the parser assumes WSFEv1's
 *     `AppServer`/`DbServer`/`AuthServer`. Blank values here mean that assumption is wrong.
 *   - Whether the certificate is enrolled for `wsfex` at all. A certificate good for `wsfe` alone fails the
 *     WSAA login with `coe.notAuthorized`, not with an empty answer.
 *   - Whether a FEEWS point of sale exists. WSFEv1's points of sale do not work for export vouchers, and a
 *     Factura E cannot be issued until one of the export kind is registered.
 *   - The current `FEXGetLast_ID` and `FEXGetLast_CMP`, which are what core seeds its request-id sequence
 *     and its numbering from.
 *
 * Read-only: no vouchers, no numbering consumed. `FEXAuthorize` is deliberately not called here.
 *
 * Usage:
 *
 *   pnpm probe:wsfex-smoke                                  # homologacion
 *   PROBE_ENVIRONMENT=production pnpm probe:wsfex-smoke      # the real register
 *   PROBE_POINT_OF_SALE=3 pnpm probe:wsfex-smoke             # ask FEXGetLast_CMP about this one
 *
 * Requires the ARCA_DELEGATE_CERT_PATH_* / ARCA_DELEGATE_KEY_PATH_* pair (see .env.example).
 */
import 'reflect-metadata';
import {ServiceId} from '../src/providers/arca/sdk/core/constants.js';
import {fexInvoiceService} from '../src/providers/arca/clients.js';
import {ticketStore} from '../src/providers/arca/auth/ticket-store/ticket-store.js';
import {delegateCredentialStore} from '../src/providers/arca/auth/delegate-credentials/delegate-credentials.js';
import {toArcaEnvironment} from '../src/providers/arca/auth/environment/environment.js';
import type {GenericEnvironment} from '../src/providers/provider/environment.js';
import type {ArcaAuth} from '../src/providers/arca/sdk/core/types.js';

const ENVIRONMENT: GenericEnvironment =
    process.env.PROBE_ENVIRONMENT === 'production' ? 'production' : 'testing';

/** The export voucher types, which are the only ones `FEXGetLast_CMP` accepts (1606). */
const VOUCHER_TYPES = [19, 20, 21];

function fail(message: string): never {
    console.error('  ' + message);
    process.exit(1);
}

async function main(): Promise<void> {
    const service = fexInvoiceService(toArcaEnvironment(ENVIRONMENT));

    console.log('-- wsfex smoke --');
    console.log('  environment : ' + ENVIRONMENT + ' (' + toArcaEnvironment(ENVIRONMENT) + ')');
    console.log('  Read-only: no vouchers authorized, no numbering consumed.');
    console.log('');

    // Unauthenticated, so it separates "the service is down" from "our certificate is not enrolled".
    const status = await service.getServerStatus();
    console.log('  FEXDummy    : ' + JSON.stringify(status));
    if (Object.values(status).every((value) => value === '')) {
        console.log('    ^ every field blank: FEXDummy does not use WSFEv1 element names. Fix the parser.');
    }
    console.log('');

    const delegate = delegateCredentialStore.get(ENVIRONMENT);
    if (delegate === undefined) {
        fail(
            `No delegate certificate configured for \`${ENVIRONMENT}\`. Set the ARCA_DELEGATE_CERT_PATH_* ` +
                'and ARCA_DELEGATE_KEY_PATH_* pair for it (see .env.example).',
        );
    }

    // A wsfex ticket, not a wsfe one: WSAA issues per service and wsfev1's ticket is rejected here.
    const auth: ArcaAuth = await ticketStore.resolve(
        'ARCA',
        delegate.delegateCuit,
        ServiceId.WSFEXV1,
        ENVIRONMENT,
        undefined,
        true,
    );
    console.log('  ticket      : wsfex ok for CUIT ' + String(auth.cuit));
    console.log('');

    const pointsOfSale = await service.getPointsOfSale(auth);
    console.log('  FEXGetPARAM_PtoVenta (the FEEWS register, not WSFEv1\'s):');
    if (pointsOfSale.length === 0) {
        console.log('    none registered — a Factura E cannot be issued until one of the export kind is.');
    }
    for (const pointOfSale of pointsOfSale) {
        console.log(
            `    ${String(pointOfSale.number).padStart(5, '0')}  blocked=${String(pointOfSale.blocked)}` +
                `  dischargeDate=${pointOfSale.dischargeDate ?? '-'}`,
        );
    }
    console.log('');

    const lastRequestId = await service.getLastRequestId(auth);
    console.log('  FEXGetLast_ID: ' + String(lastRequestId) + '  (core seeds its sequence above this)');
    console.log('');

    const asked = process.env.PROBE_POINT_OF_SALE;
    const target = asked === undefined ? pointsOfSale[0]?.number : Number(asked);
    if (target === undefined) {
        console.log('  FEXGetLast_CMP skipped: no point of sale to ask about.');
        return;
    }
    console.log(`  FEXGetLast_CMP for point of sale ${String(target)}:`);
    for (const voucherType of VOUCHER_TYPES) {
        try {
            const last = await service.getLastAuthorizedNumber(auth, target, voucherType);
            console.log(`    ${String(voucherType)}: last=${String(last)}  next=${String(last + 1)}`);
        } catch (err) {
            console.log(`    ${String(voucherType)}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

await main();
