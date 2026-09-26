-- AlterTable
ALTER TABLE "BillingLedgerEntry" ADD COLUMN     "refundDetectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "ghlAccountId" TEXT,
    "settlementTime" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletTransaction_scopeKey_settlementTime_idx" ON "WalletTransaction"("scopeKey", "settlementTime");

-- CreateIndex
CREATE INDEX "WalletTransaction_ghlAccountId_settlementTime_idx" ON "WalletTransaction"("ghlAccountId", "settlementTime");

-- CreateIndex
CREATE INDEX "WalletTransaction_category_settlementTime_idx" ON "WalletTransaction"("category", "settlementTime");

-- CreateIndex
CREATE INDEX "WalletTransaction_settlementTime_idx" ON "WalletTransaction"("settlementTime");

-- CreateIndex
CREATE INDEX "BillingLedgerEntry_occurredAt_idx" ON "BillingLedgerEntry"("occurredAt");

-- CreateIndex
CREATE INDEX "BillingLedgerEntry_status_occurredAt_idx" ON "BillingLedgerEntry"("status", "occurredAt");

