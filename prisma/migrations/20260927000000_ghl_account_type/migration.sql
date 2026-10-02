-- CreateEnum
CREATE TYPE "GhlAccountType" AS ENUM ('member', 'internal');

-- AlterTable
ALTER TABLE "GhlAccount" ADD COLUMN     "accountType" "GhlAccountType" NOT NULL DEFAULT 'member';
