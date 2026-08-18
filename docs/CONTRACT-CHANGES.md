# taxprocess-api — contract changes

Audience: the **`webprocess-api`** (core) team. A running log of changes to [CONTRACT.md](CONTRACT.md), newest
first, so core can see what to adapt without diffing the whole document. Each entry states what changed, why,
and **whether core must do anything**.

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
