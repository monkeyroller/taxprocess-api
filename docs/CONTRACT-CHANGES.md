# taxprocess-api — contract changes

Audience: the **`webprocess-api`** (core) team. A running log of changes to [CONTRACT.md](CONTRACT.md), newest
first, so core can see what to adapt without diffing the whole document. Each entry states what changed, why,
and **whether core must do anything**.

---

## 2026-08-26 (later) — An inactive or cancelled clave now gets a real answer

Branch `feature/padron`. A behaviour change on `POST /api/taxpayers/lookup`; no field, no shape and no
code-space changes. It is a **conformance fix** — the behaviour it replaces was a defect, not something
CONTRACT.md ever promised.

**What was wrong.** ARCA's constancia padrón reports a clave that is *inactive* or *cancelled* the same way
it reports a data-quality complaint: a `200` whose only content is the complaint, with every taxpayer field
empty. The service was reading those two cases as a complaint about an otherwise fine taxpayer, so a lookup
for such a clave returned `200` with a row carrying `taxId` and `providerMetadata` and nothing else — no
`name`, no `personType`, no `registrationStatus`, and `addresses` / `activities` / `taxes` all empty. That
broke two things §3 already guarantees: that a `200` row is a taxpayer, and that its key set follows from
`detail`. It also reads to an end user as "here is the taxpayer" when the authority never said so.

**What changed.** Those two verdicts are now read for what they are — the constancia declining to report an
inscripción — which is exactly the condition §3's fallback exists for. The lookup falls through to A13, and
A13 decides:

| Change | Where | Core action |
| --- | --- | --- |
| A clave with a **lapsed** registration now returns `200 detail: "IDENTITY"` with the person in full and `registrationStatus: "INACTIVE"`, where it returned a `200` `REGISTRATION` row with no name. | §3 lookup | None, if you branch on `detail` as §3 already asks. |
| A **cancelled** clave now returns `404 TAXPAYER_NOT_FOUND`, where it returned that same nameless `200`. | §3 errors, §8 | None — you already handle `404` on this endpoint. |
| `404` on this endpoint no longer means strictly "nobody is registered"; a cancelled clave neither registry still holds counts too. `message` carries ARCA's own wording. | §3 errors, §8 | None. Wording only — the outcome and `details` are unchanged. |

**If you coded around the old response, undo it.** Anything defending against a `200` row with no `name` or
no `registrationStatus` on this endpoint can go: that row no longer occurs. Nothing needs to be added.

**Worked example**, both verified against ARCA homologación. CUIT `24850833059` — one of the authority's
own published test claves — is inactive: it now answers `IDENTITY` / `LEBLANC RACHEL` / `INACTIVE`, with
document, birth date and both addresses. CUIT `20111111112` is cancelled: it now answers `404`, carrying
ARCA's wording `La CUIT fue cancelada de acuerdo a: CLAVES INVALIDAS.`

**Unchanged.** Document lookups (96 / 89 / 90) — they already read A13 and never went through the
constancia. Claves with a current inscripción still answer `REGISTRATION`, identically. There is still no
fallback the other way, for the reason given in the 2026-08-25 (later) entry.

**Also on this branch, not a contract change.** Clave lookups against ARCA's padrón services were failing
outright with `502 ARCA_AUTH` — a malformed SOAP body that the authority rejects before reading the ticket,
so it reported as a credential fault. Fixed; both padrones answer. If you tested this endpoint against
`feature/padron` and saw `502 ARCA_AUTH` on every clave, that is why, and it is gone.

---

## 2026-08-26 — The locality code now says which snapshot it came from

Branch `feature/padron`. Answers both asks in [CONTRACT-REQUESTS.md](CONTRACT-REQUESTS.md) 2026-08-25
(later). Additive on the wire; nothing breaks, and a reader that ignores the new key is correct today and
stays correct.

| Change | Where | Core action |
| --- | --- | --- |
| `address.cityCodeSchemeVersion` — the ISO date the national catalog was read (`"2026-08-25"`). Present **exactly** when `cityCode` is, like the scheme. | §3 addresses, §5 | Optional. Read it when a code on a scheme you know matches no row: **same version as yours** ⇒ the gap is real, accept it; **newer than yours** ⇒ re-seed. |
| The `INDEC` **code space is now a stated guarantee** — every code we emit is a localidad censal, never anything finer. | §5 | None. It writes down what you already depend on; see below. |
| `identificationTypeCode` stays **○**, and §3 now says why. | §3 field table | None. Keep your `taxIdType` fallback — ✔ is not coming. |

### Ask 6 — the snapshot, and the baseline it starts from

Both repos vendor an independent snapshot of the same live dataset (georef-ar), so both can drift. The
problem you described is real and it is specifically an *ambiguity*, not a missing feature: a code minted
from a newer snapshot and a code inside the documented barrio gap arrive identically, and they need
opposite responses. The version is what separates them, which is why it travels **on the address** rather
than in prose — it is needed at the moment a code fails to resolve, not at integration time.

The published baseline, now in §5:

| | |
| --- | --- |
| Snapshot | `2026-08-25` |
| Localidades censales / asentamientos read | 4027 / 14673 |
| Distinct codes emittable | **4027** |

Which matches your diff exactly, in both directions. So the two catalogs are known-identical as of
`2026-08-25`, and any future mismatch is drift dated from there — your framing, and it is the right one.

Two things worth knowing about the value. It is **the date the catalog was read, not a version georef
publishes** — georef exposes no dataset version, so this is the honest strongest thing available; it is
monotonic and comparable, which is all the drift question needs. And it is generated, not typed: the index
generator stamps it into the vendored data, and the wire reads it from there, so it cannot survive a
regeneration that changed the rows under it.

**Only `INDEC` carries a version, and the ISO levels never will.** There is no snapshot behind them — the
country is a constant and the 24 subdivisions are a fixed table (last changed in 1990). Do not wait for a
`regionCodeSchemeVersion`.

### The BAHRA projection is now contract, not an internal detail

You flagged that core silently depends on our index projecting BAHRA asentamientos *up* to the containing
localidad censal rather than emitting asentamiento codes — and you were right to, because it was documented
only in a comment in the generated data file, where it read as ours to "improve". It is now a stated
guarantee in §5: **every `INDEC` code we emit is a localidad censal**, and going finer is a breaking change
with its own entry here.

It is also enforced rather than promised. The index generator asserts that the distinct codes it emits equal
the number of localidades censales it read, and the test suite asserts the same against what actually
shipped. A future edit that indexed asentamiento or departamento ids fails the build instead of quietly
emitting codes you would resolve none of.

### Ask 7 — ○ is the truth, and §3 now says so

Void as stated, and the field table says why so nobody wonders again. `identificationTypeCode` is derived
from ARCA's `tipoClave`; that element is optional in the authority's schema, and the type is **not
recoverable from the number** — CUIT, CUIL and CDI all draw from the same `20`/`23`/`24`/`27` prefixes, so
the digits do not name their own kind. Every padrón response we have recorded does carry it, so in practice
the key is present on both details; what we will not do is state a type ARCA did not, since a wrong type is
worse for your draft than your existing fallback. Keep the fallback chain.

### Your status update, noted

`common.city` holding INDEC codes is recorded above: the 2026-08-25 `cityCode` row now carries a
**superseded** note pointing here, so nobody reading the older entry is still told the field cannot be
consumed. The row itself is left as written — it was true on the day, and this log is a record of what you
were told, not a description of today.

Also noted, and not acted on: we are **not** adding an endpoint that serves the catalog. Agreed on both the
reason and the shape, and §5 now says so explicitly so it does not get proposed again.

---

## 2026-08-25 (later) — A clave lookup can now be answered by the second registry

Branch `feature/padron`. A behaviour change on `POST /api/taxpayers/lookup`; no field, no shape and no
code-space changes anywhere.

**What changed.** A lookup by clave (`identificationTypeCode` 80 CUIT / 86 CUIL / 87 CDI) used to ask
ARCA's *constancia* padrón and nothing else, so a clave that padrón does not hold came back
`404 TAXPAYER_NOT_FOUND`. The two padrones are not the same population: the constancia knows only claves
with an *inscripción*, while A13 knows every clave ARCA has issued — it is the superset. A clave lookup now
falls back to A13 when the constancia has no such clave, and only a miss in **both** is a `404`.

| Change | Where | Core action |
| --- | --- | --- |
| A clave lookup may return `detail: "IDENTITY"` where it always returned `"REGISTRATION"`. | §3 lookup | **Recommended** — branch on `detail`, never on the identification type you sent. |
| Fewer `404`s: a clave with no inscripción now resolves instead of coming back not-found. | §3 lookup | None. An identifier that used to `404` can now return `200`. |
| A clave lookup can now report `DELEGATION_NOT_CONFIGURED` naming `ws_sr_padron_a13`. | §3 errors, §10 | None — ours to fix (the certificate's enrolment). |

**What a fallback row looks like.** Exactly the `IDENTITY` column of §3's field table: no `taxes`, no
`fiscalConditionCode`, no `simplifiedRegimeCategory`, and `documentType`, `documentNumber`, `birthDate`,
`legalForm` present instead. Anything reasoning "this was a CUIT lookup, so it has taxes" will read
`undefined` — the requested identification type never was a safe proxy for the key set, and now it visibly
is not. `providerMetadata.service` names the padrón that answered, if you want it in a log.

**One case that is deliberately not a `404`.** If the fallback cannot *reach* A13 at all (enrolment, token
or transport), the lookup fails with that error rather than degrading to the constancia's not-found. With
the superset unread the service does not know that nobody is registered, and a `404` would state something
it cannot stand behind.

**Not done, deliberately.** There is no fallback the other way: a clave the constancia holds is by
definition in A13, so that lookup could only ever come back empty-handed. Document lookups (96 / 89 / 90)
are unchanged — they already read A13.

---

## 2026-08-25 — Taxpayer lookup: coded addresses, a fiscal condition, self-describing rows

Branch `feature/padron`. Answers all five asks in [CONTRACT-REQUESTS.md](CONTRACT-REQUESTS.md) 2026-08-25.

> ### ⚠️ One breaking change, and it is a silent one
>
> **`address.regionCode` has changed meaning.** It used to carry ARCA's own `idProvincia` (`"3"` = Córdoba);
> it now carries the ISO 3166-2 subdivision code (`"AR-X"`). Same key, same JSON type, no error anywhere on
> the wire — a reader that has not adapted gets a plausible-looking string that means something else.
>
> **Core action: required.** Read `regionCode` as ISO 3166-2, paired with `regionCodeScheme`, and join it
> onto `common.state.iso_code`. ARCA's `idProvincia` is **gone from the wire** with nothing replacing it —
> your own request says you could never interpret it, and §9 keeps that kind of authority-internal id inside
> the provider. `region` (the province *name*) remains as the fallback when the code does not resolve.

Everything else is new and optional. `region`, `city` and `taxIdType` are untouched, and a lookup that
populated nothing new returns what it did yesterday.

| Change | Where | Core action |
| --- | --- | --- |
| **`address.regionCode` now ISO 3166-2** (`"AR-X"`), was ARCA's `idProvincia`. Paired with `regionCodeScheme`. | §3 addresses | **Required** — see the box above. |
| `address.countryCode` + `countryCodeScheme` — `"AR"` / `"ISO-3166-1-ALPHA-2"` on every ARCA address. | §3 addresses | Optional. Stop inferring the country from `integration_entity.country_id`; read it. |
| `address.cityCode` + `cityCodeScheme` — the locality as an INDEC 8-digit code / `"INDEC"`. | §3 addresses | Optional, and **you cannot consume it yet** — `common.city` has no INDEC column. The code is on the wire now so the backfill has something to build against. **Superseded 2026-08-26:** that backfill landed the same day this was written; `cityCode` is consumed today. |
| `TaxpayerDto.fiscalConditionCode` — the VAT condition, in the **same code space as `invoice.receiver.fiscalConditionCode`**. | §3 taxpayers | Optional. Narrow the tenant `contributor_type` candidates by it; preselect where exactly one matches. |
| `TaxpayerDto.identificationTypeCode` / `identificationNumber` — the row's own identification pair. | §3 taxpayers | Optional. Replaces mapping `taxIdType` back to a code, and the fallback to the requested type. |

### Match a level on the pair, not the code

Every coded value on an address now travels with the standard it belongs to, and **resolution is a match on
`(code, codeScheme)`** — a code alone does not identify a catalog. Read the level as: the authority's name
(`region`, `city`), the code, and the scheme.

The scheme values are a **closed vocabulary** — `ISO-3166-1-ALPHA-2`, `ISO-3166-2`, `INDEC` — now specified
in CONTRACT §5. They are stable, unique across coding systems, and key-safe (uppercase, digits, hyphens; no
spaces, no case variation), because you are storing and matching on them. **Seed them as constants rather
than retyping them**: a scheme that differs by a space or a capital raises nothing at all, it just matches no
row and leaves the field null. Treat an unrecognized scheme as "cannot resolve this level", not as an error,
and a future entity's catalog (`IBGE`, `INSEE`) will not break you.

If you built against an earlier build of this branch: `countryIso` and `regionIso` are gone. They never
shipped outside `feature/padron` — they baked the standard into the key name, which no non-ISO country could
ever answer, so they were replaced by the uniform pair before release rather than removed from anything live.

### Read these three limits before building against the new keys

**`cityCode` does not cover barrios of interior cities.** ARCA regularly reports a *barrio* as the locality —
`BARRIO YAPEYU` for a real Córdoba fiscal address — and the national catalogs (INDEC localidades censales
plus BAHRA asentamientos, vendored in `src/providers/arca/mapping/indec/`) model settlements, not neighbourhoods.
Those addresses arrive with a `regionCode` and **no** `cityCode`, keeping only `city` as the authority's free
text. CABA is the exception: its 48 barrios are in
the catalog and all resolve to the single CABA locality, so a `PALERMO` address does get a code. Closing the
gap for the rest needs a postal-code index and there is no openly-licensed source for one — if the miss rate
turns out to matter in practice, that is the next conversation, not a silent fix.

**Resolution never guesses.** A locality is matched exactly, after case/accent/punctuation folding, scoped to
the province — which is what keeps `MERLO` in Buenos Aires apart from `MERLO` in San Luis. Anything the
catalog gives two codes for within one province resolves to nothing. There is no fuzzy or nearest-match
fallback anywhere, by design: a code that puts a customer in the wrong city is worse for your users than an
absent one. The `BARRIO`/`B°` prefix is read as part of that rule rather than as noise: it says the text
names a neighbourhood, so outside CABA the address resolves to no code at all. Dropping the word instead
would match the *locality* of the same name, and those exist — Córdoba capital has a Barrio General Paz and
Córdoba province a localidad General Paz, two different places.

**`fiscalConditionCode` is absent more often than you might expect, and absence is never Consumidor Final.**
It is emitted only on positive evidence: an *active* IVA, monotributo, exento or no-alcanzado registration.
A monotributo category, which ARCA sometimes reports without the impuesto, is secondary evidence — read only
when no active impuesto names a condition, and never over an impuesto ARCA has since de-registered, since
the category is a historical attribute that carries no state of its own. It is **omitted** on every
`IDENTITY` result (no taxes are reported at all), for a taxpayer with no VAT-relevant registration, for a
de-registered one, and where the registrations on file contradict each other. Treat a missing key as "not
reported" and let the user choose — do not default it.

### Still blocked on the same deployment prerequisite

Every one of these was verified against recorded padrón responses, not live ones. The delegate certificate
still has to be adhered to `ws_sr_constancia_inscripcion` and `ws_sr_padron_a13` in WSASS (homologación) or
Administrador de Relaciones (production) before any lookup returns something other than
`500 DELEGATION_NOT_CONFIGURED` — see the 2026-08-21 entry below. **Core action: none** — it is a deployment
task on this service.

---

## 2026-08-21 — `invoice.lines` may be empty, but an invoice must still carry an amount

Branch `feature/padron`, alongside the letter-C fix below. Not breaking: every invoice core sends today keeps
authorizing unchanged.

| Change | Where | Core action |
| --- | --- | --- |
| `lines` no longer has a minimum length — a zero-rated sale legitimately has no VAT bases to declare and carries its money in `totals`. | §3 invoices | None. Send `[]` rather than padding it with zero-rated entries, which double-counted against `totals.untaxed`. |
| An invoice with **no amount in either channel** is now `400` (`details` names `lines`). | §3, §8 | None unless you were sending empty vouchers, which the authority rejected anyway — this just says so without the round-trip. |

A rate of `0` in `lines` is still valid and still means something distinct from `totals.untaxed`: it is a base
the entity **taxes at zero** and wants declared as such (AR: its own alícuota id, not `ImpTotConc`). Money
outside the tax system altogether belongs in `totals`.

### Letter-C vouchers no longer report a VAT breakdown

A voucher whose type is letter C (AR: Monotributo / Exento issuers — `FACTURA_C` and its siblings) now folds
the whole pre-tributes amount into the net and reports no VAT element at all, because its issuer has no débito
fiscal to declare and ARCA rejects any attempt to declare one (observations `10047` / `10048` / `10071`).
**Core action: none** — keep sending the net/VAT split you already send. Whether it is *reportable* is an
authority rule, and applying it is this service's job, not core's.

One visible consequence: on a letter C the perception's printed `BaseImp` is now the whole sale rather than
the pre-VAT net, since for a type-C issuer the net/VAT split is core's internal costing and the perception was
levied on the full amount. The `ImpTrib` the authority reconciles against is unchanged.

---

## 2026-08-21 — Taxpayer lookup: real registry data, new request/response shape, no `entity` block

Branch `feature/padron`. `POST /api/taxpayers/lookup` returns real data for the first time — it previously
made the authority call and then answered `501`, because the ARCA padrón parsers were seeds. Getting there
changed both the request and the response, so **this endpoint is a breaking change**. `/points-of-sale`,
`/authority/status` and `/entities` are untouched; `/invoices/authorize` moved too, but separately and
non-breakingly — see the entry above.

### The request no longer carries an issuer

| Change | Where | Core action |
| --- | --- | --- |
| Body is now `{ entityCode, environment, identificationTypeCode, identificationNumber }`. The `entity` block, `taxpayerId` and `level` are gone. | §3 taxpayers | **Required.** Send the identification pair you already send on `invoice.receiver` — the same canonical `identificationTypeCode` (80=CUIT, 86=CUIL, 87=CDI, 96=DNI, 89=LE, 90=LC). Drop `entity` and `level`. |
| Lookups no longer use the issuer's certificate, so this endpoint **never** returns `409 CREDENTIALS_REQUIRED`. | §3, §10 | You can drop the credential-retry path for this endpoint (it stays exactly as-is for every other one). |

Why the `entity` block went away: a registry lookup is not issued *for* anybody. This service now asks the
authority under **its own** delegated identity, so there is no issuer to name, no credentials to fetch and
decrypt, and no per-taxpayer delegation to arrange. It also means the endpoint works for a taxpayer you hold
no certificate for.

**`level` is gone and is not coming back.** `A4|A5|A10|A13` were ARCA service tiers leaking onto a
deliberately entity-neutral wire (§9). The identification type now selects the registry, because that is the
same decision: a tax id can be looked up directly, an identity document has to be resolved to the tax ids
issued for it first.

### The response is a list, and says which registry answered

| Change | Where | Core action |
| --- | --- | --- |
| `200` is now `{ entityCode, detail, taxpayers: [ … ] }` instead of a bare `{ idPersona, taxId, name }`. | §3 taxpayers | **Required.** Read `taxpayers[0]` for a tax-id lookup; iterate for a document lookup. `idPersona` is gone — the neutral field is `taxId`. |
| `detail` is `"REGISTRATION"` or `"IDENTITY"` and tells you which fields can be populated. | §3 field table | Branch on it if you need fields only one of them carries. |

A document lookup can legitimately match **several** taxpayers — one DNI commonly carries both a CUIL and a
CUIT — which is why the result is always a list. It is never empty on a `200`: no match is a `404`.

The two registries are complementary, not "more or less detail". `REGISTRATION` (AR: constancia de
inscripción) carries registered taxes, activities, the simplified-regime category and the fiscal address, but
no identity document. `IDENTITY` (AR: padrón A13) carries the document, birth date, legal form and every
declared address, but no taxes. The per-detail ✔/○/— field table in §3 is authoritative.

### Absence: keys are omitted, never `null`

| Change | Where | Core action |
| --- | --- | --- |
| Optional scalars are **omitted** when the authority did not return them. Arrays a detail covers are **always present**, `[]` when empty. `taxes` is absent entirely on an `IDENTITY` result. | §3 taxpayers | None if you already treat a missing key as "not reported" — that is the existing convention for `qr` and `dischargeDate`. Do not expect `null`; this service never sends it. |

The distinction is deliberate: `"taxes": []` means *asked, none registered*; no `taxes` key means *this
registry cannot report taxes at all*. Given `detail`, the key set is fully predictable.

### New errors

| Change | Where | Core action |
| --- | --- | --- |
| `404 TAXPAYER_NOT_FOUND` — nobody registered under the identifier; `details: { entityCode, identificationTypeCode, identificationNumber }`. | §8 | Handle as a normal negative answer (show "not found"), not as an outage. Never a `502`. |
| `400 ARCA_VALIDATION` with `details.code: "UNSUPPORTED_IDENTIFICATION_TYPE"` — passport (94), foreign CI (91) and "sin identificar" (99) cannot be looked up. | §3, §8 | Do not offer registry lookup for those identification types. ARCA's document search takes a bare number with no document type, so there is no way to ask it about a passport. |
| `500 DELEGATION_NOT_CONFIGURED` now also covers "our certificate is not enrolled in the registry web service", naming the service in `details.reason`. | §8, §10 | None — a deployment task on this service, not a caller error. Surface it as an outage, not as "taxpayer not found". |

> **Deployment prerequisite (this service, not core).** The delegate certificate must be adhered to
> `ws_sr_constancia_inscripcion` and `ws_sr_padron_a13` in ARCA's WSASS (homologación) or Administrador de
> Relaciones (production). Verified against homologación on 2026-08-21: until it is, every lookup returns the
> `500` above. Note that `ws_sr_padron_a5` is **deprecated** — ARCA's catalog replaces it with
> `ws_sr_constancia_inscripcion`, and that is the id to enrol.

---

## 2026-08-20 — Stronger idempotent-recovery match, concept-1 date window now rejects instead of clamping

Branch `feature/delegated-certificates`. Two related tightenings of `POST /invoices/authorize`'s existing
behavior (§3). Neither changes the request shape — both are stricter validation on paths that were already
documented, so most integrations see no difference.

### Idempotent-recovery mismatch guard now checks more fields

| Change | Where | Core action |
| --- | --- | --- |
| The `VOUCHER_ALREADY_AUTHORIZED_MISMATCH` guard on a `10016` recovery now also compares receiver id type/number, concept, currency, voucher date, and receiver IVA condition — previously only total amount. | §3 idempotency note | None if your resends are byte-for-byte the same invoice (the normal retry-after-persistence-failure case) — those still recover cleanly. If you ever *reuse* a voucher number for a genuinely different invoice, that now also throws `400 ARCA_VALIDATION` instead of silently returning the first invoice's CAE for any of these fields, not just amount. |

A stored value the authority doesn't return for a given voucher — absent, `null`, or an empty XML element —
is never treated as a mismatch; this only rejects a *confirmed* difference, same as the pre-existing amount
check.

> **Retries must replay the original `issueDate`.** Voucher date is one of the compared fields, so a retry
> that re-stamps `issueDate` with the current date is read as a different sale and refused with
> `VOUCHER_ALREADY_AUTHORIZED_MISMATCH` — permanently. The common way to hit this is a retry that crosses
> midnight. **Core action:** persist `issueDate` alongside the voucher number and resend it verbatim; do not
> rebuild it from the clock.

### Concept-1 date window: reject, don't clamp

| Change | Where | Core action |
| --- | --- | --- |
| A concept-1 (goods) `issueDate` more than 5 days from the request time is now refused (`400 ARCA_VALIDATION`, `details.code: "VOUCHER_DATE_OUT_OF_WINDOW"`) instead of silently authorized under today's date. | §2 field table, §3, §9 | If you send concept-1 invoices with a stale or future-dated `issueDate` (queued requests, backfills), you will now get this `400` where you previously got a `200` dated differently than what you sent. Send `issueDate` within ±5 days of when you call `authorize`, or use concept 2/3 with the service-date fields if the sale date is expected to diverge from the filing date. |

This also makes the idempotent-recovery date comparison above meaningful: since a resend's `CbteFch` is no
longer silently rewritten to "now", a genuinely-identical resend now always carries the same stored date as
the original.

Two clarifications on the rejection's edges:

- **Idempotent recovery still wins.** A resend whose `issueDate` has aged out of the window is reconciled
  against the authority *before* the date is judged, so a delayed replay of a lost CAE still returns that CAE
  (full `200`, QR included). Only a genuinely new invoice gets `VOUCHER_DATE_OUT_OF_WINDOW`.
- **The window counts Argentina calendar days**, not elapsed hours, so a date exactly 5 days out behaves the
  same whether you call at 09:00 or 18:00.

### Unparseable ISO dates are a `400`, not a `500`

| Change | Where | Core action |
| --- | --- | --- |
| A date field that passes `@IsISO8601` but this service cannot parse — week (`2026-W01-1`), ordinal (`2026-366`), basic (`20260231`), space-separated (`2026-08-05 12:00:00`) — is now refused with `400 ARCA_VALIDATION`, `details.code: "INVALID_ISSUE_DATE"`, naming the offending field. | §3, §8 | None if you send `YYYY-MM-DD` or a full ISO timestamp. Previously these produced an opaque `500 INTERNAL`, so any handling you built around that `500` can be dropped. |

---

## 2026-08-20 — ARCA `10069` is now a `400`; every `ARCA_SERVICE` carries the authority's error list

Branch `feature/delegated-certificates`. Two changes to the error envelope (§8) on authority business
rejections. Request shapes are unchanged.

| Change | Where | Core action |
| --- | --- | --- |
| ARCA `10069` ("Campo DocNro no puede ser igual al del emisor" — receiver identification number equals the issuer's own) now maps to `400 RECEIVER_MATCHES_ISSUER` with `details: { arcaCode, arcaErrors }`. It previously fell through to `502 ARCA_SERVICE`. | §8 | **Status class changes from 5xx to 4xx.** If you retry `502`s, this rejection is no longer retried — correctly, since it never succeeds until the receiver is corrected. Add `RECEIVER_MATCHES_ISSUER` to your error switch so the actionable message surfaces instead of falling into an unknown-4xx branch. |
| `502 ARCA_SERVICE` now includes `details.arcaErrors` — the authority's full `[{ code, message }]` list, previously dropped entirely. | §8 | None; purely additive. Worth logging: it is how a recurring code gets identified and promoted to its own `400` category later. |

---

## 2026-08-18 — Delegated authorization (ARCA *representación*)

Branch `feature/delegated-certificates`. Adds the ability to issue for a taxpayer whose certificate core does
not hold, using **our own** ARCA certificate as the delegate (*computador*). Full description: CONTRACT.md §10.

### Additive on the wire — nothing breaks

| Change | Where | Core action |
| --- | --- | --- |
| New optional request field `entity.delegated` (boolean) | §2 entity block, §10 | None to keep today's behavior. Omit it (or send `false`) and every existing flow is byte-for-byte unchanged. Send `true` to use the delegated flow. |
| New error `403 DELEGATION_NOT_AUTHORIZED`, `details: { delegateTaxId, issuerTaxId, arcaCode, arcaMessage }` | §8, §10 | Only reachable on a `delegated: true` request. Surface it to the user as "grant WSFEv1 to CUIT `<delegateTaxId>` in ARCA's *Administrador de Relaciones*". **Do not** treat it as a transport failure and do not retry — it is deterministic until the user grants the delegation. |
| New error `500 DELEGATION_NOT_CONFIGURED`, `details: { environment, reason }` | §8, §10 | Only reachable on a `delegated: true` request. It means this service is misconfigured for that environment, not that the request was wrong — alert us, don't surface it as a user error. |
| `409 CREDENTIALS_REQUIRED` is never returned for a `delegated: true` request | §4, §10 | None. Core's existing one-retry handshake logic is untouched; a delegated request simply never enters it. |

`delegated: true` requests must **not** carry `entity.credentials` — this service signs with its own platform
certificate and ignores the field.

### Behavioral notes for core

- **Prerequisite is out of band.** The represented taxpayer must delegate WSFEv1 to our delegate CUIT in ARCA's
  *Administrador de Relaciones*. This service keeps no allow-list and does not pre-validate the issuer, so the
  first signal of a missing delegation is the `403` above, on the first real call.
- **A delegated `authorize` can answer `403`/`502` where it previously answered `502 ARCA_SERVICE`.** When
  authorize hits ARCA's already-authorized conflict (`10016`) and the internal recovery query is then rejected
  for a token/representación reason, that rejection is now reported as the cause (`403
  DELEGATION_NOT_AUTHORIZED`, or `502 ARCA_AUTH` for a genuine token fault) instead of the `10016` conflict.
  Only affects `delegated: true` requests; non-delegated recovery is unchanged. Core's orphan reconciliation
  keys on `404 VOUCHER_NOT_FOUND`, which is untouched.
- **A genuine token fault is never reported as a missing delegation.** ARCA overloads `600 ValidacionDeToken`
  for both cases; we classify by message and leave the ambiguous residue as `502`. So a `403` means "the user
  must act", and a `502` means "our side or ARCA" — the distinction is safe to build UI on.

### Ticket cache (§4) — one visible consequence

Tenant tickets and the delegate ticket live in **separate cache partitions**, and a credential-less request is
only ever served from its own issuer's tenant partition. Consequence: if core also self-issues non-delegated
for **our own** CUIT, that flow keeps its normal `CREDENTIALS_REQUIRED` handshake — it does not silently ride
on the delegate ticket. (The partitions do converge, with no extra handshake, when the credentials core sends
for our own CUIT *are* our delegate certificate.)

The tenant partition key itself is unchanged: `(entityCode, environment, issuerTaxId, service)`. An existing
shared `ARCA_TICKET_CACHE_PATH` keeps working across this deploy — no cache flush, no coordinated restart.

### Deployment (our side, not core's)

`ARCA_DELEGATE_CERT_*` / `ARCA_DELEGATE_KEY_*` per environment, optionally guarded by `ARCA_DELEGATE_TAXID`;
see `.env.example`. A configured-but-unusable delegate certificate fails at **boot**, not per request. Leaving
an environment unconfigured simply disables delegation there (a `delegated: true` request for it returns `500
DELEGATION_NOT_CONFIGURED`).
