-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'admin', 'manager', 'team_lead');

-- CreateEnum
CREATE TYPE "ToolOutcome" AS ENUM ('success', 'fail', 'partial');

-- CreateEnum
CREATE TYPE "HoldState" AS ENUM ('open', 'committed', 'released');

-- AlterTable
ALTER TABLE "ApiCall" ADD COLUMN     "featureSlug" TEXT,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "tool" TEXT,
ADD COLUMN     "toolUseId" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "toolUseId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'user';

-- CreateTable
CREATE TABLE "ToolUse" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "featureSlug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" "ToolOutcome" NOT NULL,
    "compSource" TEXT,
    "propertyDataSource" TEXT,
    "escalated" BOOLEAN,
    "turnCount" INTEGER,
    "hitTokenMax" BOOLEAN,
    "retrievalHit" BOOLEAN,
    "recordCount" INTEGER,
    "regenerated" BOOLEAN,
    "detail" JSONB,

    CONSTRAINT "ToolUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditHold" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "toolUseId" TEXT NOT NULL,
    "reservedCredits" INTEGER NOT NULL,
    "state" "HoldState" NOT NULL DEFAULT 'open',
    "settledLedgerEntryId" TEXT,

    CONSTRAINT "CreditHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolUse_locationId_createdAt_idx" ON "ToolUse"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolUse_userId_createdAt_idx" ON "ToolUse"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditHold_userId_state_idx" ON "CreditHold"("userId", "state");

-- CreateIndex
CREATE INDEX "ApiCall_toolUseId_idx" ON "ApiCall"("toolUseId");

-- AddForeignKey
ALTER TABLE "ApiCall" ADD CONSTRAINT "ApiCall_toolUseId_fkey" FOREIGN KEY ("toolUseId") REFERENCES "ToolUse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_toolUseId_fkey" FOREIGN KEY ("toolUseId") REFERENCES "ToolUse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolUse" ADD CONSTRAINT "ToolUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditHold" ADD CONSTRAINT "CreditHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditHold" ADD CONSTRAINT "CreditHold_toolUseId_fkey" FOREIGN KEY ("toolUseId") REFERENCES "ToolUse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ApiCall_model_idx" ON "ApiCall"("model") WHERE "model" IS NOT NULL;
