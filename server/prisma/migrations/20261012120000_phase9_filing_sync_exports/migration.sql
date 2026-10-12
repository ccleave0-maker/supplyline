-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'ORDER_XLSX';

-- AlterTable
ALTER TABLE "ExportMapping" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dataset" TEXT NOT NULL DEFAULT 'ORDER_LINES',
ADD COLUMN     "dateFormat" TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
ADD COLUMN     "format" TEXT NOT NULL DEFAULT 'xlsx';

-- CreateTable
CREATE TABLE "FilingJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "lastVersion" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SyncDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FilingJob_organizationId_status_idx" ON "FilingJob"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SyncDevice_tokenHash_key" ON "SyncDevice"("tokenHash");

