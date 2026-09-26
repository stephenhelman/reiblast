-- CreateEnum
CREATE TYPE "BillingState" AS ENUM ('trial', 'active', 'payment_failed', 'paused', 'inactive', 'churned');

-- CreateEnum
CREATE TYPE "PauseReason" AS ENUM ('non_payment', 'expired_invoice', 'voluntary', 'manual_killswitch');

-- CreateEnum
CREATE TYPE "BillingClass" AS ENUM ('core_subscription', 'wallet_auto_recharge', 'wallet_manual_recharge', 'trial_auth', 'failed_signup', 'refund', 'unclassified');

-- CreateTable
CREATE TABLE "GhlAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "locationId" TEXT,
    "billingState" "BillingState",
    "pauseReason" "PauseReason",
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "trialOffer" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "legacyUnreconciled" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStage" TEXT,
    "locationToken" TEXT,
    "locationTokenExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingLedgerEntry" (
    "id" TEXT NOT NULL,
    "ghlTransactionId" TEXT NOT NULL,
    "ghlAccountId" TEXT,
    "contactId" TEXT,
    "classification" "BillingClass" NOT NULL,
    "classifierVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(12,6) NOT NULL,
    "amountRefunded" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GhlAccount_userId_key" ON "GhlAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GhlAccount_contactId_key" ON "GhlAccount"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "GhlAccount_locationId_key" ON "GhlAccount"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingLedgerEntry_ghlTransactionId_key" ON "BillingLedgerEntry"("ghlTransactionId");

-- CreateIndex
CREATE INDEX "BillingLedgerEntry_ghlAccountId_occurredAt_idx" ON "BillingLedgerEntry"("ghlAccountId", "occurredAt");

-- CreateIndex
CREATE INDEX "BillingLedgerEntry_classification_occurredAt_idx" ON "BillingLedgerEntry"("classification", "occurredAt");

-- AddForeignKey
ALTER TABLE "GhlAccount" ADD CONSTRAINT "GhlAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLedgerEntry" ADD CONSTRAINT "BillingLedgerEntry_ghlAccountId_fkey" FOREIGN KEY ("ghlAccountId") REFERENCES "GhlAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

