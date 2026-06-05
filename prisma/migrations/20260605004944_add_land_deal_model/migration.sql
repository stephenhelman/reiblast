-- CreateTable
CREATE TABLE "LandDeal" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "lotSizeSqft" INTEGER,
    "lotSizeAcres" DOUBLE PRECISION,
    "zoning" TEXT,
    "roadAccess" TEXT,
    "utilities" TEXT[],
    "topography" TEXT,
    "estimatedValue" DOUBLE PRECISION NOT NULL,
    "estimatedValueLow" DOUBLE PRECISION,
    "estimatedValueHigh" DOUBLE PRECISION,
    "valueConfidence" TEXT,
    "valueMethod" TEXT,
    "builderActivityLevel" TEXT,
    "builderActivityNote" TEXT,
    "exitStrategy" TEXT,
    "narrative" TEXT,
    "risks" TEXT[],
    "warnings" TEXT[],
    "compsJson" TEXT,
    "compsRawJson" TEXT,
    "discount" DOUBLE PRECISION,
    "endBuyerMax" DOUBLE PRECISION,
    "wholesaleFee" DOUBLE PRECISION,
    "cashOffer" DOUBLE PRECISION,
    "anchorOffer" DOUBLE PRECISION,
    "dealUrl" TEXT,
    "dealType" TEXT NOT NULL DEFAULT 'land',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandDeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LandDeal_locationId_address_key" ON "LandDeal"("locationId", "address");
