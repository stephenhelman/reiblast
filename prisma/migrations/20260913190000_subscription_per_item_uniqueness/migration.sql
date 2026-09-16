-- The store cart can add multiple solo tool-subs before checkout, which
-- mints ONE Stripe subscription with multiple recurring items — one
-- stripeSubscriptionId then spans multiple Subscription rows here, one per
-- item. A flat unique on stripeSubscriptionId (Step 1) can't hold once the
-- webhook starts landing multi-item subscriptions, so it's replaced by a
-- plain index (still fast lookups by stripeSubscriptionId) plus two
-- hand-written partial unique indexes that express the real per-item
-- uniqueness the webhook's upsert targets.

-- DropIndex
DROP INDEX "Subscription_stripeSubscriptionId_key";

-- CreateIndex
CREATE INDEX "Subscription_stripeSubscriptionId_idx" ON "Subscription"("stripeSubscriptionId");

-- One row per (stripeSubscriptionId, tierId) — the upsert target for
-- tool_sub items. Partial: doesn't constrain rows with a null
-- stripeSubscriptionId (unwebhooked/seed rows) or null tierId (bundle rows).
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_tierId_key"
  ON "Subscription" ("stripeSubscriptionId", "tierId")
  WHERE "stripeSubscriptionId" IS NOT NULL AND "tierId" IS NOT NULL;

-- One row per (stripeSubscriptionId, bundleId) — the upsert target for
-- bundle items.
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_bundleId_key"
  ON "Subscription" ("stripeSubscriptionId", "bundleId")
  WHERE "stripeSubscriptionId" IS NOT NULL AND "bundleId" IS NOT NULL;
