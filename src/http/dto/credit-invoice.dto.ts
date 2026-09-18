import {IsIn, IsString, MinLength} from 'class-validator';
import {GENERIC_ENVIRONMENTS, type GenericEnvironment} from '../../providers/provider/environment.js';
import {IsAuthorityDate} from './authority-date/authority-date.js';

/**
 * Body for `POST /api/taxpayers/credit-invoice-obligation`.
 *
 * No issuer block and no credentials, for the same reason `/taxpayers/lookup` has none: whether a taxpayer
 * must be sent a credit-invoice document is a fact about the *receiver* and the régimen, not about whoever
 * is asking. It is read under this service's own delegated identity, so this endpoint never returns
 * `409 CREDENTIALS_REQUIRED` and no taxpayer has to delegate anything to us.
 *
 * That is a precondition rather than a convenience. A tenant's certificate authorizes that tenant's *sales*
 * — it says nothing about a third party's obligations, and enrolling every tenant in a register none of
 * them writes to would make the answer depend on which one happened to ask.
 */
export class CreditInvoiceObligationRequestDto {
    @IsString()
    @MinLength(1)
    entityCode!: string;

    @IsIn(GENERIC_ENVIRONMENTS)
    environment!: GenericEnvironment;

    /**
     * The issuing taxpayer's canonical tax id (AR: the 11-digit CUIT).
     *
     * **Informational.** Nothing authenticates as this taxpayer and the answer does not depend on it — the
     * régimen is a property of the receiver. It is required, and echoed back, because the régimen is a
     * relationship between two parties and an audit of "why was this voucher an FCE" should be able to name
     * both. Checked for shape so the audit trail cannot carry a value nobody ever looked at.
     */
    @IsString()
    @MinLength(1)
    issuerTaxId!: string;

    /**
     * The receiving taxpayer's canonical tax id, as a string. AR: the 11-digit CUIT.
     *
     * A bare tax id rather than the `{identificationTypeCode, identificationNumber}` pair
     * `/taxpayers/lookup` takes, because the two routes ask different questions. A registry lookup can
     * legitimately be by identity document, and the type is what decides which register can answer it. The
     * régimen, by contrast, is a relationship between two *tax ids* — one register, one identification type
     * — so the pair would carry a choice with no second option.
     *
     * Digits are not checked here. Whether a value is a usable id is the provider's call, and it refuses one
     * that is not before spending a login on it.
     */
    @IsString()
    @MinLength(1)
    receiverTaxId!: string;

    /**
     * The voucher's own issue date — not today.
     *
     * A backdated sale must be judged against the régimen as it stood then, the same discipline the currency
     * rate lookup already applies to a backdated batch. Required rather than defaulting to today: a
     * defaulted date is silently wrong for exactly the vouchers that need it most, and making it optional
     * later is additive while making it required later would break every caller.
     *
     * `@IsAuthorityDate()` rather than `@IsISO8601()`: a zoneless datetime resolves to a different calendar
     * day per deployment, and here the calendar day decides a legal obligation.
     */
    @IsAuthorityDate()
    issueDate!: string;
}
