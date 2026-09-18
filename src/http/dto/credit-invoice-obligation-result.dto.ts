/**
 * Result of `POST /api/taxpayers/credit-invoice-obligation`: whether a buyer must be sent a Factura de
 * Crédito Electrónica, and from what amount.
 *
 * No validation decorators — result DTOs are plain shapes this service builds, never bodies it reads.
 *
 * Optional members are `undefined` so `res.json` drops them, never `null`, per the rule the whole result
 * layer follows.
 */

/**
 * Which of two independent answers this is.
 *
 * A closed enum rather than a boolean like `cached`, because the two sources are not degrees of the same
 * answer: one is the authority speaking now, the other is a dated observation of a published list. A caller
 * storing the verdict against a voucher needs to be able to say afterwards which it was.
 */
export type ObligationSource = 'AUTHORITY' | 'LOCAL_REGISTRY';

/**
 * The floor at or above which a voucher to this receiver must be an FCE.
 *
 * `currencyCode` is the entity's own currency code (AR: `PES`), the same space as
 * `CurrencyRatePayload.currencyCode` — **not** ISO 4217. §5 removed the ISO mapping deliberately, and a
 * field spelled `currencyCode` beside an `amount` is exactly where `ARS` would creep back in.
 *
 * Carried rather than assumed so a caller compares like with like: the régimen's figures are pesos today,
 * and the day that changes should be a visible mismatch rather than a silent comparison across currencies.
 */
export class ObligationThresholdDto {
    amount!: number;
    currencyCode!: string;
}

/**
 * When the offline list this answer came from was published, and when this service last read it.
 *
 * Present **exactly** when `source` is `LOCAL_REGISTRY`, which is what makes such an answer
 * self-identifying: a caller storing it can date it months later without asking us. `publishedAt` is the
 * day the listing itself states it takes effect; `fetchedAt` is the day we copied the page. Both are plain
 * calendar days, deliberately — they are days in the authority's calendar, not instants.
 */
export class RegistrySnapshotDto {
    publishedAt!: string;
    fetchedAt!: string;
}

/**
 * One complete answer from one source.
 *
 * **Every field is produced by the same source.** That is the contract, and it is enforced structurally
 * rather than by discipline: the authority and the offline registry each build a whole one of these, and
 * the decision between them only ever picks a branch. There is no intermediate shape in which a live
 * `obligated` could be paired with a threshold from somewhere else — which is the failure that would bite
 * precisely when the régimen changes, the one moment the answer matters.
 *
 * Two invariants hold across both branches, and both are pinned by tests:
 * - `threshold` is present if and only if `obligated` is true. An unobligated receiver has no floor to
 *   state, and saying nothing is more honest than stating a figure that decides nothing.
 * - `registrySnapshot` is present if and only if `source` is `LOCAL_REGISTRY`.
 */
export interface ObligationAnswer {
    readonly obligated: boolean;
    readonly threshold?: ObligationThresholdDto;
    readonly source: ObligationSource;
    /**
     * When this answer was true, as a UTC instant.
     *
     * An instant on both branches, at the same granularity, because mixed granularity is what a caller
     * writes one parser for and gets wrong on the other. For an authority answer it is the moment the
     * authority replied — stored alongside a cached one, so a cached answer reports when it was *true*
     * rather than when it was read. For the offline registry it is the instant its `publishedAt` day began
     * in Argentina, since that is when the fact it states became true.
     */
    readonly asOf: string;
    readonly registrySnapshot?: RegistrySnapshotDto;
    /** Always present, naming at minimum what answered. */
    readonly providerMetadata: Record<string, unknown>;
}

/**
 * The wire result: one {@link ObligationAnswer}, plus the two things the answer itself cannot know.
 *
 * `entityCode` and `issuerTaxId` are stamped by the provider rather than carried on the answer, so the
 * sources below it cannot disagree about which entity they speak for, and neither source has to be handed a
 * value it plays no part in deciding.
 */
export class CreditInvoiceObligationResultDto implements ObligationAnswer {
    entityCode!: string;

    /**
     * The `issuerTaxId` the caller asked with, echoed back.
     *
     * Nothing authenticates as this taxpayer and the answer does not depend on it — the régimen is a
     * property of the receiver. It is here because the régimen is a relationship between two parties, and a
     * caller storing this verdict against a voucher should be able to answer "why was this an FCE" naming
     * both. That is the reason the request field is required at all, so it has to actually come back.
     */
    issuerTaxId!: string;

    obligated!: boolean;
    threshold?: ObligationThresholdDto;
    source!: ObligationSource;
    asOf!: string;
    registrySnapshot?: RegistrySnapshotDto;
    providerMetadata!: Record<string, unknown>;
}
