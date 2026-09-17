-- AlterTable
ALTER TABLE "ApiCall" ADD COLUMN     "costCents" INTEGER;

-- AlterTable
ALTER TABLE "LedgerEntry" DROP COLUMN "vendorCostCents";

-- CreateTable
CREATE TABLE "VendorRate" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "model" TEXT,
    "flatCents" INTEGER,
    "perMillionInputTokens" INTEGER,
    "perMillionOutputTokens" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPlan" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "baseMonthlyCents" INTEGER NOT NULL,
    "includedQuota" INTEGER NOT NULL,
    "overageCentsPerCall" INTEGER NOT NULL,
    "periodAnchorDay" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorRate_resource_model_effectiveFrom_idx" ON "VendorRate"("resource", "model", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "VendorPlan_resource_key" ON "VendorPlan"("resource");

-- CreateIndex
CREATE INDEX "ApiCall_resource_createdAt_idx" ON "ApiCall"("resource", "createdAt");

-- CreateIndex
CREATE INDEX "ApiCall_featureSlug_createdAt_idx" ON "ApiCall"("featureSlug", "createdAt");
