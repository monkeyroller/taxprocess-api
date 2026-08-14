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
 */
function parseIssueDate(iso: string): Date {
    return new Date(iso.includes('T') ? iso : `${iso}T12:00:00-03:00`);
}

/** Returns `date` when within ±5 days of `now` (AFIP's Concepto-1 `CbteFch` window), else `now`. */
function clampToArcaDateWindow(date: Date, now: Date): Date {
    const diffDays = Math.abs(now.getTime() - date.getTime()) / 86_400_000;
    return diffDays <= 5 ? date : now;
}

/**
 * Builds the WSFEv1 authorization request for `voucherNumber`. `now` is injected (not read from the
 * clock) so the mapping stays pure and unit-testable. The canonical taxprocess codes are translated to
 * ARCA codes here via {@link file://./code-maps.ts}.
 */
export function buildCommonInvoiceRequest(
    invoice: NeutralInvoice,
    voucherNumber: number,
    now: Date,
): CommonInvoiceRequest {
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

    const issueDate = parseIssueDate(invoice.issueDate);
    // Concept 1 (productos) must fall within ±5 days of the request date; clamp an out-of-window date.
    const voucherDate = invoice.concept === 1 ? clampToArcaDateWindow(issueDate, now) : issueDate;

    const request: CommonInvoiceRequest = {
        pointOfSaleNumber: invoice.pointOfSaleNumber,
        voucherType: toCbteTipo(invoice.documentTypeCode),
        concept: invoice.concept,
        docType: toDocTipo(invoice.receiver.identificationTypeCode),
        docNumber: parseArcaId(invoice.receiver.identificationNumber, 'receiver.identificationNumber'),
        voucherNumberFrom: voucherNumber,
        voucherNumberTo: voucherNumber,
        voucherDate: formatArcaDate(voucherDate),
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
            request.serviceDateFrom = formatArcaDate(parseIssueDate(invoice.serviceDateFrom));
        }
        if (invoice.serviceDateTo !== undefined) {
            request.serviceDateTo = formatArcaDate(parseIssueDate(invoice.serviceDateTo));
        }
        if (invoice.paymentDueDate !== undefined) {
            request.paymentDueDate = formatArcaDate(parseIssueDate(invoice.paymentDueDate));
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
