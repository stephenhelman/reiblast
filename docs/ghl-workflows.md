# GHL workflows to build (billing engine)

These are the GHL workflows the server depends on. **None of them is needed while `DUNNING_MODE=shadow`** (the engine only records
decisions). Build them (disabled) ahead of cutover; see `docs/cutover.md` for the order. Contract rule 2: server → GHL is *intent only*,
through inbound-webhook workflows; GHL → server is *report-then-interpret* (docs/ghl-server-contract.md).

Stage keys equal `BillingState` values: `trial`, `active`, `payment_failed`, `paused`, `inactive`, `churned`.

## A. Server → GHL: intent receivers

### A1. "Billing intent — Active Client"  (URL → `GHL_INTENT_URL_ACTIVE_CLIENT`)

1. **Trigger:** *Inbound Webhook*. Copy its URL into the env var. Send one test payload from GHL so the fields below can be mapped.
2. **Find the contact:** map by `{{inboundWebhookRequest.contactId}}` (Find/Update Contact, or use the trigger's contact mapping).
3. **If/Else on `{{inboundWebhookRequest.stage}}`** — one branch per stage key:

   | `stage` | Action: *Update Opportunity* in the **Active Client** pipeline → stage |
   |---|---|
   | `trial` | Trial |
   | `active` | Active (Active Member) |
   | `payment_failed` | Failed Payment |
   | `paused` | Paused |
   | `inactive` | Inactive |
   | `churned` | Churned |

   (Use your actual stage names; the *keys* are what the server sends.) A `fields`-only intent carries the account's **current** stage, so the
   Update Opportunity there is a no-op — keep the branch anyway so the contact fields below are refreshed.
4. **After the If/Else — Update Contact Field(s)** (create these custom fields if they do not exist):
   - `pause_reason` ← `{{inboundWebhookRequest.fields.pause_reason}}` (empty when not paused)
   - `trial_offer` ← `{{inboundWebhookRequest.fields.trial_offer}}`
   - `trial_end_date` ← `{{inboundWebhookRequest.fields.trial_end_date}}` (`YYYY-MM-DD`, America/Denver)
5. Publish. The server treats any 2xx as success and retries a non-2xx up to 5 times.

Body the server sends: `{ "contactId": "…", "pipeline": "active_client", "stage": "paused", "fields": { "pause_reason": "non_payment", "trial_offer": null, "trial_end_date": null } }`

### A2. "Billing intent — Onboarding"  (URL → `GHL_INTENT_URL_ONBOARDING`)

Same shape, for the **Onboarding** pipeline. Trigger and contact mapping as in A1; **If/Else on `{{inboundWebhookRequest.stage}}`** — one
branch per key from `lib/billing/onboardingStages.ts` (`ONBOARDING_STAGE_KEYS`), matched **exactly** (case, underscores) — an unmatched key
silently does nothing:

| `stage` key | Action: *Update Opportunity* in the **Onboarding** pipeline → stage |
|---|---|
| `new_client` | New Client |
| `onboarding_form_submitted` | Onboarding Form Submitted |
| `onboarding_form_confirmed` | Onboarding Form Confirmed |
| `sub_account_provisioned` | Sub-Account Provisioned |
| `awaiting_kyc` | Awaiting KYC |
| `kyc_complete` | KYC Complete |
| `a2p_pending` | A2P Pending |
| `a2p_approved` | A2P Approved |
| `blocker_detected` | Blocker Detected |

(Use your actual stage names; the *keys* are what the server sends — same convention as the Active Client table in A1.) These are a
**separate vocabulary from the legacy onboarding stage names** in `lib/constants.ts` (`ONBOARDING_STAGES`), which drive the older
provisioning-email flow and are not sent through this outbox.

Today the only sender is `scripts/billing/place-cards.ts` (card placement, `a2p_approved` for completed members —
docs/cutover.md Phase B step 6); server-driven onboarding moves from the engine itself are not otherwise built.

**Loop safety:** moving an opportunity fires the *Pipeline Stage Changed* workflows in section B, which report the move back. The server
sees the account is already in that state and records a confirmation — no new intent, no loop.

## B. GHL → server: reporters

All requests: `POST`, GHL's **standard/default webhook action payload** (do not override the request body), plus
our fields added as **customData** on that same action. Auth, preferably, is the `x-reiblast-events-secret` header
(`<GHL_EVENTS_SECRET>`); if the webhook action you're using doesn't let you add a custom header, add
`customData.secret` set to `<GHL_EVENTS_SECRET>` instead — the server accepts either, checked timing-safe, and never
stores or logs the secret value (a `customData.secret` field is redacted before the raw payload is ever saved to
`GhlEvent`). The server always answers 200.

### B1. "Stage changed — Active Client"  → `POST /api/webhooks/ghl/stage-changed`
Trigger: *Pipeline Stage Changed* (pipeline = Active Client, any stage — or one workflow per stage). Action: the
standard webhook action, with these added under **customData**:
- `customData.contactId` ← `{{contact.id}}`
- `customData.pipeline` ← the **literal string** `active_client` (hardcoded in this workflow, not a merge field —
  this is what tells the server which pipeline's workflow a given event came from)
- `customData.stage` ← the **key** (table in A1), not the display name: use an If/Else on
  `{{opportunity.pipeline_stage_name}}` to set it, or one workflow per stage with a literal
- `customData.secret` ← only if the header isn't usable on this action (see above)

A manual move by staff is a *command*; an engine move arriving back is a *confirmation*.

### B2. "Stage changed — Onboarding"  → `POST /api/webhooks/ghl/stage-changed`
Trigger: *Pipeline Stage Changed* (pipeline = Onboarding). Same standard-webhook-plus-customData shape as B1:
`customData.contactId` ← `{{contact.id}}`, `customData.pipeline` ← the literal `onboarding`, `customData.stage` ←
`{{opportunity.pipeline_stage_name}}` (the exact stage **name** this time, not a key — see `docs/oct1-release.md`
for the full onboarding stage-name verification list), `customData.secret` if needed. The server stores the stage
name in `GhlAccount.onboardingStage` (display) and advances `GhlAccount.onboardingProgress` only on forward
progress (never for side stages, never guessed for an unrecognized name).

### B3. "Paused — confirm after 15 minutes"  → `POST /api/webhooks/ghl/stage-changed`
1. **Trigger:** *Pipeline Stage Changed* → Active Client / **Paused**.
2. **Wait 15 minutes.**
3. **Webhook:** standard action, customData `{ "contactId": "{{contact.id}}", "pipeline": "active_client", "stage": "paused_confirm" }`
   (plus `secret` if needed). The server pauses the location **only if the account is still paused**; if it was
   cured in the meantime it records "cured before confirmation, no pause".
4. **If/Else:** contact's opportunity is **still in Paused** → *Send Email/SMS* "update your card" message.
   (Keep the message here, not in the server: the server no longer sends comms.)

### B4. "Invoice — expired / voided"  → `POST /api/webhooks/ghl/invoice-event`
Trigger: the *Invoice* trigger, for whichever statuses GHL offers (sent / overdue / voided — GHL has no "expired" status).
Standard webhook action, customData `{ "invoiceId": "{{invoice.id}}" }` (plus `secret` if needed — same fallback as
stage-changed). The server fetches the invoice and acts only on an unpaid, past-due (or void) **core recovery
invoice**; anything else is recorded and ignored. It is safe to over-trigger. The nightly `sub_sweep` re-checks
invoices as a backstop.

### B5. Scheduled jobs  → `POST /api/webhooks/ghl/jobs`
One scheduled workflow per job (existing: `replay`, `tx_sweep`, `wallet_usage`, `balances`), header `x-reiblast-jobs-secret`. **New:**
`{ "job": "sub_sweep" }` nightly.

## C. Existing workflows this replaces at cutover
See `docs/cutover.md` — the old payment-failed → tag/warning, pause, and active workflows and their three webhook routes.
