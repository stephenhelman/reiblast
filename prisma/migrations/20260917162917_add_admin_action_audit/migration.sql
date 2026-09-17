-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('tool_activate', 'tool_deactivate', 'credit_grant', 'credit_adjust');

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" "AdminActionType" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAction_adminUserId_createdAt_idx" ON "AdminAction"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAction_targetType_targetId_createdAt_idx" ON "AdminAction"("targetType", "targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
