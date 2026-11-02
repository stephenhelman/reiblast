# Partner statement — ship plan and prod runbook

**Nothing in this document has been run against production.** Everything was developed and rehearsed on the Neon branch `admin-statement-dev`
(a copy of production taken 2026-10-29). Written for the owner; follows `docs/cutover.md` A2 (snapshot → compare migrations → rehearse → `migrate deploy` only).

## 0. What the production copy showed
- `JobRun`: `sub_sweep` ran 2026-10-29 08:01Z; `replay` and `tx_sweep` last ran **2026-10-06**; `wallet_usage`, `balances`, `discord_outbox` **never ran** (no `JobRun` row).
- `GhlEvent` `job_trigger` rows: Oct 2–6 show three workflows firing ~10 min apart each morning (sub_sweep, replay, tx_sweep); from Oct 7 only the `sub_sweep` workflow fires.
  `docs/ghl-workflows.md` B5 lists `replay`, `tx_sweep`, `wallet_usage` and `balances` workflows as existing — the logs say they are paused, unpublished or pointed somewhere else. **Check them in GHL.**
- Consequences: four Oct transactions (Oct 8, 13, 15, 28) and two on Oct 29 had no ledger row (GHL sent no payment webhook for the first four; the sweep that would have caught them had stopped);
  `WalletTransaction` / `UsageRollup` were empty. Ledger is now 501/501 against GHL on the dev copy.
- `getBillingDb()` is not blocking prod: accepted triggers record `dbHost=ep-restless-silence…`, which requires `BILLING_DB_TARGET=prod` in Vercel Production.

## 1. GHL workflow checklist (do by hand; one row per job)
Common to every workflow — **Action: Custom Webhook** (or HTTP request):

| Field | Value |
|---|---|
| Method | `POST` |
| URL | `https://reiblast.app/api/webhooks/ghl/jobs` (host from `NEXT_PUBLIC_APP_URL`; **copy the URL from the working `sub_sweep` workflow** — that is the source of truth) |
| Header | name `x-reiblast-jobs-secret`, value = `GHL_JOBS_SECRET` (the same value the `sub_sweep` workflow already uses; never paste it into docs/tickets) |
| Header | `Content-Type: application/json` |
| Trigger | Scheduler, in the sub-account's timezone (**Mountain Time**; GHL follows MDT/MST on its own) |

Never schedule the same job closer than 10 minutes apart (the route ignores a trigger while a run started <10 min ago is still in flight). The route always answers 200; success is seen in the database, not the HTTP code.

| # | Job | JSON body | Schedule (MT) | Confirm it ran (`JobRun` row for the job) |
|---|---|---|---|---|
| 1 | `sub_sweep` (exists) | `{"job":"sub_sweep"}` | daily 02:00 — keep | `lastOkAt` moves to today; `lastSummary.phase/offset` |
| 2 | `tx_sweep` | `{"job":"tx_sweep"}` | daily 02:15 (optionally also 14:15 to shrink the gap window) | `lastOkAt` moves; `lastSummary.fetched` ≈ 35-day count, `match:*` counts; ledger gap check below |
| 3 | `replay` | `{"job":"replay"}` | every 4 h at :30 (cheap when nothing is pending) | `lastOkAt` moves; `lastSummary.considered/processed/failed` |
| 4 | `wallet_usage` | `{"job":"wallet_usage"}` | daily 03:00 | `lastOkAt` moves; `lastSummary.mismatchCount = 0`; `max("WalletTransaction"."createdAt")` advances |
| 5 | `wallet_month_refresh` | `{"job":"wallet_month_refresh"}` | every 2 h at :45 (04:45–22:45) | `lastOkAt` moves every run; `lastSummary.noop = true` when idle, otherwise `month` / `windowsDone`; table `WalletMonthRefresh.windowsDone` grows until `completedAt` is set |
| 6 | `balances` | `{"job":"balances"}` | daily 03:30 | `lastOkAt` moves; one `WalletBalanceSnapshot` per location with today's `takenOn` |
| 7 | `discord_outbox` | `{"job":"discord_outbox"}` | every 15 min | `lastOkAt` within the last hour (Health goes stale at 1 h); `lastSummary.delivered/retried/exhausted/standingExhausted` |
| — | `wallet_retention` | `{"job":"wallet_retention"}` | **do not create yet** — see §5 | when enabled: `lastSummary.deleted/daysCleared`; while disabled it reports `disabled: true` |

How to look (Neon SQL editor, read-only; or `/health` → Jobs):
```sql
SELECT "job", "lastStartAt", "lastOkAt", "lastError", "cursor" IS NOT NULL AS "hasCursor", left("lastSummary"::text, 200) AS summary FROM "JobRun" ORDER BY "job";
SELECT to_char("receivedAt",'MM-DD HH24:MI') t, payload->>'reason' reason, payload->>'jobRunId' run FROM "GhlEvent" WHERE source='job_trigger' ORDER BY "receivedAt" DESC LIMIT 20;  -- expect reason = accepted
```
A trigger that never creates a `job_trigger` row didn't reach the app (wrong URL, workflow unpublished). `reason = auth_failed` = wrong secret; `in_flight` = the previous run is still going (normal for the heavy wallet jobs).
`wallet_month_refresh` first does real work from **UTC day 2 of the next month** (Nov 2 for October); expect ~11 windows (~17 min of work, i.e. 2–3 scheduled runs). Until `WalletMonthRefresh.completedAt` is set for October, **Close Month is blocked with the reason shown**.

## 2. Discord outbox (dev copy = prod as of 2026-10-29)
- `DiscordRevokeOutbox`: **0 pending**, 1 row total — `done`, created 2026-10-28 07:33Z, 1 attempt. So the outbox is delivering inline today; the `discord_outbox` job has never run and has **no backlog to drain**.
- First run behavior (code: `lib/billing/jobs/discordOutbox.ts`): purge `done/superseded` older than 30 days (none), re-arm `config_error` rows only if both Discord env vars are set (none), deliver due `pending` rows in batches of 20, each row through `deliverRevoke` (lease, re-link check, backoff), yielding at the time budget and continuing by cursor.
- **Safe to enable as is.** If a backlog ever builds (bot down), it drains 20 at a time within each 45 s budget and continues across the 15-minute runs; a stuck row backs off and ends `exhausted` after 5 attempts rather than looping. Recheck the pending count right before enabling (`SELECT status, count(*), min("createdAt") FROM "DiscordRevokeOutbox" GROUP BY 1;`) and confirm `DISCORD_BOT_URL` / `DISCORD_BOT_OUTBOUND_SECRET` exist in Production.

## 3. The two unprocessed payment webhook events
- Ids `cmuq82hmy0000l70412ht200b` and `cmuq83c6w0000jn04mp8ecxsf`, received 2026-10-02 00:25 and 00:26 UTC, 5 attempts each, `lastError = invalid transaction id`.
- Payload is `{"transactionId":"null"}` — the string `"null"` (a GHL merge field that resolved to nothing, from a test or a trigger with no transaction). There is **no transaction to look up in GHL**.
- **Do not replay**: it fails identically. They are the only two unprocessed payment events in October; they affect no ledger row. Cleanest is to leave them (replay already skips rows at 5 attempts) or mark them processed with a note after you confirm no workflow still sends an empty `transactionId`; Health counts them until then. Decision is yours; nothing was changed.

## 4. Ordered production runbook
Do it in this order, with the verification before moving on. "Prod URL" below means the Neon **direct** URL of production, typed by you; every script prints the host first and refuses production unless `BILLING_DB_TARGET=prod`, `--i-mean-production` and the typed host confirmation are all given (`scripts/billing/_cli.ts`).

**Step 0 — Preconditions.** PR approved; `fix/soak-gaps` is *not* part of this (it must be re-timestamped after `20261029130000` when it merges — `docs/cutover.md` §6). Pick a quiet window; the statement is read-only for Ari until you close a month.

**Step 1 — Neon snapshot + named branch** (cutover A2.1).
- Do: Neon console → production branch → create a **named branch** `pre-partner-statement-YYYYMMDD` from now, and note the timestamp (also take a snapshot if the plan has them). Create a second, throwaway **rehearsal branch** from it and run steps 2, 4, 5 against it first (A2.3).
- Verify: both branches show in the console; `SELECT count(*) FROM "BillingLedgerEntry"` equals production.
- Roll back: this *is* the rollback artifact. Restore = Neon "Restore" production to the named branch / timestamp (loses writes made since — webhooks recorded in `GhlEvent` after that time would need replaying).

**Step 2 — `migrate status`, then `migrate deploy`** (cutover A2.2/A2.4; migration *before* code — the changes are additive and old code ignores them).
- Do (production, PRISMA_TARGET gate in `prisma.config.ts`):
  `PRISMA_TARGET=prod DATABASE_URL=<prod direct> npx prisma migrate status` → expect exactly two pending: `20261029120000_partner_statement`, `20261029130000_wallet_month_refresh`. Then `… npx prisma migrate deploy`.
- **`retire_bundle_subscriptions` checksum note (checked read-only on the dev copy = prod):** `_prisma_migrations` holds *two* rows for `20260915030459_retire_bundle_subscriptions` — a first attempt that was **rolled back** (checksum `db18cd3a…`, `rolled_back_at` set) and the applied row (`4d9ff80c…`), and the applied row's checksum **equals the current file** (SHA-256 of `migration.sql`). Every other applied migration also matches its file. So there is no drift to stop the A2.2 diff.
  Behavior: `migrate status` reports "Database schema is up to date!" (before our migrations: 59 found, none pending); `migrate deploy` applies only pending migrations, **does not re-verify checksums of applied ones and never resets anything** (reset exists only in `migrate dev`/`migrate reset`). `migrate dev` is the command that prints "modified after it was applied … reset the schema" because it validates against the rolled-back row — **never run `migrate dev` against production.**
- Verify: `migrate status` → up to date, 61 applied; `prisma migrate diff --from-url <prod> --to-schema-datamodel prisma/schema.prisma --exit-code` → no differences; `\d "WalletMonthRefresh"` exists.
- Roll back: app code that ignores the new objects keeps working, so just don't deploy. To undo the schema (only if nothing was written): `DROP TABLE "WalletMonthRefresh","MonthClose","PartnerPayment","ReserveMovement","KurvStatement","FixedCost","SettingRate"; DROP TYPE "ReserveMovementKind"; ALTER TABLE "BillingLedgerEntry" DROP COLUMN …(12 new columns)`. The `BillingClass.non_gateway` enum value cannot be dropped in Postgres — leave it. After any real use, restore from Step 1 instead.

**Step 3 — Deploy the code** (merge the PR → Vercel Production).
- Verify: build green; `https://admin.reiblast.app/login` loads and you can sign in; `/` is Partner Statement (October shows $0 until Step 5 — the typed columns are empty); existing `/revenue`, `/costs`, `/margin`, `/members`, `/health`, `/overview` load. New ingests now write the typed columns and use classifier v3 (authOnly → `trial_auth`; `chargeId 0`/no snapshot → `non_gateway`, excluded from revenue).
- Roll back: Vercel → Deployments → Instant Rollback to the previous production deployment (schema is additive, so the old code runs fine on the new schema).

**Step 4 — Seed rates and fixed costs.**
- Do: dry-run, then apply: `BILLING_DB_TARGET=prod DATABASE_URL=<prod direct> npx tsx scripts/billing/seed-statement.ts --i-mean-production` (then `--apply`). Writes 11 rates + 2 fixed costs effective 2026-10-01, the Aug/Sep reference Kurv statements and the $514.51 opening reserve. Idempotent; never overwrites.
- Verify: `/settings` lists every rate "now"; `/cash` shows reserve balance of $514.51 + funded.
- Roll back: the seeds are append-only; `DELETE FROM "SettingRate"; DELETE FROM "FixedCost"; DELETE FROM "KurvStatement" WHERE month IN ('2026-08','2026-09'); DELETE FROM "ReserveMovement" WHERE note='Opening balance';` (valid only before any month is closed).

**Step 5 — Typed-column backfill (dry run, then apply).**
- Do: `BILLING_DB_TARGET=prod DATABASE_URL=<prod direct> npx tsx scripts/billing/backfill-kurv-fields.ts --i-mean-production` (dry run: prints the classification matrix, the account-rematch count and the Aug/Sep reconciliation; it writes `scripts/billing-audit/output/rematch.csv`). Save the output. Expected from the dev copy: 0 reclassifications, ~25 rematch rows that were previously unlinked (trial auths / failed signups, $0 revenue effect), Sep reconciliation exact (194 sales / $4,195.12, 30 batches, fees within tolerance; **Aug is partial** — the ledger starts 2026-08-27). Investigate anything else before `--apply`.
- Verify: `SELECT count(*), count("batchDate"), count("chargeId") FROM "BillingLedgerEntry"` — `chargeId` filled on every row, `batchDate` on settled sales; re-running the dry run shows 0 rematch and 0 changes.
- Roll back: the new columns are nullable — `UPDATE "BillingLedgerEntry" SET "chargeId"=NULL, …`; if the matrix showed any reclassification, reverse it from the saved output; undo the account links from `rematch.csv` (old account ids).

**Step 6 — October wallet backfill (CLI).** Do this *before* enabling the wallet workflows so two runs never overlap.
- Do: `BILLING_DB_TARGET=prod DATABASE_URL=<prod direct> npx tsx scripts/billing/backfill-usage.ts --from=2026-10-01 --to=<yesterday UTC> --i-mean-production --apply` (GHL **read-only**; ~25 minutes for 29 days; ~7k rows/day; writes `WalletTransaction` + `UsageRollup`).
- Verify: output shows `Rollup-vs-rows mismatches: 0`; `SELECT count(*) FROM "WalletTransaction"` ≈ 7k × days; the statement's wallet line is no longer $0 and the "no wallet rows" banner is gone.
- Roll back: both tables were empty before — `DELETE FROM "WalletTransaction"; DELETE FROM "UsageRollup";` (count first). Re-running the backfill is safe (insert-or-ignore / replace per scope-day).

**Step 7 — Enable the GHL workflows** (§1), in this order, running each once by hand ("run now"/test) and checking the `JobRun` field before the next: `tx_sweep` (repairs any ledger gaps — then run `scripts/billing/check-ledger-completeness.ts --from=2026-10-01 --to=<today>` against prod: expect 0 differing days) → `replay` → `wallet_usage` → `wallet_month_refresh` → `balances` → `discord_outbox`. Keep `sub_sweep` as is.
- Roll back: unpublish a workflow; every job is idempotent and a half-finished run just resumes later. `JobRun.cursor` clears itself on the next successful run.

**Step 8 — Verify `admin.reiblast.app` and Vercel Production env.**
- Do: Vercel → Project → Domains: `admin.reiblast.app` present, valid certificate, assigned to Production (cutover §3 Phase A); `curl -sI https://admin.reiblast.app/login` → 200 and `https://reiblast.app/admin` → 404 (admin is host-only in production). Vercel → Settings → Environment Variables (**Production** scope) must contain: `DATABASE_URL`, `BILLING_DB_TARGET=prod`, `ADMIN_SESSION_SECRET`, `ADMIN_TOTP_SECRET`, `ADMIN_LOCATION_IDS`, `GHL_JOBS_SECRET`, `GHL_AGENCY_API_KEY`, `GHL_COMPANY_ID`, `GHL_HQ_API_KEY`, `GHL_HQ_LOCATION_ID`, `DISCORD_BOT_URL` + `DISCORD_BOT_OUTBOUND_SECRET` (for `discord_outbox`), and **new:** `NEXT_PUBLIC_*` unchanged; set `NEON_STORAGE_LIMIT_MB=512`. `ADMIN_PROCESSOR_FEE_PCT` is no longer read (remove it when convenient). **Do not set** `WALLET_RETENTION_ENABLED`. Env changes need a redeploy to take effect.
- Verify: `/health` shows the database size with the 512 MB limit (warns at 70%, critical at 90%).
- Roll back: remove/revert the variable and redeploy.

**Step 9 — Verify the October statement in prod matches dev within expected drift.**
- Do: `… npx tsx scripts/billing/statement-preview.ts --month=2026-10` on prod (read-only) and compare with the dev numbers below. Compare *at the same cutoff*, because prod has kept moving since the copy:
  - Dev copy, 2026-10-29 evening, ledger 501/501 (statement, to date): bank deposits **$6,312.17** (359 sales, 29 batches, gross $7,366.93, daily fees $318.03, reserve $736.73); Kurv monthly debit estimate **$231.29** (529 authorizations); GHL agency plan **$497.00**; Authorize.net **$25.00**; wallet usage **$3,507.29**; net **$2,051.59**; owed to date **$1,025.80**; reserve balance **$1,251.24**.
  - Exact checks (must match to the cent, same SQL on dev and prod; dev values given): fixed costs $497.00 / $25.00; `SELECT round(sum("amount")*-1,2) FROM "WalletTransaction" WHERE "amount" < 0 AND "settlementTime" < '2026-10-30'` → dev **3507.47** (the statement line is $0.18 lower because it counts Denver October only); `SELECT count(*), sum("settleAmountCents") FROM "BillingLedgerEntry" WHERE "expectedDepositDate" BETWEEN '2026-10-01' AND '2026-10-29'` → dev **347 / 707176**; ledger rows per Denver day through Oct 29 (`check-ledger-completeness.ts`).
  - Expected drift (anything *after* the copy): new sales/batches and their fees, more authorizations in the debit estimate, new wallet usage, reserve funded by new batches, and the 6 ledger rows the sweep adds.
- Roll back: n/a (read-only). If the exact checks differ, stop and compare ledger rows by id (`check-ledger-completeness.ts`) before enabling anything else.

**Step 10 — After month end (Nov 2+).** `wallet_month_refresh` completes October on its own; enter the Kurv October statement on `/cash`; then **Close month** becomes enabled (month ended + refresh complete + Kurv entered). Record Ari's payments on `/`.

## 5. Retention job and storage warning (in the PR; **disabled until you enable them**)
- `wallet_retention` (`lib/billing/jobs/walletRetention.ts`): does nothing unless `WALLET_RETENTION_ENABLED=true`; keeps 90 days (`WALLET_RETENTION_DAYS`, floor 60) of raw `WalletTransaction` rows; deletes oldest UTC day first in 10k batches and **only** when that day's statement month has a complete `wallet_month_refresh` *and* `UsageRollup` matches the raw rows for the day; stops and reports on the first disagreement. `UsageRollup` is never pruned. `/costs/rows` shows a "rows pruned, see rollups" notice for old months when it is on. Hidden from Health until enabled.
- To enable (later): set `WALLET_RETENTION_ENABLED=true`, redeploy, dry-run `npx tsx scripts/billing/run-wallet-retention.ts` against prod (prints the first eligible day), create the GHL workflow (daily 05:15 MT, body `{"job":"wallet_retention"}`), confirm `lastSummary.deleted`.
- Storage warning: `getDbSize` + `/health` already warn at 70% and go critical at 90% of `NEON_STORAGE_LIMIT_MB`; with the variable unset the level is "unset" (silent). Setting it to 512 (Step 8) turns it on.
- Sizing (dev copy, measured): `WalletTransaction` ≈ 7.2k rows/day ≈ 2.8 MB/day (82 MB for 29 days); whole DB 108 MB (≈26 MB before the wallet load). Keep-everything reaches 512 MB in ≈ 5.7 months; 90-day retention levels off near 280 MB (≈55%); 60-day ≈ 195 MB. Doubling members roughly doubles the wallet table, so revisit at the 70% warning.
- A month reopened after its raw rows were pruned would have to use `UsageRollup` (UTC-day buckets, month edges can shift by hours); closed months always use their snapshot.
