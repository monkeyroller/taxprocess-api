# taxprocess-api — contract requests from core

Audience: the **`taxprocess-api`** team. The mirror image of [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md):
that file records what this service changed and what core must adapt to; this one records what **core is
asking this service for**, newest first. Each entry states what is requested, why it belongs here rather
than in core, and whether core is blocked on it.

---

## 2026-08-25 (later) — Locality catalog provenance, and a status update from core

> **DELIVERED 2026-08-26** — both asks, on branch `feature/padron`. See
> [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md); nothing breaks.
>
> **Ask 6 — granted as `address.cityCodeSchemeVersion`**, the ISO date the catalog was read, present exactly
> when `cityCode` is. On the address rather than in prose because that is where the ambiguity happens: same
> version as yours ⇒ the gap is real, newer ⇒ re-seed. The baseline is published in CONTRACT §5 — snapshot
> `2026-08-25`, 4027 localidades censales, 4027 distinct emittable codes — which **matches your diff in both
> directions**, so the two catalogs are known-identical as of that date. One caveat on the value: georef
> publishes no dataset version, so this is the date *we* read it. Monotonic and comparable, which is what the
> drift question needs.
>
> **Ask 7 — void as stated, and the table now says why.** `identificationTypeCode` comes from ARCA's
> `tipoClave`, which is optional in the authority's schema and is not recoverable from the number: CUIT, CUIL
> and CDI share the `20`/`23`/`24`/`27` prefixes, so the digits do not name their own kind. Present in every
> response we have recorded, but we will not state a type ARCA did not. Keep your fallback chain — ✔ is not
> coming, and §3 now says so instead of leaving you wondering.
>
> **Your two status items, both taken.** The stale `cityCode` note now carries a *superseded* pointer
> (the row itself is left as written — it was true on the day). And the BAHRA projection you asked us not to
> "fix" is now a **stated guarantee** in §5 rather than a comment in a generated file: every `INDEC` code we
> emit is a localidad censal, going finer is a breaking change, and the index generator now *asserts* it —
> distinct codes emitted must equal localidades censales read, so a finer id fails the build rather than
> shipping. Thank you for catching that one; it was exactly as invisible as you thought.
>
> The request below is kept verbatim as the record of what was asked and why.

Requested by `webprocess-api` after consuming the coded addresses above. **Nothing here is blocking** —
core's city resolution is built, tested and live. Two small asks plus a status update that makes one of
your notes about core obsolete; skip to *Two things you should know from our side* if you read nothing
else.

| # | Ask | Field | Blocking core? |
| --- | --- | --- | --- |
| 6 | The georef snapshot behind the INDEC codes | `cityCodeSchemeVersion`, or a line in CONTRACT.md | No |
| 7 | Make `identificationTypeCode` as reliable as `identificationNumber` | — | No |

**The problem.** Both repos now vendor an independent snapshot of the same live dataset. taxprocess
generates its name→code index from georef-ar; core generates `common.city` from the same API
(`scripts/build-indec-cities.mjs`, 4027 localidades censales as of 2026-08-25). Nothing keeps the two
snapshots aligned, and INDEC does add localidades.

When they diverge, a `cityCode` minted from a newer snapshot resolves to nothing in core's catalog. That
lands as `cityId: null` — **byte-for-byte identical to the documented barrio gap**, which is the expected,
permanent, do-nothing case. The two need opposite responses (re-seed vs. accept) and core cannot tell them
apart from the response.

**What we'd like.** The snapshot date and the localidades-censales row count your index was generated
from. A `cityCodeSchemeVersion` string on the address (or on the result) is ideal since it travels with the
data; a documented line in CONTRACT.md would do. Nothing about the wire's shape needs to change.

**What core did in the meantime.** `taxpayer-lookup.service` logs a warning whenever a code arrives on a
scheme it *knows* and matches no row — that already separates "stale catalog" from "no code sent", which is
the important half. The ask is about knowing *which way* it is stale, and how far, without diffing two
catalogs by hand.

### Ask 7 — a row that names its number but not its type is only half self-describing

Minor, and last in priority. CONTRACT.md §3's field table marks `identificationNumber` ✔ (always present)
on both details, but `identificationTypeCode` ○ (present when the authority returns it). Ask 5's purpose
was rows that stay usable once detached from their request, and a number without its type does not quite
get there — especially on a document lookup, where the returned claves are the whole reason the field
exists.

Core copes: it prefers `identificationTypeCode`, falls back to mapping `taxIdType`, and returns null rather
than pairing a searched-for DNI with an 11-digit CUIT (which would fail our own format validation with
nothing on the draft to explain why). So this costs us a fallback chain, not correctness.

If `taxIdType` is genuinely absent from the authority in some cases then ○ is simply the truth and this ask
is void — in which case, say so in the table and we will stop wondering.

### Two things you should know from our side

**1. `common.city` now holds INDEC codes — your note about core is out of date.** CONTRACT-CHANGES.md
2026-08-25 says of `cityCode`: *"Optional, and you cannot consume it yet — `common.city` has no INDEC
column. The code is on the wire now so the backfill has something to build against."* That backfill has
landed. Core replaced the old mixed-level catalog (1136 rows conflating departamentos and localidades)
with the 4027 INDEC localidades censales, keyed on `(code, code_scheme_id)`. **`cityCode` is consumed
today**, and a lookup for a coded locality comes back with a resolved city id.

**2. The two snapshots are provably identical right now, and this is the baseline for ask 6.** We diffed
them rather than assuming:

| | |
| --- | --- |
| Distinct codes your index can emit | **4027** (4930 name rows collapsing onto them) |
| Codes in core's `common.city` | **4027** |
| Emittable by you, missing from core | **0** |
| In core, not emittable by you | **0** |

Same count *and* same set, as of 2026-08-25. So any future mismatch is drift, and it dates from here —
which is exactly what makes a published snapshot version worth having.

**A design choice of yours that this depends on, so please don't "fix" it:** your index projects BAHRA
asentamientos *up* to the localidad censal containing them rather than emitting asentamiento codes. That
is what keeps every code you emit inside the localidades-censales space core catalogs. If a future version
emitted a finer-grained code — an asentamiento id, a departamento id — core would resolve none of them,
and the failure would look exactly like the barrio gap. If you ever need to go finer, that is a contract
change, not an internal one.

**Explicitly not asking you to serve the catalog.** An endpoint returning code + name + province would
remove the drift by construction, and we considered it. It also turns a tax service into a geography
server, which is the wrong shape — core can carry its own catalog perfectly well as long as it can tell a
stale one from a genuine gap.

---

## 2026-08-25 — Taxpayer lookup: coded addresses and a fiscal condition

> **DELIVERED 2026-08-25** — all five, on branch `feature/padron`. See
> [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md) for the wire shape, **one breaking change**, and three limits
> worth reading before building against them.
>
> **Asks 1–3 landed under one rule rather than the three spellings requested.** Every coded value on an
> address travels with the standard it belongs to, and a level is resolved by matching the pair
> `(code, codeScheme)`: `countryCode`/`countryCodeScheme`, `regionCode`/`regionCodeScheme`,
> `cityCode`/`cityCodeScheme`. So there is no `regionIso` or `countryIso` — a key naming its standard could
> only ever be answered by an ISO country, and it left the caller to infer 3166-1 from 3166-2. The scheme
> values are a closed, key-safe vocabulary (CONTRACT §5).
>
> Two consequences of that worth knowing before you read the asks below: **ask 1 was granted by replacing
> `regionCode`, not by adding beside it** — ARCA's `idProvincia` is off the wire entirely, since §9 puts it
> inside the provider and you said you could not interpret it. And **ask 3 ships, but the national catalog
> does not code *barrios* of interior cities**, so an address ARCA reports as `BARRIO YAPEYU` gets a
> `regionCode` and no `cityCode`; CABA barrios do resolve. Ask 4 (`fiscalConditionCode`) is emitted only on
> positive evidence and is **never** defaulted to Consumidor Final.
>
> The request below is kept verbatim as the record of what was asked and why.

Requested by `webprocess-api` while implementing the core side of `POST /api/taxpayers/lookup`
(CONTRACT.md §3, shipped 2026-08-21). Core's endpoint is **already built and deployed** against the
current response shape, so none of this is blocking — every ask below is **additive and optional**, and
core reads each field only when present. But until they land, three fields of core's customer/supplier
prefill draft are permanently `null`, which is most of the feature's value.

The through-line: **CONTRACT §9 says entity-specific vocabulary stays inside the provider.** Each ask below
is a place where an entity-specific value (or an unresolved free-text one) currently reaches core and
forces core to either guess or give up.

| # | Ask | Field | Blocking core? |
| --- | --- | --- | --- |
| 1 | Province as an ISO code | `address.regionIso` | No — `state` stays `null` |
| 2 | Country on the address | `address.countryIso` | No — inferred from the entity |
| 3 | Locality as a coded value | `address.cityCode` + `address.cityCodeScheme` | No — `city` stays `null` |
| 4 | The taxpayer's fiscal condition | `TaxpayerDto.fiscalConditionCode` | No — `contributorType` stays `null` |
| 5 | Self-describing taxpayer rows | `TaxpayerDto.identificationTypeCode` / `identificationNumber` | No — cosmetic |

---

### 1. `address.regionIso` — the province as ISO 3166-2

**Ask:** add `regionIso` to `TaxpayerAddressDto`, carrying the full ISO 3166-2 subdivision code
(`"AR-X"` for Córdoba). Keep the existing `regionCode` alongside it; this is additive.

**Why here.** `address.regionCode` is currently ARCA's own `idProvincia` (`"3"` = CORDOBA, from
`padron-helpers.ts` → `text(node.idProvincia)`). That is an ARCA-internal catalog — exactly the kind of
value §9 keeps inside `src/providers/arca/`. Core has no way to interpret it and no reasonable way to
acquire the mapping.

**Why ISO specifically.** Core already stores the complete ISO 3166-2:AR set: `common.country.iso_code`
holds `"AR"`, and `common.state.iso_code` holds the 24 subdivision letters —
`A,B,C,D,E,F,G,H,J,K,L,M,N,P,Q,R,S,T,U,V,W,X,Y,Z`, verified against the live catalog. An ISO code
therefore resolves to a `common.state` row deterministically, with no new column and no name matching.

**Why not name matching.** `address.region` is ARCA's `descripcionProvincia` — unaccented Spanish
uppercase (`"CORDOBA"`). Core's `common.state.name` is the display name (`"Córdoba"`). Matching those
requires accent folding and case folding against a catalog that is free to be renamed for display reasons,
which is precisely the fragility a code exists to avoid.

The mapping is 24 rows and effectively immutable.

---

### 2. `address.countryIso` — the country as ISO 3166-1 alpha-2

**Ask:** add `countryIso` to `TaxpayerAddressDto` (`"AR"`).

**Why here.** Today core infers the country from the fiscal entity behind the request
(`common.integration_entity.country_id`). That happens to be right for ARCA, where every registered
address is Argentine, but it is an assumption core is making on the provider's behalf rather than a fact
the response states. Making it explicit costs one constant and removes the inference.

---

### 3. `address.cityCode` + `address.cityCodeScheme` — the locality as a coded value

**Ask:** add both fields to `TaxpayerAddressDto`. `cityCodeScheme` names the coding system
(`"INDEC"` for AR); `cityCode` carries the code within it.

**This one is unconditional** — not "if ARCA exposes a locality identifier". The address must carry a
standard code for the locality, and producing it is this service's job even though ARCA itself returns only
free text.

**Why there is no ISO option.** ISO 3166-2 codes only a country's *first* subdivision level. For Argentina
that is the 23 provinces plus CABA and nothing below — no departamentos, partidos, ciudades or comunas.
There is no ISO code for a locality, and there will not be one.

**The standard to use is INDEC's.** The Instituto Nacional de Estadística y Censos publishes a hierarchical
numeric code:

| Level | Digits | Example — Ciudad de Córdoba |
| --- | --- | --- |
| Provincia | 2 | `14` |
| Departamento / partido | 3 | `014` |
| Localidad | 3 | `010` |
| **Full code** | **8** | **`14014010`** |

**Why this service and not core.** ARCA returns `localidad` as free text. Resolving free text to a code is
a lookup against a national catalog using entity-specific knowledge — the same category as every other
mapping §9 places inside the provider (`DocTipo`, `CondicionIVAReceptorId`, `MonId`, the tax-rate ids).
Handing core a bare place name forces it to name-match against a 1136-row catalog of departamentos and
municipalities, which is guessing. Core will not do it, so the field simply stays empty.

`cityCodeScheme` keeps the pair neutral: a future entity in another country returns its own national
scheme under the same two keys, and core branches on the scheme rather than on the entity.

**On absence.** Per the contract's existing convention, omit both keys for an address whose locality
genuinely does not resolve. That is a per-address outcome, not an opt-out from supporting the field.

**Core-side note.** Core cannot consume this immediately: `common.city` is a DR5HN import with no INDEC
column, so backfilling that scheme is a separate task on core's side. The ask stands regardless — the code
has to exist on the wire before core can build against it, and core will not start that backfill on a
promise.

---

### 4. `TaxpayerDto.fiscalConditionCode` — the taxpayer's VAT/fiscal condition

**Ask:** add an optional `fiscalConditionCode` to `TaxpayerDto`, in the **same canonical code space** as
`invoice.receiver.fiscalConditionCode` — RG 5616 / `CondicionIVAReceptorId` (1 = Responsable Inscripto,
5 = Consumidor Final, 6 = Monotributo…). Omit it when the registry gives no basis to determine one.

**Why here.** Deriving the condition means reading ARCA impuesto codes out of `taxes[]` (30 = IVA,
20 = monotributo, 32 = IVA exento…) together with `simplifiedRegimeCategory`. Those codes are ARCA
vocabulary; §9 lists exactly this kind of thing as provider-internal. Core would have to hardcode an AFIP
impuesto table to use `taxes[]`, which both repos have agreed it should not do.

**Why the existing code space.** Core already speaks it: `common.fiscal_condition.fiscal_code` holds these
values and core sends them on every `authorize`. Reusing it means zero new mapping on core's side, and the
condition a lookup reports is the same one that will later ride the invoice for that customer.

**What core does with it.** `fiscal_condition` is a shared catalog, but the field customers and suppliers
actually carry is a tenant-local `contributor_type` that *references* a fiscal condition — several
contributor types can share one. So core will use the code to narrow the candidate list, and where exactly
one tenant contributor type matches, preselect it. Without the code there is nothing to narrow by and the
user picks blind.

**On absence.** `IDENTITY` results carry no `taxes` at all, so the key will legitimately be missing there.
Core treats a missing key as "not reported" and leaves the field unset — no `null`, per the contract's
absence rule.

---

### 5. `TaxpayerDto.identificationTypeCode` / `identificationNumber` — self-describing rows

**Ask:** echo the identification pair on each entry of `taxpayers[]`.

**Why.** A document lookup (DNI/LE/LC) returns several taxpayers, and each is keyed by a *different* clave
than the one searched by — one DNI commonly yields both a CUIL and a CUIT. `taxIdType` covers most of this
already, but it is an optional free-text string (`"CUIT"`/`"CUIL"`/`"CDI"`) rather than a canonical code,
so core has to map it back to a code to be useful.

This matters more than it looks: core builds a customer draft from each returned taxpayer, and that
customer must be identified by their **CUIT**, not by the DNI the operator typed. Core currently derives
the type from `taxIdType` and falls back to the requested type when it is absent — a canonical code would
remove the string matching and the fallback.

Lowest priority of the five; purely a robustness improvement.

---

### What core built in the meantime

For context on how these are consumed:

- `POST /taxpayers/lookup` — core's conduit. Resolves routing from the company's fiscal entity (no
  `integration` row required, since lookups need no tenant credentials), pre-rejects identification types
  the registries cannot answer for, and returns this service's records **verbatim** alongside a neutral
  draft.
- `POST /customers/from-taxpayer` — returns partial customers ready to post, one per matched taxpayer.

Core promotes three of this service's errors to typed ones: `404 TAXPAYER_NOT_FOUND`,
`400 ARCA_VALIDATION`/`UNSUPPORTED_IDENTIFICATION_TYPE`, and
`400 ARCA_VALIDATION`/`UNKNOWN_CODE`|`INVALID_ID`. `500 DELEGATION_NOT_CONFIGURED` is surfaced as an
outage, never as "taxpayer not found" — as CONTRACT §10 asks.

**Reminder on the deployment prerequisite** (CONTRACT-CHANGES.md 2026-08-21): the delegate certificate must
be adhered to `ws_sr_constancia_inscripcion` and `ws_sr_padron_a13` in WSASS (homologación) or
Administrador de Relaciones (production). Until it is, every lookup returns `500
DELEGATION_NOT_CONFIGURED` and core cannot test the happy path against homologación at all.
