-- AlterTable
ALTER TABLE "BillingLedgerEntry" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "UsageRollup" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "ghlAccountId" TEXT,
    "day" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "amount" DECIMAL(12,6) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ghlAccountId" TEXT,
    "takenOn" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "balance" DECIMAL(12,6),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "lastStartAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "cursor" JSONB,
    "lastError" TEXT,
    "lastSummary" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageRollup_ghlAccountId_day_idx" ON "UsageRollup"("ghlAccountId", "day");

-- CreateIndex
CREATE INDEX "UsageRollup_day_idx" ON "UsageRollup"("day");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRollup_scopeKey_day_category_key" ON "UsageRollup"("scopeKey", "day", "category");

-- CreateIndex
CREATE UNIQUE INDEX "WalletBalanceSnapshot_locationId_takenOn_key" ON "WalletBalanceSnapshot"("locationId", "takenOn");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_job_key" ON "JobRun"("job");

