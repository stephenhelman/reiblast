/*
  Warnings:

  - You are about to drop the column `ghlSubAccount` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `passwordHash` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `stripeCustomerId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSubscriptionId` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "ghlSubAccount",
DROP COLUMN "passwordHash",
DROP COLUMN "stripeCustomerId",
DROP COLUMN "stripeSubscriptionId",
ADD COLUMN     "businessAddress" TEXT,
ADD COLUMN     "businessCity" TEXT,
ADD COLUMN     "businessEmail" TEXT,
ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "businessPhone" TEXT,
ADD COLUMN     "businessState" TEXT,
ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "businessZip" TEXT,
ADD COLUMN     "ein" TEXT,
ADD COLUMN     "ghlContactId" TEXT,
ADD COLUMN     "ghlUserId" TEXT,
ADD COLUMN     "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onboardingStage" TEXT,
ADD COLUMN     "smsComplianceAgreed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetMarket" TEXT,
ADD COLUMN     "websiteUrl" TEXT,
ADD COLUMN     "whopMemberId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'pending_onboarding';
