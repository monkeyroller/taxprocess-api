# tax-webprocess-api

Standalone **general tax-integration service**. It dispatches each request on an **entity code** to a
registered provider — **ARCA** (Argentina/AFIP) today; more tax entities (e.g. Chile SII, Mexico SAT) by
registering a provider. Core (`webprocess-api`) is a **dumb conduit**: it sends its own generic ids plus an
`entityCode`, and this service owns every entity-specific detail (id→real-code mapping, credential validation,
WSAA/QR/CAE, environment naming). Callers speak a neutral, country-agnostic HTTP contract.

> Providers live under `src/providers/`; the ARCA provider wraps the self-contained `src/providers/arca/sdk`
> library (WSAA + WSFEv1 + padrón). See [docs/CONTRACT.md](docs/CONTRACT.md) for the full HTTP contract, the
> per-entity JSON Schemas, and the core-side (`webprocess-api`) obligations.

## Credential / auth model — service-minted, core-driven

This service **stores no secrets at rest** and **never makes core-initiated outbound calls**:

- **Core (`webprocess-api`)** owns the encrypted cert/key store + `ARCA_MASTER_KEY`.
- **This service** owns the ~12h **WSAA ticket cache** and all business calls, and does the WSAA login itself.
- Requests carry issuer **identity** `{ entityCode, issuerTaxId, environment }`. On a ticket-cache miss with no
  credentials, this service replies **`409 CREDENTIALS_REQUIRED`**; core **re-sends** the same request with the
  decrypted `credentials: { certPem, keyPem }` attached, this service logs in to the authority, caches the
  ~12h ticket, and proceeds. Credentials cross the wire only on a refresh (~once/12h), never per request; the
  key is held in memory only and never persisted. The hop must be **mTLS on a private network**.

**Operational note (ticket persistence):** the ticket cache is in-memory with optional file persistence via
`ARCA_TICKET_CACHE_PATH`. WSAA refuses to re-issue a ticket while a prior one is still valid, so run
**single-node**, or point every instance at a **shared `ARCA_TICKET_CACHE_PATH`**. Horizontally-scalable
(e.g. Redis-backed) shared ticket storage is deferred.

## Requirements

- Node.js **22+** (see `.nvmrc`)
- **pnpm** (`packageManager` pinned)

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm dev          # hot-reload dev server (ts-node/esm)
```

Verify:

```bash
curl http://localhost:4101/api/health
curl -X POST http://localhost:4101/api/authority/status \
  -H 'content-type: application/json' \
  -d '{"entityCode":"ARCA","environment":"testing"}'
```

## Scripts

| script | purpose |
| --- | --- |
| `pnpm dev` | hot-reload dev server (nodemon + ts-node/esm) |
| `pnpm start` | run once via ts-node/esm (no watch) |
| `pnpm build` | emit production JS to `dist/` (`tsc -p tsconfig.build.json`) |
| `pnpm serve` | run the built `dist/index.js` |
| `pnpm typecheck` | strict type gate (`tsc --noEmit`) |
| `pnpm test` | unit tests (provider logic + the copied SDK's extraction regression oracle) |
| `pnpm lint` | ESLint strict-type-checked (new code only; the copied SDK is ignored) |
| `pnpm format` | Prettier |

## HTTP contract (routePrefix `/api`)

Every issuing call carries an `entity` block `{ entityCode, issuerTaxId, environment, credentials? }` and
dispatches on `entityCode` (unknown code → `400 UNKNOWN_ENTITY`). The neutral field names are generic by design;
see the **Neutral field glossary** in [docs/CONTRACT.md](docs/CONTRACT.md) for what each maps to (e.g.
`issuerTaxId` → ARCA CUIT, `documentTypeId` → CbteTipo).

| endpoint | status | notes |
| --- | --- | --- |
| `GET /health` | ✅ live | liveness (no provider) |
| `POST /authority/status` | ✅ wired | authority health; body `{ entityCode, environment }` |
| `POST /entities/:entityCode/credentials/validate` | ✅ wired | validate `configuration` + `credentials` at registration |
| `POST /invoices/authorize` | ✅ wired | neutral invoice (core ids) → authorization code (+ RG-4892 QR) |
| `POST /invoices/last-authorized` | ✅ wired | last authorized voucher number |
| `POST /invoices/query` | ✅ wired | idempotency backstop |
| `POST /taxpayers/lookup` | 🚧 501 | plumbing wired; ARCA SDK padrón parser is a seed |

Authenticated endpoints reply `409 CREDENTIALS_REQUIRED` on a ticket-cache miss; core re-sends with
`entity.credentials` attached (see the contract doc).

## Layout

```
src/
├── index.ts               # bootstrap (Express 5 + routing-controllers)
├── config/env.ts          # typed, frozen env (no secrets, no master key)
├── providers/
│   ├── provider.ts        # abstract TaxEntityProvider + neutral request/result types
│   ├── registry.ts        # entityCode → provider dispatch
│   └── arca/              # the ARCA provider (sole owner of AR specifics)
│       ├── arca.provider.ts
│       ├── clients.ts     # shared SDK clients
│       ├── code-maps.ts   # id → ARCA code maps (documentTypeId→CbteTipo, …)
│       ├── ar-invoice.mapper.ts
│       ├── ticket-store.ts    # WSAA ticket cache + CREDENTIALS_REQUIRED signal
│       ├── credentials.ts     # PEM/CUIT credential validation
│       ├── environment.ts     # production/testing ↔ produccion/homologacion
│       └── sdk/           # copied ARCA SDK (verbatim; WSAA + WSFEv1 + padrón)
└── http/                  # controllers + DTOs (neutral contract)
```
