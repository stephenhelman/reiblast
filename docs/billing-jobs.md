# Nightly billing data jobs

Four read-only data jobs, triggered by a GHL scheduled workflow (no Vercel Cron). They never change billing state,
tags, or stages, and never write to GHL. See `docs/ghl-server-contract.md`.

| job | what it does |
|---|---|
| `replay` | Re-runs `GhlEvent` rows that failed (unprocessed, `attempts < 5`, received > 5 min ago) through `processPaymentEvent`. |
| `tx_sweep` | Rolling 35-day window of `GET /payments/transactions` through `ingestTransaction` (catches missed webhooks). |
| `wallet_usage` | Previous 2 UTC days of agency wallet transactions → `UsageRollup` (per location incl. HQ, plus `_agency` / `_unattributed`). Replaces per (scopeKey, day). |
| `balances` | Wallet balance per location (incl. HQ) → `WalletBalanceSnapshot`, one row per location per UTC day. |

## Trigger

`POST /api/webhooks/ghl/jobs` with header `x-reiblast-jobs-secret: <GHL_JOBS_SECRET>` and body
`{ "job": "replay" | "tx_sweep" | "wallet_usage" | "balances" }`. Always answers 200 `{ accepted, job }`; the work runs in
the background (`waitUntil`). Create one GHL scheduled workflow per job.

## Plan limit assumed

**Vercel Hobby (no Fluid Compute): functions are capped at 60 s**, so the route sets `maxDuration = 60` and the default
working budget is **45 s** (`JOBS_TIME_BUDGET_MS`). A job that reaches the budget saves its cursor in `JobRun.cursor` and
POSTs to the same route to continue (max 10 continuations per run; the cap is recorded in `JobRun`). On Pro, raise
`maxDuration` (up to 300) and `JOBS_TIME_BUDGET_MS` together.

## Concurrency guard

A trigger with no cursor is ignored if the job's `JobRun` shows a start in the last 10 minutes with no success or error
since. Continuations refresh `lastStartAt`, so a long chain stays guarded. Ignored triggers are logged and counted in
`lastSummary.ignoredTriggers`.

## Environment

| var | purpose |
|---|---|
| `GHL_JOBS_SECRET` | shared secret for the route (generate: `openssl rand -hex 32`) |
| `JOBS_TIME_BUDGET_MS` | optional working budget per invocation (default 45000) |
| `JOBS_BASE_URL` | optional base URL for continuations (default `https://$VERCEL_URL`) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | on protected previews, sent as `x-vercel-protection-bypass` on continuations |
| `GHL_AGENCY_API_KEY`, `GHL_COMPANY_ID` | agency wallet endpoints |
| `GHL_HQ_API_KEY`, `GHL_HQ_LOCATION_ID` | transaction list/fetch; HQ is also included in the per-location wallet passes |
| `PIPELINE_DATABASE_URL` | preview only: routes billing DB access to the pipeline branch |

## CLI (dry-run by default, `--apply` to write, refuses the production host)

`scripts/billing/run-replay.ts`, `run-tx-sweep.ts`, `run-wallet-usage.ts`, `run-balances.ts`,
`job-health.ts` (staleness: no success in 26 h), and `backfill-usage.ts` (monthly windows per location, bucketed by
UTC day; `--from`, `--to`).
