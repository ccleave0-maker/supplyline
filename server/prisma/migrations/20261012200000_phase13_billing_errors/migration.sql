-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billingNotes" TEXT,
ADD COLUMN     "billingStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "seats" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "app" TEXT,
    "version" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "path" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorEvent_fingerprint_key" ON "ErrorEvent"("fingerprint");

-- CreateIndex
CREATE INDEX "ErrorEvent_lastAt_idx" ON "ErrorEvent"("lastAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeSubscriptionId_key" ON "Organization"("stripeSubscriptionId");


-- Organizations that already exist (the owner's own) are not charged.
UPDATE "Organization" SET "plan" = 'FREE';
