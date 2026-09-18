import {ArcaValidationError} from '../../sdk/core/errors.js';
import {isFceDocumentType} from '../code-maps/code-maps.js';
import type {NeutralInvoiceCreditInvoice, NeutralInvoiceOptional} from '../../../provider/neutral-invoice.js';
import type {TransmissionMode} from '../../../provider/transmission-mode/transmission-mode.js';

/**
 * ARCA's `Opcionales` ids for the Factura de Crédito Electrónica, and the values they take.
 *
 * This is the entity-specific half of the neutral `creditInvoice` block: the wire carries an account and a
 * mode, and this file is the only place that knows ARCA spells those `2101`, `2102` and `27`. Kept here
 * rather than asked of the caller for the reason the contract gives generally — the authority's own
 * numbering is this service's to hold, and a payload where every other field is canonical should not carry
 * three magic integers.
 *
 * Ids are strings because `Opcional.Id` travels as ARCA sent it, never coerced.
 */

/** `Opcionales` id for the issuer's CBU. */
const CBU_OPTIONAL_ID = '2101';
/** `Opcionales` id for that CBU's registered alias. */
const CBU_ALIAS_OPTIONAL_ID = '2102';
/** `Opcionales` id for the transmission mode. */
const TRANSMISSION_OPTIONAL_ID = '27';

/**
 * The régimen's default when the caller names no mode.
 *
 * Derived here rather than required on the wire so a caller with no opinion carries no field: `SCA` is what
 * the régimen assumes, and making every caller state it would be asking them to repeat a constant back to
 * us. The day `ADC` becomes an operator choice, it is already expressible.
 */
const DEFAULT_TRANSMISSION_MODE: TransmissionMode = 'SCA';

/** ARCA's own value for each mode. Identity today, and a table anyway, because it is a translation. */
const TRANSMISSION_VALUES: Readonly<Record<TransmissionMode, string>> = {
    SCA: 'SCA',
    ADC: 'ADC',
};

/** Every id this block owns — the set a caller may not also populate by hand. */
const CREDIT_INVOICE_OPTIONAL_IDS: ReadonlySet<string> = new Set([
    CBU_OPTIONAL_ID,
    CBU_ALIAS_OPTIONAL_ID,
    TRANSMISSION_OPTIONAL_ID,
]);

/**
 * The caller's own entries, narrowed to the two properties an `Opcional` has.
 *
 * One function rather than the same `map` on both return paths below: the copy exists only to strip extra
 * properties, so the day `NeutralInvoiceOptional` gains a third field — which it will, since the authority
 * names new optional fields by regulation — the field is dropped in one place to notice rather than two.
 */
function relayed(optionals: ReadonlyArray<NeutralInvoiceOptional>): Array<NeutralInvoiceOptional> {
    return optionals.map((optional) => ({id: optional.id, value: optional.value}));
}

/** The `Opcionales` entries a credit-invoice block becomes. */
export function creditInvoiceOptionals(
    creditInvoice: NeutralInvoiceCreditInvoice,
): Array<NeutralInvoiceOptional> {
    const mode = creditInvoice.transmissionMode ?? DEFAULT_TRANSMISSION_MODE;
    return [
        {id: CBU_OPTIONAL_ID, value: creditInvoice.issuerCbu},
        ...(creditInvoice.issuerCbuAlias === undefined
            ? []
            : [{id: CBU_ALIAS_OPTIONAL_ID, value: creditInvoice.issuerCbuAlias}]),
        {id: TRANSMISSION_OPTIONAL_ID, value: TRANSMISSION_VALUES[mode]},
    ];
}

/**
 * The block and the document type have to agree, and both directions are refused.
 *
 * This is the check `InvoiceCreditInvoiceDto` defers here rather than stating on the DTO: whether the block
 * belongs on a given `documentTypeCode` needs the entity's catalogue, and {@link isFceDocumentType} is it.
 * Deferring it was right; leaving it unwritten meant both mistakes reached ARCA as a relayed Spanish
 * rejection when each is decidable from the body alone — the rule this mapper's sibling states as "a `400`
 * naming the field is worth more than a relayed `502`".
 *
 * The missing direction is the more expensive one. An FCE voucher with no account on it is refused by the
 * authority for a field the caller never knew existed, because the whole point of the block is that ARCA's
 * `2101` stays on this side.
 *
 * **The CBU may arrive by either channel**, which is why this reads `optionals[]` as well as the block. The
 * relay predates the block and the contract promises it still works, so a caller who already assembles
 * `2101` by hand is issuing a perfectly good FCE and must not be told to stop. The rule is that the account
 * is present, not which channel carried it.
 *
 * Only the typed block is constrained in the other direction. A raw id on a non-FCE voucher stays the
 * authority's to reject, because that channel is deliberately open — ARCA names new optional fields by
 * regulation, and a membership check here would refuse the next one before anybody could send it.
 *
 * Runs after `toCbteTipo`, so a `documentTypeCode` outside the catalogue is already an `UNKNOWN_CODE` and
 * cannot arrive here to be reported as the wrong kind of mistake.
 */
function assertBlockMatchesDocumentType(
    documentTypeCode: number,
    creditInvoice: NeutralInvoiceCreditInvoice | undefined,
    sent: ReadonlyArray<NeutralInvoiceOptional>,
): void {
    const isFce = isFceDocumentType(documentTypeCode);
    if (!isFce) {
        if (creditInvoice !== undefined) {
            throw new ArcaValidationError(
                `invoice.creditInvoice is only carried by a credit-invoice voucher, and documentTypeCode ` +
                    `${String(documentTypeCode)} is not one — omit the block, or issue the voucher as an ` +
                    `FCE type`,
                'CREDIT_INVOICE_NOT_APPLICABLE',
            );
        }
        return;
    }
    const relayedCbu = sent.some((optional) => optional.id.trim() === CBU_OPTIONAL_ID);
    if (creditInvoice === undefined && !relayedCbu) {
        throw new ArcaValidationError(
            `documentTypeCode ${String(documentTypeCode)} is a credit-invoice voucher, which the authority ` +
                'requires an issuer CBU on — send the `creditInvoice` block',
            'CREDIT_INVOICE_REQUIRED',
        );
    }
}

/**
 * The derived credit-invoice entries merged with whatever the caller sent in `optionals[]`.
 *
 * `documentTypeCode` is taken so the block and the type can be checked against each other; see
 * {@link assertBlockMatchesDocumentType} for why that check lives here.
 *
 * `optionals[]` remains an open relay — that is its purpose, since the authority defines fields by
 * regulation faster than any contract can name them. Which leaves one genuine ambiguity: a caller can send
 * `2101` both ways, and then two values claim to be the CBU.
 *
 * **Refused rather than resolved.** Neither precedence rule is defensible: preferring the block silently
 * discards a value the caller explicitly wrote, and preferring the raw entry silently overrides the typed
 * field the contract asked them to use. Both would put a bank account on a fiscal document that the caller
 * did not unambiguously ask for, and the caller cannot see which won. So this is a `400` naming the
 * collision, which is answerable from the body and costs nobody a WSAA login.
 *
 * A raw entry with no `creditInvoice` block present is untouched. Nothing here forbids a caller from doing
 * it the old way — only from doing both at once.
 */
export function mergeCreditInvoiceOptionals(
    documentTypeCode: number,
    creditInvoice: NeutralInvoiceCreditInvoice | undefined,
    optionals: ReadonlyArray<NeutralInvoiceOptional> | undefined,
): Array<NeutralInvoiceOptional> | undefined {
    const sent = optionals ?? [];
    assertBlockMatchesDocumentType(documentTypeCode, creditInvoice, sent);

    if (creditInvoice === undefined) {
        return sent.length === 0 ? undefined : relayed(sent);
    }

    const collision = sent.find((o) => CREDIT_INVOICE_OPTIONAL_IDS.has(o.id.trim()));
    if (collision !== undefined) {
        throw new ArcaValidationError(
            `optionals[] carries id "${collision.id}", which the creditInvoice block also sets — send one ` +
                'or the other, since which of the two values reaches the authority would otherwise be ' +
                'decided silently',
            'CREDIT_INVOICE_OPTIONAL_CONFLICT',
        );
    }

    return [...creditInvoiceOptionals(creditInvoice), ...relayed(sent)];
}
