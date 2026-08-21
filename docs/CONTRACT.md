# taxprocess-api — HTTP contract & core-side obligations

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
  },
  "delegated": true               // OPTIONAL. true ⇒ issuerTaxId is the represented taxpayer and this
                                  //   service signs with its OWN platform certificate (credentials ignored,
                                  //   no CREDENTIALS_REQUIRED). Omit/false ⇒ the tenant-certificate flow. See §10.
}
```

### Neutral field glossary (what each field means → ARCA)

The wire is deliberately **entity-neutral**: generic names (`issuerTaxId`, `documentTypeCode`) replace the old
domain-bound ones (`cuit`, `voucherType`) so the contract can serve future tax entities. The three fiscal
ids carry **provider-agnostic canonical codes** (no longer core's DB primary keys). This table is the
plain-language key — for each neutral field: what it means, and what it maps to for **ARCA** (Argentina/AFIP).
The ARCA-specific codes/terms live only inside the provider; the wire never carries them.

| neutral field | plain meaning | ARCA correspondence |
| --- | --- | --- |
| `entity.entityCode` | which tax authority/provider handles the request | `"ARCA"` (Argentina AFIP) |
| `entity.issuerTaxId` | issuing taxpayer's canonical tax id (string) | **CUIT**, 11 digits, e.g. `"20123456789"` |
| `entity.environment` | generic environment selector | `"testing"`→homologación, `"production"`→producción |
| `entity.credentials.certPem/keyPem` | issuer certificate + private key (on the re-send only) | the WSAA login cert/key |
| `invoice.documentTypeCode` | document/voucher type (canonical code) | **CbteTipo** (Factura A=1, B=6, C=11, M=51, FCE A=201…) |
| `invoice.concept` | goods / services / both | **Concepto** (1 / 2 / 3) |
| `invoice.pointOfSaleNumber` | point of sale | **PtoVta** |
| `invoice.receiver.identificationTypeCode` | receiver's id-document type (canonical code) | **DocTipo** (80=CUIT, 96=DNI, 99=consumidor final) |
| `invoice.receiver.identificationNumber` | receiver's id number (string; `"0"` = anonymous) | **DocNro** |
| `invoice.receiver.fiscalConditionCode` | receiver's VAT/fiscal condition (canonical code) | **CondicionIVAReceptorId** (RG 5616: 1=RI, 5=CF, 6=Monotributo…) |
| `invoice.currencyIso` | ISO-4217 currency | **MonId** (ARS→PES, USD→DOL, EUR→060) |
| `invoice.currencyRate` | exchange rate to the local currency | **MonCotiz** |
| `invoice.issueDate` | ISO-8601 issue date | **CbteFch** (must be within ±5 days of the request time for concept 1 — see §3) |
| `invoice.lines[].netAmount` | taxed line net (base) | part of **Iva[]** subtotal grouping |
| `invoice.lines[].taxRatePercent` | tax rate % for the line (21, 10.5, 0…) | VAT alícuota → **Iva[].Id** |
| `invoice.lines[].taxAmount` | tax amount for the line | **Iva[].Importe** |
| `invoice.totals.untaxed` | net not subject to tax | **ImpTotConc** |
| `invoice.totals.exempt` | exempt amount | **ImpOpEx** |
| `invoice.totals.perceptions` | perceptions/other tributes | **Tributos** (single "Otros" id 99) |
| result `authorizationCode` | the authorization code | **CAE** |
| result `expiration` | authorization expiry (ISO-8601) | **CAEFchVto** |
| result `authorizedNumber` | authority-assigned voucher number | **CbteDesde** |
| result `qr` | fiscal QR URL | **RG-4892** QR |
| result `status` | AUTHORIZED / PARTIAL / REJECTED | **Resultado** A / P / R |
| result `providerMetadata` | entity-specific extras (core-owned; see §7) | `{}` today |
| point-of-sale `number` | a registered point of sale | **PtoVta** / `Nro` (`FEParamGetPtosVenta`) |
| point-of-sale `issuanceMode` | how the point issues | **EmisionTipo** (`CAE`, `CAEA`, `RECE`…) |
| point-of-sale `blocked` | authority has the point blocked | **Bloqueado** (`S`→true) |
| point-of-sale `dischargeDate` | de-registration date (ISO-8601); key omitted while active | **FchBaja** (`NULL` while active) |

---

## 3. Endpoints

Every issuing endpoint dispatches on `entity.entityCode` and may respond `409 CREDENTIALS_REQUIRED` (see §4).

### `GET /api/health`
Liveness. `200 → { "status":"ok", "service":"taxprocess-api", "uptimeSeconds": <n> }`. No auth.

### `POST /api/authority/status`
Authority health check (ARCA: WSFEv1 `FEDummy`). Body `{ "entityCode":"ARCA", "environment":"testing" }`. No
ticket needed. `200 → { "appServer":"OK", "dbServer":"OK", "authServer":"OK" }`.

### `POST /api/entities/:entityCode/credentials/validate`
Validates a credential bundle at registration time. Core calls this synchronously during `POST /integrations`
so bad credentials are rejected up front. Body:
```jsonc
{ "environment": "testing",
  "configuration": { "webService": "WSFEv1" },   // ARCA validation reads nothing from here (see note)
  "credentials":   { "certPem": "…", "keyPem": "…" },
  "expectedTaxId": "20111111112" }   // required: the owning company's CUIT (any formatting; canonicalized to 11 digits)
```
`200 → { "ok": true }` or `200 → { "ok": false, "errors": [ { "code": "...", "message": "..." } ] }`.
For ARCA the checks are: `expectedTaxId` is a valid CUIT; `certPem` is an issued certificate (**not** a CSR);
`keyPem` parses; and the key matches the certificate. The CUIT in the certificate subject's `serialNumber` RDN
must equal `expectedTaxId` — both are canonicalized to their bare 11 digits before comparison, so formatting
(dashes, a `CUIT ` prefix) is not significant — else `TAXID_MISMATCH` (structural cert checks win first). Error
`code`s: `INVALID_TAXPAYER_ID` (malformed `expectedTaxId`), `CERT_IS_CSR`, `INVALID_CERT`, `INVALID_KEY`,
`KEY_CERT_MISMATCH`, `TAXID_MISMATCH`.

> **Issuer identity.** Credential validation no longer takes an `issuerTaxId` — the certificate is checked
> against the authoritative, core-supplied `expectedTaxId` (the owning company's CUIT). The operational issuer
> identity used at **issuing** time is still `entity.issuerTaxId` on those calls; it is a separate field and is
> unaffected by this endpoint.

### `POST /api/invoices/authorize`
Requests an authorization (ARCA: a CAE). The caller supplies a **neutral invoice with core's own ids** (§5);
this service maps them to the entity's real codes.

Request:
```jsonc
{
  "entity": { "entityCode":"ARCA", "issuerTaxId":"20123456789", "environment":"testing" },
  "invoice": {
    "documentTypeCode": 1,            // canonical code → this service maps to CbteTipo
    "concept": 1,                     // 1=goods, 2=services, 3=both
    "pointOfSaleNumber": 1,            // PtoVta
    "voucherNumberFrom": 42,          // CbteDesde — core owns the number (see below)
    "voucherNumberTo": 42,            // CbteHasta — single-voucher flow: equals voucherNumberFrom
    "receiver": {
      "identificationTypeCode": 80,   // canonical code → DocTipo (80=CUIT, 96=DNI, 99=consumidor final)
      "identificationNumber": "20111111112",  // digits as a string; "0" for anonymous
      "fiscalConditionCode": 1        // canonical code → CondicionIVAReceptorId (RG 5616)
    },
    "currencyIso": "ARS",             // ISO-4217 → mapped to MonId by this service
    "currencyRate": 1,                // exchange rate to the local currency
    "issueDate": "2026-08-05",        // ISO date; concept 1 must be within ±5 AR calendar days of today (else 400 ARCA_VALIDATION)
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

**Voucher number:** core owns the number and sends it as `voucherNumberFrom`/`voucherNumberTo` (single-voucher
flow: equal). This service authorizes exactly that number — it never asks the authority for the last-authorized
number and adds `+1`. Use `POST /invoices/last-authorized` to fetch the next number to assign.

**Idempotency:** `authorize` is idempotent on the voucher number. If the authority authorizes but core's
persistence then fails, the number is consumed on the authority's side; **re-sending the same invoice with the
same number returns the already-issued CAE** (a full `200` result, QR included) instead of a rejection — this
service reconciles internally via the authority's voucher query. Re-sending the *same number* for what the
authority's stored voucher shows was a **different sale** is refused (`400 ARCA_VALIDATION`,
`details.code: "VOUCHER_ALREADY_AUTHORIZED_MISMATCH"`) rather than returning a CAE for the wrong invoice. The
check compares the stored voucher against the resend on: total amount, receiver id type/number, concept,
currency, voucher date, and receiver IVA condition — any confirmed mismatch on one of these is refused; a
field the authority didn't return (absent, `null`, or an empty element) is never treated as a mismatch.
`POST /invoices/query` remains available for explicit, caller-driven recovery.

> **A retry must carry the ORIGINAL `issueDate`.** `issueDate` is one of the compared fields, so re-stamping
> it with the current date makes the retry look like a different sale and it is refused with
> `VOUCHER_ALREADY_AUTHORIZED_MISMATCH` — permanently, since the stored voucher never changes. This matters
> most for a retry that crosses midnight. Persist `issueDate` with the voucher number and replay it verbatim.

**Concept-1 date window (contract change 2026-08-20):** an out-of-±5-day `issueDate` for a goods (concept 1)
invoice is now **refused** (`400 ARCA_VALIDATION`, `details.code: "VOUCHER_DATE_OUT_OF_WINDOW"`) instead of
being silently substituted with the request time. Previously this service clamped the date so the authority
would always accept it; that meant a caller could receive a CAE for a *different* `CbteFch` than the one it
sent. Core must send an `issueDate` within the window for concept 1, or expect this rejection. The window is
measured in **Argentina calendar days**, so a date exactly 5 days out is accepted at any hour of the day.

Idempotent recovery takes precedence over this rejection: a resend whose `issueDate` has aged out of the
window is still reconciled against the authority first, and returns the already-issued CAE if the voucher
number is authorized and matches. A delayed replay of a lost CAE therefore still recovers; only a genuinely
new invoice gets `VOUCHER_DATE_OUT_OF_WINDOW`.

An `issueDate` (or `serviceDateFrom`/`serviceDateTo`/`paymentDueDate`) that passes `@IsISO8601` but is not a
date this service can parse — week (`2026-W01-1`), ordinal (`2026-366`), basic (`20260231`) or
space-separated (`2026-08-05 12:00:00`) forms — is refused with `400 ARCA_VALIDATION`,
`details.code: "INVALID_ISSUE_DATE"`. Send calendar dates as `YYYY-MM-DD` or a full ISO timestamp.

**Single-voucher only:** `voucherNumberFrom` and `voucherNumberTo` must be equal (§5). A range
(`voucherNumberTo > voucherNumberFrom`) is refused (`400 ARCA_VALIDATION`,
`details.code: "VOUCHER_RANGE_UNSUPPORTED"`); it is never silently truncated to a single voucher.

### `POST /api/invoices/last-authorized`
Body `{ "entity": {...}, "pointOfSaleNumber": 1, "documentTypeCode": 1 }` → `200 { "number": 42 }`.

### `POST /api/invoices/next-numbers`
Batch lookup of the authority's **next expected** voucher number for several document types of one point of
sale, in a single call. Read-only and side-effect-free (consumes no voucher number; safe to retry). Ticket
scope `wsfe`, so it may respond `409 CREDENTIALS_REQUIRED` (§4).
```jsonc
{ "entity": { "entityCode":"ARCA", "issuerTaxId":"20123456789", "environment":"testing" },
  "pointOfSaleNumber": 3,
  "documentTypeCodes": [1, 6, 11] }   // canonical fiscal codes (AR: each a CbteTipo); non-empty
```
`200 →`
```json
{ "numbers": [
    { "documentTypeCode": 1,  "nextNumber": 18 },
    { "documentTypeCode": 6,  "nextNumber": 5  },
    { "documentTypeCode": 11, "nextNumber": 1  }
] }
```
Per code, `nextNumber` is the authority's next expected correlative (AR: `FECompUltimoAutorizado` + 1); a
document type never authorized on this point of sale returns `nextNumber: 1`. Every requested code is
**echoed** in `numbers` (order-independent; core maps back by `documentTypeCode`). An unrecognized code fails
the whole batch with the standard error envelope (`400 ARCA_VALIDATION`, `details.code: "UNKNOWN_CODE"`) —
never a silent omission. Keeps the "next" semantics on this service so core stays agnostic (it does not assume
`next = last + 1`); `last-authorized` is unchanged and answers the single-document-type case.

### `POST /api/invoices/query`
Body `{ "entity": {...}, "pointOfSaleNumber": 1, "documentTypeCode": 1, "voucherNumber": 42 }` → same shape as
`authorize`'s result.

**Not-found is a `404`, never a `502`.** When the authority has no record of the queried voucher — it was
never issued — this endpoint returns `404 { "error": { "code": "VOUCHER_NOT_FOUND", "details": {
"entityCode", "pointOfSaleNumber", "documentTypeCode", "voucherNumber" } } }`. This is a **stable, deterministic
outcome**, deliberately separated from authority transport/business/auth failures (which stay `502`). Core's
orphan reconciliation depends on the distinction: a sale left PENDING after an authorize whose response never
persisted may be cleared and re-authorized **only** on a `404 VOUCHER_NOT_FOUND`; on any `502`/timeout it must
keep the sale PENDING and retry, because an ambiguous failure is not proof the voucher was never issued —
clearing on it risks a second fiscal document for an already-authorized sale. (ARCA reports this as a `602 "No
existe el comprobante"` `Errors` block, which the provider translates to the neutral `404`.)

### `POST /api/points-of-sale`
Lists the issuer's registered points of sale (ARCA: WSFEv1 `FEParamGetPtosVenta`). Identity-only body — the list
is scoped to `entity.issuerTaxId`. Ticket scope `wsfe`, so it may respond `409 CREDENTIALS_REQUIRED` (§4).
```jsonc
{ "entity": { "entityCode":"ARCA", "issuerTaxId":"20123456789", "environment":"testing" } }
```
`200 →`
```json
{ "pointsOfSale": [
    { "number": 1, "issuanceMode": "CAE",  "blocked": false },
    { "number": 2, "issuanceMode": "CAEA", "blocked": true, "dischargeDate": "2024-01-15T03:00:00.000Z" }
] }
```
The list is **non-lossy** — blocked and de-registered points are included with flags, so core decides what is
usable (typically `!blocked && dischargeDate == null`, which reads a missing key as "active"). Optional keys are
**omitted when absent** (matching `qr`/`taxId` elsewhere): `issuanceMode` (ARCA `EmisionTipo`) is dropped when
the authority returns none, and `dischargeDate` (ARCA `FchBaja`) is present **only** for a de-registered point —
while active the key is omitted. An issuer with no registered points returns `{ "pointsOfSale": [] }` (ARCA signals
this as a `602 "Sin Resultados"` error, which the provider normalizes to the empty list — never a `502`).

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

**Issuer/cert match (mint-time guard):** on the credentialed re-send, this service verifies that the
certificate's subject CUIT equals `entity.issuerTaxId` **before** logging in to the authority. A mismatch is
rejected with `400 ARCA_VALIDATION` / `details.code: "ISSUER_TAXID_CERT_MISMATCH"` — so a wrong `issuerTaxId`
fails fast here instead of minting a ticket under the wrong identity and surfacing later as an opaque authority
token rejection. Formatting (dashes, a `CUIT ` prefix) is not significant; both sides are canonicalized to 11
digits. Core should send the CUIT that owns the certificate.

`service` values (in `details`, ARCA): `wsfe` (invoicing) and `ws_sr_padron_a4|a5|a10|a13` (lookups). This
service caches tickets keyed by the **signing certificate's identity**, shared across core instances, so after
a refresh most requests are served identity-only for ~12h. Tenant and delegate signers occupy **separate
partitions**:

| signer | partition |
| --- | --- |
| tenant certificate (§4) | `(entityCode, environment, issuerTaxId, service)` — unchanged from earlier releases |
| our delegate certificate (§10) | `(entityCode, environment, delegate, delegateCuit, service)` |

A credential-less request is only ever served from **its own issuer's** tenant partition: the delegate ticket
is never lent to a request that has not presented a certificate for the CUIT it names, even when that CUIT is
our own. So if core also self-issues non-delegated for our own CUIT, that flow keeps its normal
`CREDENTIALS_REQUIRED` handshake (§4). The two partitions merge only when the credentials core sends *are* our
delegate certificate — provably the same physical certificate, hence the same authority ticket.

---

## 5. Canonical codes the caller supplies

Core sends **provider-agnostic canonical codes** (from its `common.*.fiscal_code` columns — no longer its DB
primary keys); this service maps them to the entity's real codes (for ARCA, via `src/providers/arca/code-maps.ts`,
where the three translations are the identity — canonical code == ARCA code).

| Request field | Source in webprocess-api | ARCA target code |
| --- | --- | --- |
| `invoice.documentTypeCode` | `document_type.fiscal_code` | `CbteTipo` (identity) |
| `invoice.receiver.fiscalConditionCode` | `fiscal_condition.fiscal_code` | `CondicionIVAReceptorId` (identity) |
| `invoice.receiver.identificationTypeCode` | `identification_type.fiscal_code` | `DocTipo` (identity) |
| `invoice.receiver.identificationNumber` | sale's receiver id number (digits) | `DocNro` |
| `invoice.pointOfSaleNumber` | `pointOfSaleNumber` | `PtoVta` |
| `invoice.currencyIso` | `currency.isoCode` | `MonId` (this service maps ISO→MonId) |
| `invoice.lines[]` | per taxed line: `netAmount`, `taxAmount`, `taxRatePercent` | `Iva[]` subtotals |
| `invoice.totals.untaxed/exempt/perceptions` | `sale.totalNotTaxed / totalExempt / totalPerceptions` | `ImpTotConc`/`ImpOpEx`/`Tributos` |

This service owns the canonical-code→code translation plus the mechanical mapping: ISO→`MonId`, tax%→id +
subtotal grouping, perceptions→`Tributos`, date formatting/clamping, and the RG-4892 QR.

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

### ARCA — `configuration` (non-secret settings)
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
> No `issuerTaxId` here: the issuer identity is the owning company's CUIT. Credential validation checks the
> certificate against the core-supplied `expectedTaxId`; at issuing time the same CUIT rides the request as
> `entity.issuerTaxId` (§4), sourced by core from the company record — it is not stored in `configuration`.

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
| 400 | `ARCA_VALIDATION` | provider-side validation failed; `details.code` carries the specific reason (e.g. `UNMAPPED_CURRENCY`, `VOUCHER_ALREADY_AUTHORIZED_MISMATCH`, `VOUCHER_RANGE_UNSUPPORTED`, `VOUCHER_DATE_OUT_OF_WINDOW`, `INVALID_ISSUE_DATE`, `ISSUER_TAXID_CERT_MISMATCH`) when known |
| 400 | `RECEIVER_MATCHES_ISSUER` | the authority rejected the voucher because the receiver's identification number equals the issuer's own (ARCA `10069`). Stable and caller-fixable, so it is a `400` — **not** the `502 ARCA_SERVICE` an unclassified rejection gets; `details: { arcaCode, arcaErrors }` |
| 403 | `DELEGATION_NOT_AUTHORIZED` | delegated call (§10), but our delegate CUIT is not authorized for `issuerTaxId` at the authority — the represented taxpayer must grant the delegation; `details: { delegateTaxId, issuerTaxId, arcaCode, arcaMessage }` |
| 404 | `VOUCHER_NOT_FOUND` | `query` only — the authority has no record of the voucher (never issued); `details` carries `entityCode`/`pointOfSaleNumber`/`documentTypeCode`/`voucherNumber`. Stable outcome, **never** a `502` — the signal core clears + re-authorizes a PENDING orphan on |
| 409 | `CREDENTIALS_REQUIRED` | re-send with the issuer's credentials (§4). Never returned for a delegated request (§10) |
| 422 | (result body, not error envelope) | the authority rejected the voucher (`status:"REJECTED"`) |
| 501 | `NOT_IMPLEMENTED` | SDK operation not yet implemented (e.g. padrón parse) |
| 502 | `ARCA_SOAP` / `ARCA_SERVICE` / `ARCA_AUTH` | authority transport/business/auth failure. `ARCA_SERVICE` now carries `details.arcaErrors` — the authority's full `[{ code, message }]` list, previously dropped — so core can log or branch on the underlying rejection |
| 500 | `DELEGATION_NOT_CONFIGURED` | `delegated:true` but this service has no valid delegate certificate configured for that `environment` (server misconfiguration); `details: { environment, reason }` |
| 500 | `ARCA_ERROR` / `INTERNAL` | unexpected |

---

## 9. What stays inside the ARCA provider (do NOT leak into the contract)
CAE / CAEFchVto, RG-4892 QR, MonId, tax-rate id, CbteTipo, DocTipo, CondicionIVAReceptor, ±5-day window,
WSAA/CMS signing, `homologacion`/`produccion` — all inside `src/providers/arca/`. The neutral result already
abstracts CAE → `authorizationCode`.

---

## 10. Delegated authorization (this service's own certificate)

ARCA lets a taxpayer (the *representado*) delegate a web service (WSFEv1) to another CUIT (the
*computador/delegate*) via **Administrador de Relaciones**. This service can act as that delegate using
**its own certificate** (our organization's CUIT), so core can authorize a sale for a taxpayer whose
certificate it does not hold.

- **How to invoke:** set `entity.delegated = true` and `entity.issuerTaxId` = the represented taxpayer's
  CUIT. Do **not** send `credentials` — this service uses its own delegate certificate (configured per
  environment via `ARCA_DELEGATE_*`, see `.env.example`). A delegated request therefore **never** returns
  `409 CREDENTIALS_REQUIRED`; the tenant-credential handshake (§4) does not apply.
- **On the wire to ARCA:** `Auth.Cuit` = `issuerTaxId` (the representado); the WSAA ticket is signed with
  our delegate certificate and shared across all represented CUITs (keyed by the delegate identity, in its
  own cache partition — see the table in §4).
- **Prerequisite (user-side, out of band):** the represented taxpayer must delegate the WSFEv1 web service
  to our delegate CUIT in ARCA's *Administrador de Relaciones*. **This service keeps no allow-list** of who
  has delegated — it does not pre-validate the issuer.
- **If the delegation is missing:** the call returns **`403 DELEGATION_NOT_AUTHORIZED`** — including when the
  rejection surfaces on the internal `10016` recovery query rather than on the authorize itself,
  `details: { delegateTaxId, issuerTaxId, arcaCode, arcaMessage }` — surface it to the user as "grant WSFEv1
  to CUIT `<delegateTaxId>` in Administrador de Relaciones." A missing/insufficient delegation surfaces at the
  **WSFEv1 business call** (WSAA login only authenticates our certificate and never sees `Auth.Cuit`, so it
  cannot check the representación): either as the representación-specific **`601` (`CUIT representada no
  incluida en token`)** — unambiguous — or as an authorization-flavored **`600 ValidacionDeToken`** (e.g.
  `Usuario no autorizado a realizar esta operación`). A genuine token fault (bad signature, clock skew,
  expired ticket) is **also** reported under the overloaded `600` but is **not** a delegation problem: it
  stays a `502` token error, so a service-side cert/clock issue is never mislabeled as the user's missing
  delegation. (Note: WSAA's own login-time `computador no autorizado a acceder al servicio` is a *different*
  failure — our certificate isn't enrolled to the `wsfe` service — and surfaces before this classification as
  a `502`.)
- **Server misconfiguration:** `delegated:true` for an environment with no valid delegate certificate returns
  **`500 DELEGATION_NOT_CONFIGURED`**. A misconfigured (present-but-invalid) delegate certificate fails at
  **boot**, not per request.
- **Non-delegated (tenant-certificate) requests are unchanged:** omit `delegated` (or send `false`) and the
  `CREDENTIALS_REQUIRED` handshake behaves exactly as in §4.

**Deployment note (ticket cache).** ARCA binds a ticket to the `(certificate, service)` that minted it and
refuses to issue a second one while the first is valid, so the delegate identity gets its **own** cache
partition (§4) rather than sharing the tenant partition of the same CUIT: a taxpayer may hold several ARCA
certificates, and a *representación* is granted to one specific computador, so a ticket minted by a different
certificate of our CUIT would be rejected (`601`) as if the delegation were missing. If our own organization
*also* issues for itself non-delegated with the very certificate we delegate with, the two roles converge on
the one cached ticket automatically. Otherwise each certificate holds its own, and the single-node / shared
`ARCA_TICKET_CACHE_PATH` guidance in §1 still holds.

When ARCA rejects a delegate ticket with a genuine token fault, only that **service's** delegate ticket is
dropped — the delegate identity's other tickets (e.g. padrón) are still valid and ARCA would not re-issue them
for ~12h.
