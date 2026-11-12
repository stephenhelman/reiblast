-- CreateTable
CREATE TABLE "CampaignStats" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "listType" TEXT NOT NULL DEFAULT '',
    "listName" TEXT NOT NULL DEFAULT '',
    "variant" TEXT NOT NULL DEFAULT '',
    "entered" INTEGER NOT NULL DEFAULT 0,
    "replied" INTEGER NOT NULL DEFAULT 0,
    "errored" INTEGER NOT NULL DEFAULT 0,
    "noResponse" INTEGER NOT NULL DEFAULT 0,
    "replied1" INTEGER NOT NULL DEFAULT 0,
    "replied2" INTEGER NOT NULL DEFAULT 0,
    "replied3" INTEGER NOT NULL DEFAULT 0,
    "replied4" INTEGER NOT NULL DEFAULT 0,
    "replied5" INTEGER NOT NULL DEFAULT 0,
    "replied6" INTEGER NOT NULL DEFAULT 0,
    "replied7" INTEGER NOT NULL DEFAULT 0,
    "errored1" INTEGER NOT NULL DEFAULT 0,
    "errored2" INTEGER NOT NULL DEFAULT 0,
    "errored3" INTEGER NOT NULL DEFAULT 0,
    "errored4" INTEGER NOT NULL DEFAULT 0,
    "errored5" INTEGER NOT NULL DEFAULT 0,
    "errored6" INTEGER NOT NULL DEFAULT 0,
    "errored7" INTEGER NOT NULL DEFAULT 0,
    "firstEventAt" TIMESTAMP(3) NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSnapshot" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "entered" INTEGER NOT NULL DEFAULT 0,
    "replied" INTEGER NOT NULL DEFAULT 0,
    "errored" INTEGER NOT NULL DEFAULT 0,
    "noResponse" INTEGER NOT NULL DEFAULT 0,
    "replied1" INTEGER NOT NULL DEFAULT 0,
    "replied2" INTEGER NOT NULL DEFAULT 0,
    "replied3" INTEGER NOT NULL DEFAULT 0,
    "replied4" INTEGER NOT NULL DEFAULT 0,
    "replied5" INTEGER NOT NULL DEFAULT 0,
    "replied6" INTEGER NOT NULL DEFAULT 0,
    "replied7" INTEGER NOT NULL DEFAULT 0,
    "errored1" INTEGER NOT NULL DEFAULT 0,
    "errored2" INTEGER NOT NULL DEFAULT 0,
    "errored3" INTEGER NOT NULL DEFAULT 0,
    "errored4" INTEGER NOT NULL DEFAULT 0,
    "errored5" INTEGER NOT NULL DEFAULT 0,
    "errored6" INTEGER NOT NULL DEFAULT 0,
    "errored7" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignStats_locationId_lastEventAt_idx" ON "CampaignStats"("locationId", "lastEventAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStats_locationId_listType_listName_variant_key" ON "CampaignStats"("locationId", "listType", "listName", "variant");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSnapshot_locationId_month_key" ON "CampaignSnapshot"("locationId", "month");

-- AddForeignKey
ALTER TABLE "CampaignStats" ADD CONSTRAINT "CampaignStats_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GhlAccount"("locationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSnapshot" ADD CONSTRAINT "CampaignSnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GhlAccount"("locationId") ON DELETE CASCADE ON UPDATE CASCADE;

