/**
 * The closed vocabularies a taxpayer-registry answer is described with, shared by every provider.
 *
 * Each is a value a caller matches on rather than displays, so the rules governing `address-code-scheme/`
 * apply: member values are the contract and names are not, adding a member is additive while changing one is
 * breaking, and a token names a concept rather than a role.
 *
 * One declaration rather than the two identical copies these were, which the ARCA mapper assigned straight
 * across on structural identity alone — a member added on one side would simply not arrive.
 *
 * Dependency-free, like every provider-owned vocabulary: the taxpayer DTO imports these and
 * `neutral-results.ts` imports that DTO back, so a path from here into `http/dto` would close a cycle
 * through the decorated DTO classes.
 */

/**
 * Which kind of registry answer a taxpayer lookup produced. The services behind these are complementary
 * rather than nested — one knows the tax picture, the other the person — so this tells a caller which fields
 * could be populated at all. Derived from the identification type sent, never chosen on the wire.
 */
export type TaxpayerDetail = 'REGISTRATION' | 'IDENTITY';

/** Whether the taxpayer is a natural person or an organization. */
export type TaxpayerPersonType = 'INDIVIDUAL' | 'LEGAL_ENTITY';

/**
 * Whether the taxpayer's registration is currently active. Two members rather than a spectrum: authorities
 * report many flavours of not-active in their own wording, and a caller can act on only one distinction —
 * may I invoice this party. Which of an authority's states map to `INACTIVE` is that provider's reading.
 */
export type TaxpayerRegistrationStatus = 'ACTIVE' | 'INACTIVE';
