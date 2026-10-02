-- CreateTable
CREATE TABLE "GhlEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "GhlEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GhlEvent_source_processedAt_idx" ON "GhlEvent"("source", "processedAt");

-- CreateIndex
CREATE INDEX "GhlEvent_externalId_idx" ON "GhlEvent"("externalId");

