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
   - This workflow is only ever fed by the server when `ONBOARDING_INTENTS=live`; while off, nothing is sent (rows
     are still recorded in `GhlIntent` as `skipped_shadow`) — safe to build and test this workflow before flipping
     the flag.

3. **"Onboarding stage-changed" workflow**: GHL's default stage-change webhook, already assumed configured, posting
   to `POST /api/webhooks/ghl/stage-changed`. The payload contract this code expects (documented in
   `lib/billing/events/stageChanged.ts`):
   ```json
   { "contactId": "<GHL contact id>", "pipeline": "onboarding" | "active_client", "stage": "<exact opportunity stage name>" }
   ```
   `stage` must be the opportunity's new stage **name**, exactly matching one of the strings in the verification
   list below — any other string is treated as unrecognized (onboardingStage display field is still updated, but
   onboardingProgress is left alone and a `GhlEvent` row is written for investigation, never guessed).

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
4. Run the existing `scripts/billing/backfill-ghl-accounts.ts`, then the new
   `scripts/billing/backfill-onboarding-progress.ts` (dry-run first, review the unmapped list, then `--apply`).
5. Set required env vars before/with the deploy:
   - `ONBOARDING_INTENTS=off` (deploy code first with this off; flip to `live` only after verifying shadow output)
   - `GHL_INTENT_URL_ONBOARDING` (already-existing var, reused — confirm it points at the new "Onboarding intent"
     workflow's inbound webhook URL)
   - `GHL_EVENTS_SECRET` (existing shared secret for the stage-changed webhook, reused naming — same one used by
     `app/api/webhooks/ghl/stage-changed/route.ts` and the invoice-event route today)
   - `GHL_CLIENTS_PIPELINE_ID`, `GHL_CLIENTS_STAGE_PAUSED`, `GHL_CLIENTS_STAGE_ACTIVE` (new, item 6)
6. Merge order: migrations must be deployed (step 3) **before** the application code that reads/writes
   `GhlAccount.onboardingProgress`/`onboardingProgressAt` is deployed — a nullable-column add is backward compatible
   for old code, but new code deployed before the column exists will error on every onboarding stage-changed event.
7. After deploy, watch `GhlIntent` rows for the new `onboarding` pipeline kinds — confirm they land as
   `skipped_shadow` with sane payloads before flipping `ONBOARDING_INTENTS=live`.

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
