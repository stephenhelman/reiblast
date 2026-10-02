# Billing state engine (7a — shadow mode)

The engine decides how a member's billing state should change when a payment event arrives. **In this release it executes
nothing**: no SaaS pause/resume, no GHL write, no pipeline move, no `GhlAccount` update. It only records decisions
(`DunningDecision`) — the one exception is the onboarding → Clients handoff, which sends only when `CLIENT_HANDOFF=live` (see *Engine completion*). The live routes (`payment-failed`, `pause`, `active`) and the `Transaction` table remain the authority; see
`docs/payments-webhook-system.md`. The engine follows `docs/ghl-server-contract.md` (rule 4 one write path, rule 5 idempotency,
stage keys equal `BillingState` values).

## Rules (`lib/billing/state/transition.ts`, pure `decide(snapshot, event, ctx)`)

| Event | Effect |
|---|---|
| wallet recharge **failed**, balance < 0 | strike +1. active/trial → `payment_failed`; strikes 1–2 stay `payment_failed`; the **3rd → paused (non_payment)** with **`saas_pause` in the same decision** |
| wallet recharge failed, balance ≥ 0 or unknown | recorded, nothing changes ("no strike" / "balance unknown; strike not counted") |
| wallet recharge **succeeded** | strikes = 0 always. It only **cures** — `payment_failed` → active, or paused/`non_payment` → resume — when the **post-recharge balance is ≥ 0** (live: read after the recharge; replay: estimated). Otherwise strikes reset but the state stays: *"recharge succeeded, balance still negative"* (an unknown balance counts as not confirmed). An unpaid core failure keeps `payment_failed` regardless (a resume then lands in `payment_failed`). Other pause reasons are never resumed |
| core subscription **failed** | → `payment_failed`, **no strike**, marks a core failure open — unless `now < coreCoveredUntil` ("covered, ignored") |
| invoice **expired** | → paused (`expired_invoice`) with `saas_pause` in the same decision; same coverage protection |
| core subscription **succeeded** | clears the core failure. trial / `payment_failed` → active (stays `payment_failed` while wallet strikes remain); paused `expired_invoice`/`non_payment` → active + `saas_resume`, strikes reset. `manual_killswitch`/`voluntary` pauses are not resumed |
| `trial_auth` succeeded | null/trial → **trial**, `trialOffer` only if the subscription name matches `/\d+\s*Day Trial/i`, `trialEndsAt` from the subscription. Any other state: "ignored (state X)" |
| any payment event on **inactive** / **churned** | recorded as "state excludes action" — never struck, never auto-resumed |
| command `paused` / `inactive` / `churned` / `active` | `manual_killswitch` pause + `saas_pause` / `voluntary` pause + `saas_pause` / churned + `saas_pause` / resume + strikes reset. If the state **already matches**, it is a **confirmation**: no intent; `inactive`/`churned`/`active` re-assert their effect idempotently; `paused` re-sends nothing (its own decision already carried the pause and its retries) |
| `pause_confirmed` (legacy `paused_confirm` stage) | **removed as a step**: still parsed, but always a no-op ("no confirmation step"). Nothing depends on it |
| sweep: subscription canceled / expired | → churned + `saas_pause` (deferred while covered; a cancel during the trial churns at once); nothing if the contact has another live subscription |
| sweep: trial ended unconverted | trial → `payment_failed`, core failure open (coverage protects) |
| sweep: subscription trialing | null/trial → trial with offer and end date |

A failure is tracked by kind: wallet strikes (counter) and `coreFailureOpen` (flag). `payment_failed` lasts while either is open.
A `null` (unseeded) state is treated like active, except that `trial_auth` moves it to trial.

`decide` returns `{ nextState, pauseReason, warningCount, coreFailureOpen, trialOffer, trialEndsAt, sideEffects[], intents[], reason }`.
Side effects are `saas_pause` / `saas_resume`; intents are `{ pipeline: "active_client", stage: <BillingState>, fields }` or, for a member still in onboarding, `{ pipeline: "onboarding", stage: <onboarding key> }` (see *Engine completion*). Both are only
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

## 7b additions (built, NOT switched on)

**Intents outbox** (`lib/billing/intents/send.ts`, table `GhlIntent`). Every intent a decision emits is recorded first (dedupe key
`<mode>:<account>:<trigger>:<kind>:<stage>`). In shadow mode — or in live mode for an account not in `DUNNING_LIVE_ACCOUNTS` — the row is
`skipped_shadow` and nothing is sent. Live + allowlisted → `pending`, sent after the transaction commits to
`GHL_INTENT_URL_ACTIVE_CLIENT` / `GHL_INTENT_URL_ONBOARDING` with `{ contactId, pipeline, stage, fields: { pause_reason, trial_offer,
trial_end_date } }` (stage keys equal `BillingState` values; the fields are the account's **current** values so a stage move never blanks
the trial fields). Failures are recorded and retried up to 5 times by the replay job and after each processed event. `sendPendingIntents`
does nothing unless `DUNNING_MODE=live`. The exact GHL workflow to build is in `docs/ghl-workflows.md`.

**GHL → server routes** (`GHL_EVENTS_SECRET`, header `x-reiblast-events-secret`, timing-safe; GhlEvent recorded first; always 200):
`POST /api/webhooks/ghl/stage-changed` `{ contactId, pipeline, stage }` — onboarding: updates `GhlAccount.onboardingStage` (the only DB
write outside the engine); `active_client`: a stage key becomes a **command** (trigger `command:<stage>:<ghlEventId>`, so a later manual
move is never mistaken for an earlier one), a legacy `paused_confirm` becomes a no-op `pause_confirmed`, anything else is ignored. A repeat of the same
move within 60 s is a duplicate delivery. `POST /api/webhooks/ghl/invoice-event` `{ invoiceId }` — the invoice is fetched by id (the HQ key
has invoices read scope); only an expired or voided **core recovery invoice** (`source: payments_subscription`) becomes `invoice_expired`.
**This route is left in place but is unused**: no GHL workflow calls it. The nightly `sub_sweep` invoice check is the source of
`invoice_expired`. Failed events are retried by the replay job, dispatched by source.

**Pausing.** A strike (the 3rd), an expired invoice or a manual move to Paused changes the state, emits a `paused` intent **and** carries
`saas_pause` in the same decision (executed only in live mode, retried with backoff). There is no 15-minute debounce and no `paused_confirm`
step. A cure resumes immediately. `inactive`/`churned` commands and sweep-driven churn pause at once. An engine-sent stage move echoes
back through `stage-changed`; because the DB state already matches it is recorded as a confirmation (no intent), so there is no loop — there
is no separate echo-detection mechanism.

**Live branch** (`applyDunning`, unreachable unless `DUNNING_MODE=live`). One transaction, under the per-account advisory lock, persists
`GhlAccount` (state, strikes, pause reason, trial fields), mirrors `User.warningCount` and — only when it is currently `active`,
`suspended` or `inactive`, never an onboarding status — `User.status` (paused → suspended, inactive/churned → inactive, otherwise active;
removable once the tools app stops reading `User`), writes the decision (mode `live`) and enqueues the intents. **After** the commit it
sends the intents and executes the side effects; failures are recorded on the decision/intent, never rolled back. Idempotent on
`(trigger, account, mode)`. **Even in live mode it acts only for `DUNNING_LIVE_ACCOUNTS`**; every other account is processed as shadow.
Until cutover the old routes still change `User`, so live mode is for a named test account only.

## Engine completion (still shadow)

Everything below records decisions and intents (`skipped_shadow`); the only live send is the Clients handoff, and only when
`CLIENT_HANDOFF=live`.

### Where a member's card lives: `GhlAccount.activeClientSince`

Null = still in onboarding; set = handed off to the Clients pipeline. `routeIntents` (`transition.ts`, applied to every decision) retargets
the decision's intents. The state, strikes and side effects are identical either way; only the intents differ.

| Decision | Handed off (`activeClientSince` set) | Still in onboarding |
|---|---|---|
| → `payment_failed` | Clients **Payment Failed** | Onboarding **Payment Failed** (key `payment_failed`) |
| → `paused` | Clients **Paused** | Onboarding **Paused** (key `paused`) |
| cure: `payment_failed`/`paused` → `active` (core success, or a recharge leaving balance ≥ 0, or a manual `active`) | Clients **Active Member** | back to the onboarding stage matching `onboardingProgress` — exactly that stage, never forward, never a side stage; no recorded progress → no card move (the decision's reason says so) |
| trial / `active` / `inactive` / `churned`, trial-field refreshes | Clients intents as before | **nothing** is sent |

Onboarding keys live in `lib/billing/onboardingStages.ts` (`payment_failed`, `paused` added; `ONBOARDING_KEY_TO_STAGE_NAME` maps every key to
the exact stage name in `lib/billing/stages.ts`, enforced by a test). The onboarding workflow's If/Else needs the two new keys (`docs/ghl-workflows.md` A2).
The shadow dedupe key of an onboarding intent carries `onboarding:` so it can never collide with a Clients intent for the same trigger.

### The Clients handoff (`lib/billing/clientHandoff.ts`)

When the onboarding stage-changed webhook reports **A2P Approved** (idempotent — a redelivery or a replay retry cannot send twice) and
`activeClientSince` is null, the server enqueues ONE `active_client` intent placing the card by `GhlAccount.billingState`: trial → Trial,
active → Active Member, payment_failed → Payment Failed, paused → Paused (inactive/churned → Inactive/Churned). The receiver is the
ordinary Active Client workflow (`GHL_INTENT_URL_ACTIVE_CLIENT`), which creates or updates the opportunity. A **null** `billingState` sends
nothing: the event is noted and a `GhlEvent` of source `client_handoff_review` is recorded, and `activeClientSince` stays null.

`CLIENT_HANDOFF=live|off` (default **off**) gates it, independent of `DUNNING_MODE` and `DUNNING_LIVE_ACCOUNTS`:

- **live** — records the intent as `pending` (dedupe `handoff:<ghlAccountId>`), sets `activeClientSince`, sends it. A failed send is retried (max 5)
  by the replay job / after each processed payment event even while `DUNNING_MODE=shadow` (only `handoff:` rows are retried in that case).
- **off** — records a `skipped_shadow` preview (`handoff-shadow:<ghlAccountId>`) and writes nothing else: `activeClientSince` stays null, so
  the member is still handed off if the flag is later turned on. **Gap to know about:** a member who reaches A2P Approved while the flag
  is off is not handed off retroactively (progress is already at the maximum, so no new event arrives). Those members are exactly the
  `handoff-shadow:` rows; hand them off with the backfill (once their Clients card exists) or by re-sending A2P Approved.

`scripts/billing/backfill-active-client-since.ts` sets `activeClientSince` for members who **already** have a Clients-pipeline opportunity
(read-only `opportunities/search` per member, `GHL_CLIENTS_PIPELINE_ID`). Dry-run by default, production guard like the other backfills;
`--estimate-only` prints the member count and call estimate and exits before any GHL call. A lookup error is listed, never read as "no card".

### Pause timing (B6)

The 15-minute `paused_confirm` requirement is gone — see *Pausing* above. The Paused-stage workflow in GHL only needs to send the card-update message.

### Cuts

- **No echo detection** (B7): an engine move echoing back is just a stage-change whose state already matches (a confirmation).
- **No invoice-event workflow** (B8): the nightly `sub_sweep` invoice check is the source of `invoice_expired`; the route stays, unused.

### Confirmed rules (each has a test in `engineCompletion.test.ts`)

- A payment event never moves an **inactive** or **churned** account ("state excludes action").
- A **manual_killswitch** pause (and a voluntary one) is never auto-resumed by a payment: core success and a recharge with balance ≥ 0 both leave it paused, with no `saas_resume`.
- **trial_ended_unconverted** → `payment_failed` with a core failure open (only from trial; coverage still protects).

## Not built yet

Task 8: switching the mode on, building/disabling the GHL workflows, and removing the old routes — see `docs/cutover.md`.
