# REIblast admin

Owner-only billing dashboard for REIblast money (collected through GHL and its processors). **Entirely separate from the
REItools admin** (Stripe / OP Web Studio): no shared models, routes or libs. There are no role checks anywhere — access is
"you can prove control of the internal owner account".

## Host routing (`middleware.ts`, `lib/admin/hostRouting.ts`)

| Host | Behavior |
|---|---|
| `admin.reiblast.app` | Everything is rewritten under `/admin/*`. `/login` and `/enter` are public; every other path needs a valid session cookie, else redirect to `/login`. |
| `admin.localhost[:port]` (dev) | Same as the admin host. Browsers resolve `*.localhost` to loopback: `npm run dev` then open `http://admin.localhost:3000/login`. Cookie is not `Secure` on this host only (Safari drops Secure cookies on localhost). |
| Vercel **preview** with `ADMIN_PATH_ACCESS=true` | `/admin/*` is served by path on the preview host (`/admin/enter`, `/admin/login`, …). Requires `VERCEL_ENV === "preview"`. |
| Marketing / tools hosts, and production in every other case | Any `/admin` path returns **404**. |

Middleware sets an `x-admin-base` request header (`""` or `/admin`) so links and redirects work in both modes, and
`X-Robots-Tag: noindex`. Middleware runs on the edge and only checks the JWT signature; it is not the authority.

**`/api` is not matched by middleware.** Every `/api/admin/*` handler must start with
`const r = await ownerOr401(req); if (r instanceof NextResponse) return r;` (`lib/admin/requireOwner.ts`). (None exist yet.)

## Auth

Identity is a **GhlAccount with `accountType = internal`** (created by `scripts/admin/provision-owner.ts`): contactId = your HQ
contact, locationId = the HQ location, linked to an active `User` (no role, no `User.ghl*` fields).

### Primary: SMS via the CRM link (`/enter?locationId=<id>`)

GHL custom menu link in the **HQ sub-account**: `https://admin.reiblast.app/enter?locationId={{location.id}}`
(`{{location.id}}` is GHL's location merge field). The page:

1. `locationId` must be in `ADMIN_LOCATION_IDS`;
2. a `GhlAccount` with that locationId must exist and be `internal`;
3. its `User` must be `active`.

Any failure shows the same generic "Access not available" screen (reason in `AdminAuditLog` only). On success it creates an
`AdminAuthChallenge` and texts a 6-digit code (`crypto.randomInt`) to the account's GHL contact through the HQ Conversations
API (`lib/admin/sms.ts`; `lib/otp.ts` and `User.otp*` are not used). Stored as an HMAC (keyed by `ADMIN_SESSION_SECRET`,
bound to the challenge id); 10-minute expiry; max 5 attempts per challenge (claimed atomically before comparing);
max 3 sends per 15 minutes; timing-safe compare; a new send supersedes the old code. A page load within 60 s of a send does
not send again. This path depends on GHL (the menu link and SMS delivery); the fallback below does not.

### Fallback: `/admin/login` (TOTP or backup code)

For when GHL is unavailable. Enter the 6-digit authenticator code (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step; secret in
`ADMIN_TOTP_SECRET`; a step can't be reused) or a one-time backup code (16 chars, 10 issued, stored as SHA-256, consumed
atomically). It signs in the same internal account (exactly one active internal account must be allowlisted).

Every failure returns the same generic message. After 10 `login_failed` audit rows in 15 minutes all sign-in attempts are
refused until the window clears.

### Session

`lib/admin/session.ts`: `jose` HS256, its own `ADMIN_SESSION_SECRET` (≥ 32 chars; **fails closed** if missing, short, or equal
to `TOOLS_SESSION_SECRET`), subject = `GhlAccount.id`. Cookie `reiblast_admin`: host-only (no `domain`), HttpOnly, Secure,
SameSite=Strict, 8 hours. `requireOwner()` re-checks on **every** page, server action and API handler that the host is an
admin host, the token verifies, the account still exists and is `internal`, its locationId is still allowlisted and matches
the token, and its `User` is `active`. Sign out clears the cookie and logs it.

## Setup

1. Migrations (pipeline branch first): `20260927000000_ghl_account_type`, `20260927010000_admin_auth_tables`.
2. Provision the owner (dry-run first, refuses the production host):
   `PRISMA_TARGET=dev npx tsx scripts/admin/provision-owner.ts --email=<agency email> --contact-id=<HQ contact id>` then `--apply`.
   It verifies via read-only GHL GET that the contact is in the HQ location and has a phone.
3. Fallback auth: `PRISMA_TARGET=dev npx tsx scripts/admin/setup-owner-auth.ts` (dry-run) then `--apply`. Save the printed
   `ADMIN_TOTP_SECRET` and backup codes (shown once); add the secret to an authenticator app by manual entry.
4. Set env vars in Vercel (and `.env.local`): `ADMIN_SESSION_SECRET`, `ADMIN_TOTP_SECRET`, `ADMIN_LOCATION_IDS` (= HQ location
   id), `NEON_STORAGE_LIMIT_MB`; on Preview also `ADMIN_PATH_ACCESS=true`.
5. Add `admin.reiblast.app` to the Vercel project's domains; create the GHL custom menu link above in the HQ sub-account.

The setup scripts write only to the database in `DATABASE_URL`; run them against the pipeline branch with
`DATABASE_URL`/`SEED_DATABASE_URL` pointing at it. Production needs the same steps, deliberately, later.

## Audit log (`AdminAuditLog`, append-only)

`action`: `login_sms`, `login_totp`, `login_backup`, `login_failed` (detail: stage + reason), `sms_sent`, `export`, `logout`,
with `ip` (first `x-forwarded-for`) and `createdAt`. Used for the login throttle and TOTP replay protection.

## Views

All reads go through `getBillingDb()` and the shared query library `lib/billing/reports/*`; every page starts with
`pageCtx()` (owner check, billing DB, link base) and every export handler with `ownerOr401`. Member logic filters
`accountType = member`; labels come from `lib/admin/accountLabel.ts`. Money is exact decimal strings end to end
(`lib/billing/reports/money.ts`); recharts receives rounded numbers for plotting only. Month buckets are **America/Denver**
months (`occurredAt` for the ledger, `settlementTime` for wallet rows). Every page shows the footer: "Gross collected via
GHL — processor fees, chargebacks and payouts not included. Reporting timezone: America/Denver."

| Route | What it shows |
|---|---|
| `/` | Health badges, this month vs last month net revenue, agency cash paid, gross cash margin, members by state (each links to its page), negative balances, strikes |
| `/revenue` | Net revenue by Denver month × class (chart + table), processor eras, Attempts table. Cells drill down to `/revenue/rows` |
| `/costs` | Wallet costs by month / scope / category in four groups. Cells drill down to `/costs/rows` (raw rows, **one month at a time**) |
| `/margin` | Agency gross cash margin by month, per-member margin (sortable), "Unmatched" line, optional fee estimate, "Partner split — formula pending" |
| `/members`, `/members/[id]` | Member list (state filter, sortable) and drill-down (ledger, usage by category, wallet transactions, balance history, revenue-vs-usage chart) |
| `/health` | Job/data-quality/balance/database health (Task 5) |

### Rules (one definition each; page, drill-down and CSV share the same function)

- **Net revenue** = `SUM(amount − amountRefunded)` over ledger rows with `status IN (succeeded, refunded)`, excluding
  `trial_auth` and `failed_signup`, by Denver month of `occurredAt`; classes: core, wallet auto-recharge, wallet manual
  recharge, and **Other / unclassified** (so the total never drops a row). Refunds are attributed to the original
  transaction's month; `refundDetectedAt` is shown where present, "predates tracking" otherwise.
- **Attempts** = every ledger row that is not revenue (failed/pending, `trial_auth`, `failed_signup`). Revenue and attempts
  partition the ledger.
- **Processor eras** come from `BillingLedgerEntry.provider` and dates over the whole ledger, always labelled
  "GHL processor: <name>" (unrelated to the REItools Stripe integration).
- **Costs** come from `WalletTransaction` by Denver month of `settlementTime`. Groups: **one-time** (`a2p_registration`,
  `a2p_fast_track`, `domain_purchase`, `caller_id_verification`), **agency cash** (`agency_auto_recharge`,
  `agency_manual_recharge`), **taxes** (`wallet_sales_tax`), **ongoing** (everything else). Scopes are kept separate:
  members, REIblast HQ, `_agency`, `_unattributed`. Aggregates display costs positive; drill-downs and raw exports keep
  the stored sign (charges negative, recharges positive).
- **Gross cash margin** = net revenue − agency cash paid to GHL − wallet sales tax, per Denver month. This is a cash view;
  processor fees, chargebacks and payouts are not in the data. If `ADMIN_PROCESSOR_FEE_PCT` (0–100, exclusive) is set, a
  separate line labelled "estimate" shows that percentage of net revenue; unset hides it.
- **Per-member margin** = wallet recharges + core subscription collected (net of refunds) − wallet usage charged (member
  scope). Ledger rows with no account are the "Unmatched" line; revenue on a non-member account is surfaced, never dropped.
- **Denver vs UTC**: monthly figures differ from UTC-month reports by the rows near midnight UTC. Example: August member
  usage is −888.483003 by UTC month (matches `UsageRollup`) and −906.046875 by Denver month.
- **Members**: "Covered until" = `GhlAccount.coreCoveredUntil` + `coreCoverageNote` (manual override) and "Expected next
  charge (≈)" = latest succeeded core payment + 1 month, always labelled an estimate; if `coreCoveredUntil` is later than the
  estimate (or there is no estimate) an "override applies" badge shows. Coverage ends at 00:00 America/Denver on the stored
  date. Set it with `scripts/billing/set-coverage.ts` (see `docs/billing-jobs.md`, "Core coverage override").

### CSV exports (`/api/admin/export/[view]`)

Views: `revenue`, `attempts`, `costs`, `margin`, `members`, `member-ledger`, `member-usage`. The query string is the page's
filters (`from`, `to`, `month`, `class`, `provider`, `account`, `group`, `scope`, `category`, `scopeKey`, `state`, `sort`,
`dir`, `member`, `by=member`), parsed by the same code as the pages (`lib/admin/filters.ts`). Add `detail=1` to
`revenue`/`attempts`/`costs` for row-level data.

- **Raw wallet-transaction exports** (`costs&detail=1`, `member-usage`) require `month=YYYY-MM` (one Denver month, max);
  aggregate exports do not. Largest month today (85k rows, 18 MB) streams in ~11 s.
- Streamed with `papaparse.unparse` in chunks (keyset pagination on (timestamp, id)); metadata rows first ("REIblast admin
  export", view, filters, generated-at Denver + UTC, classifier version, reporting timezone, the gross-collected
  disclaimer), then the header, then data including every id. Dates are ISO UTC plus a Denver column.
- Text columns (descriptions, labels, notes) starting with `= + - @` get a leading `'` (spreadsheet formula injection);
  numeric columns are never altered.
- Every export writes an `AdminAuditLog` row (`action: export`, view, filters, `rowCount`, `partial: true` if the client
  aborted). Each handler starts with `ownerOr401` (middleware does not cover `/api`).

### Tests

`npm run test:admin` (auth, routing, CSV, filters, labels, alert rules), `npm run test:billing` (classifier, ingest, jobs and
all report rules with synthetic data), and `REPORTS_TEST_DATABASE_URL=<non-production url> npm run test:reports-db` — SQL
tests for the cost queries on synthetic rows in a `TEMP TABLE` that shadows `"WalletTransaction"` inside a transaction that
is always rolled back (no real data is read or written; skipped when the URL is unset; refuses the production host).
