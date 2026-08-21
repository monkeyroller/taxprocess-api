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
    type PointOfSaleInfo,
} from './sdk/index.js';
import {toCbteTipo, toCondicionIvaReceptorId, toDocTipo} from './code-maps.js';
import {parseArcaId} from './ar-identifiers.js';
import type {NeutralInvoice} from '../provider.js';
import type {
    NeutralAuthorizationResultDto,
    NeutralAuthorizationStatus,
    PointOfSaleDto,
} from '../../http/dto/neutral-result.dto.js';

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
 * Builds the WSFEv1 authorization request for `voucherNumber`. Pure and clock-free — the one
 * time-dependent rule (the concept-1 `CbteFch` window) lives in {@link concept1DateWindowError}, which the
 * caller applies separately. The canonical taxprocess codes are translated to ARCA codes here via
 * {@link file://./code-maps.ts}.
 */
export function buildCommonInvoiceRequest(invoice: NeutralInvoice, voucherNumber: number): CommonInvoiceRequest {
    const lines: Array<InvoiceLineTax> = invoice.lines.map((l) => ({
        vatRatePercent: l.taxRatePercent,
        netAmount: l.netAmount,
        vatAmount: l.taxAmount,
    }));
    const totals = calculateTotals(lines);

    const netUntaxed = invoice.totals?.untaxed ?? 0;
    const exempt = invoice.totals?.exempt ?? 0;
    const perceptions = invoice.totals?.perceptions ?? 0;
    const totalAmount = roundToTwo(totals.netTaxed + totals.vat + netUntaxed + exempt + perceptions);

    // Perceptions collapse into a single "Otros" (id 99) tribute over the taxed net, matching the
    // core API's current behaviour (no per-perception breakdown available).
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
        voucherType: toCbteTipo(invoice.documentTypeCode),
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
