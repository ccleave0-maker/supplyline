-- AlterTable
ALTER TABLE "ExportMapping" ADD COLUMN     "fileToNetwork" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSentAt" TIMESTAMP(3),
ADD COLUMN     "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "schedule" JSONB;

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "format" TEXT NOT NULL DEFAULT 'xlsx',
    "schedule" JSONB,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedReport_organizationId_idx" ON "SavedReport"("organizationId");

