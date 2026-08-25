# taxprocess-api — contract changes

Audience: the **`webprocess-api`** (core) team. A running log of changes to [CONTRACT.md](CONTRACT.md), newest
first, so core can see what to adapt without diffing the whole document. Each entry states what changed, why,
and **whether core must do anything**.

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
