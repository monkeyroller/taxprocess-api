# taxprocess-api

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
| `pnpm typecheck` | strict type gate — `src` **and** `scripts/` (`tsconfig.json` + `tsconfig.scripts.json`, both `--noEmit`) |
| `pnpm test` | unit tests (provider logic + the copied SDK's extraction regression oracle) |
| `pnpm lint` | ESLint strict-type-checked (new code only; the copied SDK is ignored) |
| `pnpm format` | Prettier |
| `pnpm probe:band` | measure the exchange-rate band ARCA enforces. **Homologación only**; `PROBE_MODE=full` authorizes real vouchers and burns voucher numbers — read-only by default |
| `pnpm probe:cotizacion-day` | measure which DAY a cotización is for. Read-only in every mode; `PROBE_ENVIRONMENT=production` is required for a meaningful answer (homologación's series is generated) |

The two probes exist because their answers are measurements with a shelf life, not readings of ARCA's
manual — re-run the probe rather than re-reading the PDF. Both are configured through `PROBE_*` env vars;
see [.env.example](.env.example) and the header comment in each script.

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
| `POST /invoices/next-numbers` | ✅ wired | batch next-expected number for several document types of one point of sale; de-duplicated, echoed by `documentTypeCode` |
| `POST /invoices/query` | ✅ wired | idempotency backstop |
| `POST /points-of-sale` | ✅ wired | the issuer's registered points of sale; identity-only body |
| `POST /taxpayers/lookup` | ✅ wired | registry lookup by identification type; uses this service's own delegated identity (no `entity` block) |
| `POST /currencies/rates` | ✅ wired | published exchange rates + the band the authority accepts; delegated identity, no `entity` block |

Authenticated endpoints reply `409 CREDENTIALS_REQUIRED` on a ticket-cache miss; core re-sends with
`entity.credentials` attached (see the contract doc). `POST /taxpayers/lookup` is the exception: it signs with
this service's own delegate certificate, so it carries no issuer and never asks for credentials — it does
require that certificate to be enrolled in `ws_sr_constancia_inscripcion` and `ws_sr_padron_a13` at ARCA.

## Layout

A module that has unit tests lives in a folder named after it, holding the module and its test —
`mapping/geography/{geography.ts, geography.test.ts}`. The folder name is kebab-case even where the
filename keeps a dotted suffix: `mapping/invoice-mapper/invoice.mapper.ts`. Modules with no test of
their own stay as plain files next to their siblings. The `/` suffixes below mark the folders that
convention creates.

```
src/
├── index.ts               # bootstrap (Express 5 + routing-controllers)
├── config/env.ts          # typed, frozen env (no secrets, no master key)
├── providers/
│   ├── provider/          # the neutral contract, one file per concern
│   │   ├── provider.ts                 # abstract TaxEntityProvider + the outbound fault guard
│   │   ├── environment.ts              # production/testing, the generic environment selector
│   │   ├── entity-auth.ts              # the entity/issuer block + issuer credentials
│   │   ├── neutral-invoice.ts          # the neutral invoice core sends
│   │   ├── neutral-results.ts          # the result aliases (naming the http/dto shapes)
│   │   ├── credential-validation.ts    # validateCredentials input/output
│   │   ├── faults.ts                   # the neutral error contract (ProviderFault + friends)
│   │   ├── address-code-scheme/        # the shared (code, codeScheme) address vocabulary
│   │   ├── taxpayer-vocabulary/        # detail / person type / registration status, shared with http/dto
│   │   └── rate-band/                  # the FORM of an exchange-rate band + the arithmetic (no entity's numbers)
│   ├── registry/          # entityCode → provider dispatch
│   ├── concurrency/       # bounded, order-preserving fan-out (mapWithConcurrency)
│   ├── expiring-cache/    # expiring (owner, scope) cache: single-flight + atomic on-disk persistence
│   ├── rounding/          # roundTo vs roundHalfUpTo — the money one is named, not assumed
│   ├── xml-node/          # reading values off a parsed SOAP node (parser facts, no authority's)
│   ├── pem/               # X.509 / PKCS#1 / PKCS#8 / CSR handling (entity-agnostic)
│   └── arca/              # the ARCA provider (sole owner of AR specifics)
│       ├── arca-provider/          # orchestration: resolve a ticket, call the SDK, map the answer
│       ├── clients.ts              # shared SDK clients
│       ├── faults/                 # what an ARCA failure IS (pure classification)
│       ├── voucher-recovery.ts     # already-authorized (10016) reconciliation
│       ├── auth/                   # who we sign as
│       │   ├── ticket-store/           # WSAA ticket cache + CREDENTIALS_REQUIRED signal
│       │   ├── credentials/            # PEM/CUIT credential validation
│       │   ├── delegate-credentials/   # this service's own delegate cert (padrón lookups)
│       │   └── environment/            # production/testing ↔ produccion/homologacion
│       ├── mapping/                # canonical/neutral ↔ ARCA translation
│       │   ├── canonical-codes.ts      # the canonical code vocabulary (belongs to no provider)
│       │   ├── code-maps/              # canonical code → ARCA code (documentTypeCode→CbteTipo, …)
│       │   ├── currency-codes/         # the ARCA MonId catalogue + currencyCode → MonId
│       │   ├── padron-routing/         # identification type → which padrón service answers
│       │   ├── identifiers.ts          # CUIT/id parsing + canonicalization
│       │   ├── invoice-mapper/         # neutral invoice ↔ WSFEv1 request/result
│       │   ├── taxpayer-mapper/        # SDK padrón data → neutral taxpayer DTOs
│       │   ├── fiscal-condition/       # ARCA impuestos → canonical fiscalConditionCode
│       │   ├── authority-day/          # an accepted date → the ARCA day it lands on (+ day arithmetic)
│       │   ├── cotizacion/             # AR rate policy: the band, the reference currency, which day prices a voucher
│       │   ├── geography/              # idProvincia → ISO 3166-2, localidad → INDEC code
│       │   └── indec/                  # the vendored INDEC catalog + the folding applied to it
│       └── sdk/           # copied ARCA SDK (WSAA + WSFEv1 + padrón)
└── http/                  # controllers + DTOs (neutral contract)
    ├── dto/               # one module per request body and per result family
    │   └── authority-date/     # which date FORMS the contract accepts (shape only — no zone, no entity)
    └── error-mapper/      # neutral fault category → HTTP status + envelope
```

The modules sitting directly under `providers/` — `concurrency/`, `expiring-cache/`, `rounding/`,
`xml-node/`, `pem/` — plus `provider/rate-band/` are **entity-agnostic leaves**: each solves a problem that
is a fact about a parser, a file, a certificate or arithmetic, never about an authority. They live outside
`arca/` so a second entity reuses them rather than growing a second copy, and each one is there because a
second copy had already appeared or was about to. The rule that keeps them honest: an authority's own
numbers and vocabulary stay in that authority's provider. `rate-band/` holds the *form* of a band and the
arithmetic; ARCA's measured `[0.02R, 5R]` lives in `arca/mapping/cotizacion/`.

The `sdk/` tree is framework-agnostic and has no barrel: import from the defining module. Consumers
construct the service classes directly — each bound to a shared, stateless `SoapClient` plus an
environment — and pass an `ArcaAuth`, obtained from `WsaaClient`, into every call. There is no per-issuer
orchestrator inside the SDK; auth policy (ticket caching, credential handshakes) is the consumer's
concern, which is what `auth/ticket-store/` owns.
