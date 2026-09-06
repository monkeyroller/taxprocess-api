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
     * Entity-specific extras for core to persist opaquely on the authorization row. Always present, empty
     * when there are none — this service derives none today, but the channel is stable.
     */
    providerMetadata!: Record<string, unknown>;
}

/** Result of `POST /invoices/last-authorized`. */
export class LastAuthorizedResultDto {
    number!: number;
}
