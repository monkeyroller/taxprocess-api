# Rename `salesPointNumber` → `pointOfSaleNumber` (and points-of-sale terminology)

**Date:** 2026-08-11 · **Status:** BREAKING (wire) · **Repos:** `tax-webprocess-api` + **`webprocess-api` (core)**
**Relates to:** `2026-08-11_points-of-sale-endpoint.md` (the new listing endpoint uses the same terminology)

## Why

The neutral field for the ARCA `PtoVta` (Punto de Venta) was `salesPointNumber`. "Point of sale" is the accurate
term (it *is* ARCA's *Punto de Venta*), so the contract now uses **points of sale / point-of-sale** consistently
across the invoice fields, the new listing endpoint, its response, and all docs.

## What changed (wire)

**Request field, on every invoice endpoint** — `salesPointNumber` → **`pointOfSaleNumber`**:
- `POST /api/invoices/authorize` — `invoice.salesPointNumber` → `invoice.pointOfSaleNumber`
- `POST /api/invoices/last-authorized` — `salesPointNumber` → `pointOfSaleNumber`
- `POST /api/invoices/query` — `salesPointNumber` → `pointOfSaleNumber`

**Listing endpoint (introduced same day, so no prior consumers):**
- Route `POST /api/sales-points` → **`POST /api/points-of-sale`**
- Response key `{ "salesPoints": [...] }` → **`{ "pointsOfSale": [...] }`**

Nothing else changes — same types (`number`), same semantics (ARCA `PtoVta`), same validation
(`@IsInt @IsPositive`). The ARCA wire schema (`PtoVta`, `FEParamGetPtosVenta`) is unchanged; this is purely the
neutral-contract field name.

## Impact on core (action required)

Core **must** rename the field it sends on the three invoice endpoints:

```diff
  "invoice": {
    "documentTypeId": 1,
-   "salesPointNumber": 1,
+   "pointOfSaleNumber": 1,
    ...
  }
```
and on `last-authorized` / `query` bodies (`salesPointNumber` → `pointOfSaleNumber`). Because
`forbidNonWhitelisted` is on, a stale `salesPointNumber` is **rejected with `400 BadRequestError`** (its
`details` will show `pointOfSaleNumber` as the missing required field) — so this fails loudly, not silently.

No consumer action for `/points-of-sale`: it had no prior release.

## Verify

1. `authorize` / `last-authorized` / `query` with `pointOfSaleNumber` → behave exactly as before.
2. The same requests with the old `salesPointNumber` → `400` (missing `pointOfSaleNumber` + non-whitelisted key).
3. `POST /api/points-of-sale` → `{ "pointsOfSale": [...] }`; old `POST /api/sales-points` → `404`.

## Code

Mechanical rename across `src/**` and `docs/**`: neutral `pointOfSaleNumber` (DTOs, `NeutralInvoice`, controllers,
mapper, QR params, SDK request/param names) and the listing feature (`PointOfSaleDto`, `PointsOfSaleResultDto`,
`PointsOfSaleController` → `points-of-sale.controller.ts`, `pointsOfSale()`, `getPointsOfSale`, `PointOfSaleInfo`,
`toNeutralPointOfSale`). ARCA wire tokens (`PtoVta`, `FEParamGetPtosVenta`, `PtoVenta`) left untouched.
