/**
 * The coding systems a `unitOfMeasureCode` may be drawn from — a closed vocabulary shared by every provider.
 *
 * One member today, and the field it names is optional with that member as the default, so nothing on the
 * wire has to spell it yet. It exists because a code means nothing without the catalogue it came from, which
 * is the same argument `AddressCodeScheme` makes for addresses: with the scheme named, adding a second
 * standard is an additive member rather than a breaking reinterpretation of every value already sent.
 *
 * That last claim is only true if a provider *reads* the field, so each one refuses the schemes it does not
 * implement — ARCA's is `assertUnitOfMeasureScheme` in `arca-rec20-units.ts`. Without it a second member
 * would be exactly the silent reinterpretation this vocabulary exists to prevent: a Rec 21 code read
 * against the Rec 20 table and reported as unknown, when it is a real code in the catalogue the caller
 * named.
 *
 * **A separate enum from `AddressCodeScheme`, deliberately.** That vocabulary's contract is that "the pair
 * alone identifies the catalog without the caller needing to know which level it came from" — a guarantee
 * about address levels, which widening it to units would quietly make false.
 *
 * Note what is *not* here: no member for an authority's own unit numbering. ARCA's `Pro_umed` is reachable
 * through no scheme, because the whole point of this field is that units are standard. What an authority
 * cannot express in Rec 20, this service refuses — see `UNSUPPORTED_UNIT_OF_MEASURE` in
 * `arca-rec20-units.ts`.
 */
export enum UnitOfMeasureCodeScheme {
    /**
     * UN/ECE Recommendation 20 common code (`"KGM"`, `"C62"`, `"ZZ"`). This service carries a curated subset
     * of Rev 17 (2021) — see `rec20-units.data.ts` for the rule and the snapshot it was taken at.
     */
    UN_ECE_REC20 = 'UN-ECE-REC20',
}
