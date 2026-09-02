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
| `invoice.currencyCode` | currency, as the authority itself codes it (canonical code) | **MonId** — identity (`PES`, `DOL`, `002`, `060`) |
| `invoice.currencyIso` | ISO-4217 currency — **deprecated**, see §5 | **MonId** (ARS→PES, USD→DOL, EUR→060) |
| `invoice.currencyRate` | exchange rate to the local currency | **MonCotiz** |
| `invoice.issueDate` | issue date, as an authority calendar day — see *Dates* below | **CbteFch** (must be within ±5 days of the request time for concept 1 — see §3) |
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

### Dates: one rule for every date field

**Every date on this wire is a calendar day in the *authority's* own calendar** — not yours, and not UTC.
The conversion happens inside this service, so nothing you send has to carry a timezone. Three forms are
accepted on `invoice.issueDate`, `invoice.serviceDateFrom` / `serviceDateTo`, `invoice.paymentDueDate` and
`currencies/rates.date`, and only one is refused:

| form | example | handling |
| --- | --- | --- |
| calendar day | `2026-08-25` | already names an authority day. **Send this** unless you genuinely hold an instant |
| instant with a zone | `2026-07-12T01:00:00Z`, `…-03:00` | placed in the authority's zone, then reduced to its day (AR: → `20260711`) |
| datetime with no zone | `2026-08-25T22:00:00` | **`400 ARCA_VALIDATION`**, `details.code: "INVALID_ISSUE_DATE"` |

The zoneless form is refused rather than guessed because it is genuinely ambiguous: `new Date` resolves it
against the *host's* timezone, so the same request would have produced `CbteFch = 20260825` on a service
running `TZ=UTC` and `20260826` on one in Buenos Aires — the voucher's **legal** date decided by our
deployment rather than by you. Dates we return are bare authority days for the same reason.

Also stricter than plain ISO-8601, and deliberately: week (`2026-W01-1`), ordinal (`2026-366`), basic
(`20260231`) and space-separated (`2026-08-05 12:00:00`) forms are refused, as is the bare-hour offset
(`…T22:00:00-03`) that ISO allows but no `Date` parser reads — send `-03:00`.

**A day that does not exist is refused in both accepted forms**, and the instant is the one to know about:
`2026-02-31` is obviously not a day, but `2026-02-31T12:00:00Z` *parses cleanly* and names March 3rd,
because `Date` rejects a month past 12 while silently rolling a day past the end of its month. Either
spelling would have filed `CbteFch = 20260303` — a legal voucher date you never named — so both are a
`400 ARCA_VALIDATION`, `details.code: "INVALID_ISSUE_DATE"`.

### You still need to know the fiscal entity's timezone

This service will not need it from you. Your own decisions do — and the failure is silent and off by one.

Four decisions are yours, and every one of them is a timezone question:

| your decision | why the zone decides it |
| --- | --- |
| which day a sale is dated (`issueDate` → `CbteFch`) | this is the voucher's **legal** date |
| which day a sale is priced for (`currencies/rates.date`) | you send the **voucher's** day; §3 turns it into the publication that applies |
| how long a cached answer stays warranted | a function of **your** refresh cadence, which this service cannot see. `refreshAfter` is advisory (§3) and does not answer it |
| what day to **render** a date we returned as | it is the authority's day, not the viewer's |

A sale submitted 2026-08-25 22:00 in Buenos Aires is already 2026-08-26 in UTC. Derive the day on a UTC
host and you will validate a Monday sale against Tuesday's band — and `CbteFch` will claim a day the sale
was not made on. Nothing rejects it: the band check is advisory, and the authority cannot know what day you
meant.

**Hold the zone as data on the entity, never as a constant in shared code.** Same rule as §9: a per-entity
column is the right home; `America/Argentina/Buenos_Aires` written into logic that will also serve a future
SII or SAT entity is not. It is the reason this service returns `refreshAfter` as an absolute instant rather
than a publication hour — a clock would have forced an Argentine constant into your scheduler.

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
- `422` (rejected/partial): same shape, `status:"REJECTED"|"PARTIAL"`, populated `observations`. A `REJECTED`
  voucher carries an empty `authorizationCode`/`expiration` — the authority issued none. A `PARTIAL` may still
  carry a real `authorizationCode`, so **decide success on `status`, never on "is `authorizationCode` empty"**:
  the split is `status:"AUTHORIZED"` (plus a non-empty code and expiration) → `200`, anything else → `422`. (AR
  reports `PARTIAL` only for multi-record batches, which the single-voucher flow never sends, so today it is
  unreachable — but it is part of the shape.)

**`observations` is NOT limited to the `422` branch.** The authority routinely authorizes a voucher *with*
observations — a valid CAE plus one or more `{code, message}` notices about the voucher it just accepted (AR:
`Observaciones.Obs` under a `Resultado: "A"`). That arrives as a normal `200`: real `authorizationCode`,
`expiration` and `qr`, `status:"AUTHORIZED"`, and a **non-empty** `observations` array. The example above shows
`[]` only because that is the common case, not because approval implies an empty array.

Core must therefore persist `observations` on **every** outcome, not just on rejection. They are the authority's
only record of *why* it flagged an accepted voucher (and the sole notice for conditions the authority chose not
to reject over), this service does not log or otherwise retain them, and `providerMetadata` never carries them.
Dropped on the `200` path they are unrecoverable except by re-querying the authority via
`POST /invoices/query` — which returns the stored voucher's observations for exactly this reason. Treat a
non-empty `observations` on an approved sale as informational, not as a failure: the CAE is valid and the sale
is filed.

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
**echoed** in `numbers` (order-independent; core maps back by `documentTypeCode`). `documentTypeCodes` is
**de-duplicated**, so `numbers` carries one entry per *distinct* code — `[1, 6, 1, 1]` answers with two
entries. Read the result by key, never by position or length. An unrecognized code fails the whole batch with
the standard error envelope (`400 ARCA_VALIDATION`, `details.code: "UNKNOWN_CODE"`) — never a silent omission,
and de-duplicating cannot suppress one, since a repeat contributes no code the batch would otherwise have
validated. Keeps the "next" semantics on this service so core stays agnostic (it does not assume
`next = last + 1`); `last-authorized` is unchanged and answers the single-document-type case.

### `POST /api/invoices/query`
Body `{ "entity": {...}, "pointOfSaleNumber": 1, "documentTypeCode": 1, "voucherNumber": 42 }` → same shape as
`authorize`'s result, including the `observations` the authority stored against the voucher. That makes this the
recovery path for observations lost on the `authorize` response (see `/invoices/authorize`); no QR is returned,
since rebuilding it needs the invoice body.

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
Looks up whoever the authority's registry holds under an identifier. **No `entity` block and no credentials:**
registry lookups are made under this service's own delegated identity, so this endpoint never returns
`409 CREDENTIALS_REQUIRED` and no taxpayer has to delegate anything to us (§10).

```jsonc
{ "entityCode": "ARCA",
  "environment": "testing",
  "identificationTypeCode": 80,            // canonical code — the same one invoice.receiver carries
  "identificationNumber": "20111111112" }  // digits as a string
```

**The identification type picks the registry**, which is why there is no "which service / how much detail"
knob on the wire. For ARCA:

| `identificationTypeCode` | what happens | resulting `detail` |
| --- | --- | --- |
| 80 CUIT, 86 CUIL, 87 CDI | the identifier **is** a clave — looked up directly | `REGISTRATION`, or `IDENTITY` — see below |
| 96 DNI, 89 LE, 90 LC | the document is resolved to the claves issued for it, then each is read | `IDENTITY` |
| 91 CI extranjera, 94 pasaporte, 99 sin identificar | refused — no registry can answer for these | — |

**A clave lookup can be answered by either registry, so `detail` is not implied by what you sent.** AR has
two registries and they hold different populations: one knows only claves with an *inscripción* (registered
taxes, a simplified-regime category), the other knows every clave the authority has issued — a superset. A
clave is asked of the first, because it is the richer picture, and falls back to the second whenever the
first will not report an inscripción for it — either it holds no such clave, or the clave is **inactive or
cancelled**, which it reports as no registration at all. So `detail` is `REGISTRATION` for a taxpayer with a
current inscripción and `IDENTITY` for a clave that exists without one, including one whose registration has
lapsed (`registrationStatus: "INACTIVE"`), and a `404` means **both** registries missed. Read the key set
off `detail` (the table below), never off the identification type in your request.

Response:

```jsonc
{ "entityCode": "ARCA",
  "detail": "REGISTRATION",     // which registry answered — see the field table below
  "taxpayers": [ { "taxId": "20111111112", … } ] }
```

`taxpayers` is **always a list and never empty on a `200`**: a document lookup can legitimately match several
taxpayers (one DNI commonly carries both a CUIL and a CUIT), and no match at all is a `404 TAXPAYER_NOT_FOUND`.
A tax-id lookup returns exactly one entry.

#### Which fields you get, per `detail`

The two registries are **complementary, not nested** — one knows the tax picture, the other knows the person —
so `detail` is what tells you the possible key set. ✔ = always present, ○ = present when the authority returns
it, — = never present for that detail.

| field | `REGISTRATION` | `IDENTITY` | notes |
| --- | :---: | :---: | --- |
| `taxId` | ✔ | ✔ | the taxpayer's tax id (AR: CUIT/CUIL/CDI) |
| `identificationNumber` | ✔ | ✔ | repeats `taxId`, so each row states the id it is keyed by |
| `addresses[]` | ✔ | ✔ | see the address shape below |
| `activities[]` | ✔ | ✔ | `{code, description, period, primary}`; `period` is an ISO year-month (`"2014-09"`) |
| `providerMetadata` | ✔ | ✔ | entity-specific extras, opaque to core; always an object |
| `taxes[]` | ✔ | — | `{code, description, period, status, reason}` |
| `simplifiedRegimeCategory` | ○ | — | small-taxpayer regime category (AR: monotributo) |
| `fiscalConditionCode` | ○ | — | the taxpayer's VAT condition, **in the same code space as `invoice.receiver.fiscalConditionCode`** (§5) |
| `identificationTypeCode` | ○ | ○ | canonical code behind `taxIdType` (AR: 80 CUIT / 86 CUIL / 87 CDI). **○ is the truth, not a gap we intend to close** — see below |
| `taxIdType` | ○ | ○ | AR: `"CUIT"` / `"CUIL"` / `"CDI"` |
| `personType` | ○ | ○ | `"INDIVIDUAL"` \| `"LEGAL_ENTITY"` |
| `name`, `firstName`, `lastName` | ○ | ○ | `name` is the legal name for an entity, the full name for a person |
| `registrationStatus` | ○ | ○ | `"ACTIVE"` \| `"INACTIVE"` |
| `fiscalAddress` | ○ | ○ | the address the authority holds as fiscal; also present in `addresses[]` |
| `fiscalYearEndMonth`, `incorporationDate` | ○ | ○ | month 1–12; ISO date |
| `documentType`, `documentNumber` | — | ○ | the identity document behind the clave |
| `birthDate`, `registrationDate`, `legalForm` | — | ○ | ISO dates; `legalForm` is free text |

**Why `identificationTypeCode` is ○ while `identificationNumber` is ✔.** The number repeats `taxId`, which
the registry always states, so it costs nothing to guarantee. The *type* is the authority's own statement of
what kind of clave it issued (AR: `tipoClave`), it is optional in the authority's schema, and it cannot be
recovered from the number: in AR, CUIT, CUIL and CDI all draw from the same `20`/`23`/`24`/`27` prefixes, so
the digits do not name their own kind. Every response recorded against the padrones so far carries it, so in
practice the key is there — but this service will not state a type the authority did not, and inferring one
would be worse than the caller's own fallback. Keep a fallback for it; ✔ is not coming.

**Absence rule.** Optional scalars are **omitted, never `null`** — the same convention as `qr` /
`dischargeDate` elsewhere in this contract. The arrays a detail covers are **always present**, `[]` when the
authority reports none, so "none registered" is distinguishable from "this detail cannot report it". That is
why `taxes` is `[]` on a `REGISTRATION` result with no registered taxes, and **absent entirely** on every
`IDENTITY` result. Given `detail`, the key set is fully predictable from the table above.

#### The address shape

Every geographic level reads the same way — **a name from the authority, a code, and the standard that code
belongs to**:

| level | authority's name | code | standard | catalog snapshot |
| --- | --- | --- | --- | --- |
| country | — | `countryCode` | `countryCodeScheme` | — |
| region | `region` | `regionCode` | `regionCodeScheme` | — |
| city | `city` | `cityCode` | `cityCodeScheme` | `cityCodeSchemeVersion` |

Plus `street`, `postalCode`, and `kind`/`status` in the authority's own wording (AR: tipo/estado de
domicilio). A Córdoba fiscal address:

```jsonc
{ "street": "SANTA FE 7516", "postalCode": "5000",
  "region": "CORDOBA",   "city": "CORDOBA",
  "countryCode": "AR",         "countryCodeScheme": "ISO-3166-1-ALPHA-2",
  "regionCode":  "AR-X",       "regionCodeScheme":  "ISO-3166-2",
  "cityCode":    "14014010",   "cityCodeScheme":    "INDEC",
                               "cityCodeSchemeVersion": "2026-08-25",
  "kind": "FISCAL" }
```

**Resolve a level by matching the pair `(code, codeScheme)`, not the code alone.** A code means nothing
without the catalog it was drawn from — `"AR"` is an ISO 3166-1 alpha-2 country here, and the same two
letters index something else in another coding system. Scheme values come from the closed vocabulary in §5,
so they are safe to store and match on directly.

The authority's own catalog ids are **not** on the wire — AR's `idProvincia` is meaningless outside ARCA (§9)
and does not appear. `region` and `city` are the authority's *names*, and they are the fallback for a level
that did not resolve.

A scheme is present **exactly** when its code is, never alone. Each pair follows the absence rule
independently, so a partially-coded address is normal rather than a fault — and one specific gap is worth
planning for: **AR locality codes do not cover barrios of interior cities.** ARCA regularly reports one as
the locality (`BARRIO YAPEYU` for a Córdoba address), the national catalog does not code neighbourhoods, and
that address therefore arrives with a `regionCode` and no `cityCode`, keeping only `city` as free text. CABA
is the exception — its barrios all resolve to the single CABA locality.

**That gap is structural, not a backlog item**, and it is stated here so nobody builds against it clearing on
its own: closing it for the rest of the country would need a postal-code index, and there is no
openly-licensed source for one. So an absent `cityCode` on a barrio address is the documented steady state —
fall back to `city` and treat it as normal, not as data that will arrive in a later release. If the miss rate
turns out to matter in practice that is the next conversation, and it would be a change with its own
CONTRACT-CHANGES entry; what it will never be is a silent fix.

`cityCodeSchemeVersion` is on the same footing as the scheme rather than optional in its own right: it is
present **exactly** when `cityCode` is, because what it dates is that code. It says which snapshot of the
national catalog the code was drawn from, and it exists for one specific ambiguity — a caller resolving our
codes against its own copy of the same *live* dataset gets nothing back both for a code minted from a newer
snapshot than its own and for the barrio gap above, and those need opposite responses. See §5 for what the
value is and how to read it. Only the city level carries one; the ISO levels have no snapshot behind them.

`providerMetadata` is the escape hatch for data with no cross-country meaning; core should persist it opaquely
and never branch on it. For ARCA it names the padrón service that answered and may carry `caracterizaciones`
(including the 2026 *ganancias simplificada* flag), `esSucesion`, `deceasedDate`, `dependencia`, `regimenes`,
`categoriasAutonomo`, and the authority's own per-block constancia errors.

**Errors:** `404 TAXPAYER_NOT_FOUND` (no registry will report a taxpayer under the identifier — nobody is
registered under it, or the clave has been cancelled and neither registry still holds the person),
`400 ARCA_VALIDATION` with `details.code: "UNSUPPORTED_IDENTIFICATION_TYPE"` (an identification type no
registry can answer for) or `"UNKNOWN_CODE"` / `"INVALID_ID"` (unknown canonical code / non-numeric
identifier), `500 DELEGATION_NOT_CONFIGURED` (this service has no usable delegate certificate for the
environment, **or it is not enrolled in the registry web service** — see §10; a clave lookup can touch both
AR registries, so both enrolments have to be in place). A fallback that cannot reach the second registry
fails with that error rather than degrading to a `404`: with the superset unread, "nobody is registered" is
not something this service can state.


### `POST /api/currencies/rates`
The authority's published exchange rates, with the band it accepts around each. **No `entity` block and no
credentials** — like `/taxpayers/lookup`, this is read under this service's own delegated identity, so it
never returns `409 CREDENTIALS_REQUIRED` and no taxpayer has to delegate anything to us (§10).

That is a precondition of the design rather than a convenience. A rate is a property of
`(entity, currency, day)` and nothing else, so a caller caches it once for every tenant. If this endpoint
demanded a tenant's certificate, a platform-wide catalogue would be populated from one arbitrary customer's
credential: it would break when that certificate lapsed, spend their authority quota fetching other
customers' data, and leave a tenant with no valid integration unable to read a public number.

```jsonc
// the daily sync — omit both optional fields to get the entity's WHOLE table at one vintage
{ "entityCode": "ARCA", "environment": "production" }

// a backdated sale — one code, and the day that needs a valid rate (the voucher's own day)
{ "entityCode": "ARCA", "environment": "production", "currencyCodes": ["DOL"], "date": "2026-08-28" }
```
`200 →`
```jsonc
{ "entityCode": "ARCA", "environment": "production",
  // `date` was Friday the 28th, so `rateDate` is Thursday the 27th — the previous working day's close.
  // `049` shows the other outcome: no close within the walk-back window, reported rather than approximated
  "rates": [
    { "currencyCode": "DOL", "rate": 1465.5, "lowerLimit": 29.31, "upperLimit": 7327.5,
      "rateDate": "2026-08-27", "bandBasis": "TOLERANCE" },
    { "currencyCode": "PES", "rate": 1, "lowerLimit": 1, "upperLimit": 1,
      "rateDate": "2026-08-28", "bandBasis": "REFERENCE" }
  ],
  "unavailable": [ { "currencyCode": "049", "reason": "NO_PUBLICATION" } ],
  "refreshAfter": "2026-08-29T00:00:00-03:00",
  "publishedAt": "2026-08-27" }
```

**`currencyCodes` is optional, and omitting it means the entity's whole table.** An authority publishes all
its cotizaciones at once, so that is both the shape of a daily sync and the shape of the answer worth
caching; enumerating the codes you happen to know would silently miss any your own seed has drifted behind
on. An **empty array is refused** (`400`) rather than read as "everything" — the two requests mean different
things.

"The whole table" is every currency **this service supports**, which is the authority's catalogue
intersected with the codes `/invoices/authorize` accepts — the same set §5 lists. The two endpoints agree by
construction: every `currencyCode` you can get a rate for is one you can invoice in, and a code missing from
a sync is one that would have been refused at authorization anyway. Requesting such a code explicitly
returns `UNKNOWN_CODE` under `unavailable` rather than omitting it, so an explicit ask is never silent.

Batched for **consistency**, not call volume. `FEParamGetCotizacion` takes one `MonId` per call, so N calls
made by a caller can straddle a publication boundary and produce a set where the dollar is today's and the
euro is yesterday's. One request answers from one moment.

**`date` is the day that needs a valid rate** — the day of the voucher being priced, in the authority's own
calendar (see §2 *Dates*). It is **not** the day of the publication you want, and you should never adjust it
yourself.

**What comes back for it is the closing rate of the previous working day.** That is the rate that is *valid*
on the day you named, and the whole of the adjustment happens here: you send the voucher's day, this service
resolves which close prices it, and `rateDate` reports the day that close belongs to. So `rateDate` is always
**earlier** than `date` — one day for a Tuesday-to-Friday, three for a Monday, more across a feriado.

> **One thing not to over-read.** "Valid" here means *correct for that day*, not *the only thing ARCA will
> accept*. The validation that names this day, **10038**, opens with a condition — *"Si se indica que el pago
> del comprobante se realiza en la misma moneda extranjera que la factura"* (`CanMisMonExt = S`) — and nothing
> on this contract can set that field, so **10038 binds no voucher you can send today.** What binds one is
> 10119's band below, and it is wide enough that a rate taken from a different day will almost always pass.
>
> This service resolves the day anyway, for three reasons worth knowing: it is the number 10038 names, so your
> vouchers are already correct the day foreign-currency payment is added and the rule starts binding as
> `EXACT`; it makes `rateDate` a defensible record of which publication priced a sale; and it is the reading
> the measurement below supports. But **do not build a hard check that says ARCA will reject a rate from
> another day** — within the band it will not, and that is the same trap as `OUT_OF_BAND`.

The answer is therefore **immutable**: it resolves to a close that already happened, so the same request at
09:00 and at 23:00 returns the same rate. Omitting `date` gets you the latest publication instead, which is
the same row `date` = today resolves to, so either shape works for a daily sync. Expect one whole-table call
per entity per day plus one single-code call per backdated sale, and normally one authority read per code
behind it.

> ⚠️ **For ARCA a cotización row is the CLOSE of a working day**, and there is no row for a Saturday, a
> Sunday, a feriado, or today. Measured against **production** on 2026-09-01 at 13:55 ART, `DOL`, every
> calendar day from `20260808`:
>
> | `FchCotiz` | answer |
> | --- | --- |
> | Mon `20260831`, Fri `20260828`, Thu `20260827` | `1508.5`, `1512`, `1512` |
> | **every Saturday and Sunday** | **`602 Sin Resultados`** |
> | **Mon `20260817` — a feriado** | **`602 Sin Resultados`** |
> | `20260901` — today | **`602 Sin Resultados`** |
> | *omitted* | `1508.5` — the same row as Mon `20260831` |
>
> **The weekend is what settles it.** If a row were the rate *in force on* its day, a Saturday would have to
> carry one — the rate in force on a Saturday is Friday's close, and a voucher issued on a Saturday must
> declare something. ARCA holds no Saturday row at all. So a row is the close **of** its day, and "la
> cotización registrada para el día hábil anterior a la fecha de emisión" — the day validation 10038 names —
> is the close of the working day before your `date`. Concretely, from that same run:
>
> | your `date` | what you get | authority reads |
> | --- | --- | --- |
> | Tue 2026-09-01 | `rateDate 2026-08-31`, 1508.5 | 1 |
> | Mon 2026-08-31 | `rateDate 2026-08-28`, 1512 — Friday, weekend skipped | 1 |
> | Sat 2026-08-29 or Sun 2026-08-30 | `rateDate 2026-08-28`, 1512 | 1 |
> | Mon 2026-08-17 (a feriado) | `rateDate 2026-08-14`, 1487.5 | 1 |
> | Tue 2026-08-18 (after it) | `rateDate 2026-08-14`, 1487.5 | 2 — the feriado answers `602`, then Friday |
>
> **Weekends are skipped, feriados are discovered.** Saturdays and Sundays are never asked about, because they
> never carry a close — that is measurement, not assumption, and it is why a Monday costs one read rather than
> three. Feriados are deliberately *not* modelled: that would need a holiday calendar this service has no
> business holding and which would be wrong the first year ARCA moves a *puente*. They are found through the
> authority's own `602` instead, walking back up to five working days; past that the code is reported
> `NO_PUBLICATION`.
>
> **A `date` later than today is clamped to today** (the second clause of 10038 — which names the day without
> requiring it, per the note above), so a voucher dated tomorrow and one dated today are priced off the same
> close.
>
> **This rule is production's, and it is applied in every environment — including `testing`.** Homologación
> disagrees with all of the above and is deliberately ignored: asked the same 24 days it answers for *every*
> calendar day, weekends and feriados included, with a series that compounds smoothly (`+0.222` rising to
> `+0.244`, no repeat anywhere) — generated data, not market data. Nothing branches on environment, so what
> you exercise in `testing` is the behaviour you will get for real. The alternative would make a testing sale
> agree with a fiction and disagree with ARCA.
>
> Treat the rule as perishable the way the band is: `PROBE_ENVIRONMENT=production pnpm probe:cotizacion-day`
> re-takes the whole table read-only (no vouchers), and the decision plus the date and environment it was
> taken in live in `src/providers/arca/mapping/cotizacion/cotizacion.ts` (`RATE_DAY_RULE`).

#### The band, and what it does and does not tell you

`lowerLimit` and `upperLimit` are the range the authority will **accept**; both are **inclusive**. The check
worth building on them is `lowerLimit ≤ yourRate ≤ upperLimit`.

`bandBasis` names the rule that produced them:

| `bandBasis` | meaning |
| --- | --- |
| `TOLERANCE` | the authority accepts a range around its published rate. This is ARCA's case |
| `EXACT` | `lowerLimit == upperLimit == rate`; the published rate is the only one accepted |
| `REFERENCE` | the authority's own currency, answered locally at `1/1/1` with no authority call |

> ⚠️ **For ARCA the band is `[0.02 × rate, 5 × rate]`, and you should design around that.** Measured
> against homologación on 2026-08-31, not inferred: `0.0199 × rate` is rejected, `0.02 × rate` is
> authorized, `4.9997 × rate` is authorized and `5.0002 × rate` is rejected — all with WSFEv1 validation
> 10119, which is excluding, so a voucher outside really is refused.
>
> But inside it there is enormous room: at a published rate of 1465.5 the accepted range is
> `[29.31, 7327.50]`. **A rate that merely differs from the official one will essentially never be out of
> band.** So if what you want to catch is a commercially wrong rate, compare against `rate` and treat that
> as a separate, softer signal from `OUT_OF_BAND` — telling an operator "the authority will reject this"
> about a rate the authority accepts is worse than saying nothing.
>
> The width comes from ARCA's sentence naming **two rules in different forms**, which is easy to misread as
> one: "inferior **al** 2%" is a fraction *of* the rate, while "superior **en** un 400%" is an excess *over*
> it (`rate + 4 × rate`). Assuming both bounds share a form gives either a ceiling of `4 × rate` (too tight
> — ARCA authorized `4.01 × rate`) or a floor of `0.98 × rate` (~49× too tight — ARCA authorized
> `0.5 × rate`).
>
> Treat the numbers as perishable: ARCA has rewritten this validation three times since 2023.
> `pnpm probe:band` re-measures it, and the current value plus the date it was taken live in
> `src/providers/arca/mapping/cotizacion/cotizacion.ts`.

**One tightening to know about now rather than later.** Manual v4.0 added validation 10038: if a voucher
declares that it is *paid* in the same foreign currency (`CanMisMonExt = S`), `MonCotiz` must match the last
published business day's rate **exactly**. Nothing on this wire can request that today, so it never fires —
but the day foreign-currency payment is added, this endpoint will start answering `EXACT` for those sales.
This is the same 10038 that names the day `date` resolves to: the day it names is what this service already
sends you, so nothing about your stored rates has to change when it does start binding.

**And one that turned out not to apply.** Validation 10240 reads as though `MonCotiz` may never exceed the
official rate by more than 1, unconditionally, which would have made the band `[rate − 1, rate + 1]`. The
same measurement settled it: `rate + 1.5` was authorized, so 10240 is conditioned on `CanMisMonExt` as its
position in the manual suggests.

**So for a voucher you can send today, 10119 is the only cotización rule that binds** — 10038 and 10240 are
both gated on `CanMisMonExt`. That is why the band is the thing to design against, and why the day
resolution above is about being *correct* rather than about being *accepted*.

#### `rateDate` is the day the rate is FOR

It is always **earlier** than the `date` you asked about: you name the day that needs a valid rate, and what
is valid for it is the previous working day's close (see the note on `date` above). One day earlier for a
Tuesday-to-Friday, three for a Monday, more across a feriado. Store `rateDate`, not your request date — it is
the authority's own echoed `FchCotiz`, never a day this service chose, so it is the only record of which close
a voucher was priced against. A bare authority calendar day (§2).

`publishedAt` is the batch's vintage — the latest `rateDate` in it. A shared `rateDate` across the batch is
**not** promised: a thinly-traded currency may not publish every day, so its answer legitimately carries an
older day than the dollar's. Absent when nothing was published at all, rather than fabricated.

#### `refreshAfter` — advisory, always present, never in the past

An absolute instant meaning "the answer to this question cannot change before then". Under the day-keyed rule
above that is the **start of the next authority day**: a closed day's rate cannot change at all, and a day
cannot stop being the day you asked about until the calendar moves. An instant rather than a clock, so the
authority's zone never has to be hardcoded in a country-agnostic caller (§2, §9).

> ⚠️ **Treat it as advisory. It is a fact about the data, not an instruction about your cron.** Until
> 2026-09-01 this field carried ARCA's next publication hour (19:00 ART) and this section told you to let it
> push your next run "later, never earlier". That was wrong in a way worth naming, because the shape of the
> mistake outlives the number: **a hint that can only push a run later is unusable by any caller whose cache
> validity ends at its next scheduled run.** Obeying it leaves that caller past its own validity boundary
> holding nothing warranted — and a caller syncing at midnight computed `max(00:00, 19:00) = 19:00`, which
> silently reinstates an evening schedule it may have deliberately retired. Your schedule sets the rhythm.
> Store this field because it records what the authority's answer claimed when you took it, which is worth
> having in the row when diagnosing a sync; nothing here requires you to act on it.

Present on every `200`, **including one where every code came back unavailable** — that being precisely the
case a client would otherwise poll hot.

#### `unavailable` — a normal outcome, never a failed batch

One missing currency must not cost the other forty-eight, so a code with no rate is reported rather than
raised:

| `reason` | meaning |
| --- | --- |
| `NO_PUBLICATION` | the authority has no rate for this code (AR: a `602 Sin Resultados`) |
| `UNKNOWN_CODE` | the authority does not recognize the code. Caught locally where possible, so it usually costs no round trip |
| `UPSTREAM_ERROR` | the authority could not be reached **for this code** while others answered |

Note the deliberate departure from how an unknown code behaves elsewhere: `documentTypeCode` throws a
`400 UNKNOWN_CODE`, while an unknown currency in a batch lands here instead. If **every** code fails the
same transient way, that is systemic rather than per-code and the request fails with a `502` — reporting it
as forty-nine currencies coincidentally having no data would let you cache "nothing is published" and stop
asking.

**The reference currency never touches the network.** `PES` is answered locally at `1/1/1`, and a request
for it alone resolves no authority ticket at all. ~99% of vouchers are in pesos, and a fiscal-sale path that
failed because the authority was unreachable while a customer paid in pesos would be a till outage caused by
a validation that could not have told anyone anything.

**Errors.** `400 ARCA_VALIDATION` with `details.code: "INVALID_ISSUE_DATE"` (a `date` this service cannot
use — §2 *Dates*), `500 DELEGATION_NOT_CONFIGURED` (no usable delegate certificate for the environment, or
it is not enrolled in the authority's invoicing service — §10), `502 ARCA_AUTH` (the authority rejected our
delegate ticket; the cached ticket is dropped so the next request re-mints).

Environment matters: this service answers from whichever environment you name, and homologación may hold no
cotización data at all. If it reports everything `NO_PUBLICATION` there, that is the authority's answer and
not a bug — validating a testing sale against a production band would be wrong in both directions.
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

`service` values (in `details`, ARCA): `wsfe` (invoicing); the registry services
(`ws_sr_constancia_inscripcion`, `ws_sr_padron_a13`) never appear here, since lookups use this service's own
delegated identity and so never raise `CREDENTIALS_REQUIRED`. This
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
primary keys); this service maps them to the entity's real codes (for ARCA, via `src/providers/arca/mapping/code-maps/code-maps.ts`,
where the three translations are the identity — canonical code == ARCA code).

| Request field | Source in webprocess-api | ARCA target code |
| --- | --- | --- |
| `invoice.documentTypeCode` | `document_type.fiscal_code` | `CbteTipo` (identity) |
| `invoice.receiver.fiscalConditionCode` | `fiscal_condition.fiscal_code` | `CondicionIVAReceptorId` (identity) |
| `invoice.receiver.identificationTypeCode` | `identification_type.fiscal_code` | `DocTipo` (identity) |
| `invoice.receiver.identificationNumber` | sale's receiver id number (digits) | `DocNro` |
| `invoice.pointOfSaleNumber` | `pointOfSaleNumber` | `PtoVta` |
| `invoice.currencyCode` | `fiscal_currency.fiscal_code` | `MonId` (identity) |
| `invoice.currencyIso` | `currency.isoCode` | `MonId` (this service maps ISO→MonId) — **deprecated**, see below |
| `invoice.lines[]` | per taxed line: `netAmount`, `taxAmount`, `taxRatePercent` | `Iva[]` subtotals |
| `invoice.totals.untaxed/exempt/perceptions` | `sale.totalNotTaxed / totalExempt / totalPerceptions` | `ImpTotConc`/`ImpOpEx`/`Tributos` |

This service owns the canonical-code→code translation plus the mechanical mapping: tax%→id + subtotal
grouping, perceptions→`Tributos`, date formatting/clamping, and the RG-4892 QR.

### Currency: the fourth canonical code

`invoice.currencyCode` carries the authority's own currency code and is identity-mapped to `MonId`, exactly
as `documentTypeCode`, `fiscalConditionCode` and `identificationTypeCode` are to `CbteTipo`, `DocTipo` and
`CondicionIVAReceptorId`. Send **exactly one** of `currencyCode` and the deprecated `currencyIso`: both is a
`400`, and so is neither.

**Why `currencyIso` is going.** It was the only field in the table above sourced from something other than a
`fiscal_code`, and the consequence was a private three-entry table in this service —
`{ARS: PES, USD: DOL, EUR: 060}` — against ARCA's forty-nine codes. Every currency a caller could not bill
was a change *here*. Worse, ISO cannot express the catalogue at all:

- `DOL` and `002` ("Dólar Libre EEUU", the blue) are **both** `USD` at different published rates, so a
  caller pricing at the blue silently declared the official code;
- `049` (Gramos de Oro Fino) has no ISO code, so it was unreachable.

Under a canonical code, a new ARCA currency is a seed row on your side. Not *zero* change here — this
service keeps a membership check so an unknown code is a `400 UNKNOWN_CODE` naming the field rather than a
`502` relaying the authority's own rejection — but a new code is a one-line addition rather than a mapping
decision, and the ISO table disappears.

`@Length(1, 8)`, not three: `002` and `060` are zero-padded and the padding is part of the code, and `MonId`
is `String(8)` in ARCA's cotización response while its catalogue's own `Id` is `String(3)`. Do not assume a
future entity codes currencies in three characters.

**Migration order** (this is the additive half): `currencyCode` is accepted now, `currencyIso` is optional
and still works. Once every caller sends the new field, `currencyIso` and the ISO table are removed as a
breaking CONTRACT-CHANGES entry. The ordering is not negotiable in the other direction — this service runs
`forbidNonWhitelisted: true`, so a caller cannot send `currencyCode` until the DTO declares it.

#### ARCA's currency catalogue

The forty-nine codes ARCA publishes via `FEParamGetTiposMonedas`, so a caller can seed
`fiscal_currency.fiscal_code` from a table under version control and diff against it rather than reading the
authority at runtime. `POST /api/currencies` deliberately does not exist: §5's own argument against serving
a catalogue applies, and a catalogue is build-time data.

The **reference currency** is the one row that matters structurally: mark it in your own seed rather than
hardcoding `"PES"`, which would be an ARCA constant living in a country-agnostic caller.

| code | name | ISO | notes |
| --- | --- | --- | --- |
| `PES` | Pesos Argentinos | `ARS` | **the reference currency** — answered locally at `1/1/1`, no authority call |
| `DOL` | Dólar Estadounidense | `USD` | default for its ISO code |
| `002` | Dólar Libre EEUU | `USD` | the "blue" — **same ISO code as `DOL`**, different published rate |
| `009` | Franco Suizo | — |  |
| `010` | Pesos Mejicanos | — |  |
| `011` | Pesos Uruguayos | — |  |
| `012` | Real | — |  |
| `014` | Coronas Danesas | — |  |
| `015` | Coronas Noruegas | — |  |
| `016` | Coronas Suecas | — |  |
| `018` | Dólar Canadiense | — |  |
| `019` | Yens | — |  |
| `021` | Libra Esterlina | — |  |
| `023` | Bolívar Venezolano | — |  |
| `024` | Corona Checa | — |  |
| `025` | Dinar Serbio | — |  |
| `026` | Dólar Australiano | — |  |
| `028` | Florín (Antillas Holandesas) | — |  |
| `029` | Güaraní | — |  |
| `030` | Shekel (Israel) | — |  |
| `031` | Peso Boliviano | — |  |
| `032` | Peso Colombiano | — |  |
| `033` | Peso Chileno | — |  |
| `034` | Rand Sudafricano | — |  |
| `035` | Nuevo Sol Peruano | — |  |
| `040` | Leu Rumano | — |  |
| `041` | Derechos Especiales de Giro | — |  |
| `042` | Peso Dominicano | — |  |
| `043` | Balboas Panameñas | — |  |
| `044` | Córdoba Nicaragüense | — |  |
| `045` | Dirham Marroquí | — |  |
| `046` | Libra Egipcia | — |  |
| `047` | Riyal Saudita | — |  |
| `049` | Gramos de Oro Fino | — | not a currency and has no ISO code — the case ISO-4217 could not express at all |
| `051` | Dólar de Hong Kong | — |  |
| `052` | Dólar de Singapur | — |  |
| `053` | Dólar de Jamaica | — |  |
| `054` | Dólar de Taiwan | — |  |
| `055` | Quetzal Guatemalteco | — |  |
| `056` | Forint (Hungría) | — |  |
| `057` | Baht (Tailandia) | — |  |
| `059` | Dinar Kuwaiti | — |  |
| `060` | Euro | `EUR` | default for its ISO code |
| `061` | Zloty Polaco | — |  |
| `062` | Rupia Hindú | — |  |
| `063` | Lempira Hondureña | — |  |
| `064` | Yuan (Rep. Pop. China) | — |  |
| `RUB` | Rublo (Rusia) | — | added by ARCA in 2025 |
| `NZD` | Dólar Neozelandes | — | added by ARCA in 2025 |

Codes with an ISO column can be bound to a real currency; the ones without cannot, and a rate bound to
`049` is therefore unselectable by construction rather than by rule.

### Address code schemes (a closed vocabulary this service returns)

The other direction: on a taxpayer lookup, every coded value on an address is returned **with the standard it
belongs to**, so a caller resolves the level by matching the pair `(code, codeScheme)` against its own
catalogs. These are the only values that can appear in a `*CodeScheme` field, across every entity:

| `codeScheme` | what the paired code is | example |
| --- | --- | --- |
| `ISO-3166-1-ALPHA-2` | country, ISO 3166-1 **alpha-2** | `"AR"` |
| `ISO-3166-2` | principal subdivision, ISO 3166-2 | `"AR-X"` (Córdoba) |
| `INDEC` | AR locality — INDEC localidad censal, 8 digits (provincia 2 + departamento 3 + localidad 3). The one scheme whose catalog is vendored, so the one that states a snapshot — see below | `"14014010"` |

Three properties this contract guarantees, because a caller keys on these:

- **Stable.** The strings are the contract; a value never changes meaning or spelling. Adding a scheme (a new
  country's national catalog — `IBGE`, `INSEE`) is additive; changing one is breaking and gets its own
  CONTRACT-CHANGES entry.
- **Unique.** No two coding systems share a token, so the pair alone identifies the catalog without the
  caller needing to know which level it came from. This is why the two ISO forms are named separately rather
  than both as `ISO`: 3166-1 defines three codes for the same country (alpha-2 `AR`, alpha-3 `ARG`, numeric
  `032`), and a shared token would make country and region collide.
- **Key-safe.** Uppercase, digits and hyphens only — no spaces, no case variation, nothing that differs
  between two spellings of the same thing. A near-miss would not error anywhere; it would simply match no
  row.

Seed them as constants rather than retyping them, and treat an unrecognized scheme as "cannot resolve this
level" rather than as a failure — that is exactly how a caller stays forward-compatible when a new entity
lands.

#### The `INDEC` code space: localidades censales, and nothing finer

**Every `INDEC` code this service emits is a *localidad censal*** — 8 digits, provincia 2 + departamento 3 +
localidad 3. INDEC's geography has levels below that one and the resolver reads them: a rural entidad or
paraje named in BAHRA is matched by name, then **projected up** to the localidad censal containing it, and
the localidad's code is what goes on the wire. No asentamiento id, departamento id or barrio id is ever
emitted.

This is a **guarantee, not an implementation detail**, and it is stated here because a caller relies on it
whether it knows or not: catalog the localidades-censales layer alone and every code we send resolves. A
build-time assertion in the index generator holds us to it — the distinct codes it emits must equal the
number of localidades censales it read, so a finer level cannot leak in silently. Emitting one anyway would
be **breaking**, with its own CONTRACT-CHANGES entry, never an internal change: a caller would resolve none
of it, and the failure would be indistinguishable from the barrio gap in §3.

#### `cityCodeSchemeVersion` — which snapshot the code came from

`INDEC` is the one scheme here with a version, because it is the one whose catalog this service **vendors a
snapshot of**. The value is the ISO date that catalog was read:

| | |
| --- | --- |
| Current snapshot | **`2026-08-25`** |
| Source | georef-ar (`apis.datos.gob.ar/georef`), Ministerio del Interior |
| Read from it | 4027 localidades censales, 14673 BAHRA asentamientos |
| Emittable distinct codes | **4027** — the localidades censales, per the guarantee above |

The dataset is live: INDEC adds localidades, so a caller resolving these codes against its own copy of the
same source is holding a snapshot too, and the two can drift. **What the version is for is telling drift
from a genuine gap.** Both arrive as a code that matches no row:

- **Same version as your own snapshot** → the catalogs agree. The code names something your copy does not
  hold either, i.e. the gap is real. Accept it and fall back to `city`.
- **Version newer than your own** → re-seed your catalog. This is the case that is otherwise invisible.

Read it, never match on it, and never reject a code for carrying a version you do not recognize. The ISO
levels carry no version and never will: there is no snapshot behind them — the country is a constant, and
the 24 AR subdivisions are a fixed table whose last change was Tierra del Fuego becoming a province in 1990.

**Not offered, deliberately: an endpoint serving the catalog.** It would remove the drift by construction and
it is the wrong shape — it makes a tax service a geography server. A caller carrying its own catalog is fine
as long as it can date a mismatch, which is what the version is.

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
| 400 | `ARCA_VALIDATION` | provider-side validation failed; `details.code` carries the specific reason (e.g. `UNMAPPED_CURRENCY`, `VOUCHER_ALREADY_AUTHORIZED_MISMATCH`, `VOUCHER_RANGE_UNSUPPORTED`, `VOUCHER_DATE_OUT_OF_WINDOW`, `INVALID_ISSUE_DATE`, `ISSUER_TAXID_CERT_MISMATCH`, `UNSUPPORTED_IDENTIFICATION_TYPE`, `UNKNOWN_CODE`, `INVALID_ID`) when known |
| 400 | `RECEIVER_MATCHES_ISSUER` | the authority rejected the voucher because the receiver's identification number equals the issuer's own (ARCA `10069`). Stable and caller-fixable, so it is a `400` — **not** the `502 ARCA_SERVICE` an unclassified rejection gets; `details: { arcaCode, arcaErrors }` |
| 403 | `DELEGATION_NOT_AUTHORIZED` | delegated call (§10), but our delegate CUIT is not authorized for `issuerTaxId` at the authority — the represented taxpayer must grant the delegation; `details: { delegateTaxId, issuerTaxId, arcaCode, arcaMessage }` |
| 404 | `VOUCHER_NOT_FOUND` | `query` only — the authority has no record of the voucher (never issued); `details` carries `entityCode`/`pointOfSaleNumber`/`documentTypeCode`/`voucherNumber`. Stable outcome, **never** a `502` — the signal core clears + re-authorizes a PENDING orphan on |
| 404 | `TAXPAYER_NOT_FOUND` | `taxpayers/lookup` only — no registry will report a taxpayer under the identifier (an unregistered tax id, a cancelled clave, or a document matching no clave); `details: { entityCode, identificationTypeCode, identificationNumber }`. `message` carries the authority's own wording where it gave one. Stable outcome, **never** a `502`, and the reason a successful lookup never returns an empty list |
| 409 | `CREDENTIALS_REQUIRED` | re-send with the issuer's credentials (§4). Never returned for a delegated request (§10) |
| 422 | (result body, not error envelope) | the authority rejected the voucher (`status:"REJECTED"`) |
| 501 | `NOT_IMPLEMENTED` | SDK operation not yet implemented |
| 502 | `ARCA_SOAP` / `ARCA_SERVICE` / `ARCA_AUTH` | authority transport/business/auth failure. `ARCA_SERVICE` now carries `details.arcaErrors` — the authority's full `[{ code, message }]` list, previously dropped — so core can log or branch on the underlying rejection |
| 500 | `DELEGATION_NOT_CONFIGURED` | this service has no valid delegate certificate for that `environment`, or (registry lookups) its certificate is not enrolled in the web service at the authority — a server misconfiguration either way; `details: { environment, reason }` |
| 500 | `ARCA_ERROR` / `INTERNAL` | unexpected |

---

## 9. What stays inside the ARCA provider (do NOT leak into the contract)
CAE / CAEFchVto, RG-4892 QR, MonId, tax-rate id, CbteTipo, DocTipo, CondicionIVAReceptor, ±5-day window,
WSAA/CMS signing, `homologacion`/`produccion`, the padrón service ids (`ws_sr_constancia_inscripcion`,
`ws_sr_padron_a13`) and their `personaReturn`/`datosGenerales`/monotributo vocabulary — all inside
`src/providers/arca/`. The neutral result already
abstracts CAE → `authorizationCode`.

Registry lookups add three of the same kind, and each one is why the corresponding neutral field exists:
ARCA's **`idProvincia`** province catalog (resolved here to ISO 3166-2, `mapping/geography/geography.ts`), the **free-text
`localidad`** (resolved to an INDEC code against a vendored national catalog, same module — the catalog is
internal, but *which snapshot of it* is published, §5), and the
**`idImpuesto`** table — 30 IVA, 32 IVA exento, 20 monotributo — which is what `fiscalConditionCode` is
derived from (`mapping/fiscal-condition/fiscal-condition.ts`). Core reading any of these directly would mean hardcoding an AFIP
table; that is this service's job, and the neutral field is the whole point of doing it here.

The cotización adds two more, and they are the clearest examples in this list because both are *numbers a
caller could plausibly have invented for itself*:

- **The rate band.** ARCA publishes a point cotización, not a range. Turning it into `lowerLimit` /
  `upperLimit` is an interpretation of Argentine tax law (WSFEv1 validation 10119), and the measured
  values live in `mapping/cotizacion/cotizacion.ts` (`BAND_RULE`). A caller inventing `±0.5%` would be
  hardcoding exactly this class of thing — and the constant would then apply, wrongly, to the next entity,
  which is now prevented structurally: the band's *shape and arithmetic* are entity-agnostic and live in
  `providers/provider/rate-band/`, which holds no authority's numbers, so an entity that does not supply its
  own rule gets no band rather than Argentina's.
- **Which day a rate is FOR.** ARCA's rows are working-day closes — no weekend, no feriado, none for today
  (measured against production 2026-09-01) — so the day that needs a rate is priced off the previous working
  day, weekends skipped and feriados discovered through the authority's own `602`, with a future date
  clamped. That resolution lives in `mapping/cotizacion/cotizacion.ts` (`RATE_DAY_RULE`) and is applied in
  every environment, because homologación's cotizaciones are generated. Another authority will key its rows
  differently, which is why `date` means "the day that needs a valid rate" on the wire and the resolution
  stays in here. It is also why `refreshAfter` is an absolute instant rather than an hour: a clock on the
  wire is an Argentine policy constant living in a country-agnostic scheduler, the same mistake moving
  `idProvincia` off the wire avoided.

Also here for the same reason: **`America/Argentina/Buenos_Aires` itself**. Which calendar day an instant
falls on is resolved inside this service (`mapping/authority-day/`), which is why every date on the wire is
a bare authority day and no caller has to convert one (§2).

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

### Registry lookups use our delegate *identity*, not a representación

`POST /api/taxpayers/lookup` (§3) also signs with our delegate certificate, but it is **not** a delegated call
in the sense above and none of this section's rules apply to it. ARCA's padrón services only require that
`cuitRepresentada` appear in the token's `relations` — which, for a login we signed ourselves, is our own
CUIT. So the service acts as **itself**: no `issuerTaxId`, no represented taxpayer, no
`DELEGATION_NOT_AUTHORIZED`, and nobody has to grant us anything in *Administrador de Relaciones*.

The one prerequisite is on **our** side: our delegate certificate must be adhered to each registry web
service — `ws_sr_constancia_inscripcion` and `ws_sr_padron_a13` — in ARCA's WSASS (homologación) or
Administrador de Relaciones (production). Until it is, WSAA refuses the login with `coe.notAuthorized` /
"Computador no autorizado a acceder al servicio". On this path that is deterministic and permanent, so it is
reported as `500 DELEGATION_NOT_CONFIGURED` naming the missing service in `details.reason` — deliberately not
the `502` the raw transport error would suggest, because retrying cannot enrol a certificate. **Core action:
none** — it is a deployment task on this service.

Because no representación is involved, a lookup can never answer `403 DELEGATION_NOT_AUTHORIZED` — there is no
second party to have failed to authorize us. If ARCA rejects the delegate *ticket* itself (token, signature or
certificate), that lookup returns `502 ARCA_AUTH` and the cached ticket for that registry service is dropped so
the next lookup re-mints; one ticket serves every lookup, so a bad one left cached would fail all of them until
it expired. A refusal that names the *enrolment* rather than the ticket leaves the cached ticket alone — it is
valid, and ARCA would not re-issue it for ~12h. **Core action: none** — retry as with any `502`.

### Cotización lookups use our delegate *identity* too

`POST /api/currencies/rates` (§3) signs with our delegate certificate on the same terms as
`/taxpayers/lookup`: `Auth.Cuit` is our **own** delegate CUIT, the service acts as itself, and none of this
section's representación rules apply. No `issuerTaxId`, no represented taxpayer, and it can never answer
`403 DELEGATION_NOT_AUTHORIZED` — there is no second party to have failed to authorize us.

It differs from the registry lookups in one way worth stating: it is a **WSFEv1** call, on the same `wsfe`
service the issuing endpoints use, so it carries `Auth.Cuit` where the padrón services only need
`cuitRepresentada` in the token's relations. The prerequisite is therefore the ordinary one — our delegate
certificate must be enrolled in `wsfe`, which it already is for delegated issuing to work at all — and a
ticket we sign naming ourselves needs nobody's permission.

**If the authority ever refuses a `FEParam*` read under our own CUIT**, that is a change inside the provider
and not on the wire: the endpoint stays credential-free and the fallback is ours to build.

**It does not refuse it today, and that is measured rather than assumed.** Against homologación on
2026-08-31, `FEParamGetCotizacion` answered under our own delegate CUIT with no representación at all:

| call | result |
| --- | --- |
| `FEParamGetCotizacion("DOL")` | `MonCotiz 1158.195`, `FchCotiz 20260830` |
| `FEParamGetCotizacion("060")` | `MonCotiz 1186.5538`, `FchCotiz 20260830` |
| `FEParamGetCotizacion("PES")` | `602 Sin Resultados` |

No `600` and no `601` anywhere in that run — so the endpoint needs no fallback and no tenant certificate
near it, and it can be cached centrally per `(entityCode, environment)`. Two things worth reading off the
table: homologación serves **live** cotizaciones rather than stubs, so a testing environment exercises the
real behaviour; and `PES` genuinely has no publication upstream, which is why the reference currency is
answered locally at `1/1/1` (§3) rather than asked for. The `602` is the authority's, not ours.

A token/certificate rejection here returns `502 ARCA_AUTH` and drops the cached `wsfe` delegate ticket so
the next request re-mints — the same handling the registry path gets, and for the same reason: one ticket
serves every call, so a bad one left cached would fail all of them until it expired. **Core action: none.**
