/*
  Warnings:

  - You are about to drop the column `stripePriceId` on the `Bundle` table. All the data in the column will be lost.
  - You are about to drop the column `bundleId` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Subscription` table. All the data in the column will be lost.
  - Made the column `tierId` on table `Subscription` required. This step will fail if there are existing NULL values in that column.
  - Made the column `featureId` on table `Subscription` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_bundleId_fkey";

-- DropIndex
DROP INDEX "Bundle_stripePriceId_key";

-- AlterTable
ALTER TABLE "Bundle" DROP COLUMN "stripePriceId";

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "bundleId",
DROP COLUMN "type",
ALTER COLUMN "tierId" SET NOT NULL,
ALTER COLUMN "featureId" SET NOT NULL;

-- DropEnum
DROP TYPE "SubscriptionType";

-- CreateTable
CREATE TABLE "BundlePriceOverride" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "level" "TierLevel" NOT NULL,
    "bundleSlug" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BundlePriceOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BundlePriceOverride_featureId_level_bundleSlug_key" ON "BundlePriceOverride"("featureId", "level", "bundleSlug");

-- AddForeignKey
ALTER TABLE "BundlePriceOverride" ADD CONSTRAINT "BundlePriceOverride_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundlePriceOverride" ADD CONSTRAINT "BundlePriceOverride_bundleSlug_fkey" FOREIGN KEY ("bundleSlug") REFERENCES "Bundle"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bundle-type subscriptions are retired: Subscription is always a tool_sub
-- now. Dropping "type"/"bundleId" above auto-drops the two hand-written
-- constraints that referenced them (Subscription_type_matches_fk_check,
-- Subscription_active_tool_sub_per_user_feature, and
-- Subscription_stripeSubscriptionId_bundleId_key — Postgres cascades index/
-- constraint drops when the column(s) they reference are dropped). Replace
-- the two that still apply, minus the now-meaningless type/bundleId filter.

-- Defensive: drop first in case cascade from the "type" column drop above
-- didn't take (it should have — this predicate index referenced "type").
DROP INDEX IF EXISTS "Subscription_active_tool_sub_per_user_feature";

-- CreateIndex: one active tool_sub per (user, feature) — no more type filter,
-- every row is a tool_sub.
CREATE UNIQUE INDEX "Subscription_active_tool_sub_per_user_feature"
  ON "Subscription" ("userId", "featureId")
  WHERE "status" = 'active';

-- The existing (stripeSubscriptionId, tierId) partial index survives the
-- column drops above untouched (it references tierId, which was only
-- altered, not dropped) — drop and replace it explicitly rather than assume
-- cascade.
DROP INDEX IF EXISTS "Subscription_stripeSubscriptionId_tierId_key";

-- CreateIndex: one row per (stripeSubscriptionId, tierId) — the webhook's
-- per-item upsert target. tierId is now NOT NULL on every row; the
-- stripeSubscriptionId filter still matters (unwebhooked/seed rows are null).
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_tierId_key"
  ON "Subscription" ("stripeSubscriptionId", "tierId")
  WHERE "stripeSubscriptionId" IS NOT NULL;
