-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "featureId" TEXT;

-- CreateTable
CREATE TABLE "ProcessedStripeEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedStripeEvent_pkey" PRIMARY KEY ("id")
);

-- Backfill: existing tool_sub rows (dev has 2 pre-existing Subscription rows
-- from the account-surface seed; prod's table is empty so this is a no-op
-- there) get featureId from their tier. Bundle rows stay null by design.
UPDATE "Subscription" AS s
SET "featureId" = t."featureId"
FROM "Tier" AS t
WHERE s."tierId" = t."id"
  AND s."type" = 'tool_sub'
  AND s."featureId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
