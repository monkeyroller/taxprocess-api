/**
 * The coding systems an address on a neutral result may name — a closed vocabulary shared by every provider.
 *
 * A caller resolves an address level by matching the code and scheme together against its own catalogs, so
 * these values are join keys rather than labels. Three rules follow:
 *
 * - Member values are the contract; member names are not. Adding a member is additive, changing a value
 *   breaking.
 * - Spelling stays key-safe (`/^[A-Z0-9-]+$/`). A scheme differing only by a space or a capital raises no
 *   error anywhere — it matches no row, and the caller's field lands `null`.
 * - A token names one specific catalog, never a role. The two ISO members are separate because ISO 3166-1
 *   defines three codes for the same country and a shared `ISO` would make country and region collide. By
 *   the same rule a future provider registers `IBGE` or `INSEE`, not `NATIONAL-STATISTICS`.
 */
export enum AddressCodeScheme {
    /** ISO 3166-1 alpha-2 country code (`"AR"`). The alpha-3 and numeric forms are a different scheme. */
    ISO_3166_1_ALPHA_2 = 'ISO-3166-1-ALPHA-2',
    /** ISO 3166-2 principal-subdivision code (`"AR-X"` — Córdoba). One code form, so no variant is named. */
    ISO_3166_2 = 'ISO-3166-2',
    /** INDEC's 8-digit localidad censal code (AR): provincia 2 + departamento 3 + localidad 3. */
    INDEC = 'INDEC',
}
