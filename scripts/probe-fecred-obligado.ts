/**
 * Asks WSFECRED whether a receiver is obligated to be sent a Factura de Crédito Electrónica, printing the
 * outgoing envelope and the raw answer.
 *
 * **Most of what this script was written to settle, the WSDL already settled.** `<endpoint>?wsdl` is public
 * and needs no certificate, and reading it on 2026-09-17 fixed the endpoint, the namespace, the element
 * form, the auth element, the request and response element names, the date type and the fact that errors
 * arrive in-payload. Anything in `sdk/fecred/` that looks wrong should be checked against the WSDL first —
 * it is free, and it is authoritative about shape.
 *
 * What a WSDL cannot tell you, and this script can:
 *
 *   - **Whether our delegate certificate is enrolled for `wsfecred` at all.** Enrolment is independent of
 *     `wsfe`, so one good for issuing vouchers still fails this login with `coe.notAuthorized`. This is
 *     the first thing to run after requesting the grant.
 *   - **Whether the service answers about an arbitrary receiver under our own identity**, or expects some
 *     relationship with the CUIT being asked about. The schema calls the field `cuitConsultada` and asks
 *     for no relationship, but a schema cannot express a business rule the server still enforces.
 *   - **What a real answer looks like** — whether `obligado` and `montoDesde` are actually populated for a
 *     known empresa grande, and what the authority returns for a CUIT it does not hold.
 *   - **Which business codes come back in `arrayErrores`**, particularly for an unrecognised receiver. Not
 *     needed today: an unclassified rejection falls through to the offline registry and is answered
 *     `obligated: false` from there, which is the same verdict, honestly labelled. A measured code would
 *     only let the authority answer it directly.
 *   - **Which codes belong in the credential-fault dispatch table.** The WSDL says the channel is
 *     in-payload; it does not say which numbers mean a bad ticket versus a missing grant, and guessing
 *     those is what evicts a ticket ARCA will not re-mint for ~12h.
 *
 * Read-only: one query, no vouchers, no numbering consumed.
 *
 * Usage:
 *
 *   pnpm probe:fecred                                              # homologacion, built-in sample CUIT
 *   PROBE_RECEIVER=30711111119 pnpm probe:fecred                   # ask about this receiver
 *   PROBE_ISSUE_DATE=2026-09-17 pnpm probe:fecred                  # judge against that day's régimen
 *   PROBE_ENVIRONMENT=production pnpm probe:fecred                 # the real register
 *
 * Requires the ARCA_DELEGATE_CERT_PATH_* / ARCA_DELEGATE_KEY_PATH_* pair (see .env.example).
 */
import 'reflect-metadata';
import {ENDPOINTS, Namespaces, ServiceId} from '../src/providers/arca/sdk/core/constants.js';
import {soap} from '../src/providers/arca/clients.js';
import {FeCredService} from '../src/providers/arca/sdk/fecred/fecred-service/fecred.service.js';
import {ticketStore} from '../src/providers/arca/auth/ticket-store/ticket-store.js';
import {delegateCredentialStore} from '../src/providers/arca/auth/delegate-credentials/delegate-credentials.js';
import {toArcaEnvironment} from '../src/providers/arca/auth/environment/environment.js';
import {arcaDayToIsoDate, toArcaDay} from '../src/providers/arca/mapping/authority-day/authority-day.js';
import type {GenericEnvironment} from '../src/providers/provider/environment.js';
import type {ArcaAuth} from '../src/providers/arca/sdk/core/types.js';

const ENVIRONMENT: GenericEnvironment =
    process.env.PROBE_ENVIRONMENT === 'production' ? 'production' : 'testing';
const RECEIVER = process.env.PROBE_RECEIVER ?? '30711111119';
const ISSUE_DATE = process.env.PROBE_ISSUE_DATE ?? new Date().toISOString().slice(0, 10);

/**
 * The production service, reporting the envelope it built.
 *
 * Subclassed only to log — nothing is overridden, so the thing being probed is exactly the thing that
 * ships. The element form and the auth shape used to be knobs here, because both were guesses and this
 * script existed partly to bisect them. The WSDL settled both, so offering to vary them now would only
 * invite an edit that breaks a client known to match the schema.
 */
class ProbeService extends FeCredService {
    lastPayload: Record<string, unknown> = {};

    protected override async invoke(
        operation: string,
        payload: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        this.lastPayload = payload;
        console.log('  operation   : ' + operation);
        console.log('  elementForm : ' + this.elementForm);
        console.log('  payload     : ' + JSON.stringify(payload, null, 2).replace(/\n/g, '\n                '));
        return super.invoke(operation, payload);
    }
}

async function attempt(auth: ArcaAuth): Promise<boolean> {
    const service = new ProbeService(soap, toArcaEnvironment(ENVIRONMENT));
    try {
        const info = await service.receptionObligation(auth, {
            receiverTaxId: Number(RECEIVER),
            issueDate: arcaDayToIsoDate(toArcaDay(ISSUE_DATE, 'PROBE_ISSUE_DATE')),
        });
        console.log('');
        console.log('  obligado    : ' + String(info.obligated));
        console.log('  montoDesde  : ' + String(info.thresholdAmount));
        console.log('  raw         : ' + JSON.stringify(info.raw, null, 2).replace(/\n/g, '\n                '));
        if (info.obligated === undefined || (info.obligated && info.thresholdAmount === undefined)) {
            console.log('');
            console.log('  ^ The call succeeded and came back with a field absent. The schema permits that');
            console.log('    — both are `minOccurs="0"` — so this is the authority declining to state one');
            console.log('    rather than a parse failure. Record what `raw` above holds for this receiver.');
        }
        return true;
    } catch (err) {
        console.log('');
        console.log('  FAILED: ' + String(err));
        return false;
    }
}

async function main(): Promise<void> {
    const arcaEnvironment = toArcaEnvironment(ENVIRONMENT);

    console.log('-- wsfecred obligado --');
    console.log('  environment : ' + ENVIRONMENT + ' (' + arcaEnvironment + ')');
    console.log('  endpoint    : ' + ENDPOINTS[arcaEnvironment].wsfecred + '   <- from the WSDL');
    console.log('  namespace   : ' + Namespaces.WSFECRED + '   <- from the WSDL');
    console.log('  receiver    : ' + RECEIVER);
    console.log('  issueDate   : ' + ISSUE_DATE);
    console.log('  Read-only: one query, no vouchers, no numbering consumed.');
    console.log('');

    const delegate = delegateCredentialStore.get(ENVIRONMENT);
    if (delegate === undefined) {
        console.error('  No delegate certificate configured for ' + ENVIRONMENT + ' (see .env.example).');
        process.exit(1);
    }

    let auth: ArcaAuth;
    try {
        auth = await ticketStore.resolve(
            'ARCA',
            delegate.delegateCuit,
            ServiceId.WSFECRED,
            ENVIRONMENT,
            undefined,
            true,
        );
    } catch (err) {
        console.error('  WSAA login for wsfecred failed: ' + String(err));
        console.error('');
        console.error('  If this says `coe.notAuthorized` or "computador no autorizado", the certificate is');
        console.error('  simply not enrolled for `wsfecred` — enrolment is per service and independent of');
        console.error('  `wsfe`. Grant it in WSASS (homologación) or Administrador de Relaciones');
        console.error('  (producción) and re-run. Nothing below can be measured until that is done.');
        process.exit(1);
    }

    console.log('  WSAA ticket obtained for wsfecred (delegate CUIT ' + delegate.delegateCuit + ').');
    console.log('  ^ So our own delegate identity CAN hold a wsfecred ticket. Whether it may ask about an');
    console.log('    ARBITRARY receiver is what the call below settles.');
    console.log('');

    if (await attempt(auth)) {
        return;
    }

    console.log('');
    console.log('  The WSAA ticket was good and the call still failed, which rules out enrolment and');
    console.log('  points at the one question the WSDL could not answer: whether the service answers');
    console.log('  about an ARBITRARY receiver under our own identity, or expects a relationship with');
    console.log('  the CUIT being asked about. Read the fault or the `arrayErrores` codes above and');
    console.log('  record it in docs/CONTRACT-CHANGES.md — that answer decides whether this endpoint');
    console.log('  can stay credential-free.');
    console.log('');
    console.log('  Do NOT reach for the element form or the auth shape. Both were read from the WSDL on');
    console.log('  2026-09-17, and changing them would break a client known to match the schema. If the');
    console.log('  envelope really is at fault, re-read `<endpoint>?wsdl` — it is public and free —');
    console.log('  rather than bisecting by hand.');
    process.exit(1);
}

main().catch((err: unknown) => {
    console.error(String(err));
    process.exit(1);
});
