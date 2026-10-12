-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ISSUED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmailMode" AS ENUM ('AUTO', 'REVIEW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailStatus" ADD VALUE 'REVIEW';
ALTER TYPE "EmailStatus" ADD VALUE 'DISCARDED';

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'PO_PDF';

-- DropForeignKey
ALTER TABLE "PurchaseOrderLine" DROP CONSTRAINT "PurchaseOrderLine_orderLineId_fkey";

-- DropForeignKey
ALTER TABLE "YardReceiptLine" DROP CONSTRAINT "YardReceiptLine_orderLineId_fkey";

-- AlterTable
ALTER TABLE "EmailOutbox" ADD COLUMN     "attachmentFileIds" TEXT[],
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "templateKey" TEXT;

-- AlterTable
ALTER TABLE "OrderForm" ADD COLUMN     "sourcePurchaseOrderId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "arrivalPromptAt" TIMESTAMP(3),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "emailVendor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "equipmentId" TEXT,
ADD COLUMN     "expectedDate" DATE,
ADD COLUMN     "followUpQueuedAt" TIMESTAMP(3),
ADD COLUMN     "gstRate" DECIMAL(6,4),
ADD COLUMN     "hstRate" DECIMAL(6,4),
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "orderedDate" DATE,
ADD COLUMN     "pstExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pstRate" DECIMAL(6,4),
ADD COLUMN     "shipToText" TEXT,
ADD COLUMN     "siteId" TEXT,
ADD COLUMN     "status" "PoStatus" NOT NULL DEFAULT 'ISSUED',
ADD COLUMN     "taxProvince" TEXT,
ADD COLUMN     "vendorSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "description" TEXT,
ADD COLUMN     "lineNo" INTEGER,
ADD COLUMN     "uom" TEXT,
ALTER COLUMN "orderLineId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "YardReceiptLine" ALTER COLUMN "orderLineId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mode" "EmailMode" NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_companyId_key_key" ON "EmailTemplate"("companyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "OrderForm_sourcePurchaseOrderId_key" ON "OrderForm"("sourcePurchaseOrderId");

-- AddForeignKey
ALTER TABLE "OrderForm" ADD CONSTRAINT "OrderForm_sourcePurchaseOrderId_fkey" FOREIGN KEY ("sourcePurchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardReceiptLine" ADD CONSTRAINT "YardReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing POs (made in Buying from order lists): fill in the job, dates and line details.
UPDATE "PurchaseOrderLine" pl SET "description" = ol."description", "uom" = ol."uom"
  FROM "OrderLine" ol WHERE pl."orderLineId" = ol."id";
UPDATE "PurchaseOrderLine" pl SET "lineNo" = x.rn
  FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "purchaseOrderId" ORDER BY "createdAt", "id") AS rn FROM "PurchaseOrderLine") x
  WHERE pl."id" = x."id";
UPDATE "PurchaseOrder" po SET "siteId" = x."siteId"
  FROM (SELECT pl."purchaseOrderId", MIN(ol."siteId") AS "siteId", COUNT(DISTINCT ol."siteId") AS n
        FROM "PurchaseOrderLine" pl JOIN "OrderLine" ol ON ol."id" = pl."orderLineId" GROUP BY pl."purchaseOrderId") x
  WHERE po."id" = x."purchaseOrderId" AND x.n = 1;
UPDATE "PurchaseOrder" po SET "orderedDate" = po."createdAt"::date, "issuedAt" = po."createdAt", "issuedById" = po."createdById",
  "expectedDate" = (SELECT MAX(pl."vendorEta") FROM "PurchaseOrderLine" pl WHERE pl."purchaseOrderId" = po."id");
UPDATE "EmailOutbox" SET "attachmentFileIds" = '{}' WHERE "attachmentFileIds" IS NULL;
