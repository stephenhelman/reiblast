-- CreateEnum
CREATE TYPE "SetupFeeStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'UNKNOWN');

-- AlterTable
ALTER TABLE "GhlAccount" ADD COLUMN     "setupFeeStatus" "SetupFeeStatus",
ADD COLUMN     "signupOffer" TEXT;
