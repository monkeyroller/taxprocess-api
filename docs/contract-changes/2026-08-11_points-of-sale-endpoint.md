# Points of sale — enumerate an entity's registered points of sale

**Date:** 2026-08-11 · **Status:** NEW ENDPOINT (tax service) · **Repos:** `tax-webprocess-api`
**Relates to:** `2026-08-10_core-wire-alignment.md` (core owns voucher numbering; needs to pick a `pointOfSaleNumber`)

## Why

Core sends a `pointOfSaleNumber` (ARCA `PtoVta`) on every authorize and last-authorized call, but the service
gave core no way to discover which points of sale the authority actually has registered for the issuer. Picking
a valid point of sale was out-of-band knowledge. ARCA exposes the list via the WSFEv1 `FEParamGetPtosVenta`
operation (same `wsfe` ticket scope / endpoint as the other invoicing calls); this surfaces it neutrally.

## What changed

New endpoint **`POST /api/points-of-sale`** — provider-agnostic, dispatched on `entity.entityCode`. It takes only
the entity/issuer block (no scalar params) and returns every registered point of sale with status flags. It is a
read; it participates in the same `409 CREDENTIALS_REQUIRED` handshake as the other ticketed endpoints.

Request:
```jsonc
{ "entity": { "entityCode": "ARCA", "issuerTaxId": "20123456789", "environment": "testing" } }
```

Response `200`:
```json
{ "pointsOfSale": [
    { "number": 1, "issuanceMode": "CAE",  "blocked": false },
    { "number": 2, "issuanceMode": "CAEA", "blocked": true, "dischargeDate": "2024-01-15T03:00:00.000Z" }
] }
```

Field semantics (neutral → ARCA):
- `number` — the point-of-sale number (ARCA `Nro` / `PtoVta`).
- `issuanceMode` — how the point issues (ARCA `EmisionTipo`, e.g. `CAE`, `CAEA`, `RECE`); **omitted** when the
  authority returns none.
- `blocked` — `true` when the authority has the point blocked (ARCA `Bloqueado = 'S'`).
- `dischargeDate` — ISO-8601 de-registration date, present **only** for a de-registered point (ARCA `FchBaja`);
  the key is **omitted** while the point is active.

Optional keys are omitted when absent (matching `qr`/`taxId` elsewhere in the contract), so a `dischargeDate ==
null` test reads a missing key as "active".

**Non-lossy by design:** the list includes blocked and de-registered points too. Core decides what is usable —
typically `!blocked && dischargeDate == null`. An issuer with no registered points returns `{ "pointsOfSale": [] }`.

**ARCA "no results" quirk:** `FEParamGetPtosVenta` reports an issuer with no electronic points of sale via an
**error** — `602 "Sin Resultados"` — rather than an empty `ResultGet`. The provider normalizes that specific
code to `{ "pointsOfSale": [] }` (a `200`), so "no points registered" is never surfaced as a `502`. Any other
service error propagates unchanged.

## Impact on core

- **Additive.** No change to any existing endpoint or shape.
- Core can call this to validate/enumerate points of sale before authorizing, instead of hard-coding them.
- Same credential handshake: identity-only first; on `409 CREDENTIALS_REQUIRED` re-send with
  `entity.credentials` (§4). Ticket scope is `wsfe` (shared with the invoicing calls).

## Verify (homologación)

1. First call identity-only → `409 CREDENTIALS_REQUIRED` on a cold ticket cache (`details.service: "wsfe"`).
2. Re-send with `entity.credentials` → `200 { "pointsOfSale": [...] }`.
3. Confirm an active point reports `blocked:false`, `dischargeDate:null`; a de-registered one carries an ISO
   `dischargeDate`.
4. An unknown `entityCode` → `400 UNKNOWN_ENTITY`.

## Code

- `src/http/controllers/points-of-sale.controller.ts` — the `POST /points-of-sale` handler (registered in `src/index.ts`).
- `src/http/dto/invoice.dto.ts` (`PointsOfSaleRequestDto`), `src/http/dto/neutral-result.dto.ts`
  (`PointOfSaleDto`, `PointsOfSaleResultDto`).
- `src/providers/provider.ts` — `TaxEntityProvider.pointsOfSale` (neutral contract).
- `src/providers/arca/arca.provider.ts` — ARCA implementation; `toNeutralPointOfSale` in `ar-invoice.mapper.ts`.
- `src/providers/arca/sdk/**` — WSFEv1 `FEParamGetPtosVenta` operation (`getPointsOfSale` on the invoice service
  base + `CommonInvoiceService` override; `PointOfSaleInfo` in `sdk/core/types.ts`).
- Tests: `src/providers/arca/sdk/invoicing/common/common-invoice.service.test.ts` (parse),
  `src/providers/arca/arca.provider.test.ts` (neutral mapping).
- `docs/CONTRACT.md` — new `/points-of-sale` endpoint + glossary rows.
