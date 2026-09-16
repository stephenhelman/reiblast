-- AlterTable
ALTER TABLE "User" ADD COLUMN     "stripeCustomerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Bundle_stripePriceId_key" ON "Bundle"("stripePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPack_stripePriceId_key" ON "CreditPack"("stripePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "Tier_stripePriceId_key" ON "Tier"("stripePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
