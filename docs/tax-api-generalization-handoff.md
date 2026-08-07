# Generalization Handoff — `arca-webprocess-api` → general tax API

**Direction:** planning handoff, authored from the `webprocess-api` (core) side. **Status:** roadmap — no code
yet. This doc is the authoritative spec for the tax-API half of a coordinated, two-repo refactor. A separate
`webprocess-api` plan covers the core half; the two must ship together (see **Coordination** at the end).

## Why

Today this service is ARCA/AFIP-only. The goal is to make it a **general tax service** that serves multiple tax
entities (ARCA now; later Chile SII, Mexico SAT, …), selected per request by an **entity code**. In parallel,
`webprocess-api` (core) is being stripped of ALL tax-entity knowledge: core will stop sending pre-resolved ARCA
codes and instead send **its own generic ids** plus an entity discriminator. **This service becomes the sole
owner of every entity-specific detail** — id→real-code mapping, credential validation, WSAA, QR, CAE, etc.

Net principle: **core is a dumb conduit; this service does all the adapting.**

## Current state (starting point)

- Express 5 + `routing-controllers`, `routePrefix: '/api'`, entry `src/index.ts`, port 4101.
- Contract in `docs/CONTRACT.md`. Endpoints: `GET /api/health`, `POST /api/authority/status`,
  `POST /api/invoices/authorize`, `POST /api/invoices/last-authorized`, `POST /api/invoices/query`,
  `POST /api/taxpayers/lookup`.
- Everything is hardcoded to ARCA: controllers call ARCA SDK singletons via `src/arca-clients.ts`; the issuer DTO
  validates `countryCode` with `@Equals('AR')` but **never dispatches on it**; the vendored ARCA SDK lives in
  `src/arca/`; the neutral result DTO (`http/dto/neutral-result.dto.ts`) and `http/mappers/ar-invoice.mapper.ts`
  already speak a "country-agnostic" result shape.
- `session/ticket-store.ts` holds the WSAA ~12h ticket cache (`ARCA_TICKET_CACHE_PATH`); `CREDENTIALS_REQUIRED`
  is the refresh handshake. The service stores **no secrets at rest** and has **no** `ARCA_MASTER_KEY` (that
  lives in core).
- **Key mismatch to fix:** today core sends **already-resolved ARCA codes** in the invoice body (`voucherType` =
  CbteTipo, `receiverIvaConditionId`, `receiverDocType` = DocTipo, `currency` ISO string). After this refactor
  **core sends its own ids** (`documentTypeId`, `fiscalConditionId`, `identificationTypeId`, currency ISO) and
  THIS service maps them to the real ARCA codes.

## Target work

### H1 — Rename + provider dispatch
- Rename the service to a general tax service (package name, README, CONTRACT.md framing).
- Define `interface TaxEntityProvider { validateCredentials, authorizeInvoice, lastAuthorized, queryVoucher,
  authorityStatus, lookupTaxpayer }` and a registry keyed by **entity code** (e.g. `'ARCA'`).
- Move the current AR implementation — the vendored `src/arca/` SDK, `src/arca-clients.ts`,
  `src/session/ticket-store.ts`, `src/http/mappers/ar-invoice.mapper.ts` — behind **`src/providers/arca/`**,
  registered under `ARCA`.
- Controllers dispatch on the request's **`entityCode`** (replace the `@Equals('AR')` `countryCode` validation);
  reject unknown entity codes.
- Delete the vendored `src/arca/core/key-crypto.ts` — it belongs to core (this service stores no secrets).

### H2 — Own the id→real-code mapping (the crux)
Hold **per-entity maps keyed by core's ids**, and translate the neutral invoice into ARCA's WSFEv1 request:
- `(entity, webp document_type_id) → CbteTipo`
- `(entity, webp fiscal_condition_id) → CondicionIVAReceptorId` (RG 5616)
- `(entity, webp identification_type_id) → DocTipo` (80 = CUIT, 96 = DNI, 99 = …)
- plus the existing mechanical mapping already in `ar-invoice.mapper.ts`: ISO-4217 → MonId, VAT % → id, concept,
  RG-4892 QR, CAE, ±5-day CbteFch clamp.

Seed these AR maps from the values **core is dropping**: `common.document_type.arca_code`, the
`common.arca_fiscal_condition` PKs (which today equal the AFIP `CondicionIVAReceptorId`), and
`common.identification_type.iso_code`. Ask the core thread for a dump of those three catalogs, or read them from
the shared DB during migration. Storage for the maps can be config/JSON or a small DB — your call; they are
AR-specific and owned here.

### H3 — Credentials validate endpoint (new)
`POST /api/entities/:entityCode/credentials/validate` — body `{ environment, configuration, credentials }`.
The entity provider validates shape + correctness and returns `{ ok: true }` or structured errors. For ARCA:
CUIT format (from `configuration.taxpayerId`), certificate is the issued cert (not a CSR), private key matches
the certificate. Core calls this synchronously during `POST /integrations` so bad credentials are rejected at
registration time. (This is the ARCA PEM/CUIT validation that currently lives in core's `provider-adapters.ts`
and `src/arca/core/pem.ts` — it moves here.)

### H4 — Generalize the wire vocabulary
- `cuit` → **`taxpayerId`** (generic issuing-taxpayer identifier). It is the **non-secret issuer identity** and
  the ticket-cache partition; core sends it on the identity-first request (before credentials), sourced from the
  integration's `configuration` — so it is NOT inside the encrypted `credentials`.
- Drop `countryCode` from the issuer block; the discriminator is **`entityCode`**.
- `environment` carries generic **`'production' | 'testing'`**; map to `homologacion`/`produccion` **inside**
  `providers/arca/` (do not leak AR env vocabulary into the contract). SOAP hosts stay in
  `src/providers/arca/.../constants.ts`.
- Ticket-cache key becomes `(entityCode, service, taxpayerId, environment)`. `CREDENTIALS_REQUIRED` handshake
  unchanged.

### H5 — Own & publish the JSONB schemas
This service is the **authority** for the per-entity shapes of the three JSONB blobs core stores opaquely.
Publish a JSON Schema per `(entityCode, purpose)` in `CONTRACT.md`; the H3 validate endpoint enforces
`configuration` + `credentials`.
- `configuration` — non-secret settings incl. issuer identity. **ARCA:** `{ environment, taxpayerId,
  <web-service selection: WSFEv1 | WSMTXCA | WSFEXv1> }` (the web-service selection moves out of core's
  `electronic_sale_type` catalog into here).
- `credentials` — secret bundle only. **ARCA:** `{ certPem, keyPem }`.
- `provider_metadata` — entity-specific extras this service returns for core to persist on the sale's
  authorization row. **ARCA:** `{ conceptTypeId, … }`.

Adding a future entity = register a provider (H1) + its id→code maps (H2) + its three JSON Schemas (H5). **No
core change.**

## The wire contract (core ↔ this service), generalized

Issuer/entity block on every issuing call:
```jsonc
{ "entityCode": "ARCA", "taxpayerId": "20123456789",
  "environment": "testing",                 // generic; AR provider maps to homologacion/produccion
  "credentials": { "certPem": "…", "keyPem": "…" } }   // OMITTED first; attached by core on CREDENTIALS_REQUIRED
```

`POST /api/invoices/authorize` — body `{ entity: <block above>, invoice: <NEUTRAL, core ids> }`:
```jsonc
{
  "documentTypeId": 12,                     // core id → this service maps to CbteTipo
  "salesPointNumber": 3,
  "receiver": { "identificationTypeId": 1,  // → DocTipo
                "identificationNumber": "30111111118",
                "fiscalConditionId": 5 },   // → CondicionIVAReceptorId
  "currencyIso": "ARS", "currencyRate": 1,
  "issueDate": "2026-08-07",
  "lines": [ { "netAmount": 1000, "taxRatePercent": 21, "taxAmount": 210 } ],
  "totals": { "untaxed": 0, "exempt": 0, "perceptions": 0 }
}
```
Response — unchanged neutral result (already implemented): `TaxAuthorizationResult { authorizationCode,
expiration, authorizedNumber, qr?, status: AUTHORIZED|PARTIAL|REJECTED, observations[] }`.

`POST /api/entities/:entityCode/credentials/validate` — H3, as above.

`last-authorized` / `query` / `authority/status` — same as today but take the generalized entity block and
dispatch by `entityCode`.

## What stays in the AR provider (do NOT leak into the contract)
CAE / CAEFchVto, RG-4892 QR, MonId, VAT-id, CbteTipo, DocTipo, CondicionIVAReceptor, ±5-day clamp, WSAA/CMS
signing, `homologacion`/`produccion` — all inside `src/providers/arca/`. The neutral result DTO already
abstracts CAE → `authorizationCode`.

## Coordination (critical)
- H1–H4 must land **before** core stops sending ARCA codes; core removing them and this service accepting core
  ids is a **single coordinated cutover** with a shared wire vocabulary — **no dual-name transition window**
  (core has decided: no back-compat names/shims).
- This service must expose the H3 validate endpoint **before** core's `POST /integrations` starts calling it.
- Get the AR seed data (document_type.arca_code, arca_fiscal_condition PKs, identification_type.iso_code) from
  the core thread at migration time so the H2 maps reproduce today's behavior exactly.
- Regression oracle: the vendored `src/arca/**/*.test.ts` and the existing homologación smoke path must stay
  green after the move behind `providers/arca/`.
