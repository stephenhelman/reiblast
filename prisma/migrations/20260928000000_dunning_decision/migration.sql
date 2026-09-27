-- CreateTable
CREATE TABLE "DunningDecision" (
    "id" TEXT NOT NULL,
    "ghlAccountId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "fromState" "BillingState",
    "toState" "BillingState",
    "fromStrikes" INTEGER NOT NULL,
    "toStrikes" INTEGER NOT NULL,
    "pauseReason" "PauseReason",
    "coreFailureOpen" BOOLEAN NOT NULL DEFAULT false,
    "sideEffects" JSONB NOT NULL,
    "intents" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "walletBalance" DECIMAL(12,6),
    "balanceEstimated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DunningDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DunningDecision_ghlAccountId_createdAt_idx" ON "DunningDecision"("ghlAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "DunningDecision_ghlAccountId_eventAt_idx" ON "DunningDecision"("ghlAccountId", "eventAt");

-- CreateIndex
CREATE INDEX "DunningDecision_createdAt_idx" ON "DunningDecision"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DunningDecision_trigger_ghlAccountId_mode_key" ON "DunningDecision"("trigger", "ghlAccountId", "mode");

-- AddForeignKey
ALTER TABLE "DunningDecision" ADD CONSTRAINT "DunningDecision_ghlAccountId_fkey" FOREIGN KEY ("ghlAccountId") REFERENCES "GhlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

