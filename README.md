# arca-webprocess-api

Standalone **Argentina (ARCA/AFIP) tax-integration service** — the first instance of the per-country fiscal
service pattern extracted from `webprocess-api`. It wraps the self-contained `src/arca` SDK (WSAA + WSFEv1 +
padrón) behind a neutral, country-agnostic HTTP contract so the core API stays country-agnostic.

> Status: **Phase 2 scaffold / runnable skeleton.** `GET /api/health` and `POST /api/authority/status` are
> wired to the real SDK; the invoice/taxpayer endpoints are honest `501` stubs.

## Credential / auth model — "split WSAA", core-driven

This service **never holds the private key** and **never makes outbound calls**:

- **Core (`webprocess-api`)** owns the cert/key store + `ARCA_MASTER_KEY` and does all WSAA minting.
- **This service** owns the ~12h **ticket cache** and the WSFEv1/padrón business calls.
- Requests carry issuer **identity** `{ cuit, environment }`. On a cache miss this service replies
  **`409 TICKET_REQUIRED`**; core mints a ticket and **re-sends** the same request with the ticket attached.
  The raw key never crosses the network; the coupling is unidirectional (core always initiates).

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
  -d '{"environment":"homologacion"}'
```

## Scripts

| script | purpose |
| --- | --- |
| `pnpm dev` | hot-reload dev server (nodemon + ts-node/esm) |
| `pnpm start` | run once via ts-node/esm (no watch) |
| `pnpm build` | emit production JS to `dist/` (`tsc -p tsconfig.build.json`) |
| `pnpm serve` | run the built `dist/index.js` |
| `pnpm typecheck` | strict type gate (`tsc --noEmit`) |
| `pnpm test` | run the copied SDK's unit tests (extraction regression oracle) |
| `pnpm lint` | ESLint strict-type-checked (new code only) |
| `pnpm format` | Prettier |

## HTTP contract (routePrefix `/api`)

| endpoint | status | notes |
| --- | --- | --- |
| `GET /health` | ✅ live | liveness (no SDK) |
| `POST /authority/status` | ✅ wired | WSFEv1 `FEDummy`; body `{ environment }` |
| `POST /invoices/authorize` | 🚧 501 | neutral invoice doc → CAE |
| `GET /invoices/last-authorized` | 🚧 501 | last authorized voucher number |
| `POST /invoices/query` | 🚧 501 | idempotency backstop |
| `POST /taxpayers/lookup` | 🚧 501 | padrón lookup |

## Layout

```
src/
├── index.ts          # bootstrap (Express 5 + routing-controllers)
├── config/env.ts     # typed, frozen env (no secrets, no master key)
├── arca/             # copied SDK (verbatim from webprocess-api/src/arca)
├── session/          # ticket-store.ts — ticket cache + TICKET_REQUIRED signal
└── http/             # controllers, DTOs, mappers (neutral contract)
```
