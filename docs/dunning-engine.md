# Billing state engine (7a — shadow mode)

The engine decides how a member's billing state should change when a payment event arrives. **In this release it executes
nothing**: no SaaS pause/resume, no GHL write, no pipeline move, no `GhlAccount` update. It only records decisions
(`DunningDecision`). The live routes (`payment-failed`, `pause`, `active`) and the `Transaction` table remain the authority; see
`docs/payments-webhook-system.md`. The engine follows `docs/ghl-server-contract.md` (rule 4 one write path, rule 5 idempotency,
stage keys equal `BillingState` values).

## Rules (`lib/billing/state/transition.ts`, pure `decide(snapshot, event, ctx)`)

| Event | Effect |
|---|---|
| wallet recharge **failed**, balance < 0 | strike +1. active/trial → `payment_failed`; strikes 1–2 stay `payment_failed`; the **3rd → paused (non_payment)** + `saas_pause` |
| wallet recharge failed, balance ≥ 0 or unknown | recorded, nothing changes ("no strike" / "balance unknown; strike not counted") |
| wallet recharge **succeeded** | strikes = 0 always. It only **cures** — `payment_failed` → active, or paused/`non_payment` → resume — when the **post-recharge balance is ≥ 0** (live: read after the recharge; replay: estimated). Otherwise strikes reset but the state stays: *"recharge succeeded, balance still negative"* (an unknown balance counts as not confirmed). An unpaid core failure keeps `payment_failed` regardless (a resume then lands in `payment_failed`). Other pause reasons are never resumed |
| core subscription **failed** | → `payment_failed`, **no strike**, marks a core failure open — unless `now < coreCoveredUntil` ("covered, ignored") |
| invoice **expired** (event arrives in 7b) | → paused (`expired_invoice`) + `saas_pause`; same coverage protection |
| core subscription **succeeded** | clears the core failure. trial / `payment_failed` → active (stays `payment_failed` while wallet strikes remain); paused `expired_invoice`/`non_payment` → active + `saas_resume`, strikes reset. `manual_killswitch`/`voluntary` pauses are not resumed |
| `trial_auth` succeeded | null/trial → **trial**, `trialOffer` only if the subscription name matches `/\d+\s*Day Trial/i`, `trialEndsAt` from the subscription. Any other state: "ignored (state X)" |
| any payment event on **inactive** / **churned** | recorded as "state excludes action" — never struck, never auto-resumed |
| command `paused` / `inactive` / `churned` / `active` (arrive in 7b) | `manual_killswitch` pause / `voluntary` pause / pause, billing stopped / resume + strikes reset. If the state **already matches**, it is a **confirmation**: no intent, side effect re-asserted with `idempotent: true` |

A failure is tracked by kind: wallet strikes (counter) and `coreFailureOpen` (flag). `payment_failed` lasts while either is open.
A `null` (unseeded) state is treated like active, except that `trial_auth` moves it to trial.

`decide` returns `{ nextState, pauseReason, warningCount, coreFailureOpen, trialOffer, trialEndsAt, sideEffects[], intents[], reason }`.
Side effects are `saas_pause` / `saas_resume`; intents are `{ pipeline: "active_client", stage: <BillingState>, fields }`. Both are only
*data* here.

## Write path and modes (`lib/billing/state/apply.ts`)

`applyDunning` is the single write path: it loads the account and its **projection**, reads a wallet balance / subscription **only
when the rule needs it** (GET only, outside the DB transaction), takes a per-account advisory lock, calls `decide`, and inserts a
`DunningDecision`. `DUNNING_MODE` defaults to `shadow`; any other value throws in this release. The `live` branch is a stub (7b).
The unique key `(trigger, ghlAccountId, mode)` makes reprocessing a no-op; triggers are `ledger:<ghlTransactionId>`,
`command:<stage>`, `invoice:<id>`.

- Only **terminal** ledger statuses (`succeeded`, `failed`) produce a decision; `pending` is skipped without recording anything, so the
  unique key can never freeze a decision on a non-final status.
- **Shadow** additionally skips events older than 48 h ("historical — covered by replay") and events older than one already projected in the shadow projection
  ("out of order"), so nightly sweeps of old rows cannot corrupt the projection. Replay has neither restriction.

## The shadow projection (`projection.ts`)

Shadow and replay never write `GhlAccount`. A shadow decision is computed against the **projected state**: the `to*` values of the
account's **latest SHADOW decision**, ordered by `eventAt` (the event's `occurredAt`, not insertion time). With no shadow decision yet,
it is seeded from the account row (`billingState`, `warningCount`, `pauseReason`; `coreFailureOpen` inferred as "payment_failed with
no strikes"). **Replay rows never feed the shadow projection** — they are analysis of history, and each mode projects only from its own
decisions. Health compares the shadow projection with `GhlAccount.billingState` (the "differs" count) and shows the replay end-state
comparison separately, labelled as analysis.

## Hooks (additive, never affect the caller)

- `processPaymentEvent` — after a ledger row is ingested and the event marked processed, `shadowDunningForLedger` runs.
- `tx_sweep` — the same call after each ingested row (recovers missed webhooks within the 48 h window).
- The hook **never throws**: any error (including an unsupported `DUNNING_MODE`) is caught, logged, and counted in
  `JobRun` `dunning_shadow` (shown on Health). The webhook's 200, the ledger write and the event's `processedAt` are unchanged.

## Dual-write for new members (`dualWrite.ts`)

Two live routes gain one import and one awaited call each; both helpers swallow and log every failure and are bounded by a 3 s timeout:

- `app/api/webhooks/ghl/route.ts` — import (line 6) and `await ensureGhlAccount(prisma, { userId, contactId })` (line 57), placed after
  `User.ghlContactId` is stored (the contact id does not exist earlier). Upserts the **member** `GhlAccount` **by `userId`**
  (unique) and refreshes `contactId`; internal accounts are skipped.
- `app/api/webhooks/ghl-provision/route.ts` — import (line 13) and `await setGhlAccountLocation(prisma, { userId, locationId, contactId })`
  (line 85), after `User.ghlLocationId` is written. Sets `GhlAccount.locationId` (creating the account first if the payment webhook's
  dual-write never ran and the contact id is real).

No branch, response body or status code in either route changes. Until the migrations are deployed to the database the live routes
use, these calls fail harmlessly (logged, swallowed).

## Historical replay (`scripts/billing/replay-dunning.ts`)

Dry-run by default (`--apply` writes `DunningDecision` rows with mode `replay`, idempotent; refuses the production host). Each member
starts from a neutral state (**trial** if their first core-related row is a `trial_auth`, else **active**) and their ledger events run
through `decide` in `occurredAt` order, with `coreCoveredUntil` checked **at each event's own time**. Subscriptions are read
(GET) for `trial_auth` events.

**Estimated balances.** Only one day of balance snapshots exists (2026-09-26), so historical balances are *reconstructed*: from the
nearest "ok" snapshot, `balance(t) = snapshot − net change between t and the snapshot`, where net change = ledger recharge credits
(succeeded auto/manual, net of refunds) + wallet usage (`WalletTransaction`, charges negative). A snapshot taken within 36 h before
the event is used as a real reading. It is an **estimate** — recharge fees, intra-interval ordering and unrecorded credits are unknown —
and is labelled "estimated" in every output (the row's `balanceEstimated`, the reason text, the Health table). With no usable
snapshot the balance is unknown and no strike is counted.

Replay sees only ledger payments: manual pauses/resumes, GHL stage moves, cancellations and pre-June history are not in it, so it
will not match today's `billingState`/`User.status` where those drove the state.

## Not in 7a

Applying decisions (live mode), executing `saas_pause`/`saas_resume`, sending intents, and the invoice and stage-change webhooks
(7b). `DunningDecision.mode = "live"` is reserved for it.

**For 7b — subscription status changes.** A subscription that is canceled, or a trial that expires without converting, produces **no
ledger event**, so the engine as built here never sees it (about 15 of today's paused accounts are in this category). 7b adds a
nightly subscription sweep that feeds those status changes to the engine as events.

**Design note for 7b (from the replay).** A third strike can be followed within minutes by a successful auto-recharge that clears the
balance (e.g. one account paused at 14:21 and resumed at 14:22). Executing those literally would pause and resume the SaaS location in
quick succession; consider a short debounce before executing a `saas_pause` that a pending recharge could immediately cure.
