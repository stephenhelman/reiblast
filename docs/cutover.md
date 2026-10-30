# Cutover (Task 8) — plan v2

> **Start with §0 — the exact switchover order (branch `billing/cutover-ready`).** Sections 1–6 below are the background plan; where they disagree with §0 (the
> core-failure rule, the exemption flag, the canary, `DUNNING_LIVE_ACCOUNTS="*"`), §0 wins.

Status: **plan.** Nothing in here has been done. Until cutover the old routes and their GHL workflows stay in charge and the engine runs in
shadow mode (`DUNNING_MODE` unset/`shadow`): it records decisions and `skipped_shadow` intents only.

## 0. Exact switchover order

Rules this build ships (details in `docs/dunning-engine.md`): a failed **core** subscription payment **pauses at once** (`non_payment`, `saas_pause`; Onboarding
"Paused" for members still onboarding) and a succeeded core payment (incl. a paid GHL invoice) cures; `payment_failed` is only for wallet strikes 1–2 and an
expired subscription ("Expired Sub"); `saas_pause` also **revokes Discord**; `GhlAccount.exemptUntil` suppresses every adverse action for special members;
`DUNNING_LIVE_ACCOUNTS="*"` = every member account. Every script below is dry-run by default; production needs `BILLING_DB_TARGET=prod`, `--i-mean-production` and the
typed host confirmation (A1). Take the Neon snapshot + named branch (A2.1) before step 1.

1. **Migrate.** `prisma migrate deploy` (never `migrate dev`) applies, in this order after `20261029130000_wallet_month_refresh`:
   - `20261030120000_pause_reason_subscription_expired` — `ALTER TYPE "PauseReason" ADD VALUE 'subscription_expired'` (re-timestamped from `20261016…`; nothing else
     references the old name).
   - `20261030130000_ghl_account_exemption` — adds `GhlAccount.exemptUntil` / `exemptReason` and copies every `coreCoveredUntil` / `coreCoverageNote` into them (old
     columns stay, unused).
   Verify `prisma migrate diff` shows no drift. Env stays `DUNNING_MODE=shadow`, `ONBOARDING_INTENTS` as is, `CLIENT_HANDOFF=off`, `DUNNING_LIVE_ACCOUNTS` empty.
2. **Merge** `billing/cutover-ready` to `main` and deploy. Nothing acts yet (shadow). The replay job now retries only `payment` / `stage_change` / `invoice` /
   `op_invoice` events; run `scripts/billing/mark-nonpayment-retries-processed.ts` (dry-run, then `--apply`) once to close out review rows that were wrongly retried.
3. **Set exemptions for special members** — anyone the engine must never pause/charge/churn (comped, partners, prepaid, test). Per member:
   `npx tsx scripts/billing/set-exemption.ts --location-id=<id> --until=YYYY-MM-DD --reason="…"` (dry-run), then `--apply`. Check Members → "Exempt until". The old
   `set-coverage.ts` is gone; members who had a coverage date were carried over by the migration (confirm each is intended).
4. **Mark manually created Clients cards as placed.** `scripts/billing/backfill-active-client-since.ts` with `--estimate-only`, then dry-run, then `--apply`
   (sets `activeClientSince` for members who already have a Clients-pipeline opportunity, so the engine routes them to Clients and the handoff skips them).
5. **Seed starting states.** Run `sub_sweep --apply` (`scripts/billing/run-sub-sweep.ts`) so `GhlSubscriptionState` is populated and its "seed" phase fills null
   states for trialing/active/unpaid members; then `scripts/billing/seed-billing-state.ts` (dry-run, then `--apply`) for the legacy paused/expired/canceled ones.
   Review the unseeded list — nothing is guessed. Shadow mode now keeps new members seeded too (trial / first core payment / expired subscription).
6. **Handoff catch-up.** Set `CLIENT_HANDOFF=live` (needs `GHL_INTENT_URL_ACTIVE_CLIENT` and the workflow of step 7 to exist first — do step 7 before this if it
   isn't built yet). `scripts/billing/handoff-catchup.ts` dry-run (lists who goes to which Clients stage; unseeded ones are listed, not moved), then `--apply`.
7. **GHL Active Client intent workflow gets an `expired_sub` branch** (stage name "Expired Sub", key `expired_sub`; see `docs/ghl-workflows.md` A1). Also confirm the
   Onboarding workflow has `payment_failed` and `paused`, and that the stage-changed workflows send "Expired Sub". An unmatched key silently does nothing, so send one
   test payload per key.
8. **Canary on one test account** (a dedicated sub-account you own, with a linked Discord, not a real member): `DUNNING_LIVE_ACCOUNTS=<that account>`,
   `DUNNING_MODE=live`. Drive it through and check the decision row, intent (`sent`), GHL stage, location pause state, `User.status` and Discord at each step:
   - **pause:** a failed core payment (or 3 failed wallet recharges with a negative balance) → `paused`/`non_payment`, `saas_pause` executed, **Discord role revoked**
     (outbox row `done`, `DiscordLink` gone);
   - **resume:** a succeeded core payment (pay the GHL invoice) → `active`, `saas_resume` executed, location unpaused. **Discord is not restored automatically** — the
     member re-verifies through the Discord verify flow (this is expected; see dunning-engine.md);
   - an exempt canary (set `exemptUntil` first): a failed core payment records `exempt…` and changes nothing;
   - a manual stage move, a canceled subscription, an expired subscription (→ Expired Sub), an expired invoice.
9. **Go live for everyone.** `DUNNING_LIVE_ACCOUNTS="*"` (internal accounts are never acted on), `DUNNING_MODE=live`. Watch Health (failed intents, failed events, failed
   side effects, unexpected decisions) for the first hour.
10. **Disable the legacy workflows the same day** — Payment Failure (→ `/payment-failed`), Pause Sub Account (→ `/pause`), Active Member (→ `/active`), plus GHL's raw
    payment-failed → Failed Payment stage workflow (section 2). Record their configuration first so rollback is exact. Confirm no double action on a test payment. The old
    routes stay deployed and inert for two weeks (they are the only other code that revokes Discord; the engine now does).

Rollback at any point: §4. Everything in steps 1–7 is additive or dry-run-first and safe to leave in place while still in shadow.

## 1. What changes

| | Before (today) | After |
|---|---|---|
| Who counts strikes / decides pauses | `payment-failed` route + `User.warningCount` | the engine (`GhlAccount`, `DunningDecision`) |
| Who pauses / resumes the location | `pause` / `active` routes (`pauseLocation` / `unpauseLocation`) | the engine: resume on cure, pause in the same decision that pauses (no confirmation step) |
| Who moves GHL pipeline stages | GHL workflows + the routes' `moveToStage` | the engine's intents → the "Billing intent" workflow |
| What gates tools access | `User.status` | still `User.status` (mirrored by the engine) until the tools repoint |

## 2. GHL workflows

**Build (new — details in `docs/ghl-workflows.md`), disabled until Phase B step 5:**
1. Billing intent — Active Client (inbound webhook → If/Else stage → Update Opportunity → Update contact fields) → `GHL_INTENT_URL_ACTIVE_CLIENT`
2. Billing intent — Onboarding → `GHL_INTENT_URL_ONBOARDING`
3. Stage changed — Active Client → `/api/webhooks/ghl/stage-changed`
4. Stage changed — Onboarding → `/api/webhooks/ghl/stage-changed`
5. ~~Paused — confirm after 15 minutes~~ — removed: the pause is part of the paused decision. Optionally keep a Paused-stage workflow that only sends the card-update message
6. Invoice — expired / voided → `/api/webhooks/ghl/invoice-event`
7. Scheduled: `sub_sweep` nightly (next to the existing four)

**Disable at cutover (the old dunning path — record their current configuration first so rollback is exact):**
1. The workflow that POSTs to `/api/webhooks/ghl/payment-failed` (payment success/failure → warning count + `payment_failed` tag)
2. The workflow that POSTs to `/api/webhooks/ghl/pause` (moved to Paused → pause the location)
3. The workflow that POSTs to `/api/webhooks/ghl/active` (moved to Active → reset warnings / unpause)
4. GHL's own "raw payment-failed → Failed Payment stage" workflow (the engine's `payment_failed` intent sets that stage now)
5. Any workflow that sends the card-update message on entering Paused (replaced by workflow 5 above)

The old **routes** stay deployed (returning as they do today) until 2 weeks after the last account goes live, then are removed in a separate change.
The payment-event webhook (`/api/webhooks/ghl/payment-event`) and all nightly jobs are unchanged and stay enabled.

## 3. Sequence

### Phase A — Production readiness (before anything touches production)

**A1. Code: an explicit production mode (built — Task 8a).** `getBillingDb()` (`lib/billing/db.ts`) and every CLI (`scripts/billing/_cli.ts`,
used by every billing/admin script including `scripts/admin/*`) *refuse* the production host absent an explicit, loud opt-in that
replaces nothing silently — nobody has set `BILLING_DB_TARGET=prod` anywhere yet, so this remains inert until Phase A actually runs:
- **Library:** `getBillingDb()` targets production only when `BILLING_DB_TARGET=prod` is set explicitly. Unset = today's behavior
  (preview → pipeline branch via `PIPELINE_DATABASE_URL`, everything else per the existing guard). A mismatch (prod target with a
  non-prod URL, or the reverse) throws.
- **Scripts:** one shared `connect()` in `_cli.ts` (used by every billing/admin script). To touch production a script needs **all** of:
  `BILLING_DB_TARGET=prod`, the `--i-mean-production` flag, and an interactive prompt that prints the resolved host + database and
  requires typing the host name back (no `--yes`; refuses when stdin is not a TTY). Dry-run stays the default; `--apply` is separate.
- Each run prints a banner (host, target, mode) and writes it to the output, so logs show what was touched.
- Tests: guard matrix (target × host × flag × TTY) with a fake URL; no test may connect.

**A2. Merge plan and migration rehearsal.**
1. **Snapshot first:** Neon snapshot **and** a named branch of production immediately before the change (restore point).
2. **Compare migrations:** diff `_prisma_migrations` on production against `prisma/migrations` on `main`; list what is unapplied.
   Anything applied on production but missing in the repo, or with a different checksum, stops the plan.
3. **Rehearse on a fresh branch of production** (created after the snapshot): run the whole sequence there — `prisma migrate deploy`, then the
   full rebuild order in A3 — and record row counts and timings.
4. **Deploy with `migrate deploy` only. Never `migrate dev`** against anything but a throwaway local/pipeline database.
5. **Verify** after deploy: `prisma migrate diff` (schema vs database) reports **no differences**, `_prisma_migrations` lists everything as applied,
   and `next build` + the billing/admin suites pass on the merged `main`.
6. Merge order follows the branching rule: work branch → `main` → `tools`.

**A3. Production rebuild order** (each step **dry-run first**, then `--apply`; compare the dry-run's counts with the pipeline branch's
and explain every difference before applying):

| # | Step | Comparison baseline (pipeline branch) |
|---|---|---|
| 1 | `backfill-ghl-accounts` | GhlAccount rows per member / location |
| 2 | `seed-billing-state` — trailing-30-Denver-day `WalletTransaction` activity check (`--wallet-dir` is now an optional fallback only) | state distribution (paused / churned / active / trial …) |
| 3 | `scripts/admin/provision-owner` (the internal HQ account, `accountType = internal`) | 1 internal account |
| 4 | load the historical ledger — `load-ledger-from-pull` or `tx_sweep` over the full history | ledger row count and classification breakdown |
| 5 | `backfill-usage` (wallet usage) | usage rows / totals per month |
| 6 | `backfill-location-names` | named locations |
| 7 | `sub_sweep` **first-run seed** (writes `GhlSubscriptionState`, emits nothing; confirm 0 decisions / 0 intents after) | 149 rows on the pipeline branch (re-count) |
| 8 | `balances` | one snapshot row per location |

Stop at the first unexplained difference. Re-run the reconciliation views on Health after step 8.

**A4. Environment.** Every variable below must exist in the **Production** scope in Vercel (not just Preview): `DATABASE_URL`,
`GHL_AGENCY_ID`, `GHL_AGENCY_API_KEY`, `GHL_HQ_API_KEY`, `GHL_HQ_LOCATION_ID`, `GHL_COMPANY_ID`, `GHL_SNAPSHOT_ID`,
`GHL_ONBOARDING_PIPELINE_ID`, the `GHL_STAGE_*` ids, `GHL_WEBHOOK_SECRET`, `GHL_BILLING_WEBHOOK_SECRET`, `GHL_JOBS_SECRET`,
`GHL_EVENTS_SECRET`, `GHL_INTENT_URL_ACTIVE_CLIENT`, `GHL_INTENT_URL_ONBOARDING`, `JOBS_BASE_URL`, `JOBS_TIME_BUDGET_MS`,
`ADMIN_SESSION_SECRET`, `ADMIN_TOTP_SECRET`, `ADMIN_LOCATION_IDS`, `ADMIN_PROCESSOR_FEE_PCT`, `NEON_STORAGE_LIMIT_MB`,
`GHL_FROM_EMAIL`, the `GHL_OTP_WEBHOOK_URL_*`, the app/checkout `NEXT_PUBLIC_*` URLs, `RENTCAST_API_KEY`, `ANTHROPIC_API_KEY`,
`BILLING_DB_TARGET=prod` (the explicit opt-in from A1 — `getBillingDb()` refuses the production host without it), and
`DUNNING_MODE=shadow` (explicit) with `DUNNING_LIVE_ACCOUNTS` empty. **`ADMIN_PATH_ACCESS` must be unset in production** (it is a preview/dev
convenience; production serves admin only on the `admin.reiblast.app` host). Add the `admin.reiblast.app` domain to the production
project and verify DNS, TLS and the host-routing rule before the first login. `PIPELINE_DATABASE_URL` is preview-only.

**A5. GHL: repoint from the preview URL to production.** Workflows built during the soak point at the preview deployment. Before cutover,
change each to the production base URL (and its secret): `payment-event`, `jobs` (all five scheduled workflows incl. `sub_sweep`), and every
new workflow in section 2 (stage-changed ×2, Paused-confirm, invoice, and the two intent receivers' URLs in the env). Send one test
payload to each and confirm a `GhlEvent`/`JobRun` row appears **in the production database**.

### Phase B — Cutover

**0. Preconditions.** Phase A complete: migrations deployed, rebuild done, env and domain set, workflows repointed; the wallet-usage/balances jobs running.

**1. Deploy in shadow.** Ship with `DUNNING_MODE=shadow`. Confirm the payment webhook's dual-write creates `GhlAccount` rows for new
members and that the shadow hook records decisions after each payment.

**2. Soak in shadow (≥ 1–2 weeks).** Compare, per account, the shadow decisions against what the old routes actually did (`User.status`,
`warningCount`, `Transaction`). Every mismatch is a bug to fix or an intended difference to accept (auto-resume on a recharge that clears
the balance). Health's "differs" count should be small and explained.

**3. Build the GHL workflows** (section 2), disabled; send test payloads to `stage-changed` / `invoice-event`; confirm `GhlEvent` rows and decisions.

**4. Code gaps closed before the canary** (Task 8a): automatic retry of failed side effects with backoff (`lib/billing/state/effects.ts`,
5 attempts, 5m/30m/2h/6h/24h — replay job + opportunistic after each processed payment event) and the Health alert for exhausted resume
failures (warning for pause) are built. Production access to `getBillingDb()`/every billing script now requires the explicit opt-in in
`docs/cutover.md` A1 (`BILLING_DB_TARGET=prod` + `--i-mean-production` + typed host confirmation).

**5. Enable the new workflows** (1 and 3–6 from section 2; the old ones stay on for now).

**6. Place cards.** Existing opportunities must sit in the right stage before the engine starts moving them:
- **Active Client pipeline:** send one `active_client` intent per member from `GhlAccount` state (`billingState`, `pauseReason`, trial
  fields) **through the outbox** (`GhlIntent`, dedupe key `place:<account>:<stage>`), so every placement is recorded and retryable. **Dry-run listing
  first:** contact, current GHL stage (if readable), target stage, count per stage — reviewed by you. Then send in **batches** (e.g. 25, with a
  pause between, watching Health for failed intents) and confirm the echoed `stage-changed` events are recorded as confirmations, not commands.
  Members whose state is `null` or legacy-unreconciled are listed and excluded, never guessed.
- **Onboarding pipeline:** map existing cards — most sit at the old **Active Member** stage — to **A2P Approved** for members whose onboarding is
  complete. **List every member whose onboarding stage cannot be mapped** (unknown or missing stage, incomplete onboarding, no opportunity) for
  manual handling; nothing is moved for them.

**7. Canary.** A **dedicated test sub-account you own, with a card you control — not a real member.** Create it (and its GhlAccount/contact)
first, set `DUNNING_LIVE_ACCOUNTS=<that account>`, then `DUNNING_MODE=live`. Only the canary is acted on; every other account stays shadow.
Drive it through: a failed recharge with a negative balance ×3 → paused intent + `saas_pause` at once; a recharge that clears the
balance → resume; a manual stage move; a canceled subscription; an expired invoice. Check the decision rows, intents (`sent`), the GHL stage,
the location's pause state and `User.status` at each step.

**7b. Widen.** Add real accounts to `DUNNING_LIVE_ACCOUNTS` in stages (a handful, then a batch, then all). Watch Health (failed intents,
failed events, failed side effects, unexpected decisions) between stages.

**8. Cut over.** With everyone allowlisted: disable the old workflows (section 2), confirm no double action on a test payment. Leave the old
routes deployed and inert.

**9. After.** Remove the old routes **2 weeks after the last account goes live**, along with the `Transaction` dedupe path; keep `User.status`
mirroring until the tools app reads `GhlAccount`, then drop the mirror and the `User.warningCount` writes.

## 4. Rollback
At any point: set `DUNNING_MODE=shadow` (or empty `DUNNING_LIVE_ACCOUNTS`) — the engine stops persisting and acting immediately; then
re-enable the old workflows and disable the new ones. Effects already executed (a pause, a stage move) are not undone automatically:
`GhlAccount`/`User` keep the last persisted state, so re-check paused accounts by hand (`DunningDecision` mode `live` lists them).

## 5. Decisions (resolved)
- **Stage names:** the stage keys (`trial`, `active`, `payment_failed`, `paused`, `inactive`, `churned`) are fixed; GHL stage *names* are a GHL-side
  mapping of those keys. When building the intent workflow, verify the If/Else branches match the keys **exactly** (case, underscores) —
  an unmatched key would silently do nothing.
- **Card-update message** stays in a GHL Paused-stage workflow. The server sends no comms.
- **No pause debounce** (the 15-minute `paused_confirm` wait was removed): `saas_pause` rides the paused decision, and a failed pause is retried with backoff (see Side-effect retries).
- **`unpaid` subscriptions stay informational** (Health list only, no engine event).
- **Side effects** (`saas_pause` / `saas_resume`) **retry automatically, up to 5 attempts with backoff (5m/30m/2h/6h/24h), via the replay job
  and opportunistically after each processed payment event.** An exhausted `saas_resume` raises an ALERT on Health (a member left paused
  after paying is the costly failure); an exhausted `saas_pause` raises a WARNING. Idempotent: a retry never fires once a later live decision
  for the account supersedes it. **Built** — `lib/billing/state/effects.ts` (see Phase B step 4).
- **Old routes** are removed **2 weeks after the last account goes live**.

## 6. Migration ordering notes (admin partner statement)
- **`fix/soak-gaps` is merged (on `billing/cutover-ready`) with its migration re-timestamped to `20261030120000_pause_reason_subscription_expired`.** The original `20261016120000_pause_reason_subscription_expired` has never been applied anywhere
  (checked on a copy of production: no `_prisma_migrations` row, and `PauseReason` has no `subscription_expired` value). When that
  branch is merged it must be **re-timestamped to sort after `20261029120000_partner_statement`** (and anything else already on main),
  never merged with its original `20261016…` name. `migrate deploy` would technically apply an earlier-dated unapplied migration, but
  main is the trunk and new migrations sort chronologically last.
