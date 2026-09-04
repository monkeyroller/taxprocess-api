import {ArcaServiceError, ArcaValidationError} from './sdk/core/errors.js';
import type {ArcaAuth} from './sdk/core/types.js';
import {decimal, text} from '../xml-node/xml-node.js';
import type {CommonInvoiceRequest, CommonInvoiceResult} from './sdk/invoicing/common/common-invoice.types.js';
import type {commonInvoiceService} from './clients.js';
import {buildQrUrl, toNeutralResult} from './mapping/invoice-mapper/invoice.mapper.js';
import {toCbteTipo} from './mapping/code-maps/code-maps.js';
import type {NeutralInvoice} from '../provider/neutral-invoice.js';
import type {TaxAuthorizationResult} from '../provider/neutral-results.js';

/**
 * Idempotent recovery of a voucher ARCA has already authorized: recognizing the conflict, proving the stored
 * voucher is the same sale, and handing back its CAE. Core may re-send a number ARCA already authorized
 * after losing its own CAE to a persistence failure, and the honest answer is that CAE, not the rejection.
 */

/**
 * ARCA's observation code for `CbteDesde` not being the next number to authorize, which includes core
 * re-sending a number already authorized. Ambiguous — it also fires for a number too far ahead of the
 * sequence — so it only flags a candidate; `recoverAuthorizedVoucher` is the arbiter.
 */
const ALREADY_AUTHORIZED_CODE = '10016';

/** True when an authorize result is a `10016` rejection — the signal to reconcile against ARCA. */
export function isAlreadyAuthorizedRejection(result: CommonInvoiceResult): boolean {
    return result.result === 'R' && result.observations.some((o) => o.code === ALREADY_AUTHORIZED_CODE);
}

/**
 * The thrown-path analogue: AFIP surfacing an already-authorized number as an `Errors` block instead of a
 * soft rejection. Recovery is attempted only for this conflict, never for an unrelated business rejection,
 * which must be re-thrown rather than reconciled against a coincidentally authorized voucher.
 */
export function isAlreadyAuthorizedError(err: ArcaServiceError): boolean {
    return err.errors.some((e) => e.code === ALREADY_AUTHORIZED_CODE);
}

/**
 * The fields of an already-authorized voucher this guard compares, in ARCA's own spellings since they are
 * read straight off the queried `raw` node. Every member is `unknown` because the SOAP parser is not told to
 * coerce. Named rather than inlined because the member list is the comparison policy: adding or dropping one
 * changes which resend is judged a different sale.
 */
interface StoredVoucherFields {
    readonly ImpTotal?: unknown;
    readonly DocTipo?: unknown;
    readonly DocNro?: unknown;
    readonly Concepto?: unknown;
    readonly MonId?: unknown;
    readonly CbteFch?: unknown;
    readonly CondicionIVAReceptorId?: unknown;
}

/**
 * Guards against core reusing a voucher number for a different sale: the identifying fields stored against
 * the already-authorized voucher must match what we just tried to authorize, or returning its CAE would hand
 * back a fiscal document for the wrong invoice.
 *
 * `ImpTotal` is the strongest single amount signal and avoids false positives from rounding differences; the
 * rest are discrete values with no rounding ambiguity, so an exact mismatch is unambiguous. `CbteFch`
 * compares the date core actually sent, which does mean core must resend the original `issueDate` rather
 * than a freshly stamped one.
 *
 * Excludes the net/VAT/exempt breakdown, redundant with `ImpTotal` and carrying the same rounding-drift
 * risk, and the associated-vouchers, tributes and optionals arrays, too fragile to compare against ARCA's
 * own wire representation. A missing stored value is never a mismatch: this guard rejects only a confirmed
 * difference.
 */
export function assertRecoveredVoucherMatches(request: CommonInvoiceRequest, queried: CommonInvoiceResult): void {
    const raw = queried.raw as StoredVoucherFields;

    const mismatch = (label: string, sent: string | number, stored: string | number): never => {
        throw new ArcaValidationError(
            `Voucher ${request.voucherNumberFrom} is already authorized for a different ${label} ` +
                `(sent ${sent}, stored ${stored}); refusing to return its CAE.`,
            'VOUCHER_ALREADY_AUTHORIZED_MISMATCH',
        );
    };

    // `text`/`decimal` enforce the rule this guard depends on: the parser runs with `parseTagValue: false`,
    // so an empty element reads as `''`, which a bare `Number('')` would turn into a finite `0` and report as
    // a confirmed mismatch. Blank is "not returned", never a difference.

    const storedTotal = decimal(raw.ImpTotal);
    if (storedTotal !== undefined && Math.abs(storedTotal - request.totalAmount) > 0.01) {
        mismatch('amount', request.totalAmount, storedTotal);
    }

    const storedDocType = decimal(raw.DocTipo);
    if (storedDocType !== undefined && storedDocType !== request.docType) {
        mismatch('receiver doc type', request.docType, storedDocType);
    }

    const storedDocNumber = decimal(raw.DocNro);
    if (storedDocNumber !== undefined && storedDocNumber !== request.docNumber) {
        mismatch('receiver doc number', request.docNumber, storedDocNumber);
    }

    const storedConcept = decimal(raw.Concepto);
    if (storedConcept !== undefined && storedConcept !== request.concept) {
        mismatch('concept', request.concept, storedConcept);
    }

    const storedCurrency = text(raw.MonId);
    if (storedCurrency !== undefined && storedCurrency !== request.currencyId) {
        mismatch('currency', request.currencyId, storedCurrency);
    }

    const storedVoucherDate = text(raw.CbteFch);
    if (storedVoucherDate !== undefined && storedVoucherDate !== request.voucherDate) {
        mismatch('voucher date', request.voucherDate, storedVoucherDate);
    }

    const storedIvaCondition = decimal(raw.CondicionIVAReceptorId);
    if (
        request.receiverIvaConditionId !== undefined &&
        storedIvaCondition !== undefined &&
        storedIvaCondition !== request.receiverIvaConditionId
    ) {
        mismatch('receiver IVA condition', request.receiverIvaConditionId, storedIvaCondition);
    }
}

/** What is needed to reconcile one voucher against the authority. */
export interface RecoveryContext {
    readonly service: ReturnType<typeof commonInvoiceService>;
    readonly auth: ArcaAuth;
    readonly invoice: NeutralInvoice;
    readonly request: CommonInvoiceRequest;
    /** The issuer whose CUIT signs the rebuilt RG-4892 QR. */
    readonly issuerTaxId: string;
    /**
     * Runs the SDK call under the caller's delegation-aware wrapper. Injected rather than imported so the
     * query is classified like every other SDK call without this module knowing the eviction policy: on a
     * delegated request a token rejection here is the true cause of the failure, so it propagates rather
     * than being flattened into "not recoverable" and reported as the original `10016`.
     */
    readonly run: <T>(op: () => Promise<T>) => Promise<T>;
}

/**
 * Recovers an already-authorized voucher's CAE via `FECompConsultar` — the only ARCA call that returns a
 * stored CAE, since `requestAuthorization` never echoes a prior one. Returns the neutral result with the QR
 * rebuilt from `request`, or `undefined` when the number is not genuinely authorized, leaving the caller to
 * surface the original authorize outcome. A not-found query counts as "not recoverable" rather than an error.
 */
export async function recoverAuthorizedVoucher(
    context: RecoveryContext,
): Promise<TaxAuthorizationResult | undefined> {
    const {service, auth, invoice, request, issuerTaxId, run} = context;

    let queried: CommonInvoiceResult;
    try {
        queried = await run(() =>
            service.queryVoucher(
                auth,
                invoice.pointOfSaleNumber,
                toCbteTipo(invoice.documentTypeCode),
                invoice.voucherNumberFrom,
            ),
        );
    } catch (err) {
        if (err instanceof ArcaServiceError) {
            return undefined; // voucher not found → nothing to recover
        }
        throw err;
    }

    if (
        queried.result !== 'A' ||
        queried.cae === undefined ||
        queried.voucherNumberFrom !== invoice.voucherNumberFrom
    ) {
        return undefined;
    }

    assertRecoveredVoucherMatches(request, queried);
    const qr = buildQrUrl(issuerTaxId, request, queried.cae);
    return toNeutralResult(queried, qr);
}
