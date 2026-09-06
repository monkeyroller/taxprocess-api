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
 * The fields of an already-authorized export voucher this guard compares, in the spellings `FEXGetCMP`
 * answers with — which are not always the ones `FEXAuthorize` uses, so they are read off the query schema
 * rather than assumed from the request.
 *
 * Four of the seven the domestic guard compares have no counterpart here: an export identifies its buyer by
 * free text plus tax ids rather than `DocTipo`/`DocNro`, has `Tipo_expo` where a domestic voucher has
 * `Concepto`, and is zero-rated so it carries no receiver VAT condition at all.
 */
interface StoredExportVoucherFields {
    readonly Imp_total?: unknown;
    readonly Moneda_Id?: unknown;
    readonly Fecha_cbte?: unknown;
    readonly Dst_cmp?: unknown;
    readonly Tipo_expo?: unknown;
    readonly Cuit_pais_cliente?: unknown;
}

/**
 * The export counterpart of {@link assertRecoveredVoucherMatches}, and the same policy: the identifying
 * fields stored against the already-authorized voucher must match what we just tried to authorize, or
 * returning its CAE would hand back a fiscal document for the wrong invoice.
 *
 * **`Id` is deliberately not compared**, though it looks like the strongest signal available. The stored
 * one belongs to the *earlier* attempt, and this service generates a fresh key for every request — so on a
 * legitimate retry the two differ by construction, and comparing them would refuse every recovery this
 * guard exists to allow. It is evidence about which submission won, not about which sale it was for.
 *
 * `Imp_total` carries a ±0.01 tolerance so rounding drift cannot read as a difference; the rest are discrete
 * values where an exact mismatch is unambiguous.
 *
 * Excludes what the domestic guard excludes, for the reasons it gives: free text the authority may
 * normalize (`Cliente`, `Domicilio_cliente`, `Id_impositivo`), `Moneda_ctz` as rounding-prone and redundant
 * with the total, and every array — items, permits, associated vouchers, optionals — as too fragile to
 * compare against ARCA's own wire representation. A missing stored value is never a mismatch: this guard
 * rejects only a confirmed difference.
 */
export function assertRecoveredExportVoucherMatches(
    request: FexInvoiceRequest,
    queried: FexInvoiceResult,
): void {
    const raw = queried.raw as StoredExportVoucherFields;

    const mismatch = (label: string, sent: string | number, stored: string | number): never => {
        throw new ArcaValidationError(
            `Voucher ${request.voucherNumber} is already authorized for a different ${label} ` +
                `(sent ${sent}, stored ${stored}); refusing to return its CAE.`,
            'VOUCHER_ALREADY_AUTHORIZED_MISMATCH',
        );
    };

    // `text`/`decimal` again: the parser runs with `parseTagValue: false`, so an empty element reads as `''`
    // and a bare `Number('')` would be a finite `0` reported as a confirmed difference.

    const storedTotal = decimal(raw.Imp_total);
    if (storedTotal !== undefined && Math.abs(storedTotal - request.totalAmount) > 0.01) {
        mismatch('amount', request.totalAmount, storedTotal);
    }

    const storedCurrency = text(raw.Moneda_Id);
    if (storedCurrency !== undefined && storedCurrency !== request.currencyId) {
        mismatch('currency', request.currencyId, storedCurrency);
    }

    const storedVoucherDate = text(raw.Fecha_cbte);
    if (
        request.voucherDate !== undefined &&
        storedVoucherDate !== undefined &&
        storedVoucherDate !== request.voucherDate
    ) {
        mismatch('voucher date', request.voucherDate, storedVoucherDate);
    }

    const storedDestination = decimal(raw.Dst_cmp);
    if (storedDestination !== undefined && storedDestination !== request.destinationCode) {
        mismatch('destination', request.destinationCode, storedDestination);
    }

    const storedExportType = decimal(raw.Tipo_expo);
    if (storedExportType !== undefined && storedExportType !== request.exportType) {
        mismatch('export type', request.exportType, storedExportType);
    }

    const storedCountryTaxId = decimal(raw.Cuit_pais_cliente);
    if (
        request.clientCountryTaxId !== undefined &&
        storedCountryTaxId !== undefined &&
        storedCountryTaxId !== request.clientCountryTaxId
    ) {
        mismatch("buyer's country tax id", request.clientCountryTaxId, storedCountryTaxId);
    }
}

/**
 * WSFEXv1's dialect.
 *
 * **Every rejection is a candidate**, where WSFEv1 filters on `10016` first. Two reasons, both measured
 * rather than stylistic:
 *
 * - WSFEX publishes no coded observation channel at all. `Motivos_Obs` is a single delimited string, read
 *   into one code-less entry, so a soft rejection here carries nothing to key on.
 * - On the thrown path a code does exist, but *which* code means "not the next number in sequence" is what
 *   the manual cannot tell us: its validation table spreads that rule across `Punto_vta`/`Cbte_nro`/
 *   `Cbte_Tipo` with 1510/1520/1530/1535 adjacent and the code column scrambled. Guessing it would be the
 *   same class of mistake as reading `Mon_fecha` off an XML sample whose field table said `Fecha_ctz`.
 *
 * The cost is one query per rejected export voucher, which is rare and cheap. The matcher was always the
 * arbiter — the domestic module's own header says its code "only flags a candidate" — so dropping the hint
 * removes an optimization, not a safeguard. If a live sequence violation is ever captured, its code can
 * become the same fast path WSFEv1 has.
 */
export const WSFEX_RECOVERY: RecoveryDialect<FexInvoiceRequest, FexInvoiceResult> = {
    serviceId: ServiceId.WSFEXV1,
    isConflictCandidate: (result) => result.result === 'R',
    isConflictError: () => true,
    voucherNumberOf: (queried) => queried.voucherNumber,
    assertMatches: assertRecoveredExportVoucherMatches,
    toNeutral: (queried) => toNeutralExportResult(queried),
};
