import {ArcaValidationError} from '../../sdk/core/errors.js';
import type {PointOfSaleInfo} from '../../sdk/core/types.js';
import {buildArcaQrUrl, formatArcaDate, parseArcaDate} from '../../sdk/invoicing/arca-qr/arca-qr.js';
import type {
    CommonInvoiceRequest,
    CommonInvoiceResult,
} from '../../sdk/invoicing/common/common-invoice.types.js';
import {
    calculateTotals,
    roundToTwo,
    type InvoiceLineTax,
    type InvoiceTotals,
} from '../../sdk/invoicing/invoice-totals/invoice-totals.js';
import {
    isNonVatDiscriminating,
    toCbteTipo,
    toCondicionIvaReceptorId,
    toDocTipo,
} from '../code-maps/code-maps.js';
import {toMonId} from '../currency-codes/currency-codes.js';
// Shared with the cotización path so the two can never disagree about which day a value names. A zoneless
// datetime is refused rather than passed to `new Date`, which is host-local per the ES spec — that made the
// voucher's legal date depend on the container's `TZ`.
import {isArcaDay, parseAuthorityDate} from '../authority-day/authority-day.js';
import {parseArcaId} from '../identifiers.js';
import type {NeutralInvoice} from '../../../provider/neutral-invoice.js';
import type {
    NeutralAuthorizationResultDto,
    NeutralAuthorizationStatus,
} from '../../../../http/dto/authorization-result.dto.js';
import type {PointOfSaleDto} from '../../../../http/dto/points-of-sale-result.dto.js';

/**
 * Argentina-specific translation from the neutral invoice to the SDK's request, plus the RG-4892 QR and the
 * neutral result: canonical-code→ARCA-code, VAT%→id, totals, perceptions→`Tributos`, dates, QR.
 */

/*
 * The deprecated ISO currency bridge. `no-deprecated` is off for this block only, since everything in it is
 * the migration bridge itself and the rule would fire on the code whose job is to keep `currencyIso`
 * working. The @deprecated tags are what make a caller's IDE strike the field through, so they stay.
 * Delete the block, the tags, and this comment together when `currencyIso` goes.
 */
/* eslint-disable @typescript-eslint/no-deprecated */
/**
 * ISO-4217 → ARCA `MonId`.
 *
 * @deprecated Superseded by `invoice.currencyCode` + `toMonId`, which carries the authority's own code
 * instead of translating one. Three entries against ARCA's forty-nine, so every currency a caller could not
 * bill was a change to this service — and ISO cannot express the catalogue at all: `DOL` and `002` (the
 * blue) are both `USD` at different published rates, and `049` (Gramos de Oro Fino) has no ISO code.
 *
 * Kept only while `currencyIso` is still accepted.
 */
const ISO_TO_ARCA_CURRENCY: Readonly<Record<string, string>> = {
    ARS: 'PES',
    USD: 'DOL',
    EUR: '060',
};

/** @deprecated Use `toMonId(invoice.currencyCode)` instead. */
function resolveCurrencyId(iso: string): string {
    const key = iso.toUpperCase();
    if (!Object.hasOwn(ISO_TO_ARCA_CURRENCY, key)) {
        throw new ArcaValidationError(`Unsupported currency "${iso}" (no ARCA MonId mapping)`, 'UNMAPPED_CURRENCY');
    }
    return ISO_TO_ARCA_CURRENCY[key];
}

/**
 * The ARCA `MonId` for this invoice, from whichever of the two currency fields it carries.
 *
 * The DTO guarantees exactly one is present, so this is a preference in name only — a silent fallback would
 * let a caller bug sending both produce a peso voucher for a dollar sale. The final `throw` is only
 * reachable by an internal caller that bypassed validation.
 *
 * `!= null` rather than `!== undefined`, so a `null` reads as "no currency" here as it does in the DTO. Read
 * strictly it would reach `toMonId` and throw a `TypeError` off `.trim()` — a `500` where this `throw` is
 * the `400` the case calls for.
 */
function invoiceCurrencyId(invoice: NeutralInvoice): string {
    if (invoice.currencyCode != null) {
        return toMonId(invoice.currencyCode);
    }
    if (invoice.currencyIso != null) {
        return resolveCurrencyId(invoice.currencyIso);
    }
    throw new ArcaValidationError(
        "invoice names no currency — send currencyCode (the authority's own code)",
        'UNMAPPED_CURRENCY',
    );
}
/* eslint-enable @typescript-eslint/no-deprecated */

/** The AR calendar day `date` falls on, as epoch ms at AR midnight — the unit ARCA's window is expressed in. */
function argentinaMidnight(date: Date): number {
    return parseArcaDate(formatArcaDate(date)).getTime();
}

/**
 * An error when `date` falls outside AFIP's ±5-day concept-1 `CbteFch` window, `undefined` when it is
 * inside. An out-of-window date is refused rather than clamped to `now`, so the caller can correct
 * `issueDate` instead of getting a CAE for a date it never sent — which also keeps idempotent recovery's
 * `CbteFch` comparison meaningful.
 *
 * Compared as AR calendar days, matching how ARCA states the rule. A raw millisecond difference against the
 * noon-AR anchor would make a date exactly 5 days out pass in the morning and fail in the afternoon.
 *
 * Returned rather than thrown so the caller can let idempotent recovery run first: a delayed resend of an
 * already-authorized voucher must still get its CAE back.
 */
export function concept1DateWindowError(invoice: NeutralInvoice, now: Date): ArcaValidationError | undefined {
    if (invoice.concept !== 1) {
        return undefined;
    }
    const date = parseAuthorityDate(invoice.issueDate, 'issueDate');
    const diffDays = Math.abs(argentinaMidnight(now) - argentinaMidnight(date)) / 86_400_000;
    if (diffDays <= 5) {
        return undefined;
    }
    return new ArcaValidationError(
        `issueDate ${formatArcaDate(date)} is outside ARCA's ±5-day window for concept 1 (productos); ` +
            `authorization date is ${formatArcaDate(now)}`,
        'VOUCHER_DATE_OUT_OF_WINDOW',
    );
}

/**
 * Totals for a voucher that may not discriminate VAT (letter C). Every line's net and its VAT fold into
 * `ImpNeto` along with the untaxed and exempt amounts, which must themselves be zero for a type C. `ImpIVA`
 * is zero and the subtotals are empty, which is what makes the service omit the element entirely.
 *
 * Satisfies ARCA's `ImpTotal = ImpNeto + ImpTrib` (10048) once the caller adds the tributes. Deliberately
 * not the legacy `ImpNeto = ImpTotal`, which is only correct with no perceptions and otherwise overstates
 * the net by exactly the tributes, re-triggering 10048.
 *
 * The fold also happens before any alícuota lookup, so a rate ARCA has no id for never reaches the rate map
 * on a type C.
 */
function collapsedTotals(
    lines: ReadonlyArray<InvoiceLineTax>,
    untaxed: number,
    exempt: number,
): InvoiceTotals {
    const netTaxed = roundToTwo(
        lines.reduce((sum, line) => sum + line.netAmount + line.vatAmount, 0) + untaxed + exempt,
    );

    return {netTaxed, vat: 0, subtotals: []};
}

/**
 * Builds the WSFEv1 authorization request for `voucherNumber`. Pure and clock-free: the one time-dependent
 * rule, the concept-1 `CbteFch` window, is `concept1DateWindowError`'s and the caller applies it separately.
 */
export function buildCommonInvoiceRequest(invoice: NeutralInvoice, voucherNumber: number): CommonInvoiceRequest {
    const voucherType = toCbteTipo(invoice.documentTypeCode);

    const lines: Array<InvoiceLineTax> = invoice.lines.map((l) => ({
        vatRatePercent: l.taxRatePercent,
        netAmount: l.netAmount,
        vatAmount: l.taxAmount,
    }));

    const requestedUntaxed = invoice.totals?.untaxed ?? 0;
    const requestedExempt = invoice.totals?.exempt ?? 0;
    const perceptions = invoice.totals?.perceptions ?? 0;

    // A letter-C voucher reports no VAT: its issuer has no débito fiscal, so there is nothing to separate
    // out and ARCA refuses any attempt to (10047 / 10048 / 10071). The caller's own breakdown is left
    // untouched, since core tracks a net/VAT split for costing and whether it is reportable is our rule.
    const collapseVat = isNonVatDiscriminating(voucherType);

    const totals = collapseVat ? collapsedTotals(lines, requestedUntaxed, requestedExempt) : calculateTotals(lines);
    const netUntaxed = collapseVat ? 0 : requestedUntaxed;
    const exempt = collapseVat ? 0 : requestedExempt;

    const totalAmount = roundToTwo(totals.netTaxed + totals.vat + netUntaxed + exempt + perceptions);

    // Perceptions collapse into a single "Otros" (id 99) tribute over the taxed net, since core has no
    // per-perception breakdown. On a letter C that net is the collapsed one, so the base carries the VAT the
    // caller reported — which is the right base, the whole sale being what the perception was levied on.
    // `BaseImp`/`Alic` are informational to ARCA but are what gets printed.
    const tributes: CommonInvoiceRequest['tributes'] =
        perceptions > 0
            ? [
                  {
                      id: 99,
                      description: 'Percepciones',
                      baseAmount: totals.netTaxed,
                      rate: totals.netTaxed > 0 ? roundToTwo((perceptions / totals.netTaxed) * 100) : 0,
                      amount: perceptions,
                  },
              ]
            : undefined;

    // Building the request never rejects on the date: the ±5-day concept-1 check is the caller's, applied
    // after idempotent recovery has had its chance.
    const issueDate = parseAuthorityDate(invoice.issueDate, 'issueDate');

    const request: CommonInvoiceRequest = {
        pointOfSaleNumber: invoice.pointOfSaleNumber,
        voucherType,
        concept: invoice.concept,
        docType: toDocTipo(invoice.receiver.identificationTypeCode),
        docNumber: parseArcaId(invoice.receiver.identificationNumber, 'receiver.identificationNumber'),
        voucherNumberFrom: voucherNumber,
        voucherNumberTo: voucherNumber,
        voucherDate: formatArcaDate(issueDate),
        totalAmount,
        netUntaxed,
        netTaxed: totals.netTaxed,
        exempt,
        vatAmount: totals.vat,
        tributesAmount: perceptions,
        receiverIvaConditionId: toCondicionIvaReceptorId(invoice.receiver.fiscalConditionCode),
        currencyId: invoiceCurrencyId(invoice),
        currencyRate: invoice.currencyRate,
        vatSubtotals: totals.subtotals,
        tributes,
    };

    // Services (concept 2/3) require the FchServ*/FchVtoPago dates. `!= null` for the same reason
    // `invoiceCurrencyId` uses it: a `null` that slipped past validation would throw a `TypeError` off
    // `.trim()`, and an omitted element is the honest rendering of a field the caller left blank.
    if (invoice.concept !== 1) {
        if (invoice.serviceDateFrom != null) {
            request.serviceDateFrom = formatArcaDate(parseAuthorityDate(invoice.serviceDateFrom, 'serviceDateFrom'));
        }
        if (invoice.serviceDateTo != null) {
            request.serviceDateTo = formatArcaDate(parseAuthorityDate(invoice.serviceDateTo, 'serviceDateTo'));
        }
        if (invoice.paymentDueDate != null) {
            request.paymentDueDate = formatArcaDate(parseAuthorityDate(invoice.paymentDueDate, 'paymentDueDate'));
        }
    }

    return request;
}

/** The RG-4892 QR URL for an authorized voucher. */
export function buildQrUrl(issuerTaxId: string, request: CommonInvoiceRequest, cae: string): string {
    return buildArcaQrUrl({
        date: parseArcaDate(request.voucherDate),
        cuit: Number(issuerTaxId),
        pointOfSaleNumber: request.pointOfSaleNumber,
        voucherType: request.voucherType,
        voucherNumber: request.voucherNumberFrom,
        totalAmount: request.totalAmount,
        currencyId: request.currencyId,
        currencyRate: request.currencyRate,
        docType: request.docType,
        docNumber: request.docNumber,
        cae,
    });
}

function statusOf(result: CommonInvoiceResult['result']): NeutralAuthorizationStatus {
    if (result === 'A') {
        return 'AUTHORIZED';
    }
    return result === 'P' ? 'PARTIAL' : 'REJECTED';
}

/**
 * Maps the SDK result and optional QR into the neutral authorization result. `providerMetadata` is always
 * returned, empty by default — ARCA derives none today, but the channel is stable for core.
 */
export function toNeutralResult(
    result: CommonInvoiceResult,
    qr?: string,
    providerMetadata: Record<string, unknown> = {},
): NeutralAuthorizationResultDto {
    return {
        authorizationCode: result.cae ?? '',
        // Guarded rather than a bare `parseArcaDate(...).toISOString()`, which threw on any `CAEFchVto` the
        // parser could not read — a `500` on an authorization that succeeded at ARCA, losing the CAE.
        expiration: result.caeExpiration !== undefined ? arcaDateToIso(result.caeExpiration) : '',
        authorizedNumber: result.voucherNumberFrom,
        qr,
        status: statusOf(result.result),
        observations: result.observations,
        providerMetadata,
    };
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
function arcaDateToIso(yyyymmdd: string): string {
    return isArcaDay(yyyymmdd) ? parseArcaDate(yyyymmdd.trim()).toISOString() : yyyymmdd;
}

/** Maps one SDK point of sale to the neutral DTO; `dischargeDate` (ARCA `yyyymmdd`) is rendered ISO-8601. */
export function toNeutralPointOfSale(info: PointOfSaleInfo): PointOfSaleDto {
    return {
        number: info.number,
        issuanceMode: info.issuanceMode,
        blocked: info.blocked,
        dischargeDate: info.dischargeDate !== undefined ? arcaDateToIso(info.dischargeDate) : undefined,
    };
}
