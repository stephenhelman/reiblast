# Nightly billing data jobs

Four read-only data jobs, triggered by a GHL scheduled workflow (no Vercel Cron). They never change billing state,
tags, or stages, and never write to GHL. See `docs/ghl-server-contract.md`.

| job | what it does |
|---|---|
| `replay` | Re-runs `GhlEvent` rows that failed (unprocessed, `attempts < 5`, received > 5 min ago) through `processPaymentEvent`. |
| `tx_sweep` | Rolling 35-day window of `GET /payments/transactions` through `ingestTransaction` (catches missed webhooks). |
| `wallet_usage` | Previous 2 UTC days of agency wallet transactions → `WalletTransaction` (every raw row, insert-or-ignore on GHL id) and `UsageRollup` (per location incl. HQ, plus `_agency` / `_unattributed`; replaces per (scopeKey, day)). On **UTC day 3 only** it also refreshes the whole previous calendar month as ≤7-day windows. Each finished window runs the rollup-vs-rows check (below). |
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

## Wallet evidence layer (`WalletTransaction`)

`UsageRollup` is the derived summary; `WalletTransaction` holds one row per GHL wallet transaction (`id` = GHL wallet
transaction id, `scopeKey`, `ghlAccountId`, `settlementTime`, `category`, `description`, signed `amount`) so every cost
figure can be drilled to individual transactions. Written by `wallet_usage` and `backfill-usage.ts` in the same pass that
builds the rollup, with `createMany({ skipDuplicates: true })` — an existing row is never modified.

- **Rollup-vs-rows check.** After each window the job compares, per (scopeKey, UTC day, category), `UsageRollup.count/amount`
  to `COUNT/SUM` of `WalletTransaction` and puts **every** disagreement in the job summary
  (`rollupCheck.mismatches`, `mismatchCount`; the nightly summary aggregates `mismatchCount` across windows). Expect zero.
  Because inserts are ignore-on-conflict, an upstream amount correction (or a row GHL later removes) surfaces here as a
  mismatch — by design.
- **`settlementTime` is UTC.** GHL returns it zoneless (`"2026-06-19 08:06:55.147"`) and the request asks for
  `timezone: "UTC"`; it is parsed explicitly as UTC (never with the machine's zone). `UsageRollup.day` is the UTC day.
- **Month refresh queue.** The job cursor carries a queue of windows (previous 2 days, then on UTC day 3 the previous
  month in ≤7-day chunks), the position, and the in-window cursor, so it resumes across continuations. Each window keeps
  its own bounded `seenIds`.
- **Indexes.** `(scopeKey, settlementTime)` and `(category, settlementTime)` (plus the pkey). **Drill-downs filter by
  `scopeKey`** — for a member it is their `GhlAccount.locationId`, and HQ / `_agency` / `_unattributed` are scopes too,
  which a `ghlAccountId` filter cannot express. `ghlAccountId` is a write-time snapshot (null if the account was created
  later) and is deliberately not indexed; resolve a member's `locationId` first, then query by `scopeKey`. Cross-scope date
  ranges (e.g. a Denver-time month) scan by `settlementTime` using the category or scope index or a sequential scan —
  fine at this size; revisit if a view needs a bare time-range index.
- **Size.** ~85–100k rows/month, ~0.4 KB/row with the two secondary indexes (61 MB for the first 153k rows). Decide a
  retention policy before it matters (e.g. keep raw rows 13 months, older months live only in `UsageRollup`).

## Reporting rules

- **Reporting timezone: `America/Denver`** (HQ location timezone is `US/Mountain`, read from `GET /locations/{HQ}`).
  Dashboard cost views bucket by month/day from `WalletTransaction.settlementTime` converted to Denver time — **not** from
  `UsageRollup.day`, which is a UTC day, so the two can differ near month boundaries. Revenue views bucket
  `BillingLedgerEntry.occurredAt` the same way.
- **Net revenue** = `SUM(amount − amountRefunded)` over ledger rows with `status IN ('succeeded', 'refunded')`.
  A fully refunded row (`status = 'refunded'`, `amountRefunded = amount`) nets to zero. `failed` and `pending` rows never
  count. Test-mode transactions are not in the ledger at all (ignored at ingest).
- **`refundDetectedAt`** is set the first time an update raises `amountRefunded` on an existing row, and never changed after.
  It is null for rows already refunded before the column existed ("predates tracking" — the 2 refunded rows on the
  pipeline branch), and for rows first ingested already refunded. Refunds are attributed to the original transaction date;
  `refundDetectedAt` is when we noticed, not when GHL refunded.

## Auto-recharge account matching

`ingestTransaction` matches a payment to a `GhlAccount` by `contactId`. For `wallet_auto_recharge` rows with no such match
it falls back to the `/location/<id>/` URL in the description and matches `GhlAccount.locationId`. The method used
(`contactId` | `descriptionLocation` | none) is returned per row and counted in the `tx_sweep` summary (`match:*`) and in
the historical-load report. `scripts/billing/relink-auto-recharge.ts` (dry-run by default) applies the same fallback to
existing unmatched rows; it only fills a null `ghlAccountId`.

## Internal accounts (`GhlAccount.accountType`)

`accountType` is `member` (default) or `internal`. The owner account used by the admin entry flow is `internal`, with
`locationId` = the HQ location. **All member logic filters `accountType = member`**:

- `listWalletLocations` (used by `wallet_usage` and `balances`) lists member accounts only and adds HQ from
  `GHL_HQ_LOCATION_ID`, so HQ is queried **exactly once**, as scopeKey = HQ location id with `ghlAccountId` null.
- `ingestTransaction` matches payments to member accounts only (by contactId, and by the auto-recharge description
  location). A payment from an internal contact stays unmatched rather than becoming a member's revenue.
- `seed-billing-state.ts`, `backfill-ghl-accounts.ts` (skips users with an internal account) and
  `relink-auto-recharge.ts` ignore internal accounts. Overview/health counts of members, `billingState` and
  `legacyUnreconciled` are member-only. Any new report or script must do the same.

## Classifier versions

`CLASSIFIER_VERSION` (lib/billing/classify.ts) is stored on every ledger row. **v2**: rule 5 (`failed_signup`) matches a
failed row with no subscriptionId whose source is a `payment_link` **or** has no source subtype at all (failed form/order
signups). Rules 2–4 still run first, so wallet recharges, $0 rows and anything subscription-shaped (including a failed
`saas_subscription` without a subscriptionId) are unaffected.

`scripts/billing/reclassify-ledger.ts` (dry-run default, `--apply`, refuses the production host) re-runs the classifier over
every row from its stored raw and updates `classification` + `classifierVersion` **only where the classification changes**.
Unchanged rows keep the version they were written with, so the ledger legitimately holds mixed versions; a row tagged v1 whose
classification v2 would repeat is simply not rewritten. Test-mode rows the classifier would ignore are reported, never changed.
