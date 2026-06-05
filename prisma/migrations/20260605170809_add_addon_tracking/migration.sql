-- AlterTable
ALTER TABLE "User" ADD COLUMN     "a2pAddonPurchasedAt" TIMESTAMP(3),
ADD COLUMN     "addons" TEXT[] DEFAULT ARRAY[]::TEXT[];
