-- CreateTable
CREATE TABLE "RentcastPull" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radius" DOUBLE PRECISION NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "rawJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentcastPull_pkey" PRIMARY KEY ("id")
);
