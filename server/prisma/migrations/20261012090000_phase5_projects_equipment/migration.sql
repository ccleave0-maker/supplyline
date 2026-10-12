-- CreateEnum
CREATE TYPE "ComplianceKind" AS ENUM ('WCB', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "RentalRatePer" AS ENUM ('HOUR', 'DAY', 'WEEK', 'MONTH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContactType" ADD VALUE 'SUBCONTRACTOR';
ALTER TYPE "ContactType" ADD VALUE 'RENTAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileKind" ADD VALUE 'PST_EXEMPTION';
ALTER TYPE "FileKind" ADD VALUE 'INSURANCE';
ALTER TYPE "FileKind" ADD VALUE 'COMPLIANCE';
ALTER TYPE "FileKind" ADD VALUE 'RENTAL_DOC';

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "pstExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pstExemptNumber" TEXT,
ADD COLUMN     "pstExemptionFileId" TEXT;

-- AlterTable
ALTER TABLE "FileAsset" ADD COLUMN     "rentalId" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "projectManagerId" TEXT,
ADD COLUMN     "pstExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pstExemptNumber" TEXT,
ADD COLUMN     "pstExemptionFileId" TEXT,
ADD COLUMN     "startDate" DATE;

-- CreateTable
CREATE TABLE "Rental" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "contactId" TEXT,
    "description" TEXT NOT NULL,
    "unitNumber" TEXT,
    "onRentDate" DATE,
    "expectedOffDate" DATE,
    "offRentDate" DATE,
    "rate" DECIMAL(12,2),
    "ratePer" "RentalRatePer",
    "poNumber" TEXT,
    "insured" BOOLEAN NOT NULL DEFAULT false,
    "insuranceNotes" TEXT,
    "maintenanceNotes" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" "ComplianceKind" NOT NULL,
    "reference" TEXT,
    "provider" TEXT,
    "coverage" TEXT,
    "expiresOn" DATE,
    "fileId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rental_siteId_idx" ON "Rental"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRecord_fileId_key" ON "ComplianceRecord"("fileId");

-- CreateIndex
CREATE INDEX "ComplianceRecord_organizationId_expiresOn_idx" ON "ComplianceRecord"("organizationId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_pstExemptionFileId_key" ON "Equipment"("pstExemptionFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_pstExemptionFileId_key" ON "Site"("pstExemptionFileId");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_pstExemptionFileId_fkey" FOREIGN KEY ("pstExemptionFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_pstExemptionFileId_fkey" FOREIGN KEY ("pstExemptionFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "Rental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRecord" ADD CONSTRAINT "ComplianceRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRecord" ADD CONSTRAINT "ComplianceRecord_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

