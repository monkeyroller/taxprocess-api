/**
 * How a credit-invoice document is put into circulation (AR: Factura de Crédito Electrónica).
 *
 * **This contract's own catalogue, not an authority's numbering.** ARCA expresses the same choice as an
 * `Opcionales` entry under id `27`, and that id — like every other entity code — stays inside the provider.
 *
 * `"SCA"` coinciding with ARCA's own literal deserves a word, since it looks like a fiscal code leaking
 * onto the wire. It is not: the members here are named after the régimen's two circulation systems, which
 * are facts about the instrument rather than about one authority's field encoding, and nothing here is
 * translated *from* an ARCA value — the provider maps these to whatever ARCA wants. The distinction is the
 * one `unitOfMeasureCode` had to learn: a vocabulary looks unavoidable right up until you notice it is two
 * vocabularies sharing a field. If a second entity ever spells these differently, it supplies its own map
 * and this union does not move.
 *
 * - `SCA` — Sistema de Circulación Abierta. The régimen's default, and what the provider assumes when a
 *   caller names no mode, so one with no opinion need not carry the field at all.
 * - `ADC` — Agente de Depósito Colectivo.
 */
export type TransmissionMode = 'SCA' | 'ADC';

/**
 * The runtime companion of the union, so a DTO validator cannot keep accepting an old set after a member is
 * added — the reason `WEB_SERVICES` exists in the same shape.
 */
export const TRANSMISSION_MODES = ['SCA', 'ADC'] as const;
