# Core wire-alignment — required before the coordinated cutover

**Date:** 2026-08-10 · **Status:** ACTION REQUIRED (core) · **Repos:** `webprocess-api` (core) → `tax-webprocess-api`
**Companion:** `webprocess-api/docs/contract-changes/2026-08-10_core-wire-alignment.md` (core-side mirror)

## Why

The tax service migrated to a neutral, multi-entity wire contract (see `docs/CONTRACT.md` + the DTOs
`src/http/dto/{entity-auth,invoice,credentials}.dto.ts`). Core's outbound client (commit `165a695` on
`feature/facturacion-electronica`) was **not** migrated with it — it still sends the old ARCA vocabulary. The tax
service validates with `whitelist:true, forbidNonWhitelisted:true`, so core's current body is rejected
**`400 BadRequestError` on every invoice call**. There is **no back-compat window**: core must adopt the neutral
contract before the two are deployed together. Paths (`/api`) + port (4101) already match, and core already
detects `409 CREDENTIALS_REQUIRED` correctly — only the request **bodies** must change.

## Files to change (core)

- `src/app/services/protected/transactions/argentina-tax-client.ts` — HTTP client (identity block ~L165-167,
  credentials re-send ~L174-178, last-authorized ~L118, query ~L138, authority/status ~L147, line types ~L37-59).
- `src/app/services/protected/transactions/argentina-invoice-payload.ts` — invoice body builder (~L44-62).
- `src/app/services/protected/transactions/electronic-invoice.service.ts` — caller (stale `TICKET_REQUIRED`
  comment ~L36).
- `src/app/services/protected/public/integration/{integration.service.ts, provider-adapters.ts}` — registration
  (`buildTaxIssuerContext` ~L139-147, `validateConfiguration` ~L98-101, `create` ~L40-75).

## Required changes

### 1. Entity/issuer block
- Wire key `issuer` → **`entity`**.
- Drop `countryCode`; add **`entityCode: "ARCA"`**.
- `cuit` (number) → **`issuerTaxId`** (string, digits only).
- Credentials re-send: `issuer.credentials` → **`entity.credentials`** (`{certPem, keyPem}` names unchanged).

### 2. Environment on the wire
- Send generic **`"production"` / `"testing"`**. Stop converting to `produccion`/`homologacion` in
  `buildTaxIssuerContext` for the outbound payload (that AR naming must never appear on the wire; the tax
  service maps it internally).

### 3. Invoice body → neutral (and nested)
| old (core sends) | new (neutral) |
| --- | --- |
| `voucherType` | `documentTypeId` |
| `currency` | `currencyIso` |
| `receiverDocType` (flat) | `receiver.identificationTypeId` |
| `receiverDocNumber` (flat, number) | `receiver.identificationNumber` (**string**) |
| `receiverIvaConditionId` (flat) | `receiver.fiscalConditionId` |
| `vatRatePercent` / `vatAmount` (lines) | `taxRatePercent` / `taxAmount` |
| `untaxedTotal` / `exemptTotal` / `perceptionsTotal` (flat) | `totals.untaxed` / `totals.exempt` / `totals.perceptions` |
| `concept`, `salesPointNumber`, `currencyRate`, `issueDate`, `netAmount` | unchanged |

Core sends the **generic ids** (`documentTypeId`, `receiver.identificationTypeId`,
`receiver.fiscalConditionId`) — the tax service maps them to ARCA codes. Do **not** resolve ARCA codes core-side
anymore.

### 4. `identificationNumber` is a string
- Drop the `Number(...)` coercion at `payload.ts:54`. Send the id number as a **string** to preserve leading
  zeros and the `"0"` anonymous-consumer sentinel the contract specifies.

### 5. last-authorized / query
- `voucherType` → **`documentTypeId`** in both bodies (`{entity, salesPointNumber, documentTypeId[, voucherNumber]}`).

### 6. authority/status
- Body becomes `{ entityCode, environment }` — add **`entityCode`**, send generic environment.

### 7. (H3) Credential validation — call the tax service
- In `IntegrationService.create`, call **`POST /entities/:entityCode/credentials/validate`** synchronously
  (body `{ environment, configuration, credentials }`) and reject registration on `{ok:false}`. This replaces (or
  backs) the current local-only `arcaAdapter.validateAndCanonicalizeCredentials` check, so the tax service is the
  single authority for credential validity.

### 8. (H5) `configuration` shape
- Persist/send `configuration` as **`{ issuerTaxId, webService, environment }`** (currently `{environment}` only;
  `issuerTaxId` is buried in `credentials.cuit`, `webService` absent). `webService` ∈ `WSFEv1 | WSMTXCA | WSFEXv1`.

### 9. Tests & comments
- Update core client/unit tests (and any fixtures) to the neutral shapes.
- Fix the stale `TICKET_REQUIRED` comment in `electronic-invoice.service.ts:36` (code already uses
  `CREDENTIALS_REQUIRED`).

## Already correct in core (no change)
- `/api` paths + port 4101 (DB-driven `common.integration_provider`; seed `http://localhost:4101`).
- `409 CREDENTIALS_REQUIRED` detection (`isCredentialsRequired`).

## Verification (interop gate)
Once the above lands, run the tax service on :4101, point core at it, and confirm core's `authorize` is
**accepted (no 400)**; then a homologación authorize (real cert/key) returns a CAE end-to-end. Fitness grep on
core's four outbound files: no `issuer` / `countryCode` / `voucherType` / `produccion` remain.

## Reference
- Neutral contract + **field glossary** (what each generic field maps to): `tax-webprocess-api/docs/CONTRACT.md`.
- DTOs (authoritative shapes): `tax-webprocess-api/src/http/dto/{entity-auth,invoice,credentials}.dto.ts`.
- `concept` / `provider_metadata` prior resolutions: `docs/contract-changes/2026-08-07_neutral-invoice-concept.md`.
