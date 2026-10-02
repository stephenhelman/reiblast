-- CreateTable
CREATE TABLE "GhlIntent" (
    "id" TEXT NOT NULL,
    "ghlAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GhlIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GhlIntent_dedupeKey_key" ON "GhlIntent"("dedupeKey");

-- CreateIndex
CREATE INDEX "GhlIntent_status_createdAt_idx" ON "GhlIntent"("status", "createdAt");
