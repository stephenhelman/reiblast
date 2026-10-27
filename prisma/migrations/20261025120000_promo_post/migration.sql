-- CreateTable
CREATE TABLE "PromoPost" (
    "id" TEXT NOT NULL,
    "promo" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "variation" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "discordMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromoPost_promo_status_createdAt_idx" ON "PromoPost"("promo", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromoPost_promo_runKey_key" ON "PromoPost"("promo", "runKey");
