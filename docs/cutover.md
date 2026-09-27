# Cutover (Task 8) — DRAFT for review

Status: **draft.** Nothing in here has been done. Until cutover the old routes and their GHL workflows stay in charge and the engine runs in
shadow mode (`DUNNING_MODE` unset/`shadow`): it records decisions and `skipped_shadow` intents only.

## 1. What changes

| | Before (today) | After |
|---|---|---|
| Who counts strikes / decides pauses | `payment-failed` route + `User.warningCount` | the engine (`GhlAccount`, `DunningDecision`) |
| Who pauses / resumes the location | `pause` / `active` routes (`pauseLocation` / `unpauseLocation`) | the engine: resume on cure, pause only on `paused_confirm` |
| Who moves GHL pipeline stages | GHL workflows + the routes' `moveToStage` | the engine's intents → the "Billing intent" workflow |
| What gates tools access | `User.status` | still `User.status` (mirrored by the engine) until the tools repoint |

## 2. GHL workflows

**Build (new — details in `docs/ghl-workflows.md`), disabled until step 6:**
1. Billing intent — Active Client (inbound webhook → If/Else stage → Update Opportunity → Update contact fields) → `GHL_INTENT_URL_ACTIVE_CLIENT`
2. Billing intent — Onboarding → `GHL_INTENT_URL_ONBOARDING`
3. Stage changed — Active Client → `/api/webhooks/ghl/stage-changed`
4. Stage changed — Onboarding → `/api/webhooks/ghl/stage-changed`
5. Paused — confirm after 15 minutes (wait 15 → `paused_confirm` → if still Paused, send the card-update message)
6. Invoice — expired / voided → `/api/webhooks/ghl/invoice-event`
7. Scheduled: `sub_sweep` nightly (next to the existing four)

**Disable at cutover (the old dunning path — record their current configuration first so rollback is exact):**
1. The workflow that POSTs to `/api/webhooks/ghl/payment-failed` (payment success/failure → warning count + `payment_failed` tag)
2. The workflow that POSTs to `/api/webhooks/ghl/pause` (moved to Paused → pause the location)
3. The workflow that POSTs to `/api/webhooks/ghl/active` (moved to Active → reset warnings / unpause)
4. GHL's own "raw payment-failed → Failed Payment stage" workflow (the engine's `payment_failed` intent sets that stage now)
5. Any workflow that sends the card-update message on entering Paused (replaced by workflow 5 above)

The old **routes** stay deployed (returning as they do today) until the soak after cutover ends, then are removed in a separate change.
The payment-event webhook (`/api/webhooks/ghl/payment-event`) and all nightly jobs are unchanged and stay enabled.

## 3. Sequence

**0. Preconditions.** All migrations deployed to the production database (`GhlAccount`, `GhlIntent`, `GhlSubscriptionState`,
`DunningDecision`, `BillingLedgerEntry`, …); Vercel env set; the historical ledger loaded and the wallet-usage/balances jobs running.

**1. Deploy in shadow.** Ship the code with `DUNNING_MODE` unset. Confirm the payment webhook's dual-write is creating `GhlAccount` rows for new
members (Health / a spot check) and that the shadow hook records decisions after each payment.

**2. Seed and analyse.** Run `sub_sweep` (first run seeds only; review what it would emit), `replay-dunning.ts --apply` (analysis rows), and
seed `GhlAccount.billingState` for members still `null`. Review Health → Dunning.

**3. Soak in shadow (≥ 1–2 weeks).** Compare, per account, the shadow decisions against what the old routes actually did (`User.status`,
`warningCount`, `Transaction`). Every mismatch is either a bug to fix or an intended difference to accept (e.g. auto-resume on a
recharge that clears the balance, the 15-minute pause debounce). Health's "differs" count should be small and explained.

**4. Build the GHL workflows** (section 2), still disabled; send test payloads to `stage-changed` / `invoice-event` and confirm
`GhlEvent` rows and decisions appear.

**5. Canary.** Pick one test account. Exclude it from the old workflows (or accept that both paths act on it), set
`DUNNING_LIVE_ACCOUNTS=<that account>`, enable workflows 1 and 3–6, then set `DUNNING_MODE=live`. Only the canary is acted on; every other
account is still shadow. Drive it through: failed recharge with a negative balance ×3 → paused intent → 15 minutes → `saas_pause`; a
recharge that clears the balance → resume; a manual stage move; a canceled subscription. Check the decision rows, the intents (`sent`), the
GHL stage, the location's pause state and `User.status` at each step.

**5b. Widen.** Add accounts to `DUNNING_LIVE_ACCOUNTS` in stages (a handful, then a batch, then all). Watch Health (failed intents, failed
events, unexpected decisions) between stages.

**6. Cut over.** With everyone allowlisted: disable the old workflows (section 2), enable the new ones, confirm no double action on a
test payment. Leave the old routes deployed and inert for the soak period.

**7. After.** Remove the old routes and the `Transaction` dedupe path; keep `User.status` mirroring until the tools app reads
`GhlAccount`; then drop the mirror and the `User.warningCount` writes.

## 4. Rollback
At any point: set `DUNNING_MODE=shadow` (or empty `DUNNING_LIVE_ACCOUNTS`) — the engine stops persisting and acting immediately; then
re-enable the old workflows and disable the new ones. Effects already executed (a pause, a stage move) are not undone automatically:
`GhlAccount`/`User` keep the last persisted state, so re-check paused accounts by hand (`DunningDecision` mode `live` lists them).

## 5. Open decisions for review
- GHL stage **names** for each stage key (the workflow tables use placeholders).
- Whether the card-update message stays in the Paused workflow (draft assumes yes).
- A short debounce before executing a `saas_pause` that a pending auto-recharge could cure (the 15-minute wait may be enough).
- `unpaid` subscriptions currently emit nothing (shown on Health) — decide whether they should count as a core failure.
- Retry policy for failed side effects (currently recorded on the decision and shown; no automatic retry).
- How long to keep the old routes deployed after cutover.
