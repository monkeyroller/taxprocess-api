import {
    ArcaValidationError,
    buildArcaQrUrl,
    calculateTotals,
    formatArcaDate,
    parseArcaDate,
    roundToTwo,
    type CommonInvoiceRequest,
    type CommonInvoiceResult,
    type InvoiceLineTax,
    type InvoiceTotals,
    type PointOfSaleInfo,
} from '../../sdk/index.js';
import {isNonVatDiscriminating, toCbteTipo, toCondicionIvaReceptorId, toDocTipo} from '../code-maps/code-maps.js';
import {parseArcaId} from '../identifiers.js';
import type {NeutralInvoice} from '../../../provider/provider.js';
import type {
    NeutralAuthorizationResultDto,
    NeutralAuthorizationStatus,
    PointOfSaleDto,
} from '../../../../http/dto/neutral-result.dto.js';

/**
 * Argentina-specific translation from the neutral invoice (carrying canonical taxprocess codes) to the
 * SDK's {@link CommonInvoiceRequest}, plus the RG-4892 QR and the neutral result. Ported from
 * `webprocess-api/src/app/services/protected/transactions/electronic-invoice.service.ts:43-203`.
 *
 * This module owns the entity-specific translation: canonical-code→ARCA-code (via
 * {@link file://./code-maps.ts}) plus the mechanical mapping (ISO→`MonId`, VAT%→id, totals,
 * perceptions→`Tributos`, dates, QR).
 */

/**
 * ISO-4217 → ARCA `MonId`. The ARCA catalog is small; a larger deployment would source this from
 * `FEParamGetTiposMonedas`. An unmapped currency is rejected (never silently billed as pesos, which —
 * combined with the caller's non-1 rate — would produce a wrong invoice).
 */
const ISO_TO_ARCA_CURRENCY: Readonly<Record<string, string>> = {
    ARS: 'PES',
    USD: 'DOL',
    EUR: '060',
};

function resolveCurrencyId(iso: string): string {
    const key = iso.toUpperCase();
    if (!Object.hasOwn(ISO_TO_ARCA_CURRENCY, key)) {
        throw new ArcaValidationError(`Unsupported currency "${iso}" (no ARCA MonId mapping)`, 'UNMAPPED_CURRENCY');
    }
    return ISO_TO_ARCA_CURRENCY[key];
}

/**
 * Parses an ISO issue date into a Date anchored to Argentina local time. A date-only value
 * (`YYYY-MM-DD`) is pinned to noon AR so `formatArcaDate` (which renders in AR time) can never shift
 * it to the neighbouring day.
 *
 * Rejects a value the `Date` parser can't read: `@IsISO8601` is non-strict, so week (`2026-W01-1`),
 * ordinal (`2026-366`), basic (`20260231`) and space-separated forms all reach us and yield an
 * `Invalid Date`. Left unchecked it survives every arithmetic comparison (`NaN` compares false) and only
 * blows up inside `formatArcaDate` as a `RangeError` → an opaque `500`; caught here it is a `400` naming
 * the field.
 */
function parseIssueDate(iso: string, field = 'issueDate'): Date {
    const date = new Date(iso.includes('T') ? iso : `${iso}T12:00:00-03:00`);
    if (Number.isNaN(date.getTime())) {
        throw new ArcaValidationError(`${field} "${iso}" is not a usable ISO-8601 date`, 'INVALID_ISSUE_DATE');
    }
    return date;
}

/** The AR calendar day `date` falls on, as epoch ms at AR midnight — the unit ARCA's window is expressed in. */
function argentinaMidnight(date: Date): number {
    return parseArcaDate(formatArcaDate(date)).getTime();
}

/**
 * Returns an {@link ArcaValidationError} when `date` falls outside ±5 days of `now` — AFIP's Concepto-1
 * `CbteFch` window — or `undefined` when it is inside. Contract change 2026-08-20: previously clamped an
 * out-of-window date to `now` and authorized under a date core never sent; now refused
 * (`VOUCHER_DATE_OUT_OF_WINDOW`) so the caller can correct `issueDate` instead of getting a CAE for a
 * different date than the one it requested — which also keeps idempotent recovery's `CbteFch` comparison
 * ({@link file://./arca.provider.ts}) meaningful, since the stored date now always equals what core sent.
 *
 * Compared as AR **calendar** days, matching how ARCA states the rule and how `CbteFch` is rendered. A raw
 * millisecond difference against the noon-AR anchor would make a date exactly 5 days out pass in the
 * morning and fail in the afternoon — the same invoice accepted or refused by the hour of day.
 *
 * Returned rather than thrown so the caller can let idempotent recovery run first: a delayed resend of an
 * already-authorized voucher must still get its CAE back, not a date rejection (see `authorizeInvoice`).
 */
export function concept1DateWindowError(invoice: NeutralInvoice, now: Date): ArcaValidationError | undefined {
    if (invoice.concept !== 1) {
        return undefined;
    }
    const date = parseIssueDate(invoice.issueDate);
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
 * Totals for a voucher that may not discriminate VAT (letter C).
 *
 * Every line's net AND its VAT fold into `ImpNeto`, together with the untaxed and exempt amounts the caller
 * reported — for a type C those two must also be zero, so there is nowhere else for them to go. `ImpIVA` is
 * zero and the `Iva` array is empty, which is what makes `common-invoice.service` omit the element entirely.
 *
 * The result satisfies ARCA's `ImpTotal = ImpNeto + ImpTrib` (10048) once the caller adds the tributes.
 *
 * NOTE this is deliberately NOT the legacy `ImpNeto = ImpTotal` (webprocess-api's old cae.service). That
 * form is only correct when there are no perceptions; with `ImpTrib > 0` it overstates the net by exactly
 * the tributes and re-triggers 10048.
 *
 * A side benefit: the fold happens before any alícuota lookup, so a rate ARCA has no id for (a coefficient
 * can produce 13.5% or 5.25%) never reaches `vatRateIdForPercent` on a type C.
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
 * Builds the WSFEv1 authorization request for `voucherNumber`. Pure and clock-free — the one
 * time-dependent rule (the concept-1 `CbteFch` window) lives in {@link concept1DateWindowError}, which the
 * caller applies separately. The canonical taxprocess codes are translated to ARCA codes here via
 * {@link file://./code-maps.ts}.
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

    // A letter-C voucher reports no VAT at all: its issuer (Monotributo / Exento) has no débito fiscal, so
    // there is nothing to separate out and ARCA refuses any attempt to (10047 / 10048 / 10071). Everything
    // except the tributes folds into ImpNeto — including untaxed and exempt, which must themselves be zero.
    //
    // The caller's own breakdown is left untouched: core legitimately tracks a net/VAT split internally for
    // costing, and whether it is REPORTABLE is an ARCA rule, which is ours to apply, not core's to know.
    const collapseVat = isNonVatDiscriminating(voucherType);

    const totals = collapseVat ? collapsedTotals(lines, requestedUntaxed, requestedExempt) : calculateTotals(lines);
    const netUntaxed = collapseVat ? 0 : requestedUntaxed;
    const exempt = collapseVat ? 0 : requestedExempt;

    const totalAmount = roundToTwo(totals.netTaxed + totals.vat + netUntaxed + exempt + perceptions);

    // Perceptions collapse into a single "Otros" (id 99) tribute over the taxed net, matching the
    // core API's current behaviour (no per-perception breakdown available).
    //
    // On a letter C that net is the collapsed one, so the base carries the VAT the caller reported. That is
    // the right base, not a rounding artefact of the collapse: a type-C issuer has no débito fiscal, so the
    // net/VAT split is core's internal costing and the amount the perception was actually levied on is the
    // whole sale. `BaseImp`/`Alic` are informational — ARCA reconciles `ImpTrib` against the tribute amounts
    // alone — but they are what gets printed, so they should describe the real sale.
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

    // Concept 1 (productos) must fall within ±5 days of the request date. The check lives in
    // `concept1DateWindowError`, applied by the caller *after* idempotent recovery has had its chance
    // (contract change 2026-08-20) — building the request itself never rejects on the date.
    const issueDate = parseIssueDate(invoice.issueDate);

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
        currencyId: resolveCurrencyId(invoice.currencyIso),
        currencyRate: invoice.currencyRate,
        vatSubtotals: totals.subtotals,
        tributes,
    };

    // Services (concept 2/3) require the FchServ*/FchVtoPago dates.
    if (invoice.concept !== 1) {
        if (invoice.serviceDateFrom !== undefined) {
            request.serviceDateFrom = formatArcaDate(parseIssueDate(invoice.serviceDateFrom, 'serviceDateFrom'));
        }
        if (invoice.serviceDateTo !== undefined) {
            request.serviceDateTo = formatArcaDate(parseIssueDate(invoice.serviceDateTo, 'serviceDateTo'));
        }
        if (invoice.paymentDueDate !== undefined) {
            request.paymentDueDate = formatArcaDate(parseIssueDate(invoice.paymentDueDate, 'paymentDueDate'));
        }
    }

    return request;
}

/** Builds the RG-4892 QR URL for an authorized voucher (all inputs derive from the request + CAE). */
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
 * Maps the SDK result (+ optional QR) into the neutral authorization result. `providerMetadata` is always
 * returned (empty by default); the ARCA provider derives none today, but the channel is stable for core.
 */
export function toNeutralResult(
    result: CommonInvoiceResult,
    qr?: string,
    providerMetadata: Record<string, unknown> = {},
): NeutralAuthorizationResultDto {
    return {
        authorizationCode: result.cae ?? '',
        expiration: result.caeExpiration !== undefined ? parseArcaDate(result.caeExpiration).toISOString() : '',
        authorizedNumber: result.voucherNumberFrom,
        qr,
        status: statusOf(result.result),
        observations: result.observations,
        providerMetadata,
    };
}

/** Renders an ARCA `yyyymmdd` date as ISO-8601, surfacing an unexpected format verbatim rather than an invalid date. */
function arcaDateToIso(yyyymmdd: string): string {
    if (!/^\d{8}$/.test(yyyymmdd)) {
        return yyyymmdd;
    }
    const date = parseArcaDate(yyyymmdd);
    return Number.isNaN(date.getTime()) ? yyyymmdd : date.toISOString();
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
