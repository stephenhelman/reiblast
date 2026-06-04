/*
  Warnings:

  - You are about to drop the `RentcastPull` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "RentcastPull";

-- CreateTable
CREATE TABLE "PropertyRecord" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "formattedAddress" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "propertyType" TEXT,
    "beds" INTEGER,
    "baths" DOUBLE PRECISION,
    "sqft" INTEGER,
    "lotSizeSqft" INTEGER,
    "lotSizeAcres" DOUBLE PRECISION,
    "yearBuilt" INTEGER,
    "zoning" TEXT,
    "subdivision" TEXT,
    "garage" BOOLEAN,
    "garageSpaces" INTEGER,
    "carport" BOOLEAN,
    "pool" BOOLEAN,
    "lastSalePrice" INTEGER,
    "lastSaleDate" TIMESTAMP(3),
    "assessedValue" INTEGER,
    "taxDelinquentYear" TEXT,
    "ownerName" TEXT,
    "ownerOccupied" BOOLEAN,
    "ownerType" TEXT,
    "mortgageAmount" INTEGER,
    "estimatedValue" INTEGER,
    "estimatedValueMin" INTEGER,
    "estimatedValueMax" INTEGER,
    "source" TEXT NOT NULL,
    "lastVerified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCall" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "resultCount" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyRecord_formattedAddress_key" ON "PropertyRecord"("formattedAddress");

-- CreateIndex
CREATE INDEX "PropertyRecord_lat_lng_idx" ON "PropertyRecord"("lat", "lng");

-- CreateIndex
CREATE INDEX "PropertyRecord_source_idx" ON "PropertyRecord"("source");

-- CreateIndex
CREATE INDEX "PropertyRecord_lastSaleDate_idx" ON "PropertyRecord"("lastSaleDate");

-- CreateIndex
CREATE INDEX "PropertyRecord_lastSalePrice_idx" ON "PropertyRecord"("lastSalePrice");

-- CreateIndex
CREATE INDEX "PropertyRecord_beds_baths_sqft_idx" ON "PropertyRecord"("beds", "baths", "sqft");

-- CreateIndex
CREATE INDEX "ApiCall_locationId_idx" ON "ApiCall"("locationId");

-- CreateIndex
CREATE INDEX "ApiCall_resource_idx" ON "ApiCall"("resource");

-- CreateIndex
CREATE INDEX "ApiCall_createdAt_idx" ON "ApiCall"("createdAt");
