# arca-webprocess-api — HTTP contract & core-side obligations

Audience: the **`webprocess-api`** (core) team. This is the integration contract between the core API and the
standalone Argentina tax service, plus what core must implement on its side (the WSAA ticket minting and the
retry client). Nothing here requires changes to this service — it is already implemented against this contract.

---

## 1. Model: "split WSAA", core-driven (unidirectional)

- **Core owns credentials + minting.** The cert/key store and `ARCA_MASTER_KEY` stay in `webprocess-api`.
  Core performs WSAA login/CMS-signing and mints the ~12h ticket. **The private key never leaves core.**
- **This service owns the ticket cache + WSFEv1/padrón calls.** It never mints, never holds the key, and
  **makes no outbound calls** — core always initiates.
- **Renewal handshake:** a request carries only issuer **identity**. On a cache miss this service replies
  `409 TICKET_REQUIRED`; core mints a ticket and **re-sends the same request with the ticket attached**.

```
core ──(1) POST /invoices/authorize {issuer:{cuit,environment}, invoice}──▶ arca-service
core ◀─(2) 409 {code:"TICKET_REQUIRED", cuit, service, environment}──────── arca-service   (cache miss)
core ──(3) mint ticket (WSAA loginCms, holds the key) ─────────────────────  (internal to core)
core ──(4) POST /invoices/authorize {issuer:{cuit,environment,ticket}, invoice}─▶ arca-service
core ◀─(5) 200 {authorizationCode, expiration, authorizedNumber, qr, ...}──── arca-service
```

On a warm cache, step (1) returns 200 directly. A minted ticket is reused for ~12h, so (2)–(4) happen roughly
once per 12h per `(cuit, service)`.

---

## 2. Base URL, auth, environments

- Base path: `/api`. Transport: HTTP/JSON. In production this hop must be **mTLS** on a private network; this
  service performs no user auth (callers are trusted).
- `environment`: `"homologacion" | "produccion"` (selects the ARCA endpoints).
- All amounts are JSON numbers (2-decimal semantics). Dates in requests are ISO-8601; dates in responses are
  ISO-8601 (the ARCA `yyyymmdd` form is internal to this service).

### Issuer identity block (the `issuer` field)

```jsonc
{
  "countryCode": "AR",            // discriminator; only AR today
  "cuit": 20123456789,            // issuing CUIT, digits only
  "environment": "homologacion",
  "ticket": {                     // OMITTED on first send; ATTACHED by core on a TICKET_REQUIRED re-send
    "token": "<wsaa token>",
    "sign":  "<wsaa sign>",
    "expiration": "2026-08-05T21:00:00.000Z"   // ISO-8601, from the WSAA ticket
  }
}
```

---

## 3. Endpoints

All invoice endpoints authenticate against the WSFEv1 service (`wsfe`); `/taxpayers/lookup` uses the padrón
service for the chosen level. Every endpoint may respond `409 TICKET_REQUIRED` (see §4).

### `GET /api/health`
Liveness. `200 → { "status":"ok", "service":"arca-webprocess-api", "uptimeSeconds": <n> }`. No auth.

### `POST /api/authority/status`
WSFEv1 `FEDummy`. Body `{ "environment": "homologacion" }`. No ticket needed.
`200 → { "appServer":"OK", "dbServer":"OK", "authServer":"OK" }`.

### `POST /api/invoices/authorize`
Requests a CAE. The caller supplies **already-resolved ARCA codes** (see §5).

Request:
```jsonc
{
  "issuer": { "countryCode":"AR", "cuit":20123456789, "environment":"homologacion" },
  "invoice": {
    "voucherType": 1,                 // ARCA CbteTipo (1=Factura A, 6=B, 11=C, …). Caller-resolved.
    "concept": 1,                     // 1=productos, 2=servicios, 3=ambos
    "salesPointNumber": 1,            // PtoVta
    "receiverIvaConditionId": 1,      // CondicionIVAReceptorId (RG 5616). Caller-resolved.
    "receiverDocType": 80,            // DocTipo (80=CUIT, 96=DNI, 99=consumidor final)
    "receiverDocNumber": 20111111112, // 0 for anonymous consumidor final
    "currency": "ARS",                // ISO-4217 → mapped to MonId by this service
    "currencyRate": 1,                // MonCotiz
    "issueDate": "2026-08-05",        // ISO date; clamped to ±5 days for concept 1
    "lines": [
      { "netAmount": 100, "vatRatePercent": 21, "vatAmount": 21 }
    ],
    "untaxedTotal": 0,                // optional (ImpTotConc)
    "exemptTotal": 0,                 // optional (ImpOpEx)
    "perceptionsTotal": 0,            // optional → single Otros(99) tribute
    "serviceDateFrom": "2026-08-01",  // optional; required by ARCA for concept 2/3
    "serviceDateTo":   "2026-08-31",  // optional
    "paymentDueDate":  "2026-09-10"   // optional
  }
}
```

Responses:
- `200` (approved):
  ```json
  { "authorizationCode":"75123456789012", "expiration":"2026-08-15T03:00:00.000Z",
    "authorizedNumber":42, "qr":"https://www.arca.gob.ar/fe/qr/?p=...",
    "status":"AUTHORIZED", "observations":[] }
  ```
- `422` (rejected/partial): same shape, `status:"REJECTED"|"PARTIAL"`, empty `authorizationCode`, populated
  `observations`.

**Voucher number:** this service asks ARCA for the last authorized number and uses `+1` — the caller does not
send it. **Idempotency (important):** if ARCA authorizes but core's own persistence then fails, the voucher
number is consumed at ARCA. On retry, call `POST /invoices/query` to recover the already-authorized voucher
instead of re-authorizing.

### `POST /api/invoices/last-authorized`
Body `{ "issuer": {...}, "salesPointNumber": 1, "voucherType": 1 }` → `200 { "number": 42 }`.
(POST, not GET — it carries the issuer block and may need the ticket on a re-send.)

### `POST /api/invoices/query`
Body `{ "issuer": {...}, "salesPointNumber": 1, "voucherType": 1, "voucherNumber": 42 }` → same shape as
`authorize`'s result (WSFEv1 `FECompConsultar`).

### `POST /api/taxpayers/lookup`
Body `{ "issuer": {...}, "taxpayerId": 20111111112, "level": "A5" }` → `200 { "idPersona":…, "taxId":…, "name":… }`.
`level` ∈ `A4|A5|A10|A13` (default `A5`). NOTE: the SDK's padrón `parseTaxpayer` is still a seed, so this
currently returns `501` after the SOAP call until the SDK level is implemented. The ticket handshake for the
padrón service id is already wired.

---

## 4. The `TICKET_REQUIRED` handshake (core must implement the retry)

Any authenticated endpoint may respond:
```
409 Conflict
{ "error": { "code":"TICKET_REQUIRED",
             "message":"...",
             "details": { "cuit":20123456789, "service":"wsfe", "environment":"homologacion" } } }
```

Core's `ArgentinaTaxClient` must:
1. Send the request with issuer identity and **no** ticket.
2. On `409 TICKET_REQUIRED`, read `details.{cuit, service, environment}`, **mint** a ticket (§6), and
   **re-send the identical request** with `issuer.ticket = { token, sign, expiration }`.
3. Treat a second `409` as an error (avoid infinite retry). One retry is sufficient.

`service` values: `wsfe` (invoicing) and `ws_sr_padron_a4|a5|a10|a13` (lookups). Cache the minted ticket
core-side keyed by `(cuit, service, environment)` and reuse it for ~12h so most requests skip the handshake.

---

## 5. Resolved codes the caller supplies (from core's DB catalogs)

Because the contract is pragmatic (not fully country-neutral), core resolves these from its existing catalogs
before calling — exactly as `electronic-invoice.service.ts` does today:

| Request field | Source in webprocess-api |
| --- | --- |
| `invoice.voucherType` | `documentType.arcaCode` |
| `invoice.receiverIvaConditionId` | `contributorType.arcaFiscalConditionId` |
| `invoice.receiverDocType` | `identificationType.isoCode` |
| `invoice.receiverDocNumber` | sale's receiver identification number (digits) |
| `invoice.salesPointNumber` | `pointOfSaleNumber` |
| `invoice.currency` | `currency.isoCode` (this service maps ISO→`MonId`) |
| `invoice.lines[]` | per taxed line: `netAmount = finalTotalPrice − taxAmount`, `vatAmount = taxAmount`, `vatRatePercent = taxRate` |
| `invoice.untaxedTotal/exemptTotal/perceptionsTotal` | `sale.totalNotTaxed / totalExempt / totalPerceptions` |

This service owns only the mechanical translation: ISO→`MonId`, VAT%→id + subtotal grouping, perceptions→
`Tributos`, date formatting/clamping, and the RG-4892 QR.

---

## 6. Core-side: `POST /wsaa/ticket` minting (internal to webprocess-api)

Core needs a ticket-minting capability (an internal function or endpoint — it is NOT called by this service).
Given `(tenantId/cuit, service, environment)`:

1. Resolve the active credential under RLS; `decryptSecret(...)` the private key in memory.
2. Build the WSAA TRA for `service`, CMS/PKCS#7-sign it with the cert+key (reuse the SDK's `wsaa-client`
   sign slice), and call WSAA `loginCms`.
3. Return `{ token, sign, expiration }` (`expiration` = the ticket's `expirationTime`, ISO-8601).

Constraints:
- **Serialize minting per `(cuit, service)`.** ARCA allows only one active TA and rejects concurrent
  `loginCms` with `coe.alreadyAuthenticated`.
- Keep a **short core-side cache** of minted tickets so a re-send reuses a still-valid TA and an
  `arca-service` cache loss doesn't force a redundant login. Handle `alreadyAuthenticated` by serving the
  cached TA (or waiting for expiry).
- The ticket is sensitive-at-rest auth material — protect it; never log it.

---

## 7. Error envelope

All errors use `{ "error": { "code": string, "message": string, "details?": unknown } }`:

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `BadRequestError` | request validation failed (`details` lists the fields) |
| 409 | `TICKET_REQUIRED` | mint a ticket and re-send (§4) |
| 422 | (result body, not error envelope) | ARCA rejected the voucher (`status:"REJECTED"`) |
| 501 | `NOT_IMPLEMENTED` | SDK operation not yet implemented (e.g. padrón parse) |
| 502 | `ARCA_SOAP` / `ARCA_SERVICE` / `ARCA_AUTH` | ARCA transport/business/auth failure |
| 500 | `INTERNAL` | unexpected |
