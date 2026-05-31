-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ghlLocationToken" TEXT,
ADD COLUMN     "ghlLocationTokenExpiresAt" TIMESTAMP(3);
