-- AlterTable
ALTER TABLE "User" ADD COLUMN     "warningCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ghlLocationId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_dedupeKey_key" ON "Transaction"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_ghlLocationId_key" ON "User"("ghlLocationId");

