# Contract resolution — `concept` in the neutral invoice

**Date:** 2026-08-07 · **Status:** RESOLVED (Option 1) · **Repos:** `tax-webprocess-api` ⇄ `webprocess-api` (core)
**Companion:** `webprocess-api/docs/contract-changes/2026-08-07_neutral-invoice-concept.md` (core-side mirror)

Captured symmetrically on both sides so the two repos don't drift. This resolves the one open question from
the generalization cutover ([tax-api-generalization-handoff.md](../tax-api-generalization-handoff.md), H4/H5):
**where does the invoice `concept` (goods/services/both) come from in the neutral invoice?**

## The question

The handoff spec was self-contradictory about `concept` (ARCA `WSFEv1.Concepto`: `1` = goods, `2` = services,
`3` = both):

- the neutral-invoice **example JSON omitted `concept`**;
- but **H5 listed `concept`/`conceptTypeId` under ARCA `provider_metadata`** (the blob this service returns for
  core to persist);
- yet ARCA **requires** it on every voucher, and it varies invoice-to-invoice — so it can't be a fixed
  per-integration setting.

## Resolution — Option 1 (confirmed against core code)

**`concept` is a per-invoice field that core sends in the `invoice` body**, as a `1|2|3`. No DTO or mapper
change on the tax-API side; this matches what was shipped in the cutover.

**Not a contradiction with `provider_metadata`:** `concept` is an **input** on `authorize` (in the body). The
`provider_metadata` blob is **core-owned** — core populates `conceptTypeId` itself from the `concept` it sent
(`electronic-invoice.service.ts:129`), not from anything this service derives. To keep the wire stable and
forward-compatible, this service **always returns a `providerMetadata` object** on `authorize`/`query`, but
derives no fields of its own today, so it returns **`{}`**. (Resolution (a): core owns the contents; the
service guarantees the envelope. Switch to service-populated only if a future authority-derived field appears.)

### Where it comes from today (core)
Core already owns `concept` and puts it in the payload, but it is a **hardcoded constant `1` (goods)** — not
yet derived:

```ts
// core: src/app/services/protected/transactions/argentina-invoice-payload.ts:11-12,50
export const CONCEPT_PRODUCTOS = 1;
...
concept: CONCEPT_PRODUCTOS,
```
```ts
// core: electronic-invoice.service.ts:129  — echoed into the persisted record
providerMetadata: {conceptTypeId: CONCEPT_PRODUCTOS},
```

So at cutover every voucher core sends carries `concept: 1`, and core will **not** send `serviceDateFrom/To`
or `paymentDueDate` yet (those are only required by ARCA for concept 2/3).

### Where derivation will live (future — core's job)
The eventual `1|2|3` derivation stays entirely in core; the tax API will still just receive the resolved value
in the body. It will **not** come from document type (Factura A/B/C is orthogonal to goods-vs-services) and
**not** from per-integration config (it varies per invoice).

**Cross-repo caveat:** core's domain has no clean goods-vs-services axis today. The nearest thing,
`common.product_nature` (`PRODUCT=1 / CONCEPT=2 / FREIGHT=3`), is a stock-behavior classification, **not** the
AFIP `servicios` concept. So "start sending 2/3" is a **modeling decision in core** (introduce a service flag /
map natures → concept / decide the mixed-basket → 3 rule), not a mapper tweak. Until that lands, the tax API
only ever sees `concept: 1`.

## Net for the merge

- ✅ **No DTO/mapper change on the tax-API side.** Option 1 as already implemented.
- **Contract to hold:** `concept` is **required** in the invoice body, value `1|2|3`; `serviceDateFrom`,
  `serviceDateTo`, `paymentDueDate` are required-for-2/3. (Already enforced — see the field table below.)
- **Do not** optimize for "core only ever sends 1." That is core's current stub, not the contract. When core
  turns on services, nothing on the tax-API side should need to change.

---

## Appendix — exact wire shapes the tax API expects (for diffing against core)

All ids are core's own generic ids; the tax API maps them to real ARCA codes internally. Unknown
`documentTypeId`/`fiscalConditionId`/`identificationTypeId` → `400 ARCA_VALIDATION`, so the id sets must match
the catalog dump the maps are seeded from (`src/providers/arca/code-maps.ts`). **Status:** the maps are now
seeded from the authoritative `common` catalog dump (both the legacy 1–213 and 1xxx `document_type` id-sets,
including the `id ≠ arca_code` divergences; identity `fiscal_condition` and `identification_type` sets).

### `entity` block (on every call)

| field | type | required | notes |
|---|---|---|---|
| `entityCode` | string | ✅ | `"ARCA"`; unknown → `400 UNKNOWN_ENTITY` |
| `issuerTaxId` | string | ✅ | issuing CUIT as a string, digits only |
| `environment` | `"production"` \| `"testing"` | ✅ | generic; mapped to produccion/homologacion internally |
| `credentials` | `{ certPem, keyPem }` | omit first | attached only on the `CREDENTIALS_REQUIRED` re-send |

### `POST /api/invoices/authorize` → `{ entity, invoice }`

| `invoice` field | type | required | → ARCA |
|---|---|---|---|
| `documentTypeId` | int > 0 | ✅ | `CbteTipo` |
| `concept` | `1` \| `2` \| `3` | ✅ | `Concepto` |
| `salesPointNumber` | int > 0 | ✅ | `PtoVta` |
| `receiver.identificationTypeId` | int ≥ 0 | ✅ | `DocTipo` |
| `receiver.identificationNumber` | string (≥1 char) | ✅ | `DocNro` (`"0"` for anonymous) |
| `receiver.fiscalConditionId` | int > 0 | ✅ | `CondicionIVAReceptorId` |
| `currencyIso` | string, len 3 | ✅ | `MonId` |
| `currencyRate` | number > 0 | ✅ | `MonCotiz` |
| `issueDate` | ISO-8601 date | ✅ | `CbteFch` (±5-day clamp for concept 1) |
| `lines[].netAmount` | number | ✅ | |
| `lines[].taxRatePercent` | number ≥ 0 | ✅ | e.g. 21, 10.5, 0 |
| `lines[].taxAmount` | number ≥ 0 | ✅ | |
| `totals.untaxed` | number ≥ 0 | ⛔ | `ImpTotConc` |
| `totals.exempt` | number ≥ 0 | ⛔ | `ImpOpEx` |
| `totals.perceptions` | number ≥ 0 | ⛔ | `Tributos` (single "Otros" id 99) |
| `serviceDateFrom` | ISO-8601 date | ⛔ | `FchServDesde` — required for concept 2/3 |
| `serviceDateTo` | ISO-8601 date | ⛔ | `FchServHasta` — required for concept 2/3 |
| `paymentDueDate` | ISO-8601 date | ⛔ | `FchVtoPago` — required for concept 2/3 |

### Other endpoints (besides the `entity` block)

| endpoint | body |
|---|---|
| `POST /api/invoices/last-authorized` | `salesPointNumber` (int>0), `documentTypeId` (int>0) |
| `POST /api/invoices/query` | `salesPointNumber` (int>0), `documentTypeId` (int>0), `voucherNumber` (int>0) |
| `POST /api/taxpayers/lookup` | `taxpayerId` (string, subject to look up), `level?` (`A4`\|`A5`\|`A10`\|`A13`, default `A5`) |
| `POST /api/entities/:entityCode/credentials/validate` | `environment`, `configuration` (object), `credentials` `{certPem,keyPem}` |

**Diff notes:**
- `identificationNumber` and `issuerTaxId` are **strings**, not numbers (avoids JS 53-bit int issues on CUITs).
- `taxpayerId` (lookup subject) is deliberately distinct from `issuerTaxId` (the issuer) — do not conflate.
