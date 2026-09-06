import {ArcaServiceError, ArcaValidationError} from '../sdk/core/errors.js';
import type {ArcaAuth} from '../sdk/core/types.js';
import {decimal, text} from '../../xml-node/xml-node.js';
import type {CommonInvoiceRequest, CommonInvoiceResult} from '../sdk/invoicing/common/common-invoice.types.js';
import {buildQrUrl, toNeutralResult} from '../mapping/invoice-mapper/invoice.mapper.js';
import {toNeutralExportResult} from '../mapping/export-invoice-mapper/export-invoice.mapper.js';
import type {FexInvoiceRequest, FexInvoiceResult} from '../sdk/invoicing/export/fex-invoice.types.js';
import {toCbteTipo} from '../mapping/code-maps/code-maps.js';
import type {NeutralInvoice} from '../../provider/neutral-invoice.js';
import type {TaxAuthorizationResult} from '../../provider/neutral-results.js';
import {ServiceId, type ServiceIdValue} from '../sdk/core/constants.js';

/**
 * Idempotent recovery of a voucher ARCA has already authorized: recognizing the conflict, proving the stored
 * voucher is the same sale, and handing back its CAE. Core may re-send a number ARCA already authorized
 * after losing its own CAE to a persistence failure, and the honest answer is that CAE, not the rejection.
 *
 * **One engine, one dialect per service.** The structure — recognize a candidate, query, gate on
 * authenticity, prove it is the same sale, return its CAE — is what both of ARCA's invoicing services need.
 * What differs between them is spellings and one predicate, so those become a {@link RecoveryDialect} the
 * way the error envelope and the parameter tables already did. Writing a second copy for the export service
 * would have duplicated the parts that were expensive to get right (the authenticity gate, "blank is not a
 * mismatch", the delegation-aware query) to vary the parts that were cheap.
 */

/** The minimum an authorize or query result must expose for the shared authenticity gate to read it. */
export interface RecoverableResult {
    readonly result: 'A' | 'R' | 'P';
    readonly cae?: string;
}

/**
 * What one service contributes to the shared engine. Everything here is a spelling or a predicate; anything
 * that is a *decision* stays in the engine, so a second service cannot quietly acquire different semantics.
 */
export interface RecoveryDialect<Req, Res extends RecoverableResult> {
    /** Whose ticket the reconciling query runs under. Never defaulted — see `translateDelegatedTokenError`. */
    readonly serviceId: ServiceIdValue;
    /** Whether a soft rejection is worth a query. */
    isConflictCandidate(result: Res): boolean;
    /** Whether a thrown error is the same conflict surfaced through the error block instead. */
    isConflictError(err: ArcaServiceError): boolean;
    /** The voucher number the authority echoed, which the engine checks against the one asked about. */
    voucherNumberOf(queried: Res): number | undefined;
    /** The comparison policy — the member list *is* the policy. Throws on a confirmed difference. */
    assertMatches(request: Req, queried: Res): void;
    /**
     * Builds the neutral answer. WSFEv1 rebuilds the RG-4892 QR here; the export service emits none.
     *
     * `cae` is passed rather than re-read off `queried` because the engine's gate already proved it present,
     * and re-deriving it would make every dialect assert away a narrowing it did not perform.
     */
    toNeutral(queried: Res, request: Req, issuerTaxId: string, cae: string): TaxAuthorizationResult;
}

/** The one operation the engine needs, which every `InvoiceWebService` already exposes identically. */
export interface QueryableService<Res> {
    queryVoucher(
        auth: ArcaAuth,
        pointOfSaleNumber: number,
        voucherType: number,
        voucherNumber: number,
    ): Promise<Res>;
}

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
export interface RecoveryContext<Req, Res extends RecoverableResult> {
    readonly dialect: RecoveryDialect<Req, Res>;
    readonly service: QueryableService<Res>;
    readonly auth: ArcaAuth;
    readonly invoice: NeutralInvoice;
    readonly request: Req;
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
 * Recovers an already-authorized voucher's CAE by querying the authority — the only call that returns a
 * stored CAE, since an authorize request never echoes a prior one. Returns the neutral result, or
 * `undefined` when the number is not genuinely authorized, leaving the caller to surface the original
 * authorize outcome. A not-found query counts as "not recoverable" rather than an error.
 */
export async function recoverAuthorizedVoucher<Req, Res extends RecoverableResult>(
    context: RecoveryContext<Req, Res>,
): Promise<TaxAuthorizationResult | undefined> {
    const {dialect, service, auth, invoice, request, issuerTaxId, run} = context;

    let queried: Res;
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

    // The authenticity gate, shared: an answer that is not approved, carries no CAE, or describes a
    // different number than the one asked about is not the voucher we are reconciling against.
    if (
        queried.result !== 'A' ||
        queried.cae === undefined ||
        dialect.voucherNumberOf(queried) !== invoice.voucherNumberFrom
    ) {
        return undefined;
    }

    dialect.assertMatches(request, queried);
    return dialect.toNeutral(queried, request, issuerTaxId, queried.cae);
}

/**
 * WSFEv1's dialect — today's behaviour, unchanged.
 *
 * Its conflict predicates key on `10016`, which the export service has no analogue for. That asymmetry is
 * measured, not stylistic: WSFEX publishes no coded observation channel at all, so a code-keyed candidate
 * test is not merely risky there but impossible. Keeping the code here is what stops the domestic path —
 * the highest-traffic one in the service — from querying on every rejection to gain nothing.
 */
export const WSFEV1_RECOVERY: RecoveryDialect<CommonInvoiceRequest, CommonInvoiceResult> = {
    serviceId: ServiceId.WSFEV1,
    isConflictCandidate: isAlreadyAuthorizedRejection,
    isConflictError: isAlreadyAuthorizedError,
    voucherNumberOf: (queried) => queried.voucherNumberFrom,
    assertMatches: assertRecoveredVoucherMatches,
    toNeutral: (queried, request, issuerTaxId, cae) =>
        toNeutralResult(queried, buildQrUrl(issuerTaxId, request, cae)),
};

/**
 * WSFEXv1's dialect.
 *
 * **Reconciles nothing yet.** The export service still relies on the caller's `Cmp.Id` for idempotency, so
 * a rejection there is the truthful outcome and querying would be asking a question ARCA already answered.
 * Both predicates therefore answer `false`, which is today's behaviour stated explicitly rather than left
 * as a gap in a table — and the shape is here so the flow that will use it is already wired.
 */
export const WSFEX_RECOVERY: RecoveryDialect<FexInvoiceRequest, FexInvoiceResult> = {
    serviceId: ServiceId.WSFEXV1,
    isConflictCandidate: () => false,
    isConflictError: () => false,
    voucherNumberOf: (queried) => queried.voucherNumber,
    assertMatches: () => undefined,
    toNeutral: (queried) => toNeutralExportResult(queried),
};
