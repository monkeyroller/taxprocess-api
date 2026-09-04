/** Results of the invoice authorization routes — the neutral shapes a provider produces. */

/** Neutral authorization status. AR's `Resultado` A/P/R maps onto these. */
export type NeutralAuthorizationStatus = 'AUTHORIZED' | 'PARTIAL' | 'REJECTED';

/** A neutral observation/error entry returned by the authority. */
export interface NeutralObservation {
    readonly code: string;
    readonly message: string;
}

/** The neutral result of an authorization request. */
export class NeutralAuthorizationResultDto {
    /** The authorization code (AR: CAE). */
    authorizationCode!: string;

    /** ISO-8601 expiration of the authorization code. */
    expiration!: string;

    /** The authority-assigned voucher number. */
    authorizedNumber!: number;

    /** Fiscal QR payload/URL, when the authority defines one (AR: RG-4892). */
    qr?: string;

    status!: NeutralAuthorizationStatus;

    observations!: Array<NeutralObservation>;

    /**
     * The authority replayed a stored answer for a request id it had already processed, rather than
     * authorizing afresh. Present only where the authority has an idempotency key of its own (AR: WSFEX
     * `Reproceso`); absent means the concept does not apply to that document.
     *
     * **`true` on a request the caller believes is new is an error, not a success.** It means the id was
     * reused, so the voucher described here is an older one — with a different total, and possibly a
     * different receiver — and everything else in this result belongs to that voucher rather than to the
     * one just sent. On a deliberate retry after a timeout it is the wanted outcome.
     */
    reprocessed?: boolean;

    /**
     * Entity-specific extras for core to persist opaquely on the authorization row. Always present, empty
     * when there are none — this service derives none today, but the channel is stable.
     */
    providerMetadata!: Record<string, unknown>;
}

/** Result of `POST /invoices/last-authorized`. */
export class LastAuthorizedResultDto {
    number!: number;
}

/**
 * Result of `POST /invoices/last-request-id` — the highest idempotency key the authority has seen for this
 * issuer (AR: WSFEX `FEXGetLast_ID`).
 *
 * Core owns the sequence, this service having no database to keep it in, so this is how core seeds it or
 * recovers it after losing track. Only meaningful on a service that has such a key at all; the others
 * answer `501`.
 */
export class LastRequestIdResultDto {
    requestId!: number;
}
