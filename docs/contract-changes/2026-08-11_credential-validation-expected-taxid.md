# Contract change — credential validation drops `issuerTaxId`, adds `expectedTaxId`

**Date:** 2026-08-11
**Endpoint:** `POST /api/entities/:entityCode/credentials/validate` (H3 — synchronous, called during `POST /integrations`)
**Audience:** core (the external API that calls this service)
**Direction:** core → tax-webprocess-api

---

## TL;DR for core

1. **Stop sending `configuration.issuerTaxId`** on the validate call. This service no longer reads anything
   from `configuration` for ARCA credential validation. (Sending it is harmless — it is ignored — but drop it.)
2. **Start sending a top-level `expectedTaxId`** — the owning company's CUIT, from
   `org.company.identificationNumber`. **Required.**
3. The certificate is now checked to **belong to `expectedTaxId`**. A cert issued to a different CUIT is
   rejected with `TAXID_MISMATCH`.
4. **Issuing calls are unchanged.** `entity.issuerTaxId` still rides every issuing request; only the
   *credential-validation* endpoint changed.

---

## Why

The validate call used to carry two CUITs that, by our data model, are always the same value:

- `configuration.issuerTaxId` — user-entered on the integration form.
- the owning company's CUIT — `org.company.identificationNumber` in core's org record.

Both are supplied by core, so cross-checking them here added complexity without adding an independent
guarantee. The one input this service can verify **independently** is the uploaded certificate, so validation
now anchors on a single authoritative CUIT — `expectedTaxId`, straight from the company record — and proves the
certificate actually belongs to it.

## Request

```jsonc
{
  "environment": "testing",                       // "production" | "testing"
  "configuration": { "webService": "WSFEv1" },    // WSFEv1 | WSMTXCA | WSFEXv1; issuerTaxId no longer read
  "credentials":   { "certPem": "…", "keyPem": "…" },
  "expectedTaxId": "20441917369"                  // REQUIRED — owning company's CUIT (org.company.identificationNumber)
}
```

- `expectedTaxId` — **required**, non-empty string. Formatting is not significant: `"20441917369"` and
  `"20-44191736-9"` are equivalent (the service canonicalizes to the bare 11 digits before matching).
- `configuration` — still required as an object (carries `webService`); ARCA reads nothing from it during
  validation.

## Response

`200 OK` in both the pass and fail cases:

```jsonc
{ "ok": true }
// or
{ "ok": false, "errors": [ { "code": "…", "message": "…" } ] }
```

### Error codes

| `code` | meaning |
| --- | --- |
| `INVALID_TAXPAYER_ID` | `expectedTaxId` does not canonicalize to a valid 11-digit CUIT |
| `CERT_IS_CSR` | `certPem` is a certificate signing request, not an issued certificate |
| `INVALID_CERT` | `certPem` is not a parseable X.509 certificate |
| `INVALID_KEY` | `keyPem` is not a parseable private key |
| `KEY_CERT_MISMATCH` | the private key does not match the certificate |
| `TAXID_MISMATCH` | the CUIT in the certificate subject's `serialNumber` RDN ≠ `expectedTaxId` |

Notes:
- More than one error may be returned at once (e.g. `INVALID_KEY` + `TAXID_MISMATCH`).
- **Structural cert checks win first:** if the certificate is a CSR or unparseable, `TAXID_MISMATCH` is *not*
  also emitted (there is no subject to read).
- The taxpayer match reads only the certificate subject's `serialNumber` RDN (where ARCA embeds
  `CUIT <11 digits>`); a digit run elsewhere in the subject is never mistaken for the taxpayer id.

## Boundary — what did NOT change

The issuer identity on **issuing** calls (`/api/invoices/authorize`, `/lastAuthorized`, `/query`,
`/taxpayers/lookup`) is still `entity.issuerTaxId`, and it is still **required** there — it is the WSAA
`Auth.Cuit`, the ticket-cache partition key `(entityCode, environment, issuerTaxId, service)`, and the QR
emisor CUIT. That field is unrelated to the removed `configuration.issuerTaxId` and is unaffected by this
change. Given issuer ≡ company, core should source `entity.issuerTaxId` from the same company record as
`expectedTaxId`.

## Stored `configuration` schema (this service is the H5 authority)

`issuerTaxId` is removed from the ARCA `configuration` schema:

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["environment", "webService"],
  "additionalProperties": false,
  "properties": {
    "environment": { "enum": ["production", "testing"] },
    "webService":  { "enum": ["WSFEv1", "WSMTXCA", "WSFEXv1"] }
  }
}
```

## Migration checklist for core

- [ ] Add `expectedTaxId` (from `org.company.identificationNumber`) to the validate-credentials request body.
- [ ] Remove `issuerTaxId` from the `configuration` blob sent to / stored for the validate call.
- [ ] Ensure `entity.issuerTaxId` on issuing calls is sourced from the company record (unchanged field, same value).
- [ ] Handle the `TAXID_MISMATCH` / `INVALID_TAXPAYER_ID` error codes at registration (reject the integration).
