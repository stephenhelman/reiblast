-- CreateTable
CREATE TABLE "DiscordRevokeOutbox" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DiscordRevokeOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordRevokeOutbox_discordUserId_key" ON "DiscordRevokeOutbox"("discordUserId");

-- CreateIndex
CREATE INDEX "DiscordRevokeOutbox_status_nextAttemptAt_idx" ON "DiscordRevokeOutbox"("status", "nextAttemptAt");

