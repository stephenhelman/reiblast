-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "arv" DOUBLE PRECISION NOT NULL,
    "endBuyerMax" DOUBLE PRECISION NOT NULL,
    "repairLevel" TEXT NOT NULL,
    "repairs" DOUBLE PRECISION NOT NULL,
    "wholesaleFee" DOUBLE PRECISION NOT NULL,
    "mao" DOUBLE PRECISION NOT NULL,
    "anchorOffer" DOUBLE PRECISION NOT NULL,
    "investorPct" DOUBLE PRECISION NOT NULL,
    "narrative" TEXT NOT NULL,
    "compsUsed" INTEGER NOT NULL,
    "dealUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deal_locationId_address_key" ON "Deal"("locationId", "address");
