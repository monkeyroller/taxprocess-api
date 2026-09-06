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
import {
    UNIT_DISCOUNT,
    isUnitModeCode,
    toProUmed,
} from '../unit-of-measure-codes/unit-of-measure-codes.js';
import {isArcaDay, parseAuthorityDate} from '../authority-day/authority-day.js';
import {parseArcaId} from '../identifiers.js';
import type {
    NeutralInvoice,
    NeutralInvoiceExport,
    NeutralInvoiceItem,
} from '../../../provider/neutral-invoice.js';
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
 * **This file owns the conditional rules that need ARCA's own codes**, which is the half of the boundary
 * `invoice-export.dto.ts` cannot enforce: which code is the peso, which voucher type is a Factura and which
 * are notas, and which unit ids mean "discount line" rather than a unit. The DTO owns the other half —
 * shape, membership, and the rules decidable in the neutral vocabulary alone. Neither half is left to ARCA's
 * Spanish rejection when it is decidable here, because a `400` naming the field is worth more than a relayed
 * `502`.
 *
 * What stays the authority's is what needs its *state* rather than its codes: the rate band, and the
 * cross-checks a nota's referenced voucher must satisfy (2040-2055). Those arrive as its own rejection.
 *
 * Two rules are enforced by *omission* rather than by a check, because for them an empty element is itself
 * the rejection — a field the caller omitted is omitted on the wire, never sent blank.
 */

/** The document types this mapper builds — a Factura E and its notas. */
const INVOICE = 19;

/** ARCA's code for the peso, which several of its rules are stated in terms of. */
const LOCAL_CURRENCY = 'PES';

function exportBlock(invoice: NeutralInvoice): NeutralInvoiceExport {
    if (invoice.export === undefined) {
        throw new ArcaValidationError(
            'invoice names no export block — required for an export voucher',
            'MISSING_EXPORT',
        );
    }
    return invoice.export;
}

function toFexItems(invoice: NeutralInvoice): Array<FexItem> {
    const items = invoice.items ?? [];
    if (items.length === 0) {
        throw new ArcaValidationError(
            'invoice names no items — an export voucher is itemized (ARCA 1666)',
            'MISSING_ITEMS',
        );
    }
    return items.map((item, index) => {
        assertItemAmounts(item, index);
        return {
            code: item.code,
            description: item.description,
            quantity: item.quantity,
            unitOfMeasure: toProUmed(item.unitOfMeasureCode),
            unitPrice: item.unitPrice,
            discount: item.discount,
            totalAmount: item.totalAmount,
        };
    });
}

/**
 * The amount rules that follow from an item's unit id being a *mode* rather than a unit (1775/1815).
 *
 * Needs ARCA's own numbering to state at all — `99` is bonificación, `97` seña/anticipo, `0` no unit — which
 * is why it lives here rather than in the DTO, where those ids would be foreign vocabulary. Contract §5
 * publishes the three, so a caller can read the rule it is being held to.
 */
function assertItemAmounts(item: NeutralInvoiceItem, index: number): void {
    if (!isUnitModeCode(item.unitOfMeasureCode)) {
        return;
    }
    const at = 'items[' + String(index) + ']';
    // A mode line describes the kind of line, so there is no quantity to price (1775). An explicit zero
    // passes: the caller sent the field and set it to nothing, which is what the rule asks for.
    const amounts = [
        ['quantity', item.quantity],
        ['unitPrice', item.unitPrice],
        ['discount', item.discount],
    ] as const;
    for (const [field, value] of amounts) {
        if (value !== undefined && value !== 0) {
            throw new ArcaValidationError(
                at +
                    '.' +
                    field +
                    ' must be zero or absent on a line whose unitOfMeasureCode is a mode rather than a ' +
                    'unit (' +
                    String(item.unitOfMeasureCode) +
                    ')',
                'INVALID_ITEM_AMOUNT',
            );
        }
    }
    // A discount subtracts, so its total is negative. A deposit is unrestricted and may be either (1815).
    if (item.unitOfMeasureCode === UNIT_DISCOUNT && item.totalAmount >= 0) {
        throw new ArcaValidationError(
            at + '.totalAmount must be negative on a discount line (unitOfMeasureCode ' +
                String(UNIT_DISCOUNT) + ')',
            'INVALID_ITEM_AMOUNT',
        );
    }
}

/**
 * `Permisos`, which only a Factura may carry (1720/1730).
 *
 * The DTO already refuses permits on a services or other export, which it can decide in its own vocabulary.
 * The case left over needs ARCA's numbering — a *nota* takes no permit whatever it covers — so it is caught
 * here. Refused rather than dropped: silently discarding a despacho the caller named would authorize a
 * different document than the one it asked for.
 */
function toFexPermits(
    block: NeutralInvoiceExport,
    voucherType: number,
): Array<FexShippingPermit> | undefined {
    if (block.shippingPermits === undefined || block.shippingPermits.length === 0) {
        return undefined;
    }
    if (voucherType !== INVOICE) {
        throw new ArcaValidationError(
            'export.shippingPermits belongs to an invoice, not to a debit or credit note',
            'SHIPPING_PERMIT_NOT_ALLOWED',
        );
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
 * The rate is exactly `1` when the voucher is in the local currency (1601).
 *
 * Which code *is* the local currency is ARCA's own — `PES` — so the rule cannot be stated in the neutral
 * layer without putting that code there.
 */
function assertLocalCurrencyRate(currencyId: string, currencyRate: number): void {
    if (currencyId === LOCAL_CURRENCY && currencyRate !== 1) {
        throw new ArcaValidationError(
            'currencyRate must be exactly 1 for currencyCode "' + LOCAL_CURRENCY + '", not ' +
                String(currencyRate),
            'CURRENCY_RATE_MISMATCH',
        );
    }
}

/**
 * The two fields a Factura requires depending on what it exports (1640, 1673).
 *
 * Both hinge on the voucher type being a Factura rather than a nota, which is ARCA's numbering. `GOODS`
 * moves under an incoterm; `SERVICES` and `OTHER` ship nothing and are dated instead by when they are paid.
 * A nota requires neither — and `paymentDate` on one is forbidden outright, which is handled where it is
 * built.
 */
function assertRequiredForInvoice(block: NeutralInvoiceExport, voucherType: number): void {
    if (voucherType !== INVOICE) {
        return;
    }
    if (block.exportType === 'GOODS' && block.incoterm === undefined) {
        throw new ArcaValidationError(
            'export.incoterm is required on an invoice for a GOODS export',
            'MISSING_INCOTERM',
        );
    }
    if (block.exportType !== 'GOODS' && block.paymentDate === undefined) {
        throw new ArcaValidationError(
            'export.paymentDate is required on an invoice for a ' + block.exportType + ' export',
            'MISSING_PAYMENT_DATE',
        );
    }
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
 *
 * `requestId` arrives resolved for that reason — it is derived from the clock, and generating it here would
 * cost this function the property that makes it testable without one. Same shape as `voucherNumber`, which
 * the provider also resolves and passes in.
 */
export function buildFexInvoiceRequest(
    invoice: NeutralInvoice,
    voucherNumber: number,
    requestId: number,
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
    // Named explicitly: the currencies an export voucher may carry are the export service's catalogue,
    // which is the same set the export rate series is filtered against.
    const currencyId = toMonId(invoice.currencyCode, 'WSFEXV1');
    assertLocalCurrencyRate(currencyId, invoice.currencyRate);
    assertRequiredForInvoice(block, voucherType);

    const request: FexInvoiceRequest = {
        requestId,
        voucherType,
        pointOfSaleNumber: invoice.pointOfSaleNumber,
        voucherNumber,
        voucherDate: formatArcaDate(parseAuthorityDate(invoice.issueDate, 'issueDate')),
        exportType: toTipoExpo(block.exportType),
        permitPresent: permitPresence(block, voucherType),
        permits: toFexPermits(block, voucherType),
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
