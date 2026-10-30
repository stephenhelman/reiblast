-- CreateEnum
CREATE TYPE "ReserveMovementKind" AS ENUM ('release', 'withdrawal', 'adjustment');

-- AlterEnum
ALTER TYPE "BillingClass" ADD VALUE 'non_gateway';

-- AlterTable
ALTER TABLE "BillingLedgerEntry" ADD COLUMN     "authAmountCents" INTEGER,
ADD COLUMN     "avsCode" TEXT,
ADD COLUMN     "batchDate" DATE,
ADD COLUMN     "batchWindowStart" TIMESTAMP(3),
ADD COLUMN     "cardBrand" TEXT,
ADD COLUMN     "chargeId" TEXT,
ADD COLUMN     "expectedDepositDate" DATE,
ADD COLUMN     "isAuthorizeNet" BOOLEAN,
ADD COLUMN     "responseCode" INTEGER,
ADD COLUMN     "settleAmountCents" INTEGER,
ADD COLUMN     "submitTimeUtc" TIMESTAMP(3),
ADD COLUMN     "transactionType" TEXT;

-- CreateTable
CREATE TABLE "SettingRate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DECIMAL(18,8) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettingRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedCost" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyAmountCents" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KurvStatement" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "salesCount" INTEGER NOT NULL,
    "salesAmountCents" INTEGER NOT NULL,
    "dailyFeesPaidCents" INTEGER NOT NULL,
    "reserveFundedCents" INTEGER NOT NULL,
    "reserveReleasedCents" INTEGER NOT NULL DEFAULT 0,
    "monthlyDebitCents" INTEGER NOT NULL,
    "notes" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KurvStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReserveMovement" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "ReserveMovementKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReserveMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPayment" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthClose" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "owedAmountCents" INTEGER NOT NULL,
    "reopenedAt" TIMESTAMP(3),

    CONSTRAINT "MonthClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SettingRate_key_effectiveFrom_key" ON "SettingRate"("key", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "FixedCost_name_effectiveFrom_key" ON "FixedCost"("name", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "KurvStatement_month_key" ON "KurvStatement"("month");

-- CreateIndex
CREATE INDEX "ReserveMovement_date_idx" ON "ReserveMovement"("date");

-- CreateIndex
CREATE INDEX "PartnerPayment_date_idx" ON "PartnerPayment"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MonthClose_month_key" ON "MonthClose"("month");

-- CreateIndex
CREATE INDEX "BillingLedgerEntry_batchDate_idx" ON "BillingLedgerEntry"("batchDate");

-- CreateIndex
CREATE INDEX "BillingLedgerEntry_expectedDepositDate_idx" ON "BillingLedgerEntry"("expectedDepositDate");

