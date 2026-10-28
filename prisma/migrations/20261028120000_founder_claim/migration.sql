-- CreateEnum
CREATE TYPE "FounderClaimStatus" AS ENUM ('FREE_WINNER', 'PENDING_PAYMENT', 'PAID', 'RELEASED');

-- CreateTable
CREATE TABLE "FounderClaim" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ghlAccountId" TEXT NOT NULL,
    "claimNumber" INTEGER NOT NULL,
    "status" "FounderClaimStatus" NOT NULL,
    "isFirst" BOOLEAN NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "studioContactId" TEXT,
    "invoiceId" TEXT,
    "invoiceUrl" TEXT,
    "intentSentAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "intakeSubmittedAt" TIMESTAMP(3),
    "announcedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FounderClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FounderVerifyAttempt" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ghlAccountId" TEXT NOT NULL,
    "discordUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FounderVerifyAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FounderClaim_token_key" ON "FounderClaim"("token");

-- CreateIndex
CREATE UNIQUE INDEX "FounderClaim_ghlAccountId_key" ON "FounderClaim"("ghlAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "FounderClaim_claimNumber_key" ON "FounderClaim"("claimNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FounderClaim_invoiceId_key" ON "FounderClaim"("invoiceId");

-- CreateIndex
CREATE INDEX "FounderClaim_status_claimedAt_idx" ON "FounderClaim"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "FounderVerifyAttempt_ghlAccountId_kind_createdAt_idx" ON "FounderVerifyAttempt"("ghlAccountId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "FounderClaim" ADD CONSTRAINT "FounderClaim_ghlAccountId_fkey" FOREIGN KEY ("ghlAccountId") REFERENCES "GhlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

