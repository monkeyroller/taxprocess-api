# Next numbers — batch "next expected voucher number" lookup

**Date:** 2026-08-12 · **Status:** NEW ENDPOINT (tax service) · **Repos:** `tax-webprocess-api`
**Relates to:** `2026-08-10_core-wire-alignment.md` (core owns voucher numbering), `2026-08-11_points-of-sale-endpoint.md`
**Handoff:** `webprocess-api/docs/tax-api/2026-08-12_next-voucher-numbers-batch.md`

## Why

Core owns the voucher number it sends to be authorized, drawn from a per-point-of-sale numerator. The
authority keeps its own correlative per (point-of-sale number, document type), and the two can drift —
vouchers authorized outside this system, a failed/retried authorization, a freshly created point of sale.
On drift the authority rejects the authorization (AR: `10016`, surfaced as `FISCAL_AUTHORIZATION_REJECTED`).

Core now offers an operator-driven **numerator sync**: per document type of a point of sale, show the
authority's next expected number next to core's current one, then let the operator realign them. That
preview must ask "what is the next number you expect?" for **several** document types of one point of sale
at once. `POST /invoices/last-authorized` already answers the single-document-type question, but one call per
document type means a separate HTTP round-trip each (each a potential `CREDENTIALS_REQUIRED` handshake). This
endpoint answers the whole set in one call and keeps the "next" semantics (`next = last + 1`) on the
tax-entity side, so core stays agnostic.

## What changed

New endpoint **`POST /api/invoices/next-numbers`** — provider-agnostic, dispatched on `entity.entityCode`. It
takes the entity/issuer block, a `pointOfSaleNumber`, and a non-empty `documentTypeCodes` array, and returns
the next expected number per code. Read-only / side-effect-free; participates in the same
`409 CREDENTIALS_REQUIRED` handshake as the other `wsfe`-scoped endpoints.

Request:
```jsonc
{ "entity": { "entityCode": "ARCA", "issuerTaxId": "20123456789", "environment": "testing" },
  "pointOfSaleNumber": 3,
  "documentTypeCodes": [1, 6, 11] }   // canonical fiscal codes (AR: each a CbteTipo); non-empty
```

Response `200`:
```json
{ "numbers": [
    { "documentTypeCode": 1,  "nextNumber": 18 },
    { "documentTypeCode": 6,  "nextNumber": 5  },
    { "documentTypeCode": 11, "nextNumber": 1  }
] }
```

Behavior:
- Per code, `nextNumber` = the authority's next expected correlative (AR: `FECompUltimoAutorizado` + 1). A
  document type never authorized on this point of sale returns `nextNumber: 1` (AR: last-authorized `0` + 1).
- **Echoes every requested code** in `numbers` (order-independent; core maps back by `documentTypeCode`).
- **Read-only.** Unlike `authorize`, it consumes no voucher number — core calls it with retry-on-5xx.
- **Fail-fast, no silent omission.** An unrecognized canonical code fails the whole batch with the standard
  error envelope (`400 ARCA_VALIDATION`, `details.code: "UNKNOWN_CODE"`), validated up front before any
  authority call; an authority error on any code propagates as `502 ARCA_SERVICE`.

**ARCA specifics stay inside the provider.** WSFEv1 has no batch operation for this; the provider resolves
the WSAA ticket once and fans out `FECompUltimoAutorizado` per code on a single ticket + service instance.

## Impact on core

- **Additive.** No change to `last-authorized`, `authorize`, or any other route (older core simply does not
  call it).
- Core replaces N `last-authorized` round-trips for the numerator-sync preview with one call.
- Same credential handshake: identity-only first; on `409 CREDENTIALS_REQUIRED` re-send with
  `entity.credentials` (§4). Ticket scope `wsfe` (shared with the invoicing calls).

## Verify (homologación)

1. Identity-only on a cold ticket cache → `409 CREDENTIALS_REQUIRED` (`details.service: "wsfe"`).
2. Re-send with `entity.credentials` → `200 { "numbers": [...] }`.
3. A mixed set where some codes have prior authorizations and some do not → each `nextNumber` is `last + 1`,
   never-authorized ones return `1`.
4. A response with codes in any order still pairs correctly by `documentTypeCode`.
5. An unknown `documentTypeCode` → `400 ARCA_VALIDATION` (`details.code: "UNKNOWN_CODE"`), whole batch fails.
6. An unknown `entityCode` → `400 UNKNOWN_ENTITY`.

## Code

- `src/http/controllers/invoices.controller.ts` — the `POST /invoices/next-numbers` handler.
- `src/http/dto/invoice.dto.ts` (`NextNumbersRequestDto`), `src/http/dto/neutral-result.dto.ts`
  (`NextNumberDto`, `NextNumbersResultDto`).
- `src/providers/provider.ts` — `TaxEntityProvider.nextNumbers` (neutral contract) + `NextNumbersResult`.
- `src/providers/arca/arca.provider.ts` — ARCA implementation (validate codes up front, resolve ticket once,
  fan out `getLastAuthorizedNumber`, return `last + 1`).
- `src/providers/arca/sdk/**` — reused unchanged (`getLastAuthorizedNumber` / WSFEv1 `FECompUltimoAutorizado`).
- Tests: `src/providers/arca/arca.provider.test.ts` (`ArcaProvider.nextNumbers` + `NextNumbersRequestDto`).
- `docs/CONTRACT.md` — new `/invoices/next-numbers` endpoint in §3.
