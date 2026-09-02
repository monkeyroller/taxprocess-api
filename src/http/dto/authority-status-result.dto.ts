/**
 * Result of `POST /authority/status` — the authority's own health, not this service's.
 *
 * Every member is the authority's verbatim wording, so a caller displays or logs these rather than branching
 * on them: another entity will have its own vocabulary and may not split its health three ways at all. What
 * is portable is the `200` itself, not any particular value here.
 */
export class AuthorityStatusResultDto {
    /** The authority's application tier. */
    appServer!: string;

    /** The authority's database tier. */
    dbServer!: string;

    /** The authority's authentication tier (AR: WSAA), reported by the invoicing service rather than probed. */
    authServer!: string;
}
