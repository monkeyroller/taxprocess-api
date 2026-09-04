/**
 * Which of an entity's web services a request is for — the value of the entity's `configuration.webService`
 * (contract §7), sent explicitly by core.
 *
 * A **selector**, not a canonical fiscal code: the provider does not translate it into an authority value,
 * it uses it to decide which of the authority's services answers, and therefore which catalogues, which
 * point-of-sale register and which idempotency scheme apply.
 *
 * Naming ARCA's services here rather than a neutral abstraction is deliberate and already settled: §7
 * publishes this enum as part of the per-entity `configuration` schema this service is the authority on, and
 * core already sends that blob to `credentials/validate`. A future entity supplies its own members the same
 * way it supplies its own id→code maps.
 */
export type WebService = 'WSFEv1' | 'WSMTXCA' | 'WSFEXv1';

/**
 * The runtime companion of the union, so a DTO validator cannot keep accepting an old set after a member is
 * added — the reason `GENERIC_ENVIRONMENTS` and `NEUTRAL_INVOICE_CONCEPTS` exist in the same shape.
 */
export const WEB_SERVICES = ['WSFEv1', 'WSMTXCA', 'WSFEXv1'] as const;
