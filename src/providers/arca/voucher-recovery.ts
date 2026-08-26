import {ArcaServiceError, ArcaValidationError} from './sdk/index.js';
import type {ArcaAuth, CommonInvoiceRequest, CommonInvoiceResult} from './sdk/index.js';
import type {commonInvoiceService} from './clients.js';
import {buildQrUrl, toNeutralResult} from './mapping/invoice.mapper.js';
import {toCbteTipo} from './mapping/code-maps.js';
import type {NeutralInvoice, TaxAuthorizationResult} from '../provider.js';

/**
 * Idempotent recovery of a voucher ARCA has already authorized.
 *
 * The whole concern lives here: recognizing the conflict, proving the stored voucher is the same sale, and
 * handing back its CAE. Core may re-send a voucher number ARCA already authorized (its own CAE lost to a
 * persistence failure, replayed minutes or days later); the honest answer is that CAE, not the rejection.
 */

/**
 * ARCA observation code returned by `FECAESolicitar` when `CbteDesde` is not the next number to
 * authorize — which includes the case where core re-sends a number ARCA has already authorized (e.g. after
 * a persistence failure on core's side). The code is ambiguous (it also fires for a number too far ahead of
 * the sequence), so it only flags a *candidate* for recovery; {@link recoverAuthorizedVoucher} is the arbiter.
 */
const ALREADY_AUTHORIZED_CODE = '10016';

/** True when an authorize result is a `10016` rejection — the signal to reconcile against ARCA. */
export function isAlreadyAuthorizedRejection(result: CommonInvoiceResult): boolean {
    return result.result === 'R' && result.observations.some((o) => o.code === ALREADY_AUTHORIZED_CODE);
}

/**
 * True when a thrown service error carries the `10016` code — AFIP surfacing an already-authorized number as
 * an `Errors` block instead of a soft rejection. This is the thrown-path analogue of
 * {@link isAlreadyAuthorizedRejection}: recovery is attempted only for this specific conflict, never for an
 * unrelated business rejection (which must be re-thrown verbatim, not reconciled against a coincidentally
 * authorized voucher).
 */
export function isAlreadyAuthorizedError(err: ArcaServiceError): boolean {
    return err.errors.some((e) => e.code === ALREADY_AUTHORIZED_CODE);
}

/**
 * Guards against core reusing a voucher number for a *different* sale: several identifying fields stored
 * against the already-authorized voucher must match what we just tried to authorize, or returning its CAE
 * would hand back a fiscal document for the wrong invoice. `ImpTotal` is the strongest single amount
 * signal and avoids false positives from rounding differences; `DocTipo`/`DocNro`/`Concepto`/`MonId`/
 * `CbteFch`/`CondicionIVAReceptorId` are discrete values with no rounding ambiguity, so an exact mismatch on
 * any of them is unambiguous. `CbteFch` compares the date core actually sent: the mapper no longer rewrites
 * an out-of-window concept-1 date to `now`, so a resend of the same invoice carries the same `CbteFch` —
 * which does mean core must resend the ORIGINAL `issueDate`, not a freshly stamped one (documented in
 * `docs/CONTRACT.md` §3). Deliberately excludes the net/VAT/exempt breakdown (redundant with `ImpTotal`,
 * same rounding-drift risk) and the associated-vouchers/tributes/optionals arrays (too fragile to compare
 * against ARCA's own wire representation). A missing stored value, or one that doesn't parse as expected, is
 * never treated as a mismatch — this guard only rejects a *confirmed* difference.
 */
export function assertRecoveredVoucherMatches(request: CommonInvoiceRequest, queried: CommonInvoiceResult): void {
    const raw = queried.raw as {
        ImpTotal?: unknown;
        DocTipo?: unknown;
        DocNro?: unknown;
        Concepto?: unknown;
        MonId?: unknown;
        CbteFch?: unknown;
        CondicionIVAReceptorId?: unknown;
    };

    const mismatch = (label: string, sent: string | number, stored: string | number): never => {
        throw new ArcaValidationError(
            `Voucher ${request.voucherNumberFrom} is already authorized for a different ${label} ` +
                `(sent ${sent}, stored ${stored}); refusing to return its CAE.`,
            'VOUCHER_ALREADY_AUTHORIZED_MISMATCH',
        );
    };

    /**
     * The stored value, or `undefined` when the authority returned nothing usable. The SOAP parser runs with
     * `parseTagValue: false`, so every field arrives as a string and an EMPTY element (`<CbteFch/>`, common
     * for fields a voucher predates) reads as `''` — which `Number('')` would silently turn into a perfectly
     * finite `0` and report as a confirmed mismatch. Blank is "not returned", never a difference.
     */
    const present = (value: unknown): string | undefined => {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? String(value) : undefined;
        }
        if (typeof value !== 'string' || value.trim() === '') {
            return undefined;
        }
        return value.trim();
    };
    const storedNumber = (value: unknown): number | undefined => {
        const text = present(value);
        if (text === undefined) {
            return undefined;
        }
        const parsed = Number(text);
        return Number.isFinite(parsed) ? parsed : undefined;
    };

    const storedTotal = storedNumber(raw.ImpTotal);
    if (storedTotal !== undefined && Math.abs(storedTotal - request.totalAmount) > 0.01) {
        mismatch('amount', request.totalAmount, storedTotal);
    }

    const storedDocType = storedNumber(raw.DocTipo);
    if (storedDocType !== undefined && storedDocType !== request.docType) {
        mismatch('receiver doc type', request.docType, storedDocType);
    }

    const storedDocNumber = storedNumber(raw.DocNro);
    if (storedDocNumber !== undefined && storedDocNumber !== request.docNumber) {
        mismatch('receiver doc number', request.docNumber, storedDocNumber);
    }

    const storedConcept = storedNumber(raw.Concepto);
    if (storedConcept !== undefined && storedConcept !== request.concept) {
        mismatch('concept', request.concept, storedConcept);
    }

    const storedCurrency = present(raw.MonId);
    if (storedCurrency !== undefined && storedCurrency !== request.currencyId) {
        mismatch('currency', request.currencyId, storedCurrency);
    }

    const storedVoucherDate = present(raw.CbteFch);
    if (storedVoucherDate !== undefined && storedVoucherDate !== request.voucherDate) {
        mismatch('voucher date', request.voucherDate, storedVoucherDate);
    }

    const storedIvaCondition = storedNumber(raw.CondicionIVAReceptorId);
    if (
        request.receiverIvaConditionId !== undefined &&
        storedIvaCondition !== undefined &&
        storedIvaCondition !== request.receiverIvaConditionId
    ) {
        mismatch('receiver IVA condition', request.receiverIvaConditionId, storedIvaCondition);
    }
}

/** What {@link recoverAuthorizedVoucher} needs to reconcile one voucher against the authority. */
export interface RecoveryContext {
    readonly service: ReturnType<typeof commonInvoiceService>;
    readonly auth: ArcaAuth;
    readonly invoice: NeutralInvoice;
    readonly request: CommonInvoiceRequest;
    /** The issuer whose CUIT signs the rebuilt RG-4892 QR. */
    readonly issuerTaxId: string;
    /**
     * Runs the SDK call under the caller's delegation-aware wrapper. Injected rather than imported so the
     * query is classified exactly like every other SDK call without this module knowing the eviction policy:
     * on a delegated request a token/representación rejection here is the true cause of the failure, so it
     * propagates (403/502) instead of being flattened into "not recoverable" and reported as the original
     * `10016`.
     */
    readonly run: <T>(op: () => Promise<T>) => Promise<T>;
}

/**
 * Recovers an already-authorized voucher's CAE via `FECompConsultar` (`queryVoucher`) — the only ARCA
 * call that returns a stored CAE; `requestAuthorization` never echoes a prior one. Returns the neutral
 * result (QR rebuilt from `request`, which the standalone `/query` endpoint cannot do without the invoice
 * body) when `invoice.voucherNumberFrom` is genuinely authorized, or `undefined` when it is not — leaving
 * the caller to surface the original authorize outcome. A not-found query (ARCA ~602, thrown as
 * `ArcaServiceError`) counts as "not recoverable", not an error.
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
