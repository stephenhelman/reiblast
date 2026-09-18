-- CreateEnum
CREATE TYPE "MemberActionType" AS ENUM ('subscription_add', 'subscription_upgrade', 'subscription_downgrade', 'subscription_remove', 'bundle_activate', 'bundle_break', 'credit_pack_purchase');

-- CreateEnum
CREATE TYPE "CartMode" AS ENUM ('subscription', 'credit_pack');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('open', 'completed', 'expired');

-- CreateEnum
CREATE TYPE "CartSource" AS ENUM ('member_self', 'admin_staged');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminActionType" ADD VALUE 'cart_stage';
ALTER TYPE "AdminActionType" ADD VALUE 'subscription_comp';
ALTER TYPE "AdminActionType" ADD VALUE 'subscription_cancel';
ALTER TYPE "AdminActionType" ADD VALUE 'service_cancel';

-- AlterEnum
ALTER TYPE "FundingReason" ADD VALUE 'admin_grant';

-- CreateTable
CREATE TABLE "MemberAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "MemberActionType" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "consent" JSONB NOT NULL,
    "cartId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "CartMode" NOT NULL,
    "status" "CartStatus" NOT NULL DEFAULT 'open',
    "source" "CartSource" NOT NULL,
    "adminActionId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartLine" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "tierId" TEXT,
    "creditPackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberAction_userId_createdAt_idx" ON "MemberAction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MemberAction_targetType_targetId_createdAt_idx" ON "MemberAction"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "Cart_userId_status_idx" ON "Cart"("userId", "status");

-- CreateIndex
CREATE INDEX "CartLine_cartId_idx" ON "CartLine"("cartId");

-- AddForeignKey
ALTER TABLE "MemberAction" ADD CONSTRAINT "MemberAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberAction" ADD CONSTRAINT "MemberAction_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_adminActionId_fkey" FOREIGN KEY ("adminActionId") REFERENCES "AdminAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartLine" ADD CONSTRAINT "CartLine_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartLine" ADD CONSTRAINT "CartLine_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "Tier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartLine" ADD CONSTRAINT "CartLine_creditPackId_fkey" FOREIGN KEY ("creditPackId") REFERENCES "CreditPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
-- Hand-edited (Prisma's schema DSL can't express a WHERE predicate) — one
-- open cart per (user, mode), same convention as the Subscription and
-- BundlePriceOverride partial unique indexes noted in schema.prisma.
CREATE UNIQUE INDEX "Cart_userId_mode_open_key" ON "Cart"("userId","mode") WHERE "status" = 'open';

