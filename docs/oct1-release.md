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
