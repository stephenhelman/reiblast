-- CreateTable
CREATE TABLE "WalletMonthRefresh" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "windowsTotal" INTEGER NOT NULL,
    "windowsDone" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WalletMonthRefresh_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletMonthRefresh_month_key" ON "WalletMonthRefresh"("month");

