# Query returns `404 VOUCHER_NOT_FOUND` for a never-issued voucher (was an opaque `502`)

**Date:** 2026-08-13 · **Status:** BEHAVIOR CHANGE (tax service) · **Repos:** `tax-webprocess-api`, core
**Affects:** `POST /api/invoices/query`

## Why

`POST /api/invoices/query` had no not-found handling. For a voucher the authority never issued, ARCA's
`FECompConsultar` returns a `602 "No existe el comprobante"` `Errors` block, which the SDK throws as
`ArcaServiceError` → the error mapper turned **every** `ArcaServiceError` into `502 ARCA_SERVICE`. So a
genuine not-found was indistinguishable, on the wire, from an authority transport/token failure.

That ambiguity breaks core's **orphan reconciliation**. When a sale is left PENDING after an authorize whose
response never persisted, core queries the authority to decide whether the voucher was in fact issued.
Reconciliation clears + re-authorizes only on a *definite* "never issued" signal; any other outcome keeps the
sale PENDING and retries. With not-found collapsed into `502`, that definite signal never arrived — the query
re-threw on every attempt and the orphan was **stuck PENDING forever, never re-authorizable**.

Note the pre-existing asymmetry this closes: `points-of-sale` already normalized ARCA's `602` (empty list,
never a `502`), and the authorize idempotency path already swallowed a not-found query internally — but the
standalone `/query` endpoint did neither.

## What changed

`ArcaProvider.queryVoucher` now catches an `ArcaServiceError` carrying ARCA code `602` and throws the neutral
`VoucherNotFoundError`, which the error mapper renders as:

```json
404 { "error": { "code": "VOUCHER_NOT_FOUND",
                 "message": "...",
                 "details": { "entityCode": "ARCA", "pointOfSaleNumber": 3,
                              "documentTypeCode": 1, "voucherNumber": 42 } } }
```

Only code `602` is translated. Every other `ArcaServiceError` (token `600`, business rejections, transport)
still propagates as `502` unchanged — an ambiguous failure must **not** masquerade as not-found, or core could
clear an orphan that was actually already authorized and issue a second fiscal document.

`VoucherNotFoundError` is a provider-agnostic domain error (in `provider.ts`, alongside `UnknownEntityError`),
so a future entity (SII, SAT) raises the same neutral `404` from its own not-found code.

## Impact on core

- **Reconciliation must branch on `404 VOUCHER_NOT_FOUND`** as the "never issued → safe to clear +
  re-authorize" signal. Previously this case surfaced as `502 TAX_SERVICE_ERROR` and was (correctly) treated
  as retryable-but-not-clearable — which is exactly why the orphan never cleared.
- **Keep the existing `502` behavior for every other query failure:** stay PENDING, retry later. Do **not**
  clear an orphan on a `502`/timeout.
- `404` is now a possible status on `/invoices/query` only. Other endpoints are unaffected.

## Verify (homologación)

1. Query a voucher number that was never authorized on `(pointOfSale, documentType)` →
   `404 VOUCHER_NOT_FOUND`, `details` echoing the four query coordinates.
2. Query an existing authorized voucher → `200` with `status:"AUTHORIZED"` and its stored CAE (unchanged).
3. Force a token failure (e.g. expired ticket) on query → still `502 ARCA_SERVICE`, **not** `404`.

## Code

- `src/providers/provider.ts` — new `VoucherNotFoundError`.
- `src/providers/arca/arca.provider.ts` — `queryVoucher` translates ARCA `602` (`VOUCHER_NOT_FOUND_CODE`).
- `src/http/error-mapper.ts` — `VoucherNotFoundError` → `404 VOUCHER_NOT_FOUND` (+ details).
- `src/providers/arca/arca.provider.test.ts` — not-found → error, non-602 propagates, existing voucher.
- `src/http/error-mapper.test.ts` — `404 VOUCHER_NOT_FOUND` mapping + details.
- `docs/CONTRACT.md` — `/invoices/query` not-found note + §8 error-table row.
