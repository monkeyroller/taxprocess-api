# Mint-time guard — reject when issuerTaxId doesn't match the certificate

**Date:** 2026-08-11 · **Status:** BEHAVIOR CHANGE (tax service) · **Repos:** `tax-webprocess-api`
**Affects:** every ticketed endpoint on the credential re-send (`/invoices/*`, `/points-of-sale`, `/taxpayers/lookup`)

## Why

WSAA login authenticates the **certificate** and carries no CUIT in the request, so a credentialed call whose
`entity.issuerTaxId` does not belong to the certificate still logs in successfully and mints a valid ~12h ticket
— cached under the *wrong* issuer identity. The mismatch only surfaces one call later, as an opaque authority
rejection (WSFEv1 `600 ValidacionDeToken: No aparecio CUIT en lista de relaciones`), by which point a ticket has
been burned under the wrong key. This was hit in practice by sending the homologación **dummy** CUIT
`20111111112` as the issuer with a certificate issued to a real CUIT.

## What changed

On the credentialed path, `ticketStore.resolve` now verifies — **before** contacting WSAA — that the
certificate's subject `serialNumber` RDN (the CUIT ARCA embeds as `CUIT <n>`) equals `entity.issuerTaxId`. On a
mismatch it throws `400 ARCA_VALIDATION` with `details.code: "ISSUER_TAXID_CERT_MISMATCH"`; no login is attempted
and no ticket is minted. Both values are canonicalized to bare 11 digits, so formatting (dashes, a `CUIT ` prefix)
never causes a spurious mismatch. This mirrors the registration-time check already performed by
`POST /entities/:entityCode/credentials/validate` (which compares the cert against `expectedTaxId`).

This runs only when credentials are present (the mint path). Cache-hit calls (identity-only, served ticket) are
unaffected.

## Impact on core

- **Additive validation.** Correct requests — where `issuerTaxId` is the CUIT that owns the certificate — are
  unchanged.
- A wrong `issuerTaxId` now fails fast and legibly (`ISSUER_TAXID_CERT_MISMATCH`) instead of minting a stray
  ticket and later returning a confusing `502` token error.
- **Delegation caveat:** this assumes own-CUIT issuance (cert CUIT == issuer CUIT), consistent with the existing
  registration check. If a representative/`gestor` certificate must issue for a *different* CUIT (ARCA WSASS
  delegation), this guard would need to be relaxed to consult the delegated relations instead of a strict equality.

## Verify (homologación)

1. Credentialed call with `issuerTaxId` = the cert's CUIT → proceeds (mints/serves a ticket).
2. Credentialed call with a different `issuerTaxId` (e.g. dummy `20111111112` + a real cert) →
   `400 ARCA_VALIDATION`, `details.code: "ISSUER_TAXID_CERT_MISMATCH"`, no WSAA login attempted.

## Code

- `src/providers/arca/ticket-store.ts` — the guard in `resolve` (uses `certificateSubjectSerialNumber` +
  `canonicalCuit`).
- `src/providers/arca/ticket-store.test.ts` — mismatch, no-CUIT cert, and formatting-agnostic match.
- `docs/CONTRACT.md` — §4 mint-time guard note + §8 `ISSUER_TAXID_CERT_MISMATCH` in the `ARCA_VALIDATION` row.
