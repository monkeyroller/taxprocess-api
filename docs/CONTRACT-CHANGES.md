# taxprocess-api — contract changes

Audience: the **`webprocess-api`** (core) team. A running log of changes to [CONTRACT.md](CONTRACT.md), newest
first, so core can see what to adapt without diffing the whole document. Each entry states what changed, why,
and **whether core must do anything**.

---

## 2026-09-02 — A rate now says which day it applies to, and every instant on this wire is UTC

Branch `feature/foreign-currency-electronic-sales`. Answers both asks core raised on 2026-09-02. **Ask 15 is
granted, and it reverses the non-ask we agreed yesterday — you were right that we put the field on the wrong
side of the split.** A window derived from `rate_sync_cron` describes *when you will next ask*; a window
derived from the authority's own day rule describes *when its number stops applying*. Those are different
facts, only one of them is ours, and `validity_day` existing solely to stop them drifting is the proof.

**Granted with one change to what you asked for**, which is the part to read: the range is keyed on the day
you *asked about*, not on the day the rate *closed on*. The next section has the reasoning.

| # | Ask | Answer | Core action |
| --- | --- | --- | --- |
| 15.1 | Accept an instant on `/currencies/rates` | **Already shipped** — `date` has accepted a zone-qualified instant (`…Z`, `…±HH:MM`) since the endpoint landed; it is placed in the authority's zone and reduced to its day. It was documented in §2's date table but never called out on the endpoint. Day-granular `date` stays, unchanged | **None.** Send either form |
| 15.2 | Report the authority's applicability range | **Granted.** Every rate now carries `validFrom` and `validUntil` — two absolute instants, half-open, one authority day wide, **keyed on the day you asked about** | **Delete `validity_day` and the two-predicate cache test**, as you proposed. One correction to the read path: test against the **voucher's** instant, never `now` — see the warning below |
| 15.3 | The service converts internally, core never names a zone | **Granted**, already true, and now stated as a wire-wide rule: **every date we return is a bare authority day; every instant we return is UTC** | **None** |
| 16 | Say what happens to `refreshAfter` | **Kept, redefined, and re-rendered.** It is now the later of the earliest `validUntil` in the batch and the next authority midnight — which, since a requested day is clamped at today, is the same instant it always was. Its **rendering** changes: `Z`, not `-03:00` | **None if you parse it.** See the rendering note if you compare it as a string |

---

### Why per-day, and not the range you asked for

You asked for "the interval for which that published figure is *the* valid one". Read strictly that is the
inverse of the day rule: a close dated `D` prices every voucher in `(D, next working day after D]`, so
Friday's close would report **one** window spanning Saturday, Sunday and Monday.

**We cannot compute that upper bound, and we would rather not guess it.** It needs a walk **forward** to know
whether tomorrow is a feriado — and ask 13 settled that feriados are not modelled here on purpose, they are
discovered through ARCA's own `602` after the fact. A feriado calendar would be wrong the first year ARCA
moves a puente, and this is exactly the case where being wrong is expensive: report the window one day short
and you re-fetch needlessly; report it one day long and you price a voucher off a rate that no longer applies.

So a rate is valid for the **24 hours of the day it was asked for**:

| you ask about | `rate` | `rateDate` | `validFrom` → `validUntil` |
| --- | --- | --- | --- |
| Sat 2026-08-29 | 1512 | `2026-08-28` | `2026-08-29T03:00:00Z` → `2026-08-30T03:00:00Z` |
| Sun 2026-08-30 | 1512 | `2026-08-28` | `2026-08-30T03:00:00Z` → `2026-08-31T03:00:00Z` |
| Mon 2026-08-31 | 1512 | `2026-08-28` | `2026-08-31T03:00:00Z` → `2026-09-01T03:00:00Z` |

Three requests, one number, one `rateDate`, three windows. `validFrom` is the day you asked about — the one
value you already hold, and nothing to do with the walk-back, which is what produces `rateDate` — and
`validUntil` is just the next midnight after it. Nothing looks forward, so nothing can be wrong about a
calendar we cannot see. The windows are contiguous and half-open, so no instant is priced twice and none is
priced by nothing.

Every rate in one response carries the **same** window, including the locally-answered `PES` row — they answer
one question — while their `rateDate`s may still differ. That is the existing rule that a shared `rateDate`
across a batch is not promised, unchanged.

### The one thing that will bite you: applicability is not entitlement

> ⚠️ **For a backdated request the window is entirely in the past, and that is correct.**

Your ask anticipated this — "`isBandWarranted(...)` against the voucher's instant" — and your own note
rejected requested-day bounds for exactly this reason: *the window would be entirely in the past and every
consumer would correctly read it as expired and re-fetch on every read.*

That objection is right under the **entitlement** reading and dissolves under the **applicability** one. The
field no longer means "core may serve this from cache until then". It means "this number priced that day",
which is permanent: the rate that priced 2026-08-17 will always be the rate that priced it, and a window in
the past records which day the answer is about rather than that it went stale.

So the predicate must take the voucher's instant, not `now`. A read path that tests against `now` concludes
every backdated answer is expired and re-fetches it on every single read — the failure you predicted, arriving
through the reading rather than through the bounds.

### What this does not give you

**ARCA still cannot be represented intraday.** The *shape* is instants and is future-proof for an authority
that republishes every six hours; ARCA's `FchCotiz` is a day, so these values stay day-aligned and a second
ARCA publication within one day remains unrepresentable. Ask 15's motivating scenario is served by the field
shape, not by ARCA. We would rather say that plainly than have you find it out.

### `refreshAfter` — ask 16

Your reading is right: ask 15 dissolves ask 14's premise. **A hint that can only push a run later is no longer
incompatible with anything**, because validity now ends where the authority says rather than at your next
tick. Ask 14's *outcome* stands — the publication hour is gone and stays gone — but its stated rationale is
superseded, and §3 now says so rather than leaving it standing on a premise this entry removed.

The field survives because it is not fully redundant. Three cases:

- **live request** — identical to every rate's `validUntil`. The ranges subsume it;
- **backdated request** — the only forward-looking instant in the payload, every window being in the past;
- **no rates at all** — the only refresh signal there is, since there are no ranges to read one from. That is
  the case a client would otherwise poll hot, and it is the one that decided this.

You said you had no preference; this is the reading where the field still earns its place, so we kept it.

### Rendering: `refreshAfter` moves from `-03:00` to `Z`

> ⚠️ **Correction to the 2026-09-01 entry.** That entry told you, as a side effect of retiring the publication
> hour, that "the field now always carries `-03:00`". That is no longer true.

Every instant this service returns is now UTC — `refreshAfter`, `validFrom` and `validUntil` alike — while
every **date** stays a bare authority day. A day is the authority's unit and means nothing without its
calendar; an instant is absolute and should travel in the one form every caller reads identically.

The instant is unchanged. `2026-08-29T00:00:00-03:00` and `2026-08-29T03:00:00Z` are the same moment, so
**anything that parses the field is unaffected**. Only a string comparison or a logged-value assertion sees a
difference. Where an instant marks a day boundary it is that authority day's midnight rendered UTC: Argentine
midnight on 2026-08-30 is `2026-08-30T03:00:00Z`.

### What did NOT change

Each is a reasonable guess at the blast radius, and each is wrong.

- **The band.** `[0.02 × rate, 5 × rate]`, measured rather than inferred, and `bandBasis` with it.
- **`rateDate`.** Still ARCA's echoed `FchCotiz`, still a bare authority day, still the record of which
  publication priced a voucher. It is **not** the window, and the two routinely disagree — that is the point
  of having both.
- **The business-day walk-back** (ask 13). This is built on it, not against it.
- **`publishedAt`**, the `PES` shortcut, `unavailable` and its three reasons, and the whole-table shape.
- **No history endpoint**, no bulk calendar, no per-instant series. Still one warranted answer per currency.
- **Day-granular `date` is not deprecated.** Send days indefinitely if you prefer.

---

## 2026-09-01 — Which day a cotización is for, the end of the publication hour, and `next-numbers` duplicates

Branch `feature/foreign-currency-electronic-sales`. Answers both asks core raised on 2026-09-01. **Ask 13 is your row 2**, settled against
production: ARCA's rows are working-day closes, so `date` no longer reaches `FchCotiz` verbatim — **`date` is
the day that needs a valid rate, and what is valid for it is the previous working day's close.** Nothing core
sends changes.

Carried in the same branch is one change **nobody asked for**, on an endpoint unrelated to currency:
`/invoices/next-numbers` now de-duplicates. It is last in the table because it is the only item here that can
alter a response you already consume.

| # | Ask | Answer | Core action |
| --- | --- | --- | --- |
| 13 | `date` should mean the day of the voucher, immutably | **Granted, and it is your row 2.** Measured against **production**: every Saturday, Sunday and feriado answers `602`, so a row is the close *of* a working day. `date` stays the day needing a rate; this service resolves it to the previous working day's close — weekends skipped, feriados discovered via `602` — plus a future-date clamp per the second clause of 10038. The rule is production's in **every** environment. **Note the correction below on what 10038 does and does not require** | **None.** Keep sending the voucher's day |
| 14 | Retire the publication-hour `refreshAfter` | **Granted as asked.** `PUBLICATION_HOUR_ART` and the publication-hour arithmetic are deleted; the field is now the next authority midnight and documented as **advisory** | None — you already ignore it. Keep storing it |
| — | *Not an ask — raised by us* | `/invoices/next-numbers` de-duplicates `documentTypeCodes`, so `numbers` carries **one entry per distinct code**. `[1, 6, 1, 1]` answers with two entries, not four | **None if you map back by `documentTypeCode`**, as the contract has always specified. **Required if you zip `numbers` against your request positionally, or check the two have equal length** — see below |

---

### The verification case — which day is a rate FOR

You were right that this was ours to measure, and right that publishing the outcome is worth more than the
answer itself. It took **two** environments, and the reason is the finding we would most want the next person
to have: **homologación cannot answer this question.**

**Run 1 — homologación, 2026-09-01, every call at 11:52 ART**, `MonId = DOL`, read-only:

| # | `FchCotiz` sent | result |
| --- | --- | --- |
| 1 | `20260901` (today, Tue) | **`602 Sin Resultados`** |
| 2 | `20260831` (Mon) | `MonCotiz 1158.439`, `FchCotiz 20260831` |
| 3 | *omitted* | `MonCotiz 1158.439`, `FchCotiz 20260831` |
| 4a | `20260829` (Sat) | `MonCotiz 1157.952`, `FchCotiz 20260829` |
| 4b | `20260830` (Sun) | `MonCotiz 1158.195`, `FchCotiz 20260830` |
| 5 | `20260817` (a feriado, Mon) | `MonCotiz 1155.114`, `FchCotiz 20260817` |

Read on its own that table is genuinely ambiguous, and it is worth saying so plainly because we first read it
as settled. Every calendar day has a row; today does not. That fits "rows are dated by close, today has not
closed" and it fits "rows are dated by the day they apply to, today's is not loaded yet at 11:52" equally
well. Nor do the values discriminate: fetched for all 24 days from `20260808`, homologación's series
**compounds smoothly** — deltas `+0.222` rising to `+0.244`, no repeat across either weekend or the feriado. A
real reference rate must carry *something* forward over a Saturday, so that series is generated. **No
measurement taken in homologación can decide this**, and the numbers there are not market data.

**Run 2 — PRODUCTION, 2026-09-01 at 13:55 ART**, same six calls plus the same 24-day series. Different
answer, and decisive:

| `FchCotiz` sent | result |
| --- | --- |
| Mon `20260831` | `MonCotiz 1508.5` |
| *omitted* | `MonCotiz 1508.5` — the same row |
| Fri `20260828`, Thu `20260827`, Wed `20260826` | `1512`, `1512`, `1514` |
| **every Saturday and Sunday** | **`602 Sin Resultados`** |
| **Mon `20260817` — a feriado** | **`602 Sin Resultados`** |
| `20260901` — today | **`602 Sin Resultados`** |

**Rows are business-day CLOSES.** The weekend settles it: if a row were the rate *in force on* its day, a
Saturday would have to carry one — the rate in force on a Saturday is Friday's close, and a voucher issued on
a Saturday has to declare something. ARCA has no Saturday row at all. Under close-keying every observation
falls out at once: no weekend close, no feriado close, none for today because today has not closed. The values
corroborate it — `1487.5`–`1514`, jittery, with negative deltas — against homologación's smooth curve over the
same days.

**So "la cotización registrada para el día hábil anterior a la fecha de emisión" — the day validation 10038
names — is the row for the last business day strictly before your `date`**, and that is what this service now
sends.

> ⚠️ **A correction to how we cited this, because it changes what you should build.** 10038 does **not**
> currently bind any voucher you can send. Its sentence opens with a condition we quoted past — *"Si se indica
> que el pago del comprobante se realiza en la misma moneda extranjera que la factura"*, i.e.
> `CanMisMonExt = S` — and nothing on this wire sets that field. Our own 2026-08-31 entry says as much about
> the *exactness* half of the same validation ("so it never fires"); the day half is gated identically, and
> presenting it as an ARCA requirement was our error.
>
> **Nothing about the behaviour changes, and neither does the measurement** — that rows are working-day closes
> is a fact about ARCA's data, established by the `602`s, not by any validation. This service still resolves to
> the previous working day, because it is the number 10038 names (so your vouchers are already right when
> foreign-currency payment lands and it starts binding as `EXACT`), and because it makes `rateDate` a
> defensible record of which publication priced a sale.
>
> **What it changes is what you should assert.** For a voucher you can send today the only cotización rule
> that binds is 10119's band, `[0.02 × rate, 5 × rate]` — so a rate taken from a different day will almost
> always be accepted. Do not build a check that tells an operator ARCA will reject one; that is the same trap
> as `OUT_OF_BAND`, which the 2026-08-31 entry already warned about.

Three things fall out that are worth having on the record:

- **"Día hábil" vs "día anterior" stops being a question**, and it is *working* days that won. Weekends never
  carry a close, so they are **skipped** rather than asked about: Monday 2026-08-31 reads Friday the 28th in
  one call instead of spending two `602`s on the way. Feriados are the opposite decision — deliberately not
  modelled, because a holiday calendar here would be wrong the first year ARCA moves a *puente*, so they are
  discovered through the authority's own `602`. Monday 2026-08-17 resolves to Friday the 14th without anything
  in this service knowing it was a holiday.
- **Omitting `FchCotiz` really does mean "the latest row"** — verified in both environments. It answered the
  same row as the last business day, so an omitted `date` and `date` = today are the same question in
  different words.
- **The trap, reported because it nearly shipped.** "ARCA's cotización for a day already *is* the previous
  close, so asking for the voucher's own day already gives the right number" is a very reasonable argument,
  and it is wrong: the row is *labelled* by the day it closed on, so asking `X` returns the close **of** `X`.
  For a same-day sale it happens not to matter — today has no row, the walk-back rescues it, and both
  readings give the same answer. **A backdated sale is where it bites**, which is the case `date` exists for:
  `date` = Mon 2026-08-31 returns Friday's `1512`, not Monday's own `1508.5`.

**One decision that follows from all this, and is worth stating because it is not obvious.** The rule above is
**production's, and this service applies it in every environment — `testing` included.** Homologación serves a
row for every calendar day, so following what it happens to answer would resolve a testing sale differently
from a production one and hand you a `rateDate` that could never occur for real. Nothing in the resolution
branches on environment: what you exercise in homologación is the behaviour you will get from ARCA. The cost is
that a testing sale is priced off a *generated* number, which was always true and is now at least consistently
so.

`PROBE_ENVIRONMENT=production pnpm probe:cotizacion-day` re-takes the whole thing read-only — no vouchers, no
numbering — and prints the verdict plus the constant to change if it ever disagrees. Add `PROBE_SERIES=1` for
the 24-day picture. The decision and the day it was taken live in
`src/providers/arca/mapping/cotizacion/cotizacion.ts` (`RATE_DAY_RULE`), together with the environment it was
taken in, because that turned out to matter.

---

### Ask 13 — `date` names the day of the voucher, and the answer is immutable

Granted as asked, and CONTRACT.md §3 now states it: **`date` is the day of the voucher being priced**, and the
answer is **immutable** — the publication it resolves to is a close that already happened, so nothing ARCA
posts later in the day can change it. What changed here to make that true:

| behaviour | before | now |
| --- | --- | --- |
| the day sent as `FchCotiz` | `date` verbatim — the voucher's own day | the **previous working day**, weekends stepped over rather than probed |
| a working day ARCA holds no close for | `NO_PUBLICATION` | walks back up to five working days; `rateDate` names the day that answered |
| `date` later than today | asked about it, then reported nothing published | clamped to today (the second clause of 10038) |
| `date` omitted | the latest row | unchanged — still the latest row, still one read per code |
| environment | — | the same rule everywhere; homologación's weekend rows are ignored |

Verified end to end against production, one code:

| `date` | authority reads | `rateDate` → rate |
| --- | --- | --- |
| Tue 2026-09-01 (today) | 1 | `2026-08-31` → 1508.5 |
| Mon 2026-08-31 | 1 | `2026-08-28` → 1512 — Friday, weekend skipped |
| Sat 2026-08-29 / Sun 2026-08-30 | 1 | `2026-08-28` → 1512 |
| Mon 2026-08-17 (the feriado) | 1 | `2026-08-14` → 1487.5 |
| Tue 2026-08-18 (after it) | 2 | `2026-08-14` → 1487.5 — the feriado `602`s, then Friday |
| 2027-12-31 (future) | 1 | `2026-08-31` → 1508.5 |
| omitted | 1 | `2026-08-31` → 1508.5 |

**`rateDate` is untouched on the wire, as you asked, and its meaning is now sharper.** It is always *earlier*
than the `date` you sent — one day for a Tuesday-to-Friday, three for a Monday, more across a feriado — and it
is ARCA's own echoed `FchCotiz`, never a day this service chose. It is the only record of which close priced a
voucher, so keep storing it rather than your request date.

**What it costs: one authority read per code, on every day of the week.** One `/api/currencies/rates` call is
still one call, and skipping weekends is what keeps the reads behind it flat — a Monday resolves to Friday
directly rather than paying two `602`s to rediscover that Saturdays do not close. Only a feriado costs a second
read (the day after one: the feriado `602`s, then the working day before it). A currency with no close at all
in the window is the case that pays for the bound: six reads, once. No per-date calendar here — your Ask 8
answer in reverse — and nothing you need to change.

Two things we did **not** do, both because you were explicit:

- **No `validFrom` / `validUntil` on the wire.** Your argument is right and now lives in CONTRACT.md §2: how
  long an answer is *warranted* is a function of your refresh cadence, which this service cannot see, and
  supplying it would mean guessing a cadence and beginning to lie the moment an operator retunes it.
- **No change to the band, `bandBasis`, or the reference-currency shortcut.** `[0.02 × rate, 5 × rate]`,
  `TOLERANCE`/`EXACT`/`REFERENCE`, and `PES` answered locally at `1/1/1` are all as they were. One
  consequence to expect: `PES` reports the day you asked about while a fetched row reports a business day
  before it, so a batch carries two `rateDate`s. That is the contract as written — a shared `rateDate` was
  never promised — and deliberate: the peso is 1 on the voucher's own day, with no close to be behind.

---

### Ask 14 — `refreshAfter` is advisory, and the publication hour is retired

Granted as asked, and the reason you gave is the one written into CONTRACT.md rather than the arithmetic:

- **`PUBLICATION_HOUR_ART` is deleted**, along with the business-day skip and the never-in-the-past clamp that
  existed to defend it. The field is now the **start of the next authority day** (`…T00:00:00-03:00`), which
  is all a day-keyed answer supports: a closed day's rate cannot change at all, and a day cannot stop being
  the day you asked about until the calendar moves. One side effect worth knowing if you log it: the clamp was
  the only path that emitted a UTC `Z` instant, so the field now always carries `-03:00`.
- **The field is documented as advisory**, with your structural argument stated in full: a hint that can only
  push a run **later** is unusable by any caller whose cache validity *ends* at its next scheduled run,
  because obeying it leaves that caller past its own validity boundary holding nothing warranted. That is not
  specific to your cadence, so §3 says it rather than leaving the next caller to find out. The old
  instruction to let it push your next run "later, never earlier" is **gone** — your schedule sets the
  rhythm, and this field is a fact about the data rather than an instruction about your cron.
- **It is still always present and still never in the past**, including on an all-`unavailable` answer. Both
  are now free rather than defended: the start of the next authority day is strictly after every instant
  inside this one.

Worth saying plainly, since your note was diplomatic about it: `max(cron, refreshAfter)` on a midnight sync
computing `19:00` was our field's fault, not your arithmetic's. A hint that could only ever delay was the
wrong shape for the thing.

**Core action: none for either ask.** You already send the voucher's day and already ignore `refreshAfter`.

---

### Not an ask — `next-numbers` answers once per distinct document type

Unrelated to currency, and in this branch only because it was found while reviewing it. `documentTypeCodes` is
de-duplicated before the authority is called, so `numbers` carries **one entry per distinct code** rather than
one per element sent: `[1, 6, 1, 1]` now answers with two entries.

**Why**, and the second reason is the one that made it worth doing rather than merely tidy. A duplicate spent
a `FECompUltimoAutorizado` call per copy — WSFEv1 has no batch operation, so the service fans out per code,
and `[1, 1, 1]` was three calls for one answer. More to the point, it put **several entries carrying the same
`documentTypeCode`** into an array the contract tells you to key by exactly that field. Two rows both claiming
to answer for code `1` is not a shape a key-based read has a defined outcome for — last-wins, first-wins and
"duplicate key" are all reasonable readings, and which one you got was never specified. Answering once per
distinct code removes the question instead of documenting an answer to it.

**What has not changed:**

- **Every requested code is still echoed.** De-duplication drops only repeats, so the *set* of codes in
  `numbers` equals the set you sent. Only the multiplicity differs.
- **A duplicated unrecognized code is still a `400`.** Validation runs over the distinct codes, and a repeat
  contributes no code that de-duplication removed — so `[9999, 9999]` fails exactly as `[9999]` does, with
  `details.code: "UNKNOWN_CODE"`. De-duplicating cannot turn a rejection into a silent omission.
- **Order is still the order you first named each code in**, and still not something to depend on: the echo is
  by key, as it always was.

**Core action: none if you read `numbers` by `documentTypeCode`.** The one thing that breaks is consuming it
positionally against your request, or asserting the two are the same length — both now fail on any request
containing a repeat. Sending duplicates was never useful and we do not know whether you do; if core already
de-duplicates before calling, nothing here is observable for you at all.

---

## 2026-08-31 — The cotización: a rate endpoint, a canonical currency code, and one date rule

Branch `feature/foreign-currency-electronic-sales`. Answers all five asks core raised on 2026-08-28. **Ask 11 is the one that unblocks you**;
everything else is additive except one date-format tightening flagged below.

| # | Ask | Answer | Core action |
| --- | --- | --- | --- |
| 8 | `POST /api/currencies/rates` | **Granted as specified.** Whole table when `currencyCodes` is omitted; `date` → the authority's day | Call it |
| 9 | Serve it credential-free under our delegate identity | **Granted as written.** No `entity` block, no credentials | None — cache centrally as planned |
| 10 | We own the band | **Granted**, as `TOLERANCE`. Read the warning below: it is wider than you expect | See "the band is wide" |
| 11 | `invoice.currencyCode` | **Granted**, additive; `currencyIso` optional and deprecated | Send `currencyCode` |
| 12 | The currency list | **As a table**, in [CONTRACT.md](CONTRACT.md) §5 — no endpoint | Diff your seed against it |

---

### Ask 11 — `invoice.currencyCode` (the one you are blocked on)

`NeutralInvoiceDto` now accepts `currencyCode`, a canonical per-entity currency code identity-mapped to
`MonId` like the other three fiscal codes. `currencyIso` is relaxed to optional and **exactly one of the two
must be present** — both is a `400`, and so is neither.

Exactly-one-of rather than prefer-`currencyCode`, as you asked: silently preferring one would let a bug send
`{currencyIso: "USD", currencyCode: "PES"}` and file a peso voucher for a dollar sale, which is the failure
`UNMAPPED_CURRENCY` existed to prevent. `@Length(1, 8)`, not three — `002`/`060` are zero-padded and `MonId`
is `String(8)` in ARCA's own cotización response.

The membership check stays: an unknown code is `400 ARCA_VALIDATION` / `UNKNOWN_CODE` naming the field,
rather than a `502` relaying ARCA's `12000`. Worth being straight about the trade you asked for both halves
of — a check and "zero change here for a new ARCA currency" are not both fully achievable. A new code is now
a one-line addition to a set in this service rather than a mapping decision, and the ISO table is gone; that
is the improvement, and it is not literally zero.

`currencyIso` and the `{ARS, USD, EUR}` table will be removed as a **breaking** entry once you confirm every
instance sends `currencyCode`.

---

### The verification case — ask 9 answered, ask 10 still open

You were right that publishing these outcomes is worth more than either endpoint, so here they are
separately from the prose above.

**Experiment 2 (ask 9): GRANTED — measured, not assumed.** Against homologación on 2026-08-31,
`FEParamGetCotizacion` answered with `Auth.Cuit` = our own delegate CUIT and **no representación**:

| call | result |
| --- | --- |
| `FEParamGetCotizacion("DOL")` | `MonCotiz 1158.195`, `FchCotiz 20260830` |
| `FEParamGetCotizacion("060")` | `MonCotiz 1186.5538`, `FchCotiz 20260830` |
| `FEParamGetCotizacion("PES")` | **`602 Sin Resultados`** |

No `600`, no `601`. So ask 9 stands as written and needs no fallback: cache centrally per
`(entity, environment)` as you planned, with no tenant certificate anywhere near it.

Three things fall out of that table:

- **Your other question is answered: homologación DOES serve cotizaciones**, with live data rather than
  stubs. You do not need to skip the check in a testing environment.
- **`PES` genuinely has no publication** — the reference currency being answered locally is therefore
  *required*, not an optimization. Asked upstream it would come back `NO_PUBLICATION`, leaving you with no
  rate for ~99% of vouchers. This service answers it at `1/1/1` before any ticket is resolved.
- **`FchCotiz` really does precede the day asked for** (the 30th, asked on the 31st), which is the
  behaviour behind "store `rateDate`, not your request date".

**Experiment 1 (ask 10 / the band): MEASURED.** Run against homologación on 2026-08-31 (`DOL`, published
rate `R = 1158.195`), 23 vouchers consumed. Every rejection came back as validation **10119**:

| `MonCotiz` | as a factor of `R` | outcome |
| --- | --- | --- |
| 23.048081 | `0.0199 × R` | **REJECTED** `10119` |
| 23.163900 | `0.02 × R` | authorized — the floor |
| 579.097500 | `0.5 × R` | authorized |
| 1159.695000 | `R + 1.5` | authorized |
| 2316.390000 | `2 × R` | authorized |
| 4644.361950 | `4.01 × R` | authorized |
| 5790.680927 | `4.9997 × R` | authorized — the ceiling, bisected |
| 5791.246452 | `5.0002 × R` | **REJECTED** `10119` |

**The band is `[0.02 × rate, 5 × rate]`.** Neither of the two readings we flagged was right, and the reason
is worth stating because it is easy to repeat: **ARCA's sentence names two rules in different forms.**
"inferior **al** 2%" is a fraction *of* the rate; "superior **en** un 400%" is an excess *over* it
(`rate + 4 × rate`). Assuming both bounds share a form gives either a ceiling of `4R` — wrong, ARCA
authorized `4.01R` — or a floor of `0.98R` — wrong by ~49×, ARCA authorized `0.5R`.

**Validation 10240 does not bind ordinary vouchers.** `R + 1.5` was authorized, so its "no podra superar en
1 a la cotizacion oficial" is conditioned on `CanMisMonExt` as its position in the manual suggests. Nothing
to design around today.

**What this means for you, concretely.** At a published rate of 1465.5 the accepted range is
`[29.31, 7327.50]`. So the warning in your frontend contract will essentially never fire on a commercially
wrong rate — which is the point in the section above, now measured rather than suspected.

---

### Ask 8 / 9 — `POST /api/currencies/rates`

Documented in full in [CONTRACT.md](CONTRACT.md) §3. It matches the shape you specified field-for-field,
including `unavailable`, `refreshAfter` and `publishedAt`. Notes on the parts where we made a decision:

- **Credential-free, granted as written.** `Auth.Cuit` is our own delegate CUIT and no representación is
  involved (§10). Nothing about this is tenant-scoped, so cache centrally as planned.
- **`publishedAt`, not a shared `rateDate`.** We cannot promise the batch shares a day: a thinly-traded code
  may not publish every day, so its answer legitimately carries an older day than the dollar's.
  `publishedAt` is the latest `rateDate` in the batch, and it is absent rather than fabricated when nothing
  was published.
- **`refreshAfter` is always present and never in the past**, including on an all-`unavailable` answer.
- **The per-date traffic is not a problem.** One extra single-code call per backdated sale is nothing next
  to the whole-table sync. Do not build a per-date calendar on our account.
- **`PES` costs nothing.** Answered locally at `1/1/1`, and a `PES`-only request resolves no ticket at all,
  so a peso till cannot be taken down by an unreachable authority. Please do mark the reference row in your
  own seed rather than hardcoding `"PES"`.
- **An unknown code lands in `unavailable`**, not as a `400` — deliberately unlike `documentTypeCode`,
  because one bad code must not cost the other forty-eight. But if *every* code fails the same transient
  way, the request fails with a `502`: reporting that as forty-nine currencies coincidentally having no data
  would let you cache "nothing is published" and stop asking.

---

### Ask 10 — the band, and the part you should act on

`bandBasis: "TOLERANCE"`, both bounds **inclusive**, confirmed. `lowerLimit`/`upperLimit` are always
present. Your check `lowerLimit ≤ rate ≤ upperLimit` is exactly right.

> ⚠️ **The band ARCA enforces is much wider than the feature assumes, and your own worked example is inside
> it.** Measured, not inferred (see the verification section above): the accepted range is
> `[0.02 × rate, 5 × rate]`. USD invoiced at 900 on a day ARCA published 1465.5 sits inside
> `[29.31, 7327.50]`. **ARCA will authorize it.**
>
> So `OUT_OF_BAND` will rarely fire, and the sale-create check as designed does not catch the abuse the
> entry's problem statement opens with. This is the outcome your verification section anticipated, and we
> are answering it the way you asked: report the real width rather than a narrower one, because telling an
> operator the authority will reject something the authority accepts is worse than saying nothing.

**What we would do about it, and it is cheap.** `rate` — the authority's point value — is already in the
response. A comparison against *that* is what catches a commercially wrong rate, and it holds regardless of
how wide the band turns out to be. We would suggest a distinct verdict (`OFF_OFFICIAL_RATE`, say) rather
than overloading `OUT_OF_BAND`, because your frontend contract already tells the operator that
`OUT_OF_BAND` means "ARCA will probably reject it". The two want different words.

**Also:** while we return a real band, `common.fiscal_entity.rateTolerancePercent` should stay unused. Two
tolerances applied in series would be nobody's intended rule.

#### The width is a measurement, and it is perishable

ARCA has rewritten this validation three times since 2023, each time by editing the same sentence. So the
numbers above are dated rather than assumed permanent: `BAND_RULE.measuredOn` in
`src/providers/arca/mapping/cotizacion/cotizacion.ts` carries `2026-08-31`, and `pnpm probe:band`
re-measures it in one command — laddering `MonCotiz`, reporting which code rejected each rung, bisecting
both bounds and printing the constant to paste back. Re-run it rather than re-reading the PDF.

The two bounds are configured independently (`FRACTION_OF` for the floor, `EXCESS_OVER` for the ceiling)
precisely because this measurement showed they do not share a form.

#### One tightening to know about now

Manual v4.0 added validation 10038: if a voucher declares it is *paid* in the same foreign currency
(`CanMisMonExt = S`), `MonCotiz` must match the last published business day's rate **exactly**. Nothing on
this wire can request that today, so it never fires. The day you add foreign-currency payment, the band for
those sales becomes `EXACT` — worth knowing before rather than after.

---

### Ask 12 — the currency list, as a table

[CONTRACT.md](CONTRACT.md) §5 now carries all forty-nine codes with names, ISO mapping and the reference row
marked. No `POST /api/currencies`: §5's own argument against serving a catalogue applies, and this is
build-time data.

Diff your seed against it. It was transcribed from the same ARCA publication and cross-checked against
`FEParamGetTiposMonedas`, so a disagreement is worth investigating in both directions.

---

### One date rule, for every date field — 🔴 a narrow tightening

| Change | Where | Core action |
| --- | --- | --- |
| Every date field now accepts a calendar day (`2026-08-25`) or an instant **carrying a zone** (`2026-07-12T01:00:00Z`). A datetime with **no** zone is `400 ARCA_VALIDATION` / `INVALID_ISSUE_DATE`. | §2 *Dates*, §3 | **None if you send `YYYY-MM-DD`**, which your payload builder does. Confirm before deploy. |
| A date-only value naming a day that does not exist (`2026-02-31`) is now refused rather than rolled forward to March 3rd. | §2 *Dates* | None |

**Why this is worth a breaking note rather than a footnote.** `issueDate: "2026-08-26T01:00:00"` used to be
accepted and resolved against *our container's* timezone: the identical request produced `CbteFch = 20260825`
on a service running `TZ=UTC` and `20260826` on one in Buenos Aires. That is the voucher's **legal** date
decided by our deployment rather than by you. It applied to `issueDate`, `serviceDateFrom`/`To` and
`paymentDueDate` alike. Now refused, and the zone-qualified form is placed correctly:
`2026-07-12T01:00:00Z` is 22:00 on the 11th in Buenos Aires and becomes `20260711`, not `20260712`.

**And one thing you cannot delegate to us**, now written up in §2: you still need the entity's timezone for
your own decisions — which day a sale is dated, whether it is backdated, and what day to render a date we
returned as. A sale submitted 2026-08-25 22:00 ART is already 2026-08-26 in UTC; derive the day on a UTC host
and you will validate a Monday sale against Tuesday's band. Hold the zone as data on the entity — you
already do, as `rateSyncTimeZoneId` — never as a constant in shared code.

---

### A pre-existing inconsistency we are flagging, not fixing

Two response fields render an authority **calendar day** as a UTC instant: `expiration` (ARCA `CAEFchVto`)
and point-of-sale `dischargeDate` (`FchBaja`). `"2026-08-27T03:00:00.000Z"` is AR midnight in UTC — the
`03:00:00.000Z` is an artifact, not information.

The consequence is real: you persist `expiration` as a timestamp, so anything rendering the **day** in a
non-AR zone gets it wrong (at UTC−5 that instant displays as 2026-08-26). Every other date this service
returns is a bare authority day, including all seven padrón dates and everything new in this release.

We are **not** changing them here — it is a breaking response change on a field you persist, and this
release is already large. Raised so the inconsistency is on the record with an owner rather than discovered
later; we will propose it with its own window.

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

Branch `feature/padron`. Answers both asks core raised on 2026-08-25 (later).
Additive on the wire; nothing breaks, and a reader that ignores the new key is correct today and
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

Branch `feature/padron`. Answers all five asks core raised on 2026-08-25 — numbered 1–5 there, and restated
in the change table below rather than by number.

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
