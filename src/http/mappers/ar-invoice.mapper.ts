import {
    buildArcaQrUrl,
    calculateTotals,
    formatArcaDate,
    parseArcaDate,
    roundToTwo,
    type CommonInvoiceRequest,
    type CommonInvoiceResult,
    type InvoiceLineTax,
} from '../../arca/index.js';
import type {ArgentinaInvoiceDto} from '../dto/invoice.dto.js';
import type {
    NeutralAuthorizationResultDto,
    NeutralAuthorizationStatus,
} from '../dto/neutral-result.dto.js';

/**
 * Argentina-specific translation from the pragmatic invoice request to the SDK's
 * {@link CommonInvoiceRequest}, plus the RG-4892 QR and the neutral result. Ported from
 * `webprocess-api/src/app/services/protected/transactions/electronic-invoice.service.ts:43-203`.
 *
 * The caller supplies already-resolved fiscal codes (voucher type, receiver IVA condition, receiver
 * document type); this module owns only the mechanical mapping.
 */

/**
 * ISO-4217 → ARCA `MonId`. The ARCA catalog is small; a larger deployment would source this from
 * `FEParamGetTiposMonedas`. Unknown currencies fall back to pesos.
 */
const ISO_TO_ARCA_CURRENCY: Readonly<Record<string, string>> = {
    ARS: 'PES',
    USD: 'DOL',
    EUR: '060',
};

function resolveCurrencyId(iso: string): string {
    return ISO_TO_ARCA_CURRENCY[iso.toUpperCase()] ?? 'PES';
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
 * clock) so the mapping stays pure and unit-testable.
 */
export function buildCommonInvoiceRequest(
    invoice: ArgentinaInvoiceDto,
    voucherNumber: number,
    now: Date,
): CommonInvoiceRequest {
    const lines: Array<InvoiceLineTax> = invoice.lines.map((l) => ({
        vatRatePercent: l.vatRatePercent,
        netAmount: l.netAmount,
        vatAmount: l.vatAmount,
    }));
    const totals = calculateTotals(lines);

    const netUntaxed = invoice.untaxedTotal ?? 0;
    const exempt = invoice.exemptTotal ?? 0;
    const perceptions = invoice.perceptionsTotal ?? 0;
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
        salesPointNumber: invoice.salesPointNumber,
        voucherType: invoice.voucherType,
        concept: invoice.concept,
        docType: invoice.receiverDocType,
        docNumber: invoice.receiverDocNumber,
        voucherNumberFrom: voucherNumber,
        voucherNumberTo: voucherNumber,
        voucherDate: formatArcaDate(voucherDate),
        totalAmount,
        netUntaxed,
        netTaxed: totals.netTaxed,
        exempt,
        vatAmount: totals.vat,
        tributesAmount: perceptions,
        receiverIvaConditionId: invoice.receiverIvaConditionId,
        currencyId: resolveCurrencyId(invoice.currency),
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
export function buildQrUrl(issuerCuit: number, request: CommonInvoiceRequest, cae: string): string {
    return buildArcaQrUrl({
        date: parseArcaDate(request.voucherDate),
        cuit: issuerCuit,
        salesPointNumber: request.salesPointNumber,
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

/** Maps the SDK result (+ optional QR) into the neutral authorization result. */
export function toNeutralResult(result: CommonInvoiceResult, qr?: string): NeutralAuthorizationResultDto {
    return {
        authorizationCode: result.cae ?? '',
        expiration: result.caeExpiration !== undefined ? parseArcaDate(result.caeExpiration).toISOString() : '',
        authorizedNumber: result.voucherNumberFrom,
        qr,
        status: statusOf(result.result),
        observations: result.observations,
    };
}
