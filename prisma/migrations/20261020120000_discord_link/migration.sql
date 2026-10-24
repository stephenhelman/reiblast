-- CreateTable
CREATE TABLE "DiscordLink" (
    "id" TEXT NOT NULL,
    "ghlAccountId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordVerifyAttempt" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "ghlAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordVerifyAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordLink_ghlAccountId_key" ON "DiscordLink"("ghlAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordLink_discordUserId_key" ON "DiscordLink"("discordUserId");

-- CreateIndex
CREATE INDEX "DiscordVerifyAttempt_discordUserId_kind_createdAt_idx" ON "DiscordVerifyAttempt"("discordUserId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "DiscordVerifyAttempt_ghlAccountId_kind_createdAt_idx" ON "DiscordVerifyAttempt"("ghlAccountId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "DiscordLink" ADD CONSTRAINT "DiscordLink_ghlAccountId_fkey" FOREIGN KEY ("ghlAccountId") REFERENCES "GhlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

