# Partner statement — ship plan (draft; nothing here has been run against production)

Checkpoint E will turn this into the final runbook. This draft records what Checkpoints C and D found so far.

## 0. Findings from the production copy (read-only, 2026-10-29)
- `JobRun`: `sub_sweep` last ran 2026-10-29 08:01Z; `replay` and `tx_sweep` last ran **2026-10-06**; `wallet_usage`, `balances`, `discord_outbox`
  have **never run** (no `JobRun` row, no `job_trigger` event ever referenced them).
- `GhlEvent` `job_trigger` rows: Oct 2–6 show three GHL workflows firing ~10 min apart (sub_sweep, replay, tx_sweep); after Oct 6 only the
  `sub_sweep` workflow fires (daily ~08:00Z).
- Result: `tx_sweep` stopped before the Oct 8/13/15/28 gaps (GHL sent no payment webhook for those four ids), and `WalletTransaction` /
  `UsageRollup` were empty because `wallet_usage` was never scheduled.
- `getBillingDb()` is not blocking production: accepted triggers record `dbHost=ep-restless-silence…`, which only happens when
  `BILLING_DB_TARGET=prod` is set in the Vercel Production env.

## 1. Make every job actually run (prod)
Env (Vercel Production — verify, do not change blindly): `BILLING_DB_TARGET=prod`, `GHL_JOBS_SECRET`, `GHL_AGENCY_API_KEY`, `GHL_COMPANY_ID`
(wallet jobs), `GHL_HQ_API_KEY`, `GHL_HQ_LOCATION_ID`, `JOBS_BASE_URL` (or rely on `VERCEL_URL`), optional `JOBS_TIME_BUDGET_MS`.
GHL scheduled workflows: one per job, `POST https://<admin-or-app host>/api/webhooks/ghl/jobs`, header `x-reiblast-jobs-secret`,
body `{"job":"<name>"}`. Missing today: **tx_sweep, replay** (stopped Oct 6), **wallet_usage, balances, discord_outbox** (never created).
Suggested schedule (UTC, staggered ≥10 min so claims don't collide): tx_sweep 08:11, replay 08:21, wallet_usage 08:31, balances 08:41,
discord_outbox every 15 min (if used), sub_sweep 08:01 (exists).
Watch-outs:
- The route is capped at 60 s (Hobby) with 45 s budgets and **10 continuations (~7.5 min per run)**. A normal 2-day `wallet_usage` run
  (~7k rows/day, backfill measured ≈ 52 s of work per day of data) needs ~3 continuations — fine. The **UTC-day-3 previous-month refresh**
  (~35 days of windows ≈ 30 min) will hit `cap_hit` and leave a partial refresh. Options: raise `maxDuration`/budget on Pro, or skip the
  refresh (the nightly window already covers late rows) — decide in Checkpoint E.
- First load of October wallet rows in prod: run the CLI (not the route) once, interactively, after the migration:
  `BILLING_DB_TARGET=prod DATABASE_URL=<prod> npx tsx scripts/billing/backfill-usage.ts --from=2026-10-01 --to=<yesterday UTC> --apply --i-mean-production`
  (~25 min for 29 days; GHL read-only; writes `WalletTransaction` + `UsageRollup`). Do not overlap it with a scheduled `wallet_usage` run.
- After the first sweep, re-run `scripts/billing/check-ledger-completeness.ts` for the month (read-only) and confirm ledger = GHL.

## 2. Retention for `WalletTransaction` (design; not built)
Keep **90 days of raw rows**, `UsageRollup` **forever**. Drill-down older than 90 days uses rollups (day × scope × category; UTC day).
Measured on the dev copy (29 days loaded): `WalletTransaction` = **82 MB** for 210,148 rows ≈ 7.2k rows/day ≈ **2.8 MB/day** (~390 B/row incl.
indexes); `UsageRollup` 1.4 MB; ledger 3.7 MB; whole DB 108 MB (≈ 26 MB before the wallet load).

| Policy | Wallet table steady state | Whole DB (≈26 MB base) | vs Neon free (0.5 GB) |
|---|---|---|---|
| Keep everything | +85 MB / month, unbounded | hits 512 MB in ≈ 5.7 months | breaks ~Apr 2027 |
| 90-day retention | ≈ 255 MB | ≈ 280 MB | ≈ 55%, OK today; ~2× member growth ≈ 535 MB (over) |
| 60-day retention | ≈ 170 MB | ≈ 195 MB | ≈ 38% |

Recommendation: ship 90 days as asked, set `NEON_STORAGE_LIMIT_MB=512` so Health warns, and revisit at 70% (or move to 60 days / a paid plan
before member count doubles). Deleted rows free space inside the table (autovacuum); the file only shrinks with a rewrite, so size alerts
should use the high-water mark. Design points:
- A `wallet_retention` step (new job, or a tail step of `wallet_usage`) deletes in batches of ~10k where `settlementTime < now − 90 days`
  **and** the rollup-vs-rows check passes for that day (`checkRollupAgainstRows`), so rollups are proven to carry the data before rows go.
- The statement only reads wallet rows for the open month; **closed months use their snapshot**. A month reopened after its rows are pruned
  would have to fall back to `UsageRollup` (UTC-day buckets, so month edges can shift by hours); show it flagged "approximate" or refuse to
  reopen months older than the retention window.
- `/costs/rows` and raw CSV (`costs&detail=1`) say "raw rows older than 90 days were pruned; see rollups" instead of returning empty.
- Never prune `BillingLedgerEntry` (small, and `raw` is the audit copy).

## 3. Still to write in Checkpoint E
Migration ordering with `fix/soak-gaps` (see `docs/cutover.md` §6); `migrate deploy` per cutover A2 with a snapshot first; the exact behavior
of `migrate deploy` / `migrate status` with the edited `20260915030459_retire_bundle_subscriptions` (read-only check on the dev copy);
running the backfill + seeds in prod; verifying `admin.reiblast.app` and its env vars in Vercel Production; the PR (not merged).
