import {parseArcaDate} from '../sdk/invoicing/arca-qr/arca-qr.js';
import {isArcaDay} from './authority-day/authority-day.js';
import type {
    NeutralAuthorizationResultDto,
    NeutralAuthorizationStatus,
    NeutralObservation,
} from '../../../http/dto/authorization-result.dto.js';

/**
 * Reading an authorization answer, shared by both of ARCA's invoicing services.
 *
 * The two documents disagree about almost everything and agree about this: an approval code, when it
 * expires, a status letter, and a list of observations. Written once per service, the three readers below
 * were byte-identical copies — and the reasoning each carries is the kind that is expensive to rediscover
 * and invisible when it goes missing, so a second copy is a second place for it to rot. Same seam
 * `catalogue-rows` and `codeMsgPairs` already put under the two services' table and error readers.
 *
 * What stays per-service is what genuinely differs: which field holds the voucher number, and whether the
 * document has a QR at all.
 */

/**
 * The answer fields both services produce, whatever each spells them on the wire. A structural type rather
 * than a union of the two result interfaces: this module has no business knowing either.
 */
export interface AuthorityVoucherResult {
    readonly result: 'A' | 'R' | 'P';
    readonly cae?: string;
    readonly caeExpiration?: string;
    readonly observations: Array<NeutralObservation>;
}

/** ARCA's `Resultado` letter as the neutral status. */
export function statusOf(result: AuthorityVoucherResult['result']): NeutralAuthorizationStatus {
    if (result === 'A') {
        return 'AUTHORIZED';
    }
    return result === 'P' ? 'PARTIAL' : 'REJECTED';
}

/**
 * Renders an ARCA `yyyymmdd` date as an ISO-8601 instant, surfacing an unexpected format verbatim rather
 * than an invalid date.
 *
 * Gated on `isArcaDay` rather than a local `\d{8}` test and a `NaN` probe. The two are not the same
 * question: `20261345` passes eight digits and only fails at the parse, so the old form fell through to the
 * verbatim branch and shipped `"20261345"` in a field the contract calls ISO-8601 — non-empty, so
 * `/invoices/authorize` still read the voucher as approved. `isArcaDay` is the one reading of an authority
 * day, and it is what the cotización path already refuses that value by.
 *
 * The `trim` is load-bearing, not tidying: `isArcaDay` matches the trimmed value while `parseArcaDate`
 * slices the raw one, so ` 20260827` passed the guard and then sliced to `" 202"-"60"-"82"`, an Invalid Date
 * whose `toISOString` throws — a `500` on an authorization ARCA had already granted. Trimming makes the two
 * read the same string, which is also what makes a `NaN` re-check unnecessary rather than merely absent: a
 * value this guard admits is eight digits naming a real day, so the parse cannot fail.
 */
export function arcaDateToIso(yyyymmdd: string): string {
    return isArcaDay(yyyymmdd) ? parseArcaDate(yyyymmdd.trim()).toISOString() : yyyymmdd;
}

/**
 * The neutral authorization result. `authorizedNumber` and `qr` are the caller's because they are the whole
 * of what the two documents do not share — WSFEv1 answers a voucher *range* and carries an RG-4892 QR, while
 * WSFEX answers one `Cbte_nro` and has no QR format specified for it.
 *
 * An absent `qr` omits the key rather than setting it to `undefined`. That distinction is asserted — the
 * export mapper's "emits no QR" test reads `not.toHaveProperty('qr')` — and it is the right reading: a
 * document with no QR format has no such field, where a domestic voucher that simply was not approved has
 * one that is empty.
 */
export function toNeutralAuthorizationResult(
    result: AuthorityVoucherResult,
    authorizedNumber: number,
    providerMetadata: Record<string, unknown>,
    qr?: string,
): NeutralAuthorizationResultDto {
    return {
        authorizationCode: result.cae ?? '',
        // Guarded rather than a bare parse, so an expiration ARCA rendered unexpectedly surfaces verbatim
        // instead of throwing a 500 over an authorization that succeeded.
        expiration: result.caeExpiration !== undefined ? arcaDateToIso(result.caeExpiration) : '',
        authorizedNumber,
        ...(qr === undefined ? {} : {qr}),
        status: statusOf(result.result),
        observations: result.observations,
        providerMetadata,
    };
}
