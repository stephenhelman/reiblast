# REItools — Platform Architecture (v3)

The backbone spec: how the **catalog**, **entitlements**, **credits/wallet**, **vendor cost**, and
**admin data layer** fit together. Per-tool build details live in `REItools-Tool-Specs.md`; visual
design in `REItools-Design-Brief.md`.

**How to read this doc:** the top half (§0–§13) is **current-state and authoritative** — what is
actually built and decided as of the latest changelog date. The bottom half is a **condensed
changelog** — one line per dated decision, preserving what changed and what was rejected, without
burying the current truth. When the changelog and the top half disagree, **the top half wins** (it's
the reconciled current state; the log is history). A fresh chat reads §0 first, then the top-half
systems relevant to its task, and dips into the changelog only for the _why_ behind a decision.

---

## 0. Migration & database operating rules (LOCKED — read before ANY schema work)

Non-negotiable, and they precede all other work. They exist because a `prisma migrate dev` run against
production once dropped `_prisma_migrations` and wiped tables with no interactive prompt — recovered
only by Neon point-in-time restore. Every rule guards against a repeat.

**Environments:**

- `DATABASE_URL` = **PRODUCTION** (`ep-restless-silence` Neon branch). The Prisma CLI and
  `prisma.config.ts` operate on this. Real member data.
- `SEED_DATABASE_URL` = the **DEV** branch (`ep-bold-frost`). App runtime hits this locally; author
  migrations and seed here.
- Confirm which URL a command hits BEFORE running it. `prisma.config.ts` can override `.env`.

**Rule 1 — Prod gets `migrate deploy` ONLY.** Never `migrate dev` / `reset` / `db push` against
`DATABASE_URL`; they can reset/wipe with no prompt in a non-TTY. `deploy` only applies pending
migrations forward and cannot reset.

**Rule 2 — Author migrations on a NON-prod DB.** Create + verify with `migrate dev` (or `migrate diff`
→ file → `migrate deploy`, the non-interactive-safe path an agent session should use) against the DEV
branch, where reset is harmless. Then deploy to prod.

**Rule 3 — `main` is the migration trunk.** ALL schema changes originate on `main`, deploy to prod from
`main`, then flow to `tools/launcher` by merging `main` in. Schema is UNIVERSAL — shared across both
branches and both DBs (only Stripe price IDs stay null in prod until go-live; only SEEDING is dev-only).
Never originate schema on `tools/launcher`.

**Rule 4 — Branch/schema divergence is the core hazard.** Multiple branches with divergent schemas share
one prod DB; a `migrate dev` from a branch missing another's applied migrations sees them as drift and
tries to reset. The trunk pipeline prevents it. If branches diverge, reconcile by copying migration files
VERBATIM (byte-exact `git checkout <branch> -- <path>`) so histories agree; never re-migrate to "fix" drift.

**Rule 5 — Migration files are immutable.** Never edit/regenerate an applied migration (checksum mismatch =
"modified after applied" = the reset trigger). New migrations only, timestamped last.

All 30/30 green with no ambient shell vars, purely from the `vitest.setup.ts` file load. All four verifications pass. Summary of the build:

**Files changed:**

- `prisma.config.ts` — deterministic `.env.local` → `.env` dotenv load, `PRISMA_TARGET`-gated selector (throws on unset/invalid target, missing target URL, or a resolved-host/target mismatch), and overwrites `process.env.DATABASE_URL` in-process so the schema's hardcoded `env("DATABASE_URL")` actually follows the resolved target (see note below — this was a real bug caught during verification, not a hypothetical).
- `package.json` — added `db:status:dev`, `db:status:prod`, `migrate:dev`, `migrate:deploy:prod` scripts (prod limited to `deploy`/`status` only, per rule).
- `vitest.config.ts` — added `test.setupFiles: ['./vitest.setup.ts']`.
- `vitest.setup.ts` (new, referenced by the above) — loads `.env.local` into the test process.
- `lib/prisma.ts` — runtime datasource resolution now throws in non-prod when `SEED_DATABASE_URL` is missing, instead of falling back to `DATABASE_URL`. Prod behavior unchanged.

**Selector logic (prisma.config.ts):** `PRISMA_TARGET` must be exactly `dev` or `prod` or it throws immediately; `dev` requires `SEED_DATABASE_URL` and throws if that resolved URL contains the prod host string; `prod` requires `DATABASE_URL` and throws if it contains the dev host string. The resolved URL is written to both `process.env.DATABASE_URL` and `datasource.url`.

**Verification results:**

- `npm run db:status:dev` → resolved host contains `ep-bold-frost` (DEV). Schema up to date.
- `npm run db:status:prod` → resolved host contains `ep-restless-silence` (PROD). Schema up to date.
- `npx prisma migrate status` (no `PRISMA_TARGET`) → threw `PRISMA_TARGET must be 'dev' or 'prod' — refusing to resolve a database.` before any connection was attempted.
- Engine test suite run with `SEED_DATABASE_URL`, `TOOLS_SESSION_SECRET`, `DATABASE_URL` explicitly unset from the shell → 30/30 passed, proving the vitest fix (not ambient shell state) supplies them.

**Mid-build correction worth flagging:** the first dev-target run actually connected to the PROD host despite resolving `SEED_DATABASE_URL` correctly — `datasource.url` in `prisma.config.ts` doesn't override `schema.prisma`'s `url = env("DATABASE_URL")` for the CLI's actual connection. I did not edit `schema.prisma` (out of scope); instead I made the resolver also overwrite `process.env.DATABASE_URL` in-process, which fixed it and was reverified before reporting.

No schema file was changed, no mutating migrate command ran, and prod was only ever touched via read-only `migrate status`.

**Destructive commands require a human.** `migrate reset` and anything that can drop/wipe is run by a person
who has confirmed the target — never routed around an agent-safety guard. If a tool's safety prompt blocks a
reset, that guard is correct; surface the command for a human to run knowingly.

**The standing pipeline for any schema change (the exact process):**

1. On `main`, edit `schema.prisma`; `prisma validate` + `tsc`; commit the schema edit (no migration yet).
2. Confirm DEV is current with prod — read-only `migrate status` against `SEED_DATABASE_URL` (no drift, new
   migration absent). Sync dev first if behind; never let `migrate dev` reconcile a gap.
3. Author against DEV — `migrate dev` (or `migrate diff` → file) pointed at `SEED_DATABASE_URL`; review the
   emitted SQL (additive unless a drop is intended); this regenerates the client (real `tsc` green).
4. Hand-edits (partial indexes, etc. Prisma's DSL can't express) go in BEFORE commit, re-applied via a DEV
   `migrate reset` so the file's checksum matches its applied state.
5. Commit the migration file on `main`.
6. Deploy to PROD — `migrate deploy` against `DATABASE_URL` (confirm host + that it's `deploy`); read-only
   `migrate status` to confirm.
7. Merge `main` → `tools/launcher` so tools inherits the file (schema conflicts are additive keep-both; a
   conflict inside an existing migration file is a red flag — stop).
8. Push both branches.

---

## 1. The core model — two orthogonal axes, two tables

Everything hangs on separating these, and they are two DB tables:

- **Feature** = the _entitlement / billing / metering / tiers_ unit ("can you run a cycle"). Owns `slug`,
  `bucket` (core_included | addon), `meteringShape` (per_cycle | by_volume | none), `creditCost`,
  `unitsPerDebit`, `consumptionEvent`, and (multi-surface only) `unifiedName`/`unifiedTagline`. No `active` —
  availability derives from its surfaces. Owns `tiers`, `surfaces`.
- **Tool** = the _render surface / card + activation_ unit ("can you open it"). Owns per-card identity and
  the per-surface **`active`** gate, `featureId`, `launchable`, `launchTarget`.

Most features have one surface. **Bots is the exception:** one `bots` Feature, two surfaces (`acq`, `dispo`),
collapsing to a single **REIclose** card when BOTH are active. Which bot is live is per-surface `active`, so
bots launch one at a time; the collapse is a derived render rule, not a stored state.

**`active` is a DB column and THE gate.** Activating a tool is a DATA change, not a deploy. Every surface
derives what it renders from `active`; composite availability (a bundle renders only if all its covered
surfaces are active) is DERIVED, never separately stored.

---

## 2. Source of truth — DB-authoritative catalog

The catalog (Feature/Tool/Tier/Bundle/BundleTier/CreditPack/BundlePriceOverride) lives in Postgres, not repo
config, because `active` and the enforcement fields must be editable without a deploy. `lib/catalog.ts` reads
Prisma behind stable accessors. It is one source of truth feeding every render surface (pricing page, store,
launcher, discovery).

---

## 3. Entitlements — subscriptions are always tool_subs; bundles are derived

`Subscription` is always a **tool_sub** pointing at a `Tier` (required `tierId` + denormalized `featureId`);
`status`, `periodStart/periodEnd` (the allowance window), `stripeSubscriptionId` (NOT globally unique — one
Stripe subscription spans N rows, one per item). Stores ZERO numbers — allowance/price read through the tier.

**There is no bundle-type subscription.** A bundle member is N tool_subs at in-bundle prices; "which bundle
am I on" is DERIVED via `qualifyBundle()` (see §5). This killed `Subscription.type`/`bundleId`.

**Replace-not-stack:** one active tool_sub per (user, FEATURE), enforced by a partial unique index on
`(userId, featureId) WHERE status='active'`. Highest access wins via `max(level)` over the ordered
`TierLevel` enum (base < plus < pro); bundle-vs-solo overlap resolves at read time, not by constraint.

**Webhook write ordering (load-bearing — do not reorder).** The receiver lands a subscription event in ONE
transaction as: (1) resolve every current item's Price → `{tierId, featureId, period}` (pure reads, no
writes); (2) **cancel** rows for that `stripeSubscriptionId` whose `tierId` is not among the current items;
(3) **upsert** the current items. Cancel MUST precede upsert. The `(userId, featureId) WHERE status='active'`
index is _partial_ and therefore cannot be `DEFERRABLE` in Postgres, so its check is immediate — a
same-feature tier change (in-bundle upgrade/downgrade, e.g. score plus→pro) that inserted the new-tier row
before canceling the old-tier row trips P2002 at insert time and deadlocks on Stripe retry. The per-item
slot is `(stripeSubscriptionId, tierId)` and the upsert's locate is **status-AGNOSTIC**: a canceled row
still occupies its slot, so a downgrade back to a previously-held tier must _resurrect_ (update) that row,
not create a duplicate (which would trip the per-item unique). Verified by the Chat-B gate as real
transitions on one live sub (upgrade → old row canceled/new active; downgrade-back → original row
resurrected; no P2002). Any extraction of this write path (see the v1.5 `landSubscriptionItem` plan) MUST
preserve both the cancel-before-upsert ordering and the status-agnostic locate — a single-item test passes
even with the bug present, so it will not catch a regression here.

## SHIPPED 2026-09-21 (engine phase 1–2) — the extraction is done. landSubscriptionItem(tx, {userId, tierId, featureId, periodStart, periodEnd, status, stripeSubscriptionId}) (lib/engine/subscriptionLand.ts) is the CORE: status-agnostic findFirst-then-update-or-create on (stripeSubscriptionId, tierId), no orphan-cancel, no price resolution. cancelOrphanSubscriptions(tx, scope) is the shared helper, two scope shapes — {stripeSubscriptionId, excludeTierIds} (webhook) or {userId, featureId, excludeTierId} (comp and the consent paths). handleSubscriptionEvent is now a thin ADAPTER: keeps the resolve phase and the cancel-before-upsert ordering, calls the helper then the core per item. tx is NON-OPTIONAL by intent — do NOT relax it to fund()'s dual client/tx shape. fund() accepts a bare client OR a tx because a credit grant stands alone; the sub core must NOT, because every consent path commits the entitlement write ATOMICALLY with its consent record (MemberAction at the break gate, AdminAction at the comp). A core that could open its own tx would let a caller write an entitlement outside the consent's transaction — the exact failure the consent architecture exists to prevent. Regression coverage now drives a real multi-item bundle through in-bundle upgrade → downgrade-back (resurrect-by-row-id, no P2002) — the coverage §3 warned a single-item test could never give.

## 4. Pricing (LOCKED — authoritative)

Core membership **$57/mo**, billed via GHL/Ari (walled, never OP Stripe) — includes Score base (10
analyses/mo) + Scrub (free). **Credit unit = $0.25.** Everything else is OP Stripe (splits with Ari after
cost, except op-direct which is 100% OP).

**Credit debit map:**

| Feature | Debit            | $ pay-go/overage         |
| ------- | ---------------- | ------------------------ |
| Score   | 5 cr / analysis  | $1.25                    |
| Scrub   | 0 (free)         | —                        |
| Pack    | 4 cr / packet    | $1.00 (pay-go only, §5a) |
| Ask     | 1 cr / 3 queries | $0.083/query             |
| Close   | 10 cr / handoff  | $2.50                    |

**À-la-carte ladder:** Score plus $29 (50) / pro $49 (175) · Ask base $29 (500q) / plus $49 (1,500q) —
**no Ask pro, ever** · Close base $99 (60) / plus $169 (120) / pro $299 (250) · Pack pay-go only · Scrub free.
Ask is priced to the trained-expert-AI substitute, not to Haiku cost.

**Ladder rule:** pay-go/overage per-unit price must stay ≥ the next tier's marginal rate, so a pack never
beats moving up a tier. (This is why Ask is 1cr/3q not 1cr/5q.)

---

## 5. Bundles — companion-gated, derived, per-line in-bundle pricing

**Composition (locked):** Bundle Plus = score/plus + ask/base (+ Pack perk). Bundle Pro = score/pro + ask/plus

- close/base (+ Pack perk). Pack is never a bundle line (§5a).

**Qualification is tier-floored on the subscription lines** via `qualifyBundle(tiers)`: Plus on {score≥plus,
ask≥base}; Pro on {score≥pro, ask≥plus, close≥base}; Pro precedence; Pack never qualifies. Floored = higher
tiers still qualify.

**Per-line in-bundle prices** (discount distributed AWAY from cost-heavy lines — Score/Close shallow, Ask
absorbs depth; every line below à-la-carte, above its cost floor):

- Bundle Plus: score/plus $29→$25, ask/base $29→$21 (sub $58→$46, 21%). Pack perk: 5 free/mo then $1.
- Bundle Pro: score/pro $49→$45, ask/plus $49→$39, close/base $99→$89 (sub $197→$173, 12%). Pack perk: 10 free/mo then $1.

**In-bundle UPGRADE cells (a line upgraded above the bundle floor, still short of the next bundle).**

- Qualification is floored (§5), so a member can hold a tier ABOVE their bundle's floor and still qualify — e.g. score/pro while on Bundle Plus. That upgraded line must NOT fall back to à-la-carte. (The original bug: an unpriced (feature, level, bundle) cell defaulted to full à-la-carte, punishing the in-bundle upgrader — it was a missing price row, not a qualification break.) Fix: price the reachable upgrade cells BELOW à-la-carte and ABOVE the bundle's floor-line discount — monotonic per line: à-la-carte > upgrade-in-bundle > floor-in-bundle. Floors unchanged. Four cells:

- feature/level bundle à-la-carte upgrade-in-bundle
- score/pro bundle-plus $49 $47
- ask/plus bundle-plus $49 $44
- close/plus bundle-pro $169 $159
- close/pro bundle-pro $299 $281

- These are ordinary BundlePriceOverride rows (same mechanism above), taking the table to 9 rows (5 floor + 4 upgrade) and recurring Stripe Prices to 16 (7 à-la-carte tier Prices + 9 override). resolveStripePriceId now finds a row for these four instead of falling through. Cells that would tip a member into the NEXT bundle's floor are deliberately NOT priced here — qualification promotes them and the nudge-to-higher-bundle fires instead (bundleNudge.ts).

**The retention lock is the reprice, not the headline %:** every subscription line reprices to à-la-carte if
the qualifying set breaks.

**Data shape:** sparse `BundlePriceOverride` table `(feature, level, bundleSlug) → stripePriceId`, one row only
where in-bundle ≠ à-la-carte; resolver/cart/webhook fall back to the tier's own `stripePriceId` on no row.
`Bundle`/`BundleTier` are definition-only (no `stripePriceId`, never a subscription target). `qualifyBundle`,
`composeBundleLines` (bundle → N priced lines), and `resolveStripePriceId` (override-else-à-la-carte) are the
shared functions cart/webhook/surfaces all read — never reimplemented.

### 5a. Pack — value-priced pay-go perk (the model exception)

Not a subscription, not a bundle line. Pure pay-go at 4 cr / $1.00 per packet, priced to value (~$0.01 cost).
Same $1 always (never reprices, never in a consent flow). In a bundle it's a granted monthly packet allowance
(Plus 5, Pro 10) then $1. $1 is an attach-rate lever (documented raise to $2/8cr if attach is inelastic). No
Pack Stripe subscription Prices; packets consume 4 wallet credits.

---

## 6. Wallet, credit ledger, and the CLIENT/ADMIN audience split

**The audience line (LOCKED — this was violated once and corrected):**

- **`LedgerEntry` = CLIENT-EYES.** A per-user record of _their_ credits, allowance, and wallet evolution.
  Answers the client's question ("what did I use, what's my balance"). Carries **NO company cost**. Admin may
  view it, but it exists for the client.
- **`ToolUse` + `ApiCall` = ADMIN-EYES.** Company usage + cost, for margin. See §8.

**Wallet** — 1:1 with User, one shared `balance` (the single materialized number). Available balance =
`balance − sum(open CreditHolds)` (§7).

**LedgerEntry** — append-only, never updated; `creditDelta` is the only balance-affecting field; discriminated
by `kind` (funding | consumption). Funding rows: `reason` (pack_purchase | tier_grant | bundle_grant |
adjustment), `creditPackId?`, `refId?`. Consumption rows: `toolId`, `featureId`, `unitCount`, `creditsDebited`,
`allowanceCovered`, `outcome` (success | fail), `toolUseId` (the run this settles; null for funding). **No
vendor cost anywhere on it.**

**Materialize vs derive:** the wallet balance is the one materialized number (atomic decrement). Allowance-used
is DERIVED (count of covered success consumption rows in the period) — no counter, no rollover cron; the period
window is the reset.

**CreditPack** — flat universal top-up (credits, priceCents, stripePriceId). Not per-tool. Credit-pack SKUs at
$0.25/credit: flat, laddered by size, no volume discount (curves deferred).

**Metering engine (§6 logic, built + tested):** `resolveFeature` (pure read: highest-wins level, allowance
through the tier, used derived, calendar-month window for the base tier), the two-phase **lock-free** meter
(`precheck` → do work → `chargeOnSuccess`/`recordFailure`), and `fund`. Charge on success only, per billable
CYCLE not per internal step. Strict block: run only if allowance remains OR balance ≥ full cost; else
out-of-credits. Negative balance is race-only, never blocks an allowance-covered unit. `withMeter` wraps these
and is a ready-to-attach helper (see §12 build state).

---

## 7. CreditHold — reserved credits (bots cost protection)

Bots are session-scoped (a handoff is an autonomous SMS conversation over minutes/hours; many concurrent), a
check-then-commit race window the per-cycle strict gate doesn't cover. `CreditHold` is the fix: reserve credits
at conversation open (`state: open`), gate every reservation against **available = balance − sum(open holds)**,
decline at activation if unavailable (bank-style). On settle → convert to the debit (`committed`, links the
`LedgerEntry` via `settledLedgerEntryId`) or release (no charge). Expiry/sweep handles dead conversations.

The **ledger stays ACTUAL-only**; holds carry PENDING. Member history display aggregates settled ledger rows +
open holds at READ time (never a table merge). Bounded ~6 open holds/subscription, so the table stays small.
Model exists; the reserve/commit/release LIFECYCLE is the metering chat's job.

---

## 8. Admin data layer — three tables, three questions (ADMIN-EYES)

The separation of concerns that lets you ask "did the charge cover the cost." A metered run =
**1 ToolUse → N ApiCall → (if metered) 1 LedgerEntry**, all sharing `toolUseId`. The correlation is the value.

- **ToolUse = behavior** ("who ran what, when, outcome"). Keyed on BOTH `locationId` (behavioral anchor — which
  location uses tools most) and `userId` (actor + the join key to the ledger). `isAdmin` frozen at write (not
  derived — keeps historical expense math stable if a role changes). `featureSlug`, `kind`, `outcome`
  (success | fail | partial), promoted behavioral columns (compSource, escalated, turnCount, recordCount, …)
  as real columns for admin group-bys, plus `detail Json?` for the long tail. Grain differs per tool (Score =
  1 analysis, Ask = 1 query, Bots = 1 conversation, Scrub = 1 run, Pack = 1 packet) — do not conflate.
- **ApiCall = vendor spend** (N per run, one per real vendor hit). Carries `resource`, `model`, tokens, and
  **`costCents` — where company cost lives** (frozen per call). `isAdmin` frozen, `toolUseId` links to the run.
- **LedgerEntry = client money** (§6). Cost is NOT here.

**Cost lives on `ApiCall.costCents`, not the ledger** (corrected 09-17): cost is a per-resource fact; you need
per-tool/per-vendor/per-model cost to decide when to upgrade Rentcast and set the AI budget, which a run-level
ledger sum can't give. It also means admin/free runs (ApiCalls, no ledger row) still capture cost. Margin =
ApiCall cost (admin) vs Stripe revenue (pulled later), never the ledger.

**`role` on User** (`user | admin | manager | team_lead`) — same session, admin surfaces gate on `role: admin`.

---

## 9. Vendor cost model (LOCKED 2026-09-17)

Cost freezes on `ApiCall.costCents` from an admin-editable, effective-dated rate book — so raising a vendor
price is data, not a redeploy, and past calls keep their historical cost.

- **`VendorRate`** — append-only, effective-dated (`resource`, `model?`, `flatCents?`,
  `perMillionInputTokens?`, `perMillionOutputTokens?`, `effectiveFrom`). "Rate for a call" = latest
  `effectiveFrom ≤ call time`. Raising a price = INSERT, never update. Seeded: **Melissa 4¢ flat**
  ($40/1000); **Anthropic Sonnet 200/1000** (=$2/$10 per M in/out); **Anthropic Haiku 100/500** (=$1/$5 per M).
  Both models priced because Ask runs on Haiku and Bots escalates Haiku→Sonnet. **No Rentcast VendorRate row.**
- **`VendorPlan`** — subscription vendors ONLY (`resource`, `baseMonthlyCents`, `includedQuota`,
  `overageCentsPerCall`, `periodAnchorDay`, `active`). Seeded: **Rentcast $74/mo (7400¢), 1000 calls, 6¢
  overage, anchor day 1.** The plan's ABSENCE marks a vendor as pure per-call (Melissa has none).

**Rentcast cost is derived read-side, not per-call (Option B).** A Rentcast `ApiCall.costCents` is **null** —
its real cost is `(baseMonthly + max(0, periodCalls − quota) × overage) ÷ periodCalls`, computed over the
vendor period. This is the client-allowance model turned inward at your vendors. Null is the deliberate signal
"compute from the plan; don't sum me," so `SUM(costCents)` gives true per-call vendor cost (Melissa+Anthropic)
without a bogus Rentcast number.

**Margin per tool** = per-call vendor cost summed from `ApiCall.costCents` + Rentcast's period-allocated share
(count × plan), vs Stripe revenue. Upgrade timing (Rentcast → next tier ~3,000 sustained calls/mo) is a
read-side data point Stephen acts on, NOT a modeled tier ladder. Protect the comp-cache — it lowers Rentcast
calls/analysis and defers every plan upgrade. SMS on Close is user-incurred, rebilled via Ari — keep OFF the
margin ledger.

**Canonical model keys (CROSS-CHAT CONTRACT, locked 2026-09-17).** `ApiCall.model` and `VendorRate.model`
must use the SAME strings so the cost join is exact-match (no substring hack):

- **`claude-sonnet-5`** — matches what prod's analyzer already writes today. Seed + VendorRate align up to it,
  so the substring match in `lib/adminResources.ts` can drop for Sonnet immediately.
- **`claude-haiku-4-5`** — Haiku 4.5; the forward standard. No prod Haiku writes exist yet (Ask/bots not live),
  so this is the string the metering/analyzer chat MUST write when it wires Haiku, or the join breaks on real
  data. The seed already writes both canonical keys.

---

## 10. Money flow (three streams)

1. **Core membership $57/mo** — Ari's GHL processor, walled, never touches this DB. The one crossing: base
   Score access, granted by `status: active`, its allowance a cost OP bears against op-split revenue.
2. **OP Stripe** — add-ons, tiers, bundles, credit packs. Stephen collects, pays all API/data bills, splits the
   remainder with Ari after cost.
3. **Op-direct** (REIsite ~$500 + upkeep, REIkit TBD) — OP Stripe, 100% OP, no split. `bucket: op-direct`,
   `launchable: false`, sales on `Transaction`, never metered/tiered/bundled.

---

## 11. Launcher card states (derived from `active`, not stored)

Derived per surface: coming-soon (inactive), core-included (active, membership-granted), owned-addon (active +
subscription), out-of-credits (owned, allowance spent, balance can't cover — block the unit, prompt top-up),
op-direct (link-out). Bundles render only if all covered surfaces active; the REIclose card appears only when
both bots surfaces are active.

---

## 12. Build state (as of 2026-09-18)

**Live in prod:** the full engine schema (catalog, entitlements, wallet, ledger), the admin data layer
(ToolUse, ApiCall upgrade, CreditHold, User.role), and the vendor-cost model (ApiCall.costCents, VendorRate,
VendorPlan; LedgerEntry.vendorCostCents dropped). Migrations flow main → prod → tools/launcher.
Also live: the consent/cart schema — MemberAction (append-only member price-consent audit),
Cart/CartLine (saved-cart checkout-staging), and the AdminActionType/FundingReason enum
extensions — via migration 20260918214506_add_member_action_cart_admin_funding_reason
(schema only; nothing writes these tables yet).

**Built + tested (code):** the §6 metering engine (resolver/meter/funding, tested); the bundle-retirement +
09-14 pricing reconciliation (resolver, checkout expansion, webhook landing N tool_subs, override-table pricing,
the shared qualify/compose/resolve functions); the store/account/discovery surfaces on the derived-bundle model;
Stripe setup (mintCheckout + embedded checkout + test-mode Prices); `withMeter` rewritten for the new schema
(cost on ApiCall.costCents, ledger client-eyes only) — 12/12 engine tests passing.

**Dev data (`scripts/seed-dev-data.ts`) — the dev DB source of truth.** Prod-guarded (reads
`SEED_DATABASE_URL` only; refuses if the host looks like prod `ep-restless-silence`; requires dev
`ep-bold-frost`), idempotent + deterministic (seeded PRNG; wipes its own `@seed.reitools.dev`-marked rows and
rebuilds identically), self-contained (creates its own users + all their activity). What it produces:

- **~7,300 correlated runs** (1 ToolUse → N ApiCall →, if metered, 1 LedgerEntry, all sharing `toolUseId` via
  client-generated ids; bulk-inserted via `createMany` accumulators for speed). ~12k ApiCalls, ~5.4k ledger rows.
- **18 users across every `User.status`** (pending_onboarding → onboarding_complete → provisioning → active →
  inactive → suspended); one flipped to `role: admin` (`admin@seed.reitools.dev`); pre-provisioning users carry
  no wallet/usage.
- **60-day upward-trending curve** (recent-weighted, with variance and two dips) so cost/usage/margin lines have
  shape. Volume tuned so the RECENT 30 days crosses the 1,000-call Rentcast quota (overage state renders) while
  an earlier window stays under (within-quota state).
- **Canonical model keys** `claude-sonnet-5` / `claude-haiku-4-5` on ApiCall.model, exact-matching VendorRate.
- **Cost model:** costCents real on Melissa/Anthropic (from the seeded rates), NULL on Rentcast; fails still
  write ApiCalls (spent-money-no-revenue). Fresh Score = 3 ApiCalls, cache = 1 (cost gap visible).
- **Plan-fit personas** via a `profile` (over/under/normal) shaping the allowance-vs-credit split, so upsell
  (over-utilizer) and churn-save (under-utilizer) cases exist; plus a negative-balance case and past_due/canceled.
- **Vendor tables** seeded to the locked numbers (VendorRate ×3, VendorPlan ×1 Rentcast).
- **KNOWN GAP (see changelog 09-18 balance bug):** the seed HARDCODES `Wallet.balance` and writes one
  made-up funding row, so the ledger does not sum to the balance. The reseed fix is to DERIVE the seeded
  balance from the seeded ledger (Σ creditDeltas). Not an engine bug — seed-only.

**NOT wired live:** `withMeter` is dormant — a ready-to-attach helper, not yet wrapping the live analyzer
routes, and the analyzer isn't yet instrumented to report real tokens/cost. Metering is telemetry-observe, not
charge, until the metering chat wires it. CreditHold lifecycle is modeled, not built. Stripe is test-mode; live
Prices + go-live pending. Admin SURFACES are unbuilt (design chat).

---

## 13. Sequence to launch (from here)

1. **Metering write-path chat** — wire `withMeter` around the live analyzer (close the session `{userId,
locationId}` bridge — the helper currently surfaces only userId), instrument real token/cost capture,
   populate ToolUse/ApiCall/costCents, build the CreditHold lifecycle. Cost freezes from VendorRate/VendorPlan.
2. **Admin surfaces chat (design)** — build the dashboard reading ToolUse/ApiCall (admin-eyes, margin, exclude
   `isAdmin` by default) + the client-eyes ledger views. Data is seeded and correctly shaped.
3. **Stripe go-live** — recreate Prices in live mode, wire the live webhook, ratify credit-pack SKUs, flip prod
   catalog rows off null.
   **Stripe checkout contract (CROSS-CHAT — session stamping ↔ webhook parsing must agree).**
   Identity: mintCheckout stamps every session with client_reference_id: userId, metadata.userId, and the
   catalog-row ids (tierId per subscription line; creditPackId for a top-up); subscription mode also sets
   subscription_data.metadata.userId, since client_reference_id does NOT propagate to renewal/cancel/
   past_due events. First purchase create-or-attaches a Stripe Customer (metadata.userId) and writes
   stripeCustomerId back to User, so all later lifecycle events resolve customer → User via that column,
   never email. The webhook reads exactly these keys; go-live rewires the LIVE webhook against the same
   contract — if either side's keys change, they change together.
   Single-intent carts: mintCheckout rejects a mixed cart — a subscription tier line and a one-time
   CreditPack top-up cannot share one session (Stripe mode is per-session). One intent per checkout.
   UI: checkout renders as a fully custom Stripe Checkout Elements form (ui_mode 'custom'), NOT the hosted
   or embedded_page component — payment logic is client-side on our own form. (Supersedes the earlier
   embedded_page/createEmbeddedCheckoutPage/return_url approach.)
   DISCREPANCY FLAGGED 2026-09-21 (unresolved — contract owner to reconcile). This doc states ui_mode: 'custom'; the code (lib/checkout.ts:116) actually sets ui_mode: 'elements'. Either the doc is stale or the code regressed off the contract. Not a build-chat decision — the checkout-contract owner picks which is right and reconciles BOTH sides together (§13's rule: if either side's keys change, they change together). Consent-before-checkout wiring (a later phase) is unaffected either way — the MemberAction write sits before session mint regardless of ui_mode.
   CONSENT-BEFORE-CHECKOUT (shipped 5b). Two money paths both write a MemberAction (targetType:'Cart', type subscription_add / credit_pack_purchase) on member approval, BEFORE the checkout session mints: member-self checkout (the member's own open cart) and admin-staged finalize (the member completing an admin_staged cart = consent by construction). Consent is written in its own tx; mint is invoked after. Disclosure is computed from Tier.priceCents / CreditPack.priceCents — additive paths, so priceCents IS the number, no Stripe round-trip and no from-less gap (that gap is confined to the break/downgrade disclosure, §6b). Consent is written on approve only, never on modal-open.
   SDK pin: stripe@22.6.2, apiVersion 2026-08-26.dahlia — Checkout Sessions vocabulary here differs from
   most public examples; match the installed version, don't copy older docs.
   Receiver is replay-safe: every event is deduped on Stripe `event.id` via a `ProcessedStripeEvent` row
   inserted INSIDE the same transaction as the effect, so a replayed webhook is a true no-op. The marker's
   P2002 is discriminated from a Subscription-index P2002 on `err.meta.modelName`. Outer transaction timeout
   is 20s (Neon latency on multi-item bundle events). Go-live rewires the LIVE webhook against this same
   contract.
   **API-version gap (asserted, NOT tested — close before live traffic):** the Chat-B gate ran under
   `stripe listen`'s account default `2025-10-29.clover`, not the pinned `2026-08-26.dahlia`. The item-level
   `current_period_start/end` read — the reason period is read off the subscription ITEM, not the top-level
   object — was verified under clover only and merely inferred for dahlia. Go-live MUST register the prod
   endpoint pinned to `2026-08-26.dahlia` (a registered endpoint carries its own version, independent of the
   account default) and re-run the multi-item + in-bundle-upgrade cases against a dahlia-versioned event
   before live traffic. A version mismatch here is a SILENT null-period write: it passes `tsc`, lands rows
   with broken allowance windows, and never throws.
4. **REIscore fine-tune → launch.**

---

## Open threads (flagged, not resolved)

- Credit-pack SKU sizes at $0.25/credit (flat, laddered; must stay ≥ next-tier marginal rate).
- Rentcast billing anchor day — seeded as day 1; correct from a real invoice if different (one-field admin edit).
- What kept resetting the `ep-bold-frost` dev branch mid-work (happened 2–3×) — check Neon branch-op log; close
  so dev stops moving under active builds.
- **`.env.local` not auto-loaded by `prisma.config.ts`** — `SEED_DATABASE_URL` lives in `.env.local`, which
  `prisma.config.ts` does NOT auto-load; a Prisma command that forgets to load it manually falls through to
  `DATABASE_URL` = PROD. This is one forgotten `source` away from the incident §0 exists to prevent. Fix: load
  `.env.local` in `prisma.config.ts` (or move the var) so dev commands can't silently target prod.
- **Pipeline gap — `migrate deploy` applies ALL pending, not "the one" you reviewed.** This session, a stranded
  `vendor_cost_model` migration rode along inside an `AdminAction` deploy because prod was two behind, not one.
  Add to the §0 pipeline: immediately before deploy, run read-only `migrate status` against PROD and confirm the
  pending list is EXACTLY what you intend — no more, no less.
- REIkit pricing.
- **Reprice-on-break consent record.** [PARTIALLY RESOLVED 2026-09-18: the per-event record SHIPPED as
  MemberAction — append-only, frozen `consent` Json {timestamp, disclosureText, type}, migration
  20260918214506 — the member-side twin of AdminAction as planned. What REMAINS is wiring it at the
  downgrade/break confirmation gate (a subscriptions.update Stripe never sees the member consent to);
  no schema left, build-chat work.] §5 locks the survivor-reprice-to-à-la-carte on a broken bundle; the
  T&C carries the policy consent, but that does not evidence the per-event fact (member X, on date D, shown
  disclosure string S with the specific new prices, approved). Store the per-event record in OUR Postgres,
  keyed by `userId` — NOT the GHL/OP-Web-Studio contact (last-write-wins fields, retention we don't control,
  and the email join §13 bans). It's the member-side twin of the `AdminAction` append-only audit
  (`userId, changeType, before/after prices, rendered disclosureText, timestamp`); build it alongside the
  subscription-editing surface, since a cancel/downgrade is a backend `subscriptions.update` Stripe never
  sees the member consent to (the saved-cart "consent by construction" covers adds only).
- **Seed balance-integrity fix** (see 09-18 changelog): derive seeded `Wallet.balance` from the seeded ledger so
  Σ creditDeltas == balance. Seed-only; do before the cart/write chat trusts the ledger for admin writes.

  GO-LIVE + CROSS-CHAT ITEMS (surfaced across Phase 3–5b, owned elsewhere):

Break-disclosure "from" price (Stripe + data-model chats). The break/downgrade/cancel disclosure (Phase 3/4) shows the new à-la-carte survivor prices but NOT the prior in-bundle discounted rate, because that rate lives on the applied BundlePriceOverride → Stripe price, not derivable from catalog priceCents on this Stripe-excluded DB leg. At go-live the disclosure should show the delta (from → to) — materially better consent, especially for an admin-PROPOSED cancel the member didn't originate. disclosureText is already structured delta-ready (a labeled 'from' slot that fills when available); do not fabricate a number until it's real.
BundlePriceOverride should likely cache priceCents (data-model chat) + possibly its own stripePriceId (Stripe chat). Tier caches priceCents next to stripePriceId for display without a Stripe round-trip; BundlePriceOverride currently does not, which is why the "from" rate above needs a round-trip. Adding a cached priceCents to the override (a structural schema change → schema chat) would let the break disclosure show the true prior rate directly. Decide whether the discounted rate also needs its own Stripe price object/ID.
Mint-failure handling (Stripe chat). Phase 5b wraps the (excluded) real mintCheckout in a try/catch that SWALLOWS failures so dev catalog rows without backfilled Prices don't block the flow. That swallow must NOT survive to go-live: once Stripe is the real caller, a mint failure after consent has committed is invisible. The consent row correctly persists (audits approval, not execution); the Stripe chat must define real mint-failure handling (surface / retry / reconcile), not inherit a silent catch.
member_self cart carryover (already noted, still open). Cart is now a live DB object for member_self (5a), so the "browser→DB carryover" originally imagined has no browser layer to carry from — it was net-new and is now built. This item is effectively closed by 5a; remove it from open threads.

6a. Consent carriers — the shape the review surfaces build to (cross-chat contract, 2026-09-21)

Member consent (MemberAction) is the mandatory gate for ANYTHING that changes a member's Stripe billing shape — add, upgrade, downgrade, cancel — with comps the only exception (OP-borne, no Stripe charge, admin-direct). An admin action is a PROPOSAL, never an execution, for any billed-shape change; origin is irrelevant (member-asked or admin-decided), the trigger to pull is always the member's. Cancel is IN the gate, not out: cancelling one line can break the qualifying set and reprice survivors UP to à-la-carte + strip the Pack perk (§5), so a cancel can RAISE the bill — and an unconditional gate leaves no lane for a rogue admin. Two carriers, keyed by routing shape:

AdminAction.after = the resolved entitlement line set [{featureId, tierId, status}] — the same projection read off Subscription rows (and emitted by composeBundleLines), NOT Stripe-price-shaped, NOT a diff. This makes finalize-detection a set-equality read: "has the proposal executed" = live Subscription lines == AdminAction.after. before uses the same shape.
MemberAction.targetType = the proposal carrier's name — "AdminAction" on the CHANGE path (admin change to an existing sub: Admin→Member, no cart) and "Cart" on the ADD path (admin add: Admin→Cart→Member, member checks out the staged cart). The polymorphic ref carries the routing shape itself.

Three review states derive from these with NO new mutable column (schema stays frozen): pending = an open proposal (admin_staged Cart, or AdminAction) with no MemberAction referencing it; consented = a MemberAction references it but the effect hasn't landed (approved-then-abandoned checkout, add path); finalized = the effect landed (Cart at completed terminal / live Subscription == after) — a displayed-OFF state, i.e. the item drops off the review feed. Dev nuance: on the CHANGE path consent + execution are atomic (one tx), so the consented-in-flight middle state only physically opens at go-live, when Stripe's subscriptions.update→webhook round-trip pries them apart; on the ADD path that middle state is real now (an abandoned checkout leaves exactly it).

Consent-capture timing: synchronous effect → MemberAction in the SAME tx as the entitlement write (member break/cancel gate, direct DB — consent and effect commit together or not at all); deferred/async effect → MemberAction BEFORE the effect (consent-before-checkout — an abandoned checkout leaving an approved-but-unexecuted consent row is CORRECT, because MemberAction audits "shown disclosure S, approved at T," not execution). disclosureText freezes the SPECIFIC prices shown at approval (from resolveStripePriceId / the composed lines), so a stale row is accurate evidence of what was shown then; a fresh approval mints a fresh row.

The break/cancel disclosure computation — run qualifyBundle/resolveStripePriceId over the post-change line set, render the specific new prices — is the SAME for the member's own break gate and an admin-proposed cancel the member reviews. Written once, read by both.

---

6b. The entitlement core and its consent callers (shipped Phase 3–5b)

Every subscription entitlement write goes through ONE shared core, and each caller writes its OWN consent record — the two are deliberately NOT fused.

applySubscriptionTransition(tx, {userId, featureId, changeType, newTierId?}) (lib/engine/subscriptionTransition.ts) — the entitlement-only core. tx non-optional, writes NO MemberAction. Handles all three directions: upgrade and downgrade are mechanically identical at the entitlement level (cancelOrphanSubscriptions by {userId,featureId,excludeTierId:newTierId} then landSubscriptionItem — §3 ordering, cancel-before-upsert, status-agnostic locate); cancel is the status transition. It calls the Phase 1 cores (landSubscriptionItem / cancelOrphanSubscriptions), never reimplements them.

Why entitlement-write and consent-write are split: originally breakSubscriptionCore wrote both the entitlement change and its own MemberAction. That fusion forced a double-write when a second caller (admin-proposed finalize) needed to reuse the entitlement write while supplying its OWN consent record (the AdminAction back-pointer) — producing two MemberActions per downgrade/cancel finalize, the extra one indistinguishable from a member-initiated break, defeating the provenance the two-carrier design exists to carry. Splitting them makes one entitlement core with caller-supplied consent — the same shape principle as landSubscriptionItem (tx-only, caller composes), pushed up one level.

The consent callers (each writes exactly one provenance-correct MemberAction):

Webhook adapter — Stripe confirms → lands via the core (no MemberAction; Stripe is the actor, not a consenting member). [go-live]
Member break/cancel gate (Phase 3, lib/engine/subscriptionBreak.ts) — member edits their own sub; MemberAction targetType:'subscription', SAME tx as the entitlement write (synchronous → atomic).
Admin-proposed finalize (Phase 4, lib/engine/finalizeProposal.ts) — member approves an admin-staged change; MemberAction targetType:'AdminAction' (targetId = the proposal), SAME tx as the entitlement write. Delta sourced from AdminAction.after; disclosure via computeBreakDisclosure (reused from Phase 3).
Checkout consent (Phase 5b, lib/engine/checkoutConsent.ts) — member checks out a cart; MemberAction targetType:'Cart', BEFORE the mint, in its OWN tx (async → consent precedes the deferred Stripe effect).
Comp (Phase 2, lib/engine/comp.ts) — admin-direct exception, AdminAction only, no MemberAction (OP-borne, no member charge).

6c. The cart as a live DB object + admin/member mutual exclusion (shipped 5a)

The store cart is a live DB object, not browser state. Every add/remove/qty change writes through to a Cart(source:member_self, status:open) + CartLines directly (lib/engine/memberCart.ts, components/store/StoreClient.tsx) — no localStorage, no polling; the DB is the source of truth. This powers the re-entry reminder ("you still have X in your cart"), which needs a persisted cart, not React state.

Admin and member carts are mutually exclusive per (userId, mode) — by design, not limitation. The one-open-cart-per-(userId,mode) partial-unique enforces this at the DB level (P2002 if ever violated); app logic enforces it at the UX level so the DB never has to throw. Two directions:

Member adds while an admin_staged cart is open → the add is blocked, the member is routed to the proposal (approve → proceeds; decline → the admin_staged cart expires, freeing the slot).
Admin stages while a member_self cart is open → the stage is BLOCKED and the admin is prompted to confirm the member agreed (on the call — admin never silently destroys a member's in-progress cart). On confirm: expire the member cart + stage + write a cart_override AdminAction, one tx. On decline: nothing written.

Both directions are check-then-write in ONE tx, so no window allows two open carts. The partial-unique is the backstop; a P2002 on cart write is a bug surfaced, not a condition to catch-and-proceed.

cart_override AdminAction records an admin replacing a member's open cart with the member's verbal (call) consent — a distinct, queryable act from cart_stage. NOTE: its before/after use the projection SHAPE ([{featureId,tierId,status}]) but a CART-lifecycle status vocabulary ('discarded'/'staged'), not the entitlement statuses ('active'/'canceled') that subscription-action AdminActions use. AdminAction.after.status therefore carries two vocabularies by action type. Phase 4 finalize-detection reads .after only for subscription actions (set-equality vs live Subscription), so no collision — but any future code interpreting AdminAction.after.status generically must branch on action type.

## The atomicity rule, generalized: consent commits atomically WITH the effect when the effect is synchronous (break gate, finalize — one tx); consent commits BEFORE the effect when the effect is deferred/async (checkout → Stripe/webhook — own tx, an abandoned checkout leaving an approved-but-unexecuted consent row is correct, because MemberAction audits "shown S, approved at T," not execution).

# Changelog (condensed — history + rationale; the top half is current truth)

Newest first. Each line: what changed / what was rejected. Fuller prose for older entries lives in this doc's
git history if deeper context is ever needed.

2026-09-22 — Phase 5b: consent-before-checkout shipped (§6b, §13). Both money paths (member-self checkout, admin-staged finalize) write a targetType:'Cart' MemberAction on approve, before mint, in consent's own tx. Ordering proven by a mint-boundary spy (consent row present at mint time). Disclosure from priceCents (no Stripe round-trip). Abandoned checkout leaves no consent row. Stripe excluded; mint failures swallowed in dev — flagged as a go-live item. 68/68. No schema change.
2026-09-25 — GhlEvent inbox + payment-event ingest (POST /api/webhooks/ghl/payment-event) + lib/billing normalizer/classifier v1 + historical ledger load. Additive migration `20260925230000_add_ghl_event` (migrate diff → file → migrate deploy). Classifier v1 rules: liveMode=false ignore; saas_one_time → auto/manual wallet recharge (description); $0 → trial_auth; subscriptionId OR invoice OR source subtype saas_subscription/subscription_view → core_subscription (failed renewals can lack a subscriptionId; verified 8/8 had earlier succeeded subscription payments); entitySourceType payment_link + failed + no subscriptionId → failed_signup. `raw` is stored as received; ONLY normalizeTransaction reads it. DEFERRED: replay of failed GhlEvent rows (processedAt null / lastError set) belongs to the nightly sweep task — not built here. Existing payment-failed/pause/active routes and Transaction are untouched.
2026-09-25 — GhlAccount + BillingLedgerEntry (+ BillingState / PauseReason / BillingClass enums). Additive migration `20260925190000_add_ghl_account_ledger`, authored via `migrate diff` → file → `migrate deploy` on the pipeline Neon branch (a prod clone; `migrate dev` is unusable on prod clones because the rolled-back `retire_bundle_subscriptions` row's checksum differs from the applied row's). `GhlAccount.billingState` is nullable with NO default — null = "not yet seeded"; only the backfill's suspended/inactive rules and the subscription-based seed set it. Rules for all GHL↔server interaction live in docs/ghl-server-contract.md. Not yet deployed to prod. No change to existing models. CUTOVER NOTE: the seed (scripts/billing/seed-billing-state.ts) splits paused-vs-churned by wallet activity; the pipeline-branch seed used AUGUST 2026 wallet data — production seeding at cutover must re-run the wallet activity check over the TRAILING 30 DAYS instead, not August.
2026-09-22 — AdminActionType += cart_override (§6c). Additive enum migration, full §0 pipeline. Records an admin replacing a member's open cart to stage a proposal (member's verbal call-consent) — distinct/queryable from cart_stage.
2026-09-22 — Phase 5a: live member_self cart + admin/member mutual exclusion (§6c). Cart is now a live DB object (write-through, DB authoritative, no localStorage). Bidirectional collision handling: member-add blocked when admin_staged open (route to proposal); admin-stage blocked when member_self open (prompt → confirm → cart_override). Partial-unique proven as the backstop (P2002 test). No MemberAction (consent is 5b). No schema change.
2026-09-21/22 — entitlement/consent split (§6b). Extracted applySubscriptionTransition (entitlement-only, tx-only, all three directions) out of breakSubscriptionCore; break gate and finalize each write their own single provenance-correct MemberAction. Fixes the Phase 4 double-write and gives upgrade a home in the core. Behavior preserved; 51/51 → 61/61.
2026-09-21 — Phase 4: admin→member review feed + change-path finalize (§6a/§6b). Union feed (open member_self + admin_staged carts + open AdminAction proposals with no back-pointer), three states derived with NO mutable column. Change-path finalize reuses the break-gate machinery; member approves an admin-proposed change → MemberAction targetType:'AdminAction' + entitlement change, one tx. Two read surfaces (tools-entry popup, member-page ReviewZone). Add-path items shown-but-not-finalized (finalize is 5b).
2026-09-21 — Phase 3.5: admin change producer (§6a). Admin stages adds (Cart admin_staged + cart_stage AdminAction) and proposes upgrade/downgrade/cancel (AdminAction, no cart) — PROPOSALS only, structurally incapable of writing an entitlement or MemberAction (grep-proven). Gives Phase 4 real dual-carrier input. NOTE two polymorphic targetTypes on the AdminAction side: adds carry 'user' (no sub row yet), changes carry 'subscription' — the feed anti-join must handle both.
2026-09-21 — Phase 3: member break/cancel gate (§6b). First member-initiated entitlement write in the app. Compute-then-confirm-then-commit: reprice is DERIVED not stored (§3/§5), MemberAction written only on approval, consent + effect atomic in one tx. Member account page stops being read-only.

2026-09-22 — AdminActionType += cart_override. Additive enum migration, full §0 pipeline. Records an admin replacing a member's open member_self cart to stage a proposal (member's verbal consent on a call) — distinct from cart_stage so overrides are queryable as their own category. No structural change.
2026-09-21 — AdminActionType += subscription_upgrade / subscription_downgrade. Additive enum migration, full §0 pipeline. Mirrors the MemberActionType directional pair so admin/member audit twins (§6a) label tier-change direction symmetrically; direction stays independently derivable from before/after — the enum is the cheap label, the projection is the finalize carrier. No structural change.
2026-09-21 — Prisma target-declaration hardening (§0 Rule 6). PRISMA_TARGET now gates every Prisma connection (dev→SEED_DATABASE_URL, prod→DATABASE_URL, unset→throw); resolver cross-checks resolved host vs declared target and aborts on mismatch; all DB work runs through wrapped npm scripts; lib/prisma.ts fails closed in non-prod; tests self-load env via vitest.setup.ts. Root cause closed: prisma.config.ts had hard-coded prod and dotenv loaded only .env, so every plain prisma command resolved prod with NO dev target. Fix works by overwriting process.env.DATABASE_URL in-process (the CLI reads the schema's env(), not datasource.url) — holds only while all Prisma paths route through prisma.config.ts. No schema change.
2026-09-21 — Engine phase 1–2 shipped: landSubscriptionItem extraction + comp caller (§3). Core/adapter/helper split done; tx non-optional BY INTENT (diverges from fund()'s dual shape so consent + entitlement commit atomically); comp free-month wired direct to the core (synthetic null stripeSubscriptionId, {userId,featureId} orphan key, executed subscription_comp AdminAction, no ledger write). Multi-item upgrade→downgrade-back regression test added (resurrect-by-id, no P2002) — the §3 gap single-item tests couldn't cover. 30/30 green. No schema change.
2026-09-21 — Consent carrier conventions locked (§6a). AdminAction.after = resolved line set [{featureId,tierId,status}] (finalize-detection by set-equality); MemberAction.targetType = proposal-carrier name ("AdminAction" change path / "Cart" add path). Three review states derive with no new column; cancel is IN the consent gate (can raise the bill via §5 reprice); consent timing = same-tx for synchronous effects, before-effect for async. Build-forward for the review/edit surfaces; no schema change.
2026-09-21 — ui_mode doc/code discrepancy flagged (§13). Doc says 'custom', code (lib/checkout.ts:116) says 'elements' — contract owner to reconcile both sides together.

- **2026-09-18 — Consent/cart schema shipped (MemberAction + Cart/CartLine + enum
  extensions).** Migration `20260918214506_add_member_action_cart_admin_funding_reason`
  — authored on `main`, deployed to prod, merged to `tools/launcher` (all 35/35).
  Added **MemberAction** (append-only member price-consent audit, twin of AdminAction;
  frozen `consent` Json `{timestamp, disclosureText, type}`; polymorphic
  targetType/targetId no-FK; optional `cartId`; NO ledger fields — §6 audience split),
  **Cart + CartLine** (single-intent `mode` subscription|credit_pack; catalog refs
  never prices — §3 stores-zero-numbers; `source` member_self|admin_staged;
  `adminActionId` staged-by join; partial-unique one-open-cart-per-(user,mode); no
  bundleId), plus `AdminActionType` += cart_stage/subscription_comp/
  subscription_cancel/service_cancel and `FundingReason` += admin_grant. **AdminAction
  already existed** (migration 20260917162917, 09-17) — the v1.5 dependency-order line
  listing it as to-build was the doc lagging reality; no divergence. Schema-only —
  nothing writes these tables yet. Build-chat carry-forwards: (a) `FUNDING_REASON_LABEL`
  in lib/accountData.ts needs an `admin_grant` entry (real tsc error on tools/launcher);
  (b) the Prisma `CartLine` name-collides with a TS interface in lib/storeCart.ts
  (alias on import); (c) a CartLine with both tierId and creditPackId null is DB-valid,
  so exactly-one-ref-matching-mode is app-enforced, not DB-enforced.
- **2026-09-18 — Admin READ layer COMPLETE (all 7 surfaces built + reconciling) + v1.5 WRITE plan.**
  Admin surfaces done and HTTP-verified against seeded data: Overview, Tools, Tool-detail, Resources,
  Members-list, Member-dossier, Members-Compare. All money flows through ONE shared lib/adminMoney.ts
  (+ getRentcastEconomics); reconciliation invariants (per-tool & per-member SUM to the aggregate for
  the same window) verified across Range/Source combos. Audience-split enforced BOTH ways: money
  visible on admin surfaces; Compare is CLIENT-SAFE (usage only, grep-confirmed no cost/margin/revenue).
  Surface behavior detail now lives in the companion REItools-Design-Doc.md. Dossier write buttons are
  rendered-but-DISABLED, placed for v1.5.

  **v1.5 WRITE PLAN — confirmation-cores-as-shared-truth (the model to build to):** every Stripe write
  = outbound (create in Stripe) + inbound (webhook confirms → mutates DB). The DB-mutation logic is the
  shared truth; wire admin writes to call the SAME cores the webhook calls, so writes work WITHOUT
  Stripe now and Stripe just becomes another caller later. Investigation of the built webhook
  (app/api/webhooks/stripe/route.ts → handleEvent → handlers) found:
  • `fund(client, userId, credits, reason, opts)` (lib/engine/funding.ts) is ALREADY a clean arg-based
  core. → Admin CREDIT GRANTS / PROMOS need NO Stripe, NO refactor: call fund() directly with a new
  FundingReason `admin_grant` + write an AdminAction, in one tx. Tier-1, buildable immediately.
  • `handleSubscriptionEvent(tx, subscription, eventType)` is Stripe-event-coupled (parses
  subscription.items/price.id/status inline). → Needs an EXTRACTED CORE
  `landSubscriptionItem(tx, {userId,tierId,featureId,periodStart,periodEnd,status,stripeSubscriptionId})`
  with handleSubscriptionEvent becoming a thin adapter over it. Then comped subs call the core
  directly (stripeSubscriptionId null/synthetic); the webhook calls it via the adapter. Tier-2.
  MUST preserve the §3 write-ordering invariant: the ADAPTER keeps cancel-orphans-before-the-upsert-loop
  (reconcile is item-set-scoped, stays in the adapter); the CORE keeps the status-agnostic per-item locate.
  Note the reconcile step is scoped by `stripeSubscriptionId`, which a comped sub lacks — so a comped-sub
  path needs its own orphan-cancel key (e.g. by userId+featureId), not the webhook's sub-scoped reconcile.
  • A real PAID subscription (bills a card) is the only piece needing outbound Stripe first. Tier-3.

  **ADMIN SUBSCRIPTION-ADD = SAVED-CART model (resolved this session — the clean answer to "admin
  charging with/without consent"):** an admin never charges a member's card directly. Flow: Add
  subscription → choose subscription → stage it in a SAVED CART keyed to the member → generate a
  checkout link that guides the member to their own REItools store to complete checkout themselves.
  Consent is preserved by construction (the member checks out), it REUSES the existing store/Stripe
  checkout path (no separate admin-billing code), and it routes admin sub-adds through the SAME Stripe
  flow as member self-serve. SCHEMA SHIPPED 2026-09-18 (Cart/CartLine + MemberAction, migration
  20260918214506); the saved-cart WRITE PATH (cart initiator + member checkout-link) is the build that
  follows. (This is also the discovery cart-save mechanic finding its real home.)

  **Dependency order for the write pass:** (1) schema — AdminAction audit table + `admin_grant`
  FundingReason + the saved-cart model [data-model chat] ✓ SHIPPED 2026-09-18 (migration 20260918214506).
  NOTE: AdminAction already existed from migration 20260917162917 (09-17); listing it here as to-build
  was the doc lagging reality — no branch divergence, main had it and prod showed it applied.; (2) credit grants/promos → fund()+AdminAction
  [buildable now]; (3) extract landSubscriptionItem (adapter/core split) [engine chat]; (4) comped subs
  - cancel/pause → the sub core + AdminAction; (5) saved-cart → checkout-link for paid sub-adds;
    (6) paid subs via real Stripe [go-live]. Every admin write logs an AdminAction (append-only audit:
    adminUserId, action, target, before/after, note).

- **2026-09-18 — OPEN BUG: consumption ledger `creditDelta: 0` (ledger ≠ wallet balance).** Found on
  the dossier: a member's LedgerEntry rows sum to a different number than Wallet.balance (e.g. Sean:
  ledger 104, balance 4) because consumption rows carry creditDelta:0. Running-balance calc is correct;
  the DATA is wrong. **RESOLVED (2026-09-18, this analysis): it is the SEED, not the engine.** The seed
  hardcodes `Wallet.balance = walletBalance` (a made-up number) AND writes a single funding row of
  `walletBalance + 100` (another made-up number), while consumption rows correctly carry
  `creditDelta: -creditsDebited` — which is legitimately 0 on allowance-covered and failed runs (those
  don't touch the wallet). None of the three numbers derive from each other, so the ledger can't sum to
  the balance. The engine's chargeOnSuccess sets creditDelta correctly (real debit on credit-bound runs,
  0 on allowance-covered — which is right). **Fix is in the SEED, not the engine:** seed the funding rows
  and the runs FIRST, then set `Wallet.balance` to the actual ledger sum (Σ funding + Σ consumption
  creditDeltas). Do NOT hunt for an engine balance bug — there isn't one. (Nuance for the cart/write chat:
  `Wallet.balance` is MATERIALIZED per §6, not derived — so production keeps the atomic-decrement balance;
  the fix is only that the SEED must make its at-rest balance equal its own ledger sum.) Enforce the
  invariant in the reseed: sum(member's creditDeltas) == Wallet.balance.

- **2026-09-18 — Reseed calibration pending.** Seed is unrealistically credit-heavy (median ~0.51
  credit share); real paying members should skew mostly allowance-covered. Reseed target: a healthy
  majority (5–20% credit share, no flags) + a few genuine over-utilizers (upsell) + a few under-
  utilizers (churn-save) + the existing edge cases. Verify: upsell drops to ~2–3, downsell >0, and the
  creditDelta invariant above holds. (Also open: display-name formatter — pills show inconsistent
  casing/naming "score Pro"/"score+"/"REIclose"; one shared slug+tier→display formatter.)

- **2026-09-17 — Vendor cost model + cost moved to ApiCall.** Cost was wrongly on `LedgerEntry.vendorCostCents`
  (a client-eyes table) — a category error. Moved to `ApiCall.costCents` (admin-eyes, per-resource). Added
  `VendorRate` (effective-dated rate book, editable without redeploy) + `VendorPlan` (Rentcast subscription
  only). Rentcast cost derived read-side (Option B), its per-call costCents null. Rejected: tier ladder per
  vendor (upgrade timing is a read-side data point), storing cost in code (redeploy to change rates), keeping
  cost on the ledger. `withMeter`/`meter.ts` rewritten to match; 12/12 tests. Locked rates: Sonnet 2/10, Haiku
  1/5, Melissa 4¢, Rentcast $74/1000/6¢.
- **2026-09-17 — Dev prod-wipe incident + migration operating rules (§0).** A `migrate dev` from `main`
  (behind prod by 8 engine migrations) saw prod's engine tables as drift and wiped prod; recovered via Neon
  PITR. Root cause: divergent branch histories on one prod DB. Fix: `main` = migration trunk, deploy-only
  against prod, author on dev, verbatim file-copy to reconcile. Enshrined as §0. Also: universal prod-guarded
  dev seed (`scripts/seed-dev-data.ts`) so lost dev data is one command, not a re-port.
- **2026-09-16 — Admin data layer.** Three-table split (ToolUse=behavior, ApiCall=vendor spend, Ledger=client
  money), correlated via toolUseId; `User.role`; ApiCall upgrade; CreditHold modeled. Built + migrated to prod.
- **2026-09-16 (later) — Metering write-path built.** `withMeter` as a dormant ready-to-attach helper;
  telemetry-observe not charge until wired live.
- **2026-09-15 — Bundle-retirement + 09-14 pricing reconciliation (lib passes 1–3).** Retired bundle-type subs
  (a bundle member is N tool_subs; membership derived via `qualifyBundle`); dropped `Subscription.type`/
  `bundleId` and `Bundle.stripePriceId`; added `BundlePriceOverride`. Shared functions qualify/compose/resolve.
  Resolver, checkout expansion, webhook (lands N tool_subs), and store/account/discovery components re-pointed.
  Test-mode Prices recreated to the 09-14 set.
- **2026-09-15 (later) — In-bundle upgrade outlier pricing.** Priced the four upgrade-within-bundle cells that previously fell back to à-la-carte (score/pro·plus $47, ask/plus·plus $44, close/plus·pro $159, close/pro·pro $281), rule = below à-la-carte / above the floor discount (monotonic). Floors unchanged; override table 5→9 rows, recurring Prices 12→16. Numbers now in §5.
- **2026-09-14 — AUTHORITATIVE PRICING.** $0.25 credit unit; the debit map, à-la-carte ladder, and per-line
  bundle pricing now in §4/§5. Superseded the $0.20 unit, flat $49/$149 bundles, and the Score-anchor model.
  Ask corrected to 1cr/3q; Ask pro deferred (later: cut entirely — no Ask pro ever); Pack as pay-go perk.
- **2026-09-13 — Score-anchor bundle pricing** (superseded same-day-later by 09-14) + the DB operating rule
  first drafted. Account/Wallet surface built (transaction history + subscription view).
- **2026-09-12 — Meter gate (Chat A) + Stripe setup built.** `withMeter` + session→member bridge (18 tests).
  `mintCheckout` with embedded Checkout (Payment-Links plan retired), `stripeCustomerId`, backfilled test Prices.
  Provisional Cart/checkout-session architecture agreed (server-minted sessions, Cart table, OTP claim-link).
- **2026-09-11 — Surfaces complete.** Launcher/store/pricing/discovery render the true launch state behind
  `active`; wallet engine named as the next frontier.
- **2026-09-10 — Data model + credit/wallet engine.** Two-axes-two-tables (Feature/Tool); Tier table (canonical
  price+allowance, ordered base/plus/pro); transmorphic Subscription; single shared Wallet; append-only
  LedgerEntry; CreditHold decided (deferred to bots); §6 logic built + tested + unwired. Deleted the unwired
  render-shaped catalog block + per-tool MemberCreditBalance. Rejected: per-tool wallets, allowance/price copied
  onto subs, optimistic debit, per-user locks. Billing corrected to Stripe-only (base Score the one Ari crossing;
  no processor `source` field).
- **2026-09-08 — Design foundation.** Launcher + store surfaces; launch scope (Score+Scrub live, rest inactive);
  `active`-gating as the single derived flag.
