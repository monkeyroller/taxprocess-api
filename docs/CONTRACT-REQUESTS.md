# taxprocess-api — contract requests from core

Audience: the **`taxprocess-api`** team. The mirror image of [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md):
that file records what this service changed and what core must adapt to; this one records what **core is
asking this service for**, newest first. Each entry states what is requested, why it belongs here rather
than in core, and whether core is blocked on it.

---

## 2026-08-28 — The cotización: a rate, a band, and who is allowed to ask for it

Requested by `webprocess-api` while building foreign-currency electronic sales. **Asks 8, 9, 10 and 11 are
blocking** — core cannot issue a compliant foreign-currency voucher without them, and today it does not try:
every sale it authorizes is in the entity's own currency. Ask 12 is not blocking and has a fallback we will
happily take.

The through-line is the same as the last two entries, from the other end. **CONTRACT §5 says core sends
canonical codes out of its own `*.fiscal_code` columns and this service maps them identity.** Currency is the
one row in that table that does not work that way — and `currencyRate` is the one number on the wire this
service hands to the authority without ever having seen the authority's own value for it.

| # | Ask | Field | Blocking core? |
| --- | --- | --- | --- |
| 8 | The cotización — the entity's **whole table** in one call, and one code for an arbitrary `date` | `POST /api/currencies/rates` | **Yes** |
| 9 | Serve it under **your delegate identity**, with no entity block | — | **Yes** |
| 10 | You own the band, and the reference currency answers 1/1/1 offline | `lowerLimit` / `upperLimit` / `bandBasis` | **Yes** |
| 11 | `invoice.currencyCode` alongside `currencyIso`, then instead of it | `invoice.currencyCode` | **Yes** |
| 12 | The currency list, as a seed source we read once a year | `POST /api/currencies` | No — a table in CONTRACT.md does |

**The problem.** `invoice.currencyRate` is documented as "exchange rate to the local currency"
(CONTRACT.md:92) and lands as `MonCotiz` unvalidated: `common-invoice.service.ts:69-70` writes
`detail.MonCotiz = request.currencyRate.toFixed(6)` and nothing between core's DTO and ARCA's XSD has an
opinion about the number. On our side it is `sale.currency_rate`, the **negotiated** rate a salesperson may
override (`create-sale.dto.ts`, `@MinNumericString(0.000001)`). So today a user can invoice USD at 900 on a
day the authority published 1465.5, and both services will help them do it. `voucher-recovery.ts` compares
`MonId` on recovery and deliberately not `MonCotiz`, which is correct, and also means nothing downstream
catches it either.

Core now checks that at sale-create — the only moment the number can still be changed, since
`sale.currency_rate` is a pinned snapshot the whole payment tree is derived from. To check it, core needs the
authority's number. Core cannot get it: it is published daily and needs a WSAA ticket.

---

### Ask 8 — one call, one vintage, every currency

**Ask:** `POST /api/currencies/rates` taking `{entityCode, environment, currencyCodes?, date?}` and returning,
per code, `{currencyCode, rate, lowerLimit, upperLimit, rateDate, bandBasis}`, plus a top-level `refreshAfter`
and a vintage marker. Codes with no publication come back under `unavailable` with a reason, never as a failed
batch.

```jsonc
// request — the daily sync: omit both optional fields
{ "entityCode": "ARCA", "environment": "production" }

// request — a backdated sale: one code, one date
{ "entityCode": "ARCA", "environment": "production", "currencyCodes": ["DOL"], "date": "2026-08-25" }

// response
{ "entityCode": "ARCA", "environment": "production",
  "rates": [
    { "currencyCode": "DOL", "rate": 1465.5, "lowerLimit": 1465.5, "upperLimit": 1465.5,
      "rateDate": "2026-08-27", "bandBasis": "EXACT" },
    { "currencyCode": "PES", "rate": 1, "lowerLimit": 1, "upperLimit": 1,
      "rateDate": "2026-08-28", "bandBasis": "REFERENCE" }
  ],
  "unavailable": [ { "currencyCode": "060", "reason": "NO_PUBLICATION" } ],
  "publishedAt": "2026-08-27",
  "refreshAfter": "2026-08-28T19:00:00-03:00" }
```

**`currencyCodes` must be optional, and omitting it must mean the entity's WHOLE table.** An authority
publishes all its cotizaciones at once, so that is both the shape of the daily call and the shape of the
answer core caches. Core enumerating the ~50 codes it happens to know would also silently miss any its seed
has drifted behind on.

**Why batched — consistency, not call volume.** `FEParamGetCotizacion` takes one `MonId` per call, so N calls
can straddle a publication boundary and hand core a set where DOL is today's and EUR is yesterday's. A batch
answers from one moment. The fan-out belongs here for the same reason it already does in
`POST /invoices/next-numbers`, which fans out `FECompUltimoAutorizado` per code behind one neutral batch call
(`arca.provider.ts:280`) — §5's "this service owns the mechanical mapping", exactly.

**Why here.** The cotización requires a WSAA ticket and a `wsfe` enrolment. There is no version of core that
can obtain it.

**`date` is not optional to us.** Core caches only the LATEST publication, so a backdated voucher is validated
by a live per-date call for one code. That changes the expected traffic from "once per entity per day" to
"that, plus one per backdated sale". Say if that is a problem — the alternative is core keeping a per-date
calendar, which we deliberately did not build.

**A vintage marker, please** — the top-level `publishedAt` above, or a guarantee that `rateDate` is shared
across the batch. Core's schedule fires on the entity's own publication time; a run that fires five minutes
early looks *identical* to one that fires after, and without a vintage there is nothing for the schedule to
self-correct against.

**`refreshAfter`, and why core wants a timestamp rather than a clock.** ARCA publishes on its own schedule; a
future entity will publish on another. If core hardcodes "≈19:00 ART" that is an Argentine policy constant
living in a country-agnostic core — the same thing §9 moved `idProvincia` off the wire to avoid. Make it an
absolute ISO instant meaning "this value cannot change before then". Core stores it and lets it push the next
run **later, never earlier**: the local schedule sets the rhythm, you may veto an early ask. Two properties
core depends on: present on `unavailable` entries too (that is the case a client would otherwise poll hot),
and never in the past.

**One semantic to state rather than imply.** `rateDate` is the date the rate is *for* — the last published
business day — which may be earlier than the date asked for. Core stores `rateDate`, not the request date, so
a Monday sale is provably validated against Friday's number.

**On absence.** Core cannot ship the check. The catalogue, the binding, the cache and the sync all landed
anyway (see the closing section), but with no band there is nothing to check against, and shipping a
"validated" foreign-currency sale that validated nothing is worse than not shipping it.

---

### Ask 9 — a public number should not need a customer's certificate

**Ask:** serve ask 8 with **no `entity` block and no credentials**, under this service's own delegate identity
— the shape `POST /api/taxpayers/lookup` already has (CONTRACT.md:311-314, and §10's *"Registry lookups use
our delegate identity, not a representación"*).

This one is a decision core has already built against, not a preference, so it is worth saying why plainly
rather than offering it as an option.

**Why it is a precondition.** A cotización is a property of `(entity, currency, date)` and nothing else. Core
caches it in a shared `common.*` row serving **every tenant**. If the endpoint demands a tenant's
`issuerTaxId` and credentials, a platform-wide catalogue gets populated with **one arbitrary customer's
certificate**: it breaks when their cert lapses, it spends their ARCA ticket budget fetching other customers'
data, and a tenant with no valid integration cannot read a number that is public information. Either this is
credential-free or core cannot cache centrally at all.

**Why not core.** Core holds tenant certificates encrypted and can decrypt them — that is not the obstacle.
The obstacle is that doing so would be *wrong*: it makes a shared fact tenant-owned.

**The one thing genuinely open, and it is yours to settle.** Unlike the padrón services this is a WSFEv1 call,
so it carries `Auth.Cuit`. **Does `FEParamGetCotizacion` succeed with `Auth.Cuit` = your own delegate CUIT and
no representación?** Reasons to expect yes: it is a `FEParam*` method — reference data, not a taxpayer's
ledger; `FEParamGetPtosVenta` is the one `FEParam*` that is genuinely issuer-scoped and a cotización plainly is
not; and your delegate CUIT must already have `wsfe` adhered for §10 to work at all, so a ticket you sign
naming yourself needs nobody's permission. But `/taxpayers/lookup` is a *padrón* precedent, not a WSFEv1 one,
and §10's own warning that a missing representación surfaces as an overloaded `600` is exactly why we are
asking instead of assuming. See the verification case below.

If ARCA does refuse the delegate CUIT, our reading is that the fix belongs inside the provider rather than on
the wire. **On absence** — if it truly cannot be done — core falls back to caching per
`(integration_entity, environment)` populated by whichever tenant happens to trigger a refresh. Stated so it
is nobody's surprise: a rate would then only be as fresh as the last tenant who sold something, and a tenant
onboarding during an outage would have no band at all.

**Also worth confirming while you are in there:** does **homologación** answer `FEParamGetCotizacion`, or
`602` everything? Core caches per environment — validating a testing sale against a production band is wrong
in both directions — and if homologación has no data, core will skip the check there rather than fail every
foreign-currency test sale.

---

### Ask 10 — the band is yours, and the reference currency must never need the network

**Ask:** always return `lowerLimit` and `upperLimit`, plus a `bandBasis` naming the rule
(`EXACT` | `TOLERANCE` | `REFERENCE`). And answer the entity's own currency **locally**, with no authority
call, as `rate = lowerLimit = upperLimit = 1`, `bandBasis: "REFERENCE"`.

**Why here.** ARCA publishes a point cotización, not a band. A band is therefore an *interpretation* of a legal
rule — the voucher must use the cotización of the last published business day before issue — and that
interpretation is Argentine tax policy. If core invented `±0.5%` it would be hardcoding exactly the class of
thing §9 exists to keep inside `src/providers/arca/`, and the constant would then apply, wrongly, to the next
entity. **Core encodes zero band policy.** Its entire check is `lowerLimit ≤ negotiatedRate ≤ upperLimit` —
please confirm inclusive is what you mean.

If the honest answer for ARCA is that the band is a single point, say `lower = upper = rate` with
`bandBasis: "EXACT"`. That is a fine answer and core will enforce it strictly. What core cannot do is guess
which of the two you meant.

**Why the reference currency is separate.** `FEParamGetCotizacion("PES")` is not a meaningful query, and — the
real reason — core must not have a fiscal-sale path that fails because the authority was unreachable while a
customer invoiced in pesos. That is ~99% of vouchers. Core seeds `PES` at 1/1/1 locally and never calls out
for it; the ask is that your endpoint agrees rather than erroring, so the two do not disagree.

Please also mark it on the catalogue row (`reference: true`, ask 12) so core seeds that guarantee from data
instead of hardcoding `"PES"`, which would be an ARCA constant sitting in core.

**On absence.** Core would have to either skip the band check entirely (making the feature decorative) or
invent a tolerance (a §9 violation, in core, for Argentina). It will do neither.

---

### Ask 11 — `currencyCode`, and the end of the ISO→MonId table

**Ask:** add optional `invoice.currencyCode` to `NeutralInvoiceDto`, carrying a canonical per-entity currency
code from core's `common.fiscal_currency.fiscal_code` (`"PES"`, `"DOL"`, `"060"`), identity-mapped to `MonId`
via `code-maps.ts` like the other three. Relax `currencyIso` to optional in the same release and enforce
**exactly one of the two**. Once core confirms every instance sends the new field, drop `currencyIso`,
`ISO_TO_ARCA_CURRENCY` and `resolveCurrencyId` as a breaking CONTRACT-CHANGES entry.

**Why here.** `invoice.currencyIso` is the only row in §5's table sourced from something other than a
`fiscal_code` — `currency.isoCode` rather than a canonical code (CONTRACT.md:516). The consequence is a
**private three-entry const** at `invoice.mapper.ts:33-50`, not in `code-maps.ts`, not exported, mapping
`{ARS:'PES', USD:'DOL', EUR:'060'}` and throwing `UNMAPPED_CURRENCY` for everything else. ARCA's catalogue has
~50 entries and gained RUB and NZD in 2025. Today each addition is a change to this service; under a canonical
code it is a seed row in core and **zero change here** — which is the entire argument that put
`document_type.fiscal_code` on the wire in the first place.

More sharply: ISO cannot express the cases the feature exists for. `DOL` and `002` ("Dólar Libre EEUU", the
blue) are **both** `USD`, so today a tenant pricing at blue silently declares the official code. And `049`
Gramos de Oro Fino has no ISO code at all, so it is unreachable.

**On §9, which lists `MonId`.** §5 already states that `documentTypeCode`, `identificationTypeCode` and
`fiscalConditionCode` are **identity** with `CbteTipo`, `DocTipo` and `CondicionIVAReceptorId`, and nobody
argues those have leaked. What §9 forbids is core *interpreting* your vocabulary — reading `idProvincia`,
deriving a condition from `idImpuesto`. Core never branches on `"DOL"`, never learns it means dollars, and
would carry an SII code in the same column with no new code. The namespace is **yours**; for ARCA it happens to
be the identity, exactly as the other three are. If anything this removes ARCA vocabulary from the codebase,
since the ISO table disappears.

**Please keep the membership check.** `code-maps.ts` should reject an unknown code as
`400 ARCA_VALIDATION` / `UNKNOWN_CODE` rather than letting `"DOLL"` reach ARCA and come back a `502`. That is
what `toCbteTipo` and `toDocTipo` already do, and it is the half of `resolveCurrencyId` worth keeping.

**One asymmetry, flagged rather than hidden:** the existing three canonical codes are numeric
(`fiscal_condition.fiscal_code` is `SMALLINT` in core); this one is a string, because `002` and `060` are
zero-padded and the padding is part of the code. Suggest `@IsString() @Length(1, 8)` rather than
`@Length(3,3)` — do not assume every future entity codes currencies in three characters.

**Why additive first, and why the ordering is not negotiable.** This service runs `forbidNonWhitelisted: true`
(`src/index.ts:47-48`), so core **cannot** send `currencyCode` until the DTO declares it — any "lockstep" plan
is really "you first" with extra downtime. One optional field plus an exactly-one-of validator buys a clean
window. Please make it exactly-one-of rather than prefer-`currencyCode`: silently preferring one would let a
core bug send `{currencyIso:"USD", currencyCode:"PES"}` and produce a peso voucher for a dollar sale, which is
the precise failure `UNMAPPED_CURRENCY` was written to prevent. `InvoiceCarriesAmount` (`invoice.dto.ts:171`)
is the class-level pattern.

> **Status on core's side:** the switch is already written and merged behind the release ordering — core sends
> `currencyCode` and no longer has an ISO code to fall back on. So core is holding at "cannot issue a
> foreign-currency voucher" until this lands, which is the intended state, not an outage.

---

### Ask 12 — the currency list, as a seed source and not a server

**Ask:** `POST /api/currencies` → `{entityCode, environment, currencies: [{code, name, reference}]}`, from
`FEParamGetTiposMonedas`. **Not blocking**, and a plain table in CONTRACT.md §5 would satisfy it completely.

**Why core is not asking you to be a currency server.** §5 already says an endpoint serving a catalogue is the
wrong shape, and core agreed with that reasoning about geography and vendored INDEC instead
(`scripts/build-indec-cities.mjs`). The same answer applies here: core has already seeded
`common.fiscal_currency` itself, from ARCA's published table, with the same discipline the INDEC catalogue
uses.

**The one difference, stated plainly:** georef is a public API core could read on its own.
`FEParamGetTiposMonedas` is behind a WSAA ticket, so core has no independent source and the seed is
hand-transcribed. This is therefore a request for a **build-time source read once a year by a script**, never
on a request path — a seed, not a server. If you would rather not expose it at all, publish the ~50 rows in
CONTRACT.md §5 with the reference row marked, and core will diff against that; the shape core needs is the
same either way.

**On absence.** Core keeps the hand-seeded catalogue and accepts drift. The risk is real but small and it
fails safely: a code core does not hold is a currency nobody can select, which surfaces at binding time rather
than silently at issuance. (The sync already logs a warning when you publish a code core has never heard of,
which is the drift detector we have in the meantime.)

---

### A verification case, so none of this rests on agreement

Two experiments, both falsifiable, both cheap.

**1. Is the band real?** For a CUIT in homologación, on a day when your endpoint reports `DOL` at `rate = R`:

- issue a Factura A in USD with `MonCotiz = R` → must be authorized;
- issue the identical voucher with `MonCotiz = upperLimit + 0.01` → **if ARCA also authorizes that**, your
  band is advisory rather than enforced, and `bandBasis` must say so (`TOLERANCE` with a documented width, or
  a new `ADVISORY`). Core will still warn on it — the legal rule binds whether or not the XSD does — but core
  must not tell an operator the authority will reject something the authority accepts.

**2. Does ask 9 hold?** Call `FEParamGetCotizacion` for `MonId=DOL` with `Auth.Cuit` = your delegate CUIT and
no representación, in homologación. Report the outcome: a rate (ask 9 is granted as written), or an ARCA code
— `600` vs `601` distinguishes "not authorized for this operation" from "CUIT representada no incluida", and
the two imply different fallbacks for core.

Publishing both outcomes in CONTRACT.md is worth more than either endpoint, because it settles what
`lowerLimit`/`upperLimit` *mean* for anyone reading them later.

---

### What core built in the meantime

None of this is speculative — the whole core-side half is merged, and only the tax-service call is stubbed out
by your 404.

- **`common.fiscal_currency`** — surrogate id + `fiscal_code` + `integration_entity_id` + optional
  `currency_id`, with an `is_reference` flag and one default per `(entity, real currency)`. Seeded with ARCA's
  49 codes. Same shape as `common.fiscal_condition` and `common.document_type`, which is the point: currency
  joins the canonical-code family instead of being the exception. `DOL` and `002` both map to USD, with `DOL`
  default; `049` is deliberately unmapped and is therefore unselectable, enforced by a composite foreign key
  rather than a rule.
- **`common.fiscal_currency_rate`**, keyed `(fiscal_currency_id, environment)` — the durable cache for ask 8's
  response. Keyed by environment deliberately: a testing sale must not be validated against a production band.
  Latest-only; the per-date case is ask 8's `date` parameter.
- **`common.fiscal_rate_sync_state`** — schedule and lease per `(entity, environment)`, with `refresh_after`
  stored exactly as you return it.
- **The sync.** Core had no scheduler either; this is the first. Practical consequence for you: core will call
  ask 8 **roughly once per fiscal entity per publication**, not once per tenant and not once per sale —
  *provided* ask 9 is granted. If it is not, multiply by the tenant count.
- **The sale-create check**, which **records** rather than blocks: `VERIFIED`, `OUT_OF_BAND`, or one of three
  `UNVERIFIED_*` reasons, snapshotted on the authorization row. Core refuses only what it is certain about —
  a rate with no fiscal binding, or one bound to another authority. An out-of-band rate is a warning in the
  sale form and a recorded verdict, never a refusal: your service's band is a cached, possibly stale value,
  and turning it into a till outage would be the wrong trade.
- **A rule core adopted because of `MonCotiz`:** a tenant's base currency must be the reference currency of
  every entity it issues through, enforced when a rate is bound rather than when a sale is made. Core's rate
  convention is base-units-per-foreign-unit; `MonCotiz` is ARS-per-foreign-unit. Those agree only under that
  rule. It has silently held for every tenant to date, and nothing in either repo said so until now.

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
