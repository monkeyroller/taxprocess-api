# tax-webprocess-api — HTTP contract & core-side obligations

Audience: the **`webprocess-api`** (core) team. This is the integration contract between the core API and the
standalone **general tax service**, plus what core must implement on its side (the credential store and the
retry client).

This service is a **multi-entity** tax integration: every request selects a tax entity by **`entityCode`**
(`ARCA` today; more entities by registering a provider). Core is a **dumb conduit** — it sends its own generic
ids plus `entityCode`, and **this service owns every entity-specific detail**: id→real-code mapping, credential
validation, WSAA login, the business calls, the ~12h ticket cache, and the fiscal QR.

---

## 1. Model: credentials-driven, service-minted (unidirectional)

- **Core owns the credential store; this service owns ALL communication with the tax authority** — WSAA
  login/CMS-signing (ARCA), the business calls, and the ~12h ticket cache. Core never talks to the authority.
- **This service stores no secrets at rest** — there is no `ARCA_MASTER_KEY` and no credential store here. The
  cert/key store and `ARCA_MASTER_KEY` stay in `webprocess-api`; core decrypts the key and sends it here only
  when asked. This service holds it transiently in memory to mint a ticket and **never persists or logs it**.
  Requires mTLS on a private network.
- **Renewal handshake:** a request carries only issuer **identity**. On a ticket-cache miss this service
  replies `409 CREDENTIALS_REQUIRED`; core **re-sends the same request with the issuer's credentials
  attached**, and this service logs in to the authority, caches the ticket (shared across all core instances),
  and proceeds.

```
core ──(1) POST /invoices/authorize {entity:{entityCode,issuerTaxId,environment}, invoice}────────▶ tax-service
core ◀─(2) 409 {code:"CREDENTIALS_REQUIRED", entityCode, issuerTaxId, service, environment}───────── tax-service   (cache miss)
core ──(3) POST /invoices/authorize {entity:{…,credentials:{certPem,keyPem}}, invoice}─────────────▶ tax-service
                                     tax-service ──(WSAA loginCms; key in memory only)─────────────▶ authority
core ◀─(4) 200 {authorizationCode, expiration, authorizedNumber, qr, ...}──────────────────────────── tax-service
```

On a warm cache, step (1) returns 200 directly. The minted ticket is reused for ~12h, so (2)–(3) happen
roughly once per 12h per issuer — i.e. credentials cross the wire ~once per 12h, never per request.

**Ticket persistence / scale:** the cache is in-memory with optional file persistence via
`ARCA_TICKET_CACHE_PATH`. WSAA refuses to re-issue a ticket while a prior one is still valid, so run
**single-node**, or point every instance at a **shared `ARCA_TICKET_CACHE_PATH`**. A shared (Redis-backed)
store for horizontal scale is **deferred**.

---

## 2. Base URL, auth, environments

- Base path: `/api`. Transport: HTTP/JSON. In production this hop must be **mTLS** on a private network; this
  service performs no user auth (callers are trusted).
- `environment`: generic **`"production" | "testing"`**. Each provider maps it to the authority's own naming
  (ARCA: `produccion`/`homologacion`) internally — that naming never appears on the wire.
- All amounts are JSON numbers (2-decimal semantics). Dates in requests are ISO-8601; dates in responses are
  ISO-8601.

### Entity/issuer block (the `entity` field)

```jsonc
{
  "entityCode": "ARCA",           // selects the provider; unknown code → 400 UNKNOWN_ENTITY
  "issuerTaxId": "20123456789",   // issuing party's canonical tax id (AR: CUIT); type implied by entityCode
  "environment": "testing",       // generic; the provider maps it internally
  "credentials": {                // OMITTED on first send; ATTACHED by core on a CREDENTIALS_REQUIRED re-send
    "certPem": "-----BEGIN CERTIFICATE----- …",
    "keyPem":  "-----BEGIN PRIVATE KEY----- …"  // already-decrypted; used in-memory only, never persisted
  }
}
```

---

## 3. Endpoints

Every issuing endpoint dispatches on `entity.entityCode` and may respond `409 CREDENTIALS_REQUIRED` (see §4).

### `GET /api/health`
Liveness. `200 → { "status":"ok", "service":"tax-webprocess-api", "uptimeSeconds": <n> }`. No auth.

### `POST /api/authority/status`
Authority health check (ARCA: WSFEv1 `FEDummy`). Body `{ "entityCode":"ARCA", "environment":"testing" }`. No
ticket needed. `200 → { "appServer":"OK", "dbServer":"OK", "authServer":"OK" }`.

### `POST /api/entities/:entityCode/credentials/validate`
Validates a credential bundle at registration time. Core calls this synchronously during `POST /integrations`
so bad credentials are rejected up front. Body:
```jsonc
{ "environment": "testing",
  "configuration": { "issuerTaxId": "20123456789", "webService": "WSFEv1" },
  "credentials":   { "certPem": "…", "keyPem": "…" } }
```
`200 → { "ok": true }` or `200 → { "ok": false, "errors": [ { "code": "...", "message": "..." } ] }`.
For ARCA the checks are: `configuration.issuerTaxId` is an 11-digit CUIT; `certPem` is an issued certificate
(**not** a CSR); `keyPem` parses; and the key matches the certificate.

### `POST /api/invoices/authorize`
Requests an authorization (ARCA: a CAE). The caller supplies a **neutral invoice with core's own ids** (§5);
this service maps them to the entity's real codes.

Request:
```jsonc
{
  "entity": { "entityCode":"ARCA", "issuerTaxId":"20123456789", "environment":"testing" },
  "invoice": {
    "documentTypeId": 1,              // core id → this service maps to CbteTipo
    "concept": 1,                     // 1=goods, 2=services, 3=both
    "salesPointNumber": 1,            // PtoVta
    "receiver": {
      "identificationTypeId": 1,      // core id → DocTipo (80=CUIT, 96=DNI, 99=consumidor final)
      "identificationNumber": "20111111112",  // digits as a string; "0" for anonymous
      "fiscalConditionId": 1          // core id → CondicionIVAReceptorId (RG 5616)
    },
    "currencyIso": "ARS",             // ISO-4217 → mapped to MonId by this service
    "currencyRate": 1,                // exchange rate to the local currency
    "issueDate": "2026-08-05",        // ISO date; clamped to ±5 days for concept 1
    "lines": [
      { "netAmount": 100, "taxRatePercent": 21, "taxAmount": 21 }
    ],
    "totals": { "untaxed": 0, "exempt": 0, "perceptions": 0 },  // optional
    "serviceDateFrom": "2026-08-01",  // optional; required for concept 2/3
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
    "status":"AUTHORIZED", "observations":[], "providerMetadata":{} }
  ```
- `422` (rejected/partial): same shape, `status:"REJECTED"|"PARTIAL"`, empty `authorizationCode`, populated
  `observations`.

**Voucher number:** this service asks the authority for the last authorized number and uses `+1` — the caller
does not send it. **Idempotency:** if the authority authorizes but core's persistence then fails, the voucher
number is consumed. On retry, call `POST /invoices/query` to recover the already-authorized voucher instead of
re-authorizing.

### `POST /api/invoices/last-authorized`
Body `{ "entity": {...}, "salesPointNumber": 1, "documentTypeId": 1 }` → `200 { "number": 42 }`.

### `POST /api/invoices/query`
Body `{ "entity": {...}, "salesPointNumber": 1, "documentTypeId": 1, "voucherNumber": 42 }` → same shape as
`authorize`'s result.

### `POST /api/taxpayers/lookup`
Body `{ "entity": {...}, "taxpayerId": "20111111112", "level": "A5" }` → `200 { "idPersona":…, "taxId":…,
"name":… }`. `level` ∈ `A4|A5|A10|A13` (default `A5`). NOTE: the ARCA SDK's padrón `parseTaxpayer` is still a
seed, so this currently returns `501` after the SOAP call until the SDK level is implemented.

---

## 4. The `CREDENTIALS_REQUIRED` handshake (core must implement the retry)

Any authenticated endpoint may respond:
```
409 Conflict
{ "error": { "code":"CREDENTIALS_REQUIRED",
             "message":"...",
             "details": { "entityCode":"ARCA", "issuerTaxId":"20123456789",
                          "service":"wsfe", "environment":"testing" } } }
```

Core's tax client must:
1. Send the request with issuer identity and **no** credentials.
2. On `409 CREDENTIALS_REQUIRED`, load + decrypt the issuer's credentials (§6) and **re-send the identical
   request** with `entity.credentials = { certPem, keyPem }`.
3. Treat a second `409` as an error (one retry is sufficient).

`service` values (in `details`, ARCA): `wsfe` (invoicing) and `ws_sr_padron_a4|a5|a10|a13` (lookups). This
service caches tickets keyed by `(entityCode, environment, issuerTaxId, service)`, shared across core
instances — so after a refresh, most requests are served identity-only for ~12h.

---

## 5. Neutral ids the caller supplies (from core's DB catalogs)

Core sends its **own generic ids**; this service maps them to the entity's real codes (for ARCA, via the maps
in `src/providers/arca/code-maps.ts`, seeded from core's catalogs).

| Request field | Source in webprocess-api | ARCA target code |
| --- | --- | --- |
| `invoice.documentTypeId` | `documentType` PK | `CbteTipo` |
| `invoice.receiver.fiscalConditionId` | `contributorType`/fiscal-condition PK | `CondicionIVAReceptorId` |
| `invoice.receiver.identificationTypeId` | `identificationType` PK | `DocTipo` |
| `invoice.receiver.identificationNumber` | sale's receiver id number (digits) | `DocNro` |
| `invoice.salesPointNumber` | `pointOfSaleNumber` | `PtoVta` |
| `invoice.currencyIso` | `currency.isoCode` | `MonId` (this service maps ISO→MonId) |
| `invoice.lines[]` | per taxed line: `netAmount`, `taxAmount`, `taxRatePercent` | `Iva[]` subtotals |
| `invoice.totals.untaxed/exempt/perceptions` | `sale.totalNotTaxed / totalExempt / totalPerceptions` | `ImpTotConc`/`ImpOpEx`/`Tributos` |

This service owns the id→code translation plus the mechanical mapping: ISO→`MonId`, tax%→id + subtotal
grouping, perceptions→`Tributos`, date formatting/clamping, and the RG-4892 QR.

---

## 6. Core-side: providing credentials on the handshake (internal to webprocess-api)

On a `409 CREDENTIALS_REQUIRED` for `(entityCode, issuerTaxId, service, environment)`, core:
1. Resolves the active credential under RLS and `decryptSecret(...)` the private key in memory
   (`ARCA_MASTER_KEY` stays core-side).
2. Re-sends the identical request with `entity.credentials = { certPem, keyPem }`.

Constraints on core:
- **Never persist or log** the decrypted key; it exists only for the duration of the re-send.
- The hop must be **mTLS on a private network** — the key crosses it in plaintext-at-the-app-layer.
- No core-side ticket cache is required (this service owns it). Core may safely send identity-only first every
  time and attach credentials only when told.

---

## 7. Per-entity JSONB schemas (this service is the authority)

This service publishes the shape of the three JSONB blobs core stores opaquely. The
`credentials/validate` endpoint (§3) enforces `configuration` + `credentials`.

### ARCA — `configuration` (non-secret settings incl. issuer identity)
```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["environment", "issuerTaxId", "webService"],
  "additionalProperties": false,
  "properties": {
    "environment": { "enum": ["production", "testing"] },
    "issuerTaxId": { "type": "string", "pattern": "^\\d{11}$" },
    "webService":  { "enum": ["WSFEv1", "WSMTXCA", "WSFEXv1"] }
  }
}
```

### ARCA — `credentials` (secret bundle only)
```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["certPem", "keyPem"],
  "additionalProperties": false,
  "properties": {
    "certPem": { "type": "string", "minLength": 1 },
    "keyPem":  { "type": "string", "minLength": 1 }
  }
}
```

### ARCA — `provider_metadata` (persisted by core on the authorization row)
`provider_metadata` is a **core-owned** blob core persists on the sale's authorization row. Its meaningful
fields are populated by **core**, not this service — e.g. core writes `conceptTypeId` from the `concept` it
sent. This service **always returns a `providerMetadata` object** on `authorize`/`query` for a stable,
forward-compatible channel, but currently derives **no** fields of its own, so it returns **`{}`**. (If a
future provider surfaces a genuinely authority-derived field core can't model, it would populate this object;
until then it's empty.)
```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "conceptTypeId": { "type": "integer" }   // core-populated, from the concept it sent
  }
}
```

Adding a future entity = register a provider + its id→code maps + these three schemas. **No core change.**

---

## 8. Error envelope

All errors use `{ "error": { "code": string, "message": string, "details?": unknown } }`:

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `BadRequestError` | request validation failed (`details` lists the fields) |
| 400 | `UNKNOWN_ENTITY` | `entityCode` has no registered provider |
| 400 | `ARCA_VALIDATION` | provider-side validation failed (e.g. an unmapped id) |
| 409 | `CREDENTIALS_REQUIRED` | re-send with the issuer's credentials (§4) |
| 422 | (result body, not error envelope) | the authority rejected the voucher (`status:"REJECTED"`) |
| 501 | `NOT_IMPLEMENTED` | SDK operation not yet implemented (e.g. padrón parse) |
| 502 | `ARCA_SOAP` / `ARCA_SERVICE` / `ARCA_AUTH` | authority transport/business/auth failure |
| 500 | `ARCA_ERROR` / `INTERNAL` | unexpected |

---

## 9. What stays inside the ARCA provider (do NOT leak into the contract)
CAE / CAEFchVto, RG-4892 QR, MonId, tax-rate id, CbteTipo, DocTipo, CondicionIVAReceptor, ±5-day clamp,
WSAA/CMS signing, `homologacion`/`produccion` — all inside `src/providers/arca/`. The neutral result already
abstracts CAE → `authorizationCode`.
