-- CreateTable
CREATE TABLE "GhlSubscriptionState" (
    "subscriptionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "name" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlSubscriptionState_pkey" PRIMARY KEY ("subscriptionId")
);

-- CreateIndex
CREATE INDEX "GhlSubscriptionState_contactId_idx" ON "GhlSubscriptionState"("contactId");
