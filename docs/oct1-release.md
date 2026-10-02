# Oct 1 release: onboarding progress + intents outbox

Scope: lib/billing/stages.ts, GhlAccount.onboardingProgress/onboardingProgressAt, onboarding intents via the
existing GhlIntent outbox (ONBOARDING_INTENTS, independent of DUNNING_MODE), ghl-provision re-provision guard and
failure handling, and a minimal repoint of the legacy payment-failed/active routes at the Clients pipeline.

## (a) GHL-side changes

1. **SaaS payment workflow** should be reduced to the one webhook it already calls (`POST /api/webhooks/ghl`,
   `app/api/webhooks/ghl/route.ts`). No GHL-side change needed beyond confirming no other workflow also fires a
   duplicate payment-received call into this route.

2. **New "Onboarding intent" workflow** (a human builds this in GHL — this is the spec, not a build-it-here task):
   - Trigger: inbound webhook, URL = `GHL_INTENT_URL_ONBOARDING` (reused from the existing outbox — see
     `lib/billing/intents/send.ts`).
   - Body it receives (`PlacementBody` in `lib/billing/intents/send.ts`):
     ```json
     { "contactId": "...", "pipeline": "onboarding", "stage": "new_client" | "onboarding_form_submitted" | "sub_account_provisioned", "fields": { "pause_reason": null, "trial_offer": null, "trial_end_date": null } }
     ```
   - If/Else branch on `stage` (the snake_case outbox key, NOT the pipeline's display stage name — see
     `lib/billing/onboardingStages.ts` for the full list of keys this outbox can send, though this release only
     ever sends `new_client`, `onboarding_form_submitted`, `sub_account_provisioned`).
   - Action per branch: Create/Update Opportunity in the onboarding pipeline, setting the stage to the matching
     display name from the table below.
   - **Timing dependency at cutover, read this carefully:** the code no longer moves the "Onboarding Form
     Submitted"/"Sub Account Provisioned" cards directly — those `moveToStage` calls were replaced with these
     intents in an earlier round. That means **intents must be live (`ONBOARDING_INTENTS=live`) from the moment this
     code deploys to production**, not shadow-first: shadow-first would mean no card ever gets created for those two
     transitions during the shadow window (a gap, not a safe default, now that the old direct-move path is gone).
     Validate the workflow itself on GHL's **Preview/staging environment** first — set `ONBOARDING_INTENTS=live`
     scoped to Preview only, confirm cards move correctly there — then deploy to production with
     `ONBOARDING_INTENTS=live` set from the start. See the rollout steps in (b) below.
   - **SaaS payment workflow timing dependency:** the SaaS workflow's own "Create Opportunity" action (the one that
     today directly creates the onboarding card on payment) must be **removed at the exact moment `ONBOARDING_INTENTS`
     goes live in production** — the server's `new_client` intent now replaces that action. Removing it earlier
     (before intents are live) means no card gets created for that window; removing it later (after intents are
     already live) creates a duplicate card per new payment. There is no safe straddle — this is a single atomic
     cutover moment, not a gradual one.

3. **"Onboarding stage-changed" / "Clients stage-changed" workflows**: build **one GHL workflow per pipeline** (two
   total — one for `onboarding`, one for `active_client`), each on GHL's standard/default "pipeline stage changed"
   webhook trigger, posting to `POST /api/webhooks/ghl/stage-changed`. **Do not override GHL's default request body**
   — add the fields this code needs as **customData** on the standard webhook action instead:
   - `customData.contactId` — the contact id merge field
   - `customData.pipeline` — a **hardcoded literal** per workflow (`"onboarding"` in the onboarding-pipeline
     workflow, `"active_client"` in the Clients-pipeline workflow) — NOT a merge field; this is what distinguishes
     the two workflows' events once they land in the same route
   - `customData.stage` — the opportunity's new stage name merge field
   - `customData.secret` — the shared secret (`GHL_EVENTS_SECRET`), **only if** the `x-reiblast-events-secret`
     header isn't configurable on this webhook action (see the auth note below) — omit it if the header works, since
     a header is preferred over a body field for a secret
   The payload contract this code expects (documented in `lib/billing/events/stageChanged.ts` and
   `lib/billing/events/payloadFields.ts`):
   ```json
   { "...GHL's own default fields...": "...", "customData": { "contactId": "<GHL contact id>", "pipeline": "onboarding" | "active_client", "stage": "<exact opportunity stage name>" } }
   ```
   `contactId`/`pipeline`/`stage` are read from `customData` first; a flat top-level field of the same name is only
   a fallback for manual/curl testing with an unwrapped body — don't rely on it for the real GHL workflow. `stage`
   must be the opportunity's new stage **name**, exactly matching one of the strings in the verification list below
   — any other string is treated as unrecognized (onboardingStage display field is still updated, but
   onboardingProgress is left alone and a `GhlEvent` row is written for investigation, never guessed).
   **Auth:** the existing `payment-failed` workflow authenticates via a custom header
   (`x-reiblast-secret`/`GHL_WEBHOOK_SECRET`, checked in `lib/ghl/verifyWebhook.ts`), which assumes GHL's webhook
   action on that workflow supports adding a custom header. If the standard/default webhook action on your GHL plan
   does **not** expose custom headers (this can vary by plan/action type — confirm in the GHL workflow builder before
   relying on either path), use the `customData.secret` fallback above instead: the server accepts **either** the
   `x-reiblast-events-secret` header **or** a matching `customData.secret` value (timing-safe compared either way;
   never logged; redacted to `"[redacted]"` before the raw payload is ever stored in `GhlEvent`). Prefer the header
   when it's available — a body-carried secret is inherently slightly more exposed (visible in GHL's own workflow
   logs/history) than a header.

4. **Active/Pause workflows** (today: `app/api/webhooks/ghl/payment-failed/route.ts`,
   `app/api/webhooks/ghl/pause/route.ts`, `app/api/webhooks/ghl/active/route.ts`) should be retriggered based on the
   Clients-pipeline stages, not the legacy single onboarding pipeline. See item 6 below for the exact env vars.

5. **Deprecate in GHL** once this ships: any old workflow that directly moved opportunities on payment-received /
   form-submitted / sub-account-provisioned events is superseded by the new intents going through the "Onboarding
   intent" workflow above — those old direct-move workflows should be disabled to avoid double-moving the same
   opportunity (code-side, the direct `moveToStage` calls for those three events have already been removed from
   `app/api/webhooks/ghl/route.ts`, `app/api/onboarding/submit/route.ts`, and `app/api/webhooks/ghl-provision/route.ts`
   in this change).

### Stage name verification list (exact strings — check against GHL)

Onboarding pipeline, progress order:

| # | Stage name |
|---|---|
| 1 | `New Client` |
| 2 | `Onboarding Form Submitted` |
| 3 | `Onboarding Form Confirmed` |
| 4 | `Sub Account Provisioned` |
| 5 | `Awaiting KYC` |
| 6 | `KYC Complete` |
| 7 | `A2P Pending` |
| 8 | `A2P Approved` |

Onboarding side stages (never change progress): `Blocker Detected`, `Payment Failed`, `Paused`

Clients pipeline: `Trial`, `Active Member`, `Payment Failed`, `Paused`, `Inactive`, `Churned`

Note `Payment Failed` and `Paused` exist in **both** pipelines as distinct stage identities
(`lib/billing/stages.ts` `stageIdentity(pipeline, stageKey)`).

## (b) Production rollout steps

1. Take a **fresh** Neon branch off production for migration rehearsal (not a stale/reused branch).
2. On that fresh branch, run `prisma migrate deploy` and diff the `_prisma_migrations` table against
   production/main to confirm parity before touching anything else.
3. Only then run `prisma migrate deploy` (never `migrate dev`) against production itself.
4. On that SAME fresh production-rehearsal branch, run BOTH backfill scripts — `scripts/billing/backfill-ghl-accounts.ts`
   then `scripts/billing/backfill-onboarding-progress.ts` — in dry-run first, and compare the counts against what the
   same scripts produced on the pipeline branch (reported to this doc's author as **82 floored via the
   `provisionedFloor` path / 1 mapped / 0 unmapped**, but note: that pipeline-branch figure was NOT independently
   verified by the agent that wrote this doc — every attempt to run these scripts against a real database in that
   session was blocked by the environment's own permission system, so this number is secondhand and should be
   treated as "what to compare against, pending confirmation" rather than a verified baseline). A rehearsal run with
   materially different counts needs explaining before proceeding, not just applying — and if the "82/1/0" figure
   itself can't be traced to an actual dry-run log, get that log before trusting the comparison at all. Only after
   that comparison checks out, run both against production for real (`--apply`).
5. Set required env vars before/with the deploy:
   - **`BILLING_DB_TARGET=prod`, set in the Production environment ONLY — this is now LOAD-BEARING, not optional.**
     `getBillingDb()`'s runtime production guard (`lib/billing/db.ts`, `scripts/billing/_cli.ts`) is committed as of
     `billing: explicit production mode for scripts and getBillingDb`, so every billing route — including
     stage-changed, invoice-event, and the payment-event webhook — now calls `getBillingDb()`, which **refuses to
     resolve the production database at all unless `BILLING_DB_TARGET=prod` is set**. Without it, these routes fail
     closed in production (not silently misbehave — they throw/refuse), which is exactly the point of the guard, but
     it means this var is no longer a nice-to-have: forgetting it breaks production outright rather than leaving an
     old insecure default running.
   - **`ONBOARDING_INTENTS=live` from the start** — do NOT deploy with it `off`/shadow-first. The code no longer
     moves form-submitted/provisioned cards directly (superseded by intents in an earlier round), so shadow-first
     would mean no card is created for those transitions during the shadow window. Validate the "Onboarding intent"
     workflow on GHL's Preview/staging environment first (scoped `ONBOARDING_INTENTS=live` there), then deploy to
     production already live. See the timing-dependency note in (a) item 2.
   - `GHL_INTENT_URL_ONBOARDING` (already-existing var, reused — confirm it points at the new "Onboarding intent"
     workflow's inbound webhook URL)
   - `GHL_EVENTS_SECRET` (existing shared secret for the stage-changed webhook, reused naming — same one used by
     `app/api/webhooks/ghl/stage-changed/route.ts` and the invoice-event route today; also the value the GHL
     workflow's `customData.secret` fallback must match, if that fallback path is used instead of a header)
   - `GHL_CLIENTS_PIPELINE_ID`, `GHL_CLIENTS_STAGE_PAUSED`, `GHL_CLIENTS_STAGE_ACTIVE` (new, item 6)
   - `GHL_ONBOARDING_STAGE_PAUSED` (new, item 6 — the onboarding pipeline's own "Paused" side-stage id)
   - `GHL_ONBOARDING_PIPELINE_ID` (existing var, reused by item 6's no-Clients-card fallback) — **before deploy,
     explicitly confirm this value points at the CURRENT/new onboarding pipeline, not a legacy/old pipeline id left
     over from an earlier GHL setup.** A stale value here would silently misfile the item-6 fallback moves.
6. Merge order: migrations must be deployed (step 3) **before** the application code that reads/writes
   `GhlAccount.onboardingProgress`/`onboardingProgressAt` is deployed — a nullable-column add is backward compatible
   for old code, but new code deployed before the column exists will error on every onboarding stage-changed event.
7. After deploy, watch `GhlIntent` rows for the new `onboarding` pipeline kinds — confirm they're actually sending
   (not `skipped_shadow`, since intents are live from the start per step 5) and that payloads look sane.
8. **Pre-flight sanity check before merging this branch to main** (this branch also carries out-of-scope admin/jobs
   work that will ship to production as a side effect of the merge): confirm `/admin` still 404s in production —
   i.e. `ADMIN_PATH_ACCESS` is unset in the Production environment, and no dedicated admin domain
   (`admin.reiblast.app` or similar) is configured there yet — and confirm nothing is scheduled/cron'd to call the
   production jobs routes yet. Neither of those should be live in production until they're each deliberately turned
   on; merging this branch must not be what turns them on by accident.

## Item 6: legacy dunning routes repointed at the Clients pipeline

`moveToStage()` (`lib/ghl.ts`) is hardcoded to the single onboarding pipeline
(`GHL_ONBOARDING_PIPELINE_ID` + `ONBOARDING_STAGE_IDS`), so pointing the legacy routes at Clients-pipeline stages is
**not** env-var-only — it requires the minimal code change of calling the existing `moveOpportunityToStage(contactId,
pipelineId, stageId, name)` helper instead, which already takes a pipeline/stage id pair directly. This was the
minimal change made:

- `app/api/webhooks/ghl/payment-failed/route.ts`: 3rd-strike now calls
  `moveOpportunityToStage(contactId, GHL_CLIENTS_PIPELINE_ID, GHL_CLIENTS_STAGE_PAUSED, name)` instead of
  `moveToStage(contactId, ONBOARDING_STAGES.PAUSED, name)`.
- `app/api/webhooks/ghl/active/route.ts`: now calls
  `moveOpportunityToStage(user.ghlContactId, GHL_CLIENTS_PIPELINE_ID, GHL_CLIENTS_STAGE_ACTIVE, name)` — previously
  this route made no stage move at all.
- `app/api/webhooks/ghl/pause/route.ts`: unchanged (it never moved a stage; it only pauses the sub-account).

**Updated (no longer creates a phantom Clients card):** a member with no Clients-pipeline opportunity yet — never
handed off via A2P Approved — previously would have had a brand-new Clients-pipeline card silently created directly
in "Paused"/"Active Member" (skipping Trial/Active Member). This is now guarded: both routes first call the new
read-only `hasOpportunityInPipeline(contactId, pipelineId)` (`lib/ghl.ts`) against `GHL_CLIENTS_PIPELINE_ID`.

- `payment-failed` 3rd-strike: if a Clients card exists, move it to `GHL_CLIENTS_STAGE_PAUSED` as before. If not,
  move their *existing* Onboarding-pipeline card into the onboarding pipeline's own "Paused" SIDE stage instead,
  via `moveOpportunityToStage(contactId, GHL_ONBOARDING_PIPELINE_ID, GHL_ONBOARDING_STAGE_PAUSED, name)`. This is a
  distinct stage identity from the Clients-pipeline "Paused" (`lib/billing/stages.ts` `stageIdentity`).
- `active`: if a Clients card exists, move it to `GHL_CLIENTS_STAGE_ACTIVE` as before. If not, **do nothing** —
  resuming a paused ONBOARDING member back into onboarding progress is a **manual action for Oct 1, not
  automated**. (There is no onboarding-pipeline "Active" side stage to move them to automatically; someone must
  manually move the card forward in GHL.)

**GHL workflow configuration implication:** the "Pause" workflow must be configured to trigger on the "Paused"
stage in **both** pipelines (onboarding and Clients) — not just the Clients one — since a payment-failure pause can
now land a card in either pipeline's "Paused" stage depending on whether the member has been handed off yet.

New env vars (exact names, no defaults — must be set before these routes can move opportunities):
```
GHL_CLIENTS_PIPELINE_ID=
GHL_CLIENTS_STAGE_PAUSED=
GHL_CLIENTS_STAGE_ACTIVE=
GHL_ONBOARDING_STAGE_PAUSED=   # pipeline id reuses the existing GHL_ONBOARDING_PIPELINE_ID
```

## Clients-pipeline stage changes via stage-changed webhook

`processStageChanged`'s `active_client` branch is unchanged: it continues to feed `applyDunning` exactly as before.
This is intentional — "Clients-pipeline changes recorded only, no action" in the task prompt refers to not adding
new *onboarding-side* actions when a Clients-pipeline card moves, not to removing the existing dunning hookup, which
remains the only consumer of `active_client` stage-changed events.

## (c) Production command sheet (copy-paste order)

These use the ACTUAL production-mode mechanisms as committed this session — read directly from `scripts/billing/_cli.ts`
(`assertProductionGuard`/`connect()`) and `prisma.config.ts` (`PRISMA_TARGET`), not guessed. `$PROD` below stands for the
production database's **direct (non-pooled)** connection string — never write the real value into this doc, a shell
history file, or anywhere else; export it into your shell session only.

**(a) Migration status check:**
```sh
PRISMA_TARGET=prod npx prisma migrate status
```
Expected: every migration up through `20261001031302_add_onboarding_progress` (the one this release adds) listed as
**not yet applied** if run before step (b); after step (b), `_prisma_migrations` should show it applied and `prisma
migrate status` should report the database schema is up to date with no pending migrations — parity with what the
fresh production-rehearsal Neon branch showed in item (b)'s rehearsal (see (b) step 2 above: diff `_prisma_migrations`
there against `main` first, and don't run this against real production until that diff is clean).

**(b) Deploy the migration (never `migrate dev` here):**
```sh
PRISMA_TARGET=prod npx prisma migrate deploy
```
Expected output: `Applying migration 20261001031302_add_onboarding_progress` (and any other pending ones in order),
ending "All migrations have been successfully applied." Re-run `prisma migrate status` (command a) immediately after
to confirm zero pending.

**(c) Backfill existing GhlAccount rows — dry-run, then apply:**
```sh
DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/backfill-ghl-accounts.ts --i-mean-production
# review the printed counts, then:
DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/backfill-ghl-accounts.ts --i-mean-production --apply
```
Both invocations are interactive: `connect()` (`scripts/billing/_cli.ts`) will print the resolved host and database
and prompt `Type the host name to confirm:` — type the production host exactly as printed, or it refuses. **Expected
dry-run output (from the rehearsal on the fresh production branch): 89 accounts, 0 duplicates.** A rehearsal result
that differs from this is a stop-and-explain condition per the rollout steps in (b) above, not something to apply
through.

**(d) Backfill onboarding progress — dry-run, then apply:**
```sh
DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/backfill-onboarding-progress.ts --i-mean-production
# review the printed counts (especially the "provisionedFloor" and "unmapped" listings), then:
DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/backfill-onboarding-progress.ts --i-mean-production --apply
```
**Expected dry-run output, as reported for the rehearsal: 84 floored (via the `provisionedFloor` path), 1 mapped, 0
unmapped.** Flagging explicitly, per this doc's own earlier instruction to call out any discrepancy rather than
silently picking a number: an EARLIER round of this same work was told the rehearsal figure was **82 floored / 1
mapped / 0 unmapped**; this round states **84 floored**, with no explanation given for the change between the two
reports. Neither figure has been independently verified by whoever has been writing this doc — every attempt made in
this engagement to run these scripts against a real database was blocked by the environment's own permission system
(see the open items below). **Do not treat 84 (or 82) as ground truth.** Before running the real dry-run against
production, re-run this same dry-run against a fresh rehearsal branch and use whatever number it actually prints —
if it's neither 82 nor 84, that itself is worth understanding before proceeding, since it would mean the GhlAccount
data has materially changed between whenever these numbers were generated and now.

## (d) Production environment variables (Vercel, Production scope)

| Variable | Value / source |
|---|---|
| `DATABASE_URL` | Existing production Neon connection string, unchanged. |
| `BILLING_DB_TARGET` | `prod` — **new, load-bearing** (see (b) step 5). Without it `getBillingDb()` refuses every billing route in production. |
| `GHL_AGENCY_ID` | Existing value, unchanged. |
| `GHL_SNAPSHOT_ID` | Existing value, unchanged. |
| `GHL_AGENCY_API_KEY` | Existing value, unchanged. |
| `GHL_HQ_API_KEY` | Existing value, unchanged. |
| `GHL_HQ_LOCATION_ID` | Existing value, unchanged. |
| `GHL_COMPANY_ID` | Existing value, unchanged. |
| `GHL_ONBOARDING_PIPELINE_ID` | **`Ox3gM3rk5sb2IQWcNane`** — the NEW "Onboarding (New)" pipeline, confirmed via a direct GHL API lookup the user ran themselves. **This is a repoint, not a no-op**: the value currently configured is presumed to be the OLD "Onboarding" pipeline, id `xBkcR6CZjBhSc6M9GlCy` — see the caller audit below for who still depends on the old id/stage pairing before flipping this. |
| `GHL_WEBHOOK_SECRET` | Existing value, unchanged. |
| `GHL_FROM_EMAIL` | Existing value, unchanged. |
| `GHL_OTP_WEBHOOK_URL_ONBOARDING` / `GHL_OTP_WEBHOOK_URL_TOOLS` | Existing values, unchanged. |
| `GHL_STAGE_*` (legacy onboarding stage ids: `PAYMENT_RECEIVED`, `ONBOARDING_FORM_SENT`, `ONBOARDING_FORM_SUBMITTED`, `ONBOARDING_CONFIRMED`, `SUB_ACCOUNT_PROVISIONED`, `CREDENTIALS_SENT`, `A2P_SUBMITTED`, `ACTIVE`, `PAUSED`) | Existing values, unchanged — still used by the legacy `moveToStage()`/`lib/constants.ts` path. |
| `RENTCAST_API_KEY`, `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`, `ANTHROPIC_API_KEY` | Existing values, unchanged. |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_TOOLS_URL`, `NEXT_PUBLIC_GHL_APP_URL`, `NEXT_PUBLIC_MENTORSHIP_URL` | Existing values, unchanged. |
| `GHL_BILLING_WEBHOOK_SECRET` | Existing value, unchanged (payment-event webhook). |
| `GHL_JOBS_SECRET` | Existing value, unchanged (nightly jobs). |
| `JOBS_TIME_BUDGET_MS`, `JOBS_BASE_URL` | Existing values (or unset for defaults), unchanged. |
| `ADMIN_SESSION_SECRET`, `ADMIN_TOTP_SECRET`, `ADMIN_LOCATION_IDS`, `ADMIN_PROCESSOR_FEE_PCT`, `NEON_STORAGE_LIMIT_MB` | Existing values, unchanged. |
| `ADMIN_PATH_ACCESS` | **Must stay unset in Production** (preview-only convenience) — see the pre-merge sanity check in (b) step 8. |
| `DUNNING_MODE` | `shadow`, unchanged, explicit. |
| `DUNNING_LIVE_ACCOUNTS` | Existing value (empty unless a canary is live), unchanged. |
| `GHL_EVENTS_SECRET` | Existing value, unchanged — also the value a GHL workflow's `customData.secret` fallback must match if used. |
| `GHL_INTENT_URL_ACTIVE_CLIENT` | Existing value, unchanged. |
| `GHL_INTENT_URL_ONBOARDING` | Existing value — confirm it points at the new "Onboarding intent" workflow's inbound webhook URL (see (a) item 2). |
| `ONBOARDING_INTENTS` | **New — set to `live` at deploy time, not `off`** (see (b) step 5's timing dependency; do not shadow-first this one). |
| `GHL_CLIENTS_PIPELINE_ID` | **`7Sk73ThiajsaGMcQNaPx`** — confirmed via the user's own direct GHL API lookup. |
| `GHL_CLIENTS_STAGE_PAUSED` | **`e2b9c89a-ac72-4404-874e-2f8dc70a7a46`** |
| `GHL_CLIENTS_STAGE_ACTIVE` | **`26b75fe5-8543-4cfe-a785-86405f8c51f0`** |
| `GHL_ONBOARDING_STAGE_PAUSED` | **`926ab9b6-e661-48a8-8a2f-7d8b07e584f6`** — a stage id within the NEW onboarding pipeline (`Ox3gM3rk5sb2IQWcNane`), paired consistently with the `GHL_ONBOARDING_PIPELINE_ID` value above. |

### GHL pipeline/stage ID lookup — completed (user-supplied, not agent-executed)

The values above came from the user running the lookup directly against GHL (not a live call made by this agent —
see the prior round's report for why that call was declined when it arrived as a relayed instruction rather than the
user's own words). Two onboarding pipelines exist in GHL right now, and they must not be confused:

| Pipeline | id | Role |
|---|---|---|
| **"Onboarding (New)"** | `Ox3gM3rk5sb2IQWcNane` | The pipeline this release's code actually targets (`lib/billing/stages.ts` `ONBOARDING_PROGRESS_STAGES`/`ONBOARDING_SIDE_STAGES`). This is what `GHL_ONBOARDING_PIPELINE_ID` must point at. |
| **"Onboarding"** (OLD) | `xBkcR6CZjBhSc6M9GlCy` | The legacy pipeline `lib/constants.ts` (`ONBOARDING_STAGES`/`ONBOARDING_STAGE_IDS`) was built against. Presumed to be what `GHL_ONBOARDING_PIPELINE_ID` currently points at in production today — **see the caller audit below before repointing this var**, since at least one live code path still depends on the OLD pipeline/stage-id pairing. |

**Stage-name typo to fix before go-live**: the new pipeline's first stage is currently named **"New CLient"** (capital
L) in GHL. `lib/billing/stages.ts` expects the exact string `"New Client"` — `isKnownOnboardingStage`/`progressRank`
do exact string matches only, so as-is, every contact landing in that first stage would hit the stage-changed
handler's "unrecognized stage" path (onboardingStage display field still updates, but onboardingProgress is never
set and a `GhlEvent` is logged for investigation) instead of being recognized as the start of onboarding progress.
**Rename the GHL stage to "New Client" before go-live** — do not change the code to match the typo.

### Caller audit: what breaks if `GHL_ONBOARDING_PIPELINE_ID` moves from the OLD to the NEW pipeline

Every remaining reader of `GHL_ONBOARDING_PIPELINE_ID` or any `GHL_STAGE_*` var (found via `grep -rn` across
`app/`, `lib/`, `scripts/` — nothing in `scripts/` reads either):

1. **`lib/ghl.ts` `moveToStage(contactId, stage, name)`** — reads `GHL_ONBOARDING_PIPELINE_ID` as the pipeline to
   search/create/update an opportunity in, and looks up the target stage id via `ONBOARDING_STAGE_IDS[stage]`
   (`lib/constants.ts`, backed by the eight `GHL_STAGE_*` vars: `PAYMENT_RECEIVED`, `ONBOARDING_FORM_SUBMITTED`,
   `ONBOARDING_CONFIRMED`, `SUB_ACCOUNT_PROVISIONED`, `CREDENTIALS_SENT`, `A2P_SUBMITTED`, `ACTIVE`, `PAUSED`). Those
   eight stage ids are presumed to be stage ids **within the OLD pipeline** (`xBkcR6CZjBhSc6M9GlCy`) — they predate
   the new pipeline's existence, and the new pipeline's stage list (`lib/billing/stages.ts`) has no equivalent
   stages for several of them at all (no "Payment Received," "Credentials Sent," or "A2P Submitted" stage exists in
   the new 8-stage onboarding-progress model, which starts at "New Client").
   **Only one live caller remains**: `app/api/webhooks/ghl/route.ts` line 65, `moveToStage(contactId,
   ONBOARDING_STAGES.PAYMENT_RECEIVED, name)` — the SaaS payment webhook's stage move, still active (per item (a)/1
   above, this webhook is kept, only its duplicate-workflow concern was raised, not this call). The other seven
   `ONBOARDING_STAGE_IDS` keys are currently **dead** — nothing in the codebase calls `moveToStage` with any stage
   other than `PAYMENT_RECEIVED` anymore (the submit/provision routes were switched to the intents outbox earlier
   this release).
   **VERDICT: WAS "WOULD BREAK" — NOW RESOLVED: call removed.** The `moveToStage(contactId,
   ONBOARDING_STAGES.PAYMENT_RECEIVED, name)` call in `app/api/webhooks/ghl/route.ts` has been deleted entirely
   (the "retire the call" option, not the `GHL_LEGACY_ONBOARDING_PIPELINE_ID` option). The `new_client` intent that
   route already enqueues (sent when `ONBOARDING_INTENTS=live`) is now the sole mechanism that creates/moves the New
   Client card for this route — confirmed by a route test asserting `moveToStage` is never called
   (`lib/billing/__tests__/onboardingWebhookRoutes.test.ts`). A re-grep across `app/`, `lib/`, `scripts/` turns up
   **zero remaining callers of `moveToStage()` anywhere** (only a stale code comment and an unrelated docblock
   mention it by name) — `ONBOARDING_STAGE_IDS` (`lib/constants.ts`) and `moveToStage()` itself (`lib/ghl.ts`) are
   left in place as deferred dead-code cleanup, per this round's scope, but since nothing calls `moveToStage()`
   anymore, the `GHL_ONBOARDING_PIPELINE_ID` / old-pipeline-`GHL_STAGE_*` pairing inside its body can never actually
   execute — the mismatch risk is eliminated in practice, not just worked around.

2. **`app/api/webhooks/ghl/payment-failed/route.ts`'s no-Clients-card fallback** (`moveOpportunityToStage(contactId,
   process.env.GHL_ONBOARDING_PIPELINE_ID, process.env.GHL_ONBOARDING_STAGE_PAUSED, name)`) — **NO BREAK**. This
   round's values pair `GHL_ONBOARDING_PIPELINE_ID` (new pipeline) with `GHL_ONBOARDING_STAGE_PAUSED`
   (`926ab9b6-e661-48a8-8a2f-7d8b07e584f6`, itself a stage within the new pipeline per the user's lookup) —
   consistent, no mismatch.

3. **`app/api/webhooks/ghl/active/route.ts`** and **`app/api/webhooks/ghl/payment-failed/route.ts`'s Clients-card
   branch** — both use `GHL_CLIENTS_PIPELINE_ID`/`GHL_CLIENTS_STAGE_*`, entirely separate from the onboarding
   pipeline question. **NO BREAK**, unaffected either way.

4. **`app/api/chat/lead/route.ts`** — uses its own, unrelated `GHL_SALES_PIPELINE_ID` / `GHL_STAGE_SALES_NEW_LEAD`
   (a Sales pipeline, not onboarding at all). **NO BREAK**, unaffected.

5. **`app/api/webhooks/ghl-provision/route.ts`, `app/api/onboarding/submit/route.ts`** — their direct `moveToStage`
   calls were already removed earlier this release in favor of the intents outbox; grep confirms no `moveToStage`/
   `GHL_ONBOARDING_PIPELINE_ID` reference remains in either file. **NO BREAK**, not a caller anymore.

## B2 — seed billing states in production

`scripts/billing/seed-billing-state.ts` sets `GhlAccount.billingState` once, for members whose state is still null. Same
production guard as the backfills in (c): `BILLING_DB_TARGET=prod` + `--i-mean-production` + typing the host. Dry-run is the
default; nothing is written without `--apply`.

**Prerequisites:** `GhlSubscriptionState` is populated (sub_sweep has run at least once — the script stops with an error if
it is empty), and the ledger is loaded (`BillingLedgerEntry` has succeeded wallet recharges).

**Inputs, as run in production:**
- Subscriptions: read from `GhlSubscriptionState`. It has no creation time, so a contact with several subscriptions is
  resolved by liveness (active > trialing > unpaid > paused > expired > canceled > incomplete_expired). Passing a
  `<subscriptions.json>` path instead uses the old pull file (newest by `createdAt`).
- Recent activity (paused vs churned for paused/expired/canceled/incomplete_expired): `WalletTransaction` when the location
  has any rows (preferred); otherwise succeeded `wallet_auto_recharge`/`wallet_manual_recharge` ledger entries in the
  trailing 30 Denver days. Production has no `WalletTransaction` rows, so expect the ledger path. If the ledger has no
  succeeded recharges at all the account is left null and listed (never guessed as churned).

Rules: never overwrites a non-null `billingState` (listed under "Skipped — DB state wins"); members only; `trialOffer`
only for names matching `/\d+\s*Day Trial/i`; `unpaid` → `payment_failed`; `trialing` → `trial`; `active` → `active`;
recent activity → `paused` (`non_payment`, `legacyUnreconciled`); none → `churned` (`legacyUnreconciled`).

**Dry-run, then apply:**
```sh
DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/seed-billing-state.ts --i-mean-production
# review the output, then:
DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/seed-billing-state.ts --i-mean-production --apply
```
Both prompt `Type the host name to confirm:` — type the host exactly as printed.

**What to expect from the dry-run:**
- Header: `Target: PRODUCTION (confirmed)`, `Mode: dry-run`, then `Subscription source: GhlSubscriptionState (N rows)` and
  `Activity sources: WalletTransaction rows for 0/<locations> locations; ledger has succeeded wallet recharges (...)`.
  If it says `ledger has NO succeeded wallet recharges`, stop: paused/expired/canceled members would all be left null.
- `Would apply W writes`, the `Outcomes` tally, and `Final billingState distribution`. Every member with a subscription
  should land in `trial`, `active`, `payment_failed`, `paused/non_payment`, or `churned`.
- Review: "Skipped — DB state wins" (accounts already holding a state, e.g. from the backfills), "Left null" lists (should be
  empty or explainable), `GhlAccounts with no subscription`, and `trialOffer values set` (only real "N Day Trial" names).
- `--apply` re-prints the same report, writes W rows, and ends with `Done.` Re-running is safe: seeded accounts are then
  skipped as "DB state wins".
