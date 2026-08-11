# Idempotent authorize — return the existing CAE when a voucher number is re-sent

**Date:** 2026-08-11 · **Status:** BEHAVIOR CHANGE (tax service) · **Repos:** `tax-webprocess-api`
**Follows:** `2026-08-10_core-wire-alignment.md` (core now owns voucher numbering and sends it)

## Why

Since core owns the voucher number (`voucherNumberFrom`/`voucherNumberTo` on the invoice), a burned-voucher gap
became reachable: the authority authorizes number `N` and issues a CAE, but core's persistence then fails and
rolls back. Core has no record; the authority does. Re-sending `N` to `POST /api/invoices/authorize` used to
fail again — the authority reports `N` is not the next to authorize (error **10016**), surfaced as a neutral
`REJECTED` (→ `422`). The CAE the authority actually granted could never be recovered through the authorize path,
so the sale was permanently stuck.

## What changed

`POST /api/invoices/authorize` is now **idempotent on the voucher number**:

- On the happy path (a fresh, correctly-sequenced number) behavior is unchanged: authorize once, return the CAE.
- When the authority reports the number is already authorized (a `10016` rejection, or the equivalent thrown
  error), the service reconciles internally via the authority's voucher query (`FECompConsultar`) — the only
  operation that returns a stored CAE. If `N` is genuinely authorized, the service returns that CAE as a complete
  `200` result **with the QR rebuilt**, instead of the rejection.
- If the number is *not* actually authorized (e.g. it is ahead of the sequence), the original `REJECTED`/error is
  surfaced unchanged — the query result, not the ambiguous `10016` code, decides.
- **Mismatch guard:** if `N` is already authorized but for a *different amount* than the invoice being sent, the
  service refuses to return the CAE and responds `400 ARCA_VALIDATION` with code
  `VOUCHER_ALREADY_AUTHORIZED_MISMATCH`, rather than handing back a fiscal document for the wrong invoice.

There is no double issuance: the authority still refuses to re-issue; the service only *reads back* the existing CAE.

## Impact on core

- **No request/response shape change.** Same `authorize` body and same `200` result shape.
- Core may now treat a plain retry of the *same invoice with the same number* as safe: it either issues the CAE
  or returns the existing one. `POST /api/invoices/query` remains available for explicit, caller-driven recovery.
- Core must keep re-sending the **same number and same amount** on a retry. A different amount for an
  already-used number is a client error (`VOUCHER_ALREADY_AUTHORIZED_MISMATCH`), not a recovery.

## Verify (homologación)

1. Authorize a fresh number `N` → `200`, CAE returned.
2. Re-send the same invoice with the same `N` → `200`, **same** CAE, QR present (recovery path). Confirm whether
   the authority delivered `10016` as a soft `R` result or a thrown error.
3. Re-send `N` with a different total → `400 VOUCHER_ALREADY_AUTHORIZED_MISMATCH`.
4. Send a number far ahead of the sequence → original `REJECTED`/error passes through (no false recovery).

## Code

- `src/providers/arca/arca.provider.ts` — `authorizeInvoice` reconciliation + `recoverAuthorizedVoucher` helper.
- `src/providers/arca/arca.provider.test.ts` — recovery, non-recovery, mismatch, thrown-conflict, happy-path.
- `docs/CONTRACT.md` — updated `/invoices/authorize` voucher-number + idempotency notes.
