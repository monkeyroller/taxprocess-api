import {ArcaValidationError} from '../../sdk/core/errors.js';
import {formatArcaDate, parseArcaDate} from '../../sdk/invoicing/arca-qr/arca-qr.js';
import type {
    FexAssociatedVoucher,
    FexInvoiceRequest,
    FexInvoiceResult,
    FexItem,
    FexShippingPermit,
} from '../../sdk/invoicing/export/fex-invoice.types.js';
import {roundToTwo} from '../../sdk/invoicing/invoice-totals/invoice-totals.js';
import {toCbteTipo} from '../code-maps/code-maps.js';
import {toMonId} from '../currency-codes/currency-codes.js';
import {toCountryTaxId, toDstCmp} from '../destination-codes/destination-codes.js';
import {toIdiomaCbte, toIncoterms, toTipoExpo} from '../export-codes/export-codes.js';
import {toProUmed} from '../unit-of-measure-codes/unit-of-measure-codes.js';
import {isArcaDay, parseAuthorityDate} from '../authority-day/authority-day.js';
import {parseArcaId} from '../identifiers.js';
import type {NeutralInvoice, NeutralInvoiceExport} from '../../../provider/neutral-invoice.js';
import type {
    NeutralAuthorizationResultDto,
    NeutralAuthorizationStatus,
} from '../../../../http/dto/authorization-result.dto.js';

/**
 * Argentina-specific translation from the neutral invoice to the WSFEXv1 request, and back from its result.
 *
 * Sibling of `invoice.mapper.ts` rather than a branch inside it: the two documents share the currency pair
 * and nothing else, so one function carrying both would be a sequence of mutually exclusive `if`s over a
 * type where every field is optional.
 *
 * The conditional-mandatory rules are the DTO's, not this file's. Everything here is a translation, so a
 * field the caller omitted is omitted on the wire — which is itself what several of ARCA's rules require,
 * since an empty element is a value it validates.
 */

/** The document types this mapper builds — a Factura E and its notas. */
const INVOICE = 19;

function exportBlock(invoice: NeutralInvoice): NeutralInvoiceExport {
    if (invoice.export === undefined) {
        throw new ArcaValidationError(
            'invoice names no export block — required for an export voucher',
            'MISSING_EXPORT',
        );
    }
    return invoice.export;
}

/**
 * The caller's request id, which WSFEX requires and has no way to invent.
 *
 * This service keeps no database, so it cannot allocate one: the sequence belongs to core. A fabricated
 * value would be worse than a rejection — a collision replays a stored voucher and reports it as success.
 */
function requestIdOf(invoice: NeutralInvoice): number {
    if (invoice.requestId === undefined) {
        throw new ArcaValidationError(
            'invoice names no requestId — an export voucher needs the idempotency key the caller owns',
            'MISSING_REQUEST_ID',
        );
    }
    return invoice.requestId;
}

function toFexItems(invoice: NeutralInvoice): Array<FexItem> {
    const items = invoice.items ?? [];
    if (items.length === 0) {
        throw new ArcaValidationError(
            'invoice names no items — an export voucher is itemized (ARCA 1666)',
            'MISSING_ITEMS',
        );
    }
    return items.map((item) => ({
        code: item.code,
        description: item.description,
        quantity: item.quantity,
        unitOfMeasure: toProUmed(item.unitOfMeasureCode),
        unitPrice: item.unitPrice,
        discount: item.discount,
        totalAmount: item.totalAmount,
    }));
}

function toFexPermits(block: NeutralInvoiceExport): Array<FexShippingPermit> | undefined {
    if (block.shippingPermits === undefined || block.shippingPermits.length === 0) {
        return undefined;
    }
    return block.shippingPermits.map((permit) => ({
        permitId: permit.permitId,
        destinationCode: toDstCmp(permit.destinationCode),
    }));
}

function toFexAssociated(invoice: NeutralInvoice): Array<FexAssociatedVoucher> | undefined {
    if (invoice.associatedVouchers === undefined || invoice.associatedVouchers.length === 0) {
        return undefined;
    }
    return invoice.associatedVouchers.map((voucher) => ({
        voucherType: toCbteTipo(voucher.documentTypeCode),
        pointOfSaleNumber: voucher.pointOfSaleNumber,
        number: voucher.number,
        cuit:
            voucher.issuerTaxId === undefined
                ? undefined
                : parseArcaId(voucher.issuerTaxId, 'associatedVouchers[].issuerTaxId'),
    }));
}

/**
 * `Permiso_existente`, which ARCA wants present, absent or one of two letters depending on the combination
 * (1550/1720/1730):
 *
 * - `"S"`/`"N"` only for a goods export on a Factura;
 * - absent everywhere else — a nota never carries it, and neither does a services or other export.
 *
 * Returning `undefined` is therefore a translation, not a default: the field is omitted rather than sent
 * empty, and an empty element here is a rejection.
 */
function permitPresence(
    block: NeutralInvoiceExport,
    voucherType: number,
): 'S' | 'N' | undefined {
    if (block.exportType !== 'GOODS' || voucherType !== INVOICE) {
        return undefined;
    }
    if (block.shippingPermitPresent === undefined) {
        return undefined;
    }
    return block.shippingPermitPresent ? 'S' : 'N';
}

/**
 * `CanMisMonExt`, which must **not** be sent on a peso Factura or on any nota (1605).
 *
 * So the caller's flag is dropped in exactly those cases rather than passed through — the one place this
 * mapper overrides what it was told, and it does so because sending the field at all is the rejection.
 */
function settlementFlag(
    block: NeutralInvoiceExport,
    voucherType: number,
    currencyId: string,
): 'S' | 'N' | undefined {
    if (block.settledInInvoiceCurrency === undefined) {
        return undefined;
    }
    if (voucherType !== INVOICE || currencyId === 'PES') {
        return undefined;
    }
    return block.settledInInvoiceCurrency ? 'S' : 'N';
}

/**
 * Builds the WSFEXv1 authorization request for `voucherNumber`. Pure and clock-free, like its WSFEv1
 * sibling: ARCA owns the date window (1500) for this document, so nothing here reads the clock.
 */
export function buildFexInvoiceRequest(
    invoice: NeutralInvoice,
    voucherNumber: number,
): FexInvoiceRequest {
    const block = exportBlock(invoice);
    const voucherType = toCbteTipo(invoice.documentTypeCode);
    // The export document takes `currencyCode` only. The deprecated `currencyIso` bridge is deliberately
    // not reached from here: it maps three ISO codes onto ARCA's forty-nine and is being deleted, so
    // extending its reach to a second document would be work in the wrong direction.
    if (invoice.currencyCode === undefined) {
        throw new ArcaValidationError(
            "invoice names no currencyCode — an export voucher needs the authority's own code",
            'UNMAPPED_CURRENCY',
        );
    }
    const currencyId = toMonId(invoice.currencyCode);

    const request: FexInvoiceRequest = {
        requestId: requestIdOf(invoice),
        voucherType,
        pointOfSaleNumber: invoice.pointOfSaleNumber,
        voucherNumber,
        voucherDate: formatArcaDate(parseAuthorityDate(invoice.issueDate, 'issueDate')),
        exportType: toTipoExpo(block.exportType),
        permitPresent: permitPresence(block, voucherType),
        permits: toFexPermits(block),
        destinationCode: toDstCmp(block.destinationCode),
        clientName: block.clientName,
        clientCountryTaxId:
            block.clientCountryTaxId === undefined ? undefined : toCountryTaxId(block.clientCountryTaxId),
        clientAddress: block.clientAddress,
        clientTaxId: block.clientTaxId,
        currencyId,
        currencyRate: invoice.currencyRate,
        settledInInvoiceCurrency: settlementFlag(block, voucherType, currencyId),
        commercialObservations: block.commercialObservations,
        totalAmount: totalOf(invoice),
        observations: block.observations,
        associatedVouchers: toFexAssociated(invoice),
        paymentTerms: block.paymentTerms,
        incoterm: block.incoterm === undefined ? undefined : toIncoterms(block.incoterm),
        incotermDescription: block.incotermDescription,
        language: toIdiomaCbte(block.language),
        items: toFexItems(invoice),
        optionals: invoice.optionals?.map((optional) => ({id: optional.id, value: optional.value})),
        // Forbidden on a nota (1674), so it is dropped there rather than relayed into a rejection.
        paymentDate:
            voucherType === INVOICE && block.paymentDate !== undefined
                ? formatArcaDate(parseAuthorityDate(block.paymentDate, 'export.paymentDate'))
                : undefined,
    };

    return request;
}

/**
 * `Imp_total`, which ARCA requires to equal the sum of the item totals within its own tolerance (1610).
 *
 * Always derived from the items, never taken from a separate field. The neutral invoice has no top-level
 * total for an export to carry, and adding one would create a value that can disagree with the items — a
 * disagreement only ARCA would catch, as a rejection naming neither side. Deriving it means this service
 * cannot be the one to introduce it.
 *
 * Uses the same money rounding as the domestic path rather than a local one. The WSFEX manual (§2.18) states
 * its own criterion as Round Half Even, which `roundToTwo` is not — but the difference cannot reach the
 * wire here: it is at most half a cent on one addend, while ARCA's own tolerance for this comparison is a
 * relative 0.01% or an absolute 0.01 per item, an order of magnitude larger. Matching the domestic path is
 * worth more than matching a rule whose margin already absorbs the discrepancy.
 */
function totalOf(invoice: NeutralInvoice): number {
    const items = invoice.items ?? [];
    return roundToTwo(items.reduce((sum, item) => sum + item.totalAmount, 0));
}

function statusOf(result: FexInvoiceResult['result']): NeutralAuthorizationStatus {
    if (result === 'A') {
        return 'AUTHORIZED';
    }
    return result === 'P' ? 'PARTIAL' : 'REJECTED';
}

/**
 * Maps the WSFEX result into the neutral authorization result.
 *
 * No QR: `buildArcaQrUrl` implements RG 4892, whose payload is specified for the domestic voucher, and
 * emitting one for a Factura E would be inventing a format. `reprocessed` is carried through because a
 * caller cannot otherwise tell a replayed voucher from a fresh one.
 */
export function toNeutralExportResult(
    result: FexInvoiceResult,
    providerMetadata: Record<string, unknown> = {},
): NeutralAuthorizationResultDto {
    return {
        authorizationCode: result.cae ?? '',
        // Guarded rather than a bare parse, so an expiration ARCA rendered unexpectedly surfaces verbatim
        // instead of throwing a 500 over an authorization that succeeded.
        expiration: result.caeExpiration !== undefined ? arcaDateToIso(result.caeExpiration) : '',
        authorizedNumber: result.voucherNumber,
        status: statusOf(result.result),
        observations: result.observations,
        reprocessed: result.reprocessed,
        providerMetadata,
    };
}

/** Renders an ARCA `yyyymmdd` date as an ISO-8601 instant, surfacing an unexpected format verbatim. */
function arcaDateToIso(yyyymmdd: string): string {
    return isArcaDay(yyyymmdd) ? parseArcaDate(yyyymmdd.trim()).toISOString() : yyyymmdd;
}
