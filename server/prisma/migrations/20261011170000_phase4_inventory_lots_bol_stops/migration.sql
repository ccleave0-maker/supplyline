-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('IN_STOCK', 'STAGED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "StopKind" AS ENUM ('PICKUP', 'DROP');

-- AlterEnum
ALTER TYPE "InventorySource" ADD VALUE 'TRANSFER';

-- DropForeignKey
ALTER TABLE "BOLLine" DROP CONSTRAINT "BOLLine_yardInventoryItemId_fkey";

-- DropForeignKey
ALTER TABLE "BillOfLading" DROP CONSTRAINT "BillOfLading_shipFromLocationId_fkey";

-- DropForeignKey
ALTER TABLE "BillOfLading" DROP CONSTRAINT "BillOfLading_shipToLocationId_fkey";

-- DropForeignKey
ALTER TABLE "BillOfLading" DROP CONSTRAINT "BillOfLading_siteId_fkey";

-- DropForeignKey
ALTER TABLE "SiteReceipt" DROP CONSTRAINT "SiteReceipt_siteId_fkey";

-- DropForeignKey
ALTER TABLE "YardInventoryItem" DROP CONSTRAINT "YardInventoryItem_yardId_fkey";

-- DropIndex
DROP INDEX "YardInventoryItem_yardId_companyId_idx";

-- AlterTable
ALTER TABLE "BOLLine" DROP COLUMN "yardInventoryItemId",
ADD COLUMN     "dropStopId" TEXT NOT NULL,
ADD COLUMN     "pickupStopId" TEXT NOT NULL,
ADD COLUMN     "sourceLotId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "BillOfLading" DROP COLUMN "shipFromLocationId",
DROP COLUMN "shipToLocationId",
ADD COLUMN     "driverName" TEXT,
ADD COLUMN     "scheduledDate" DATE,
ADD COLUMN     "truckUnit" TEXT,
ALTER COLUMN "siteId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ShippingLocation" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "SiteReceipt" ADD COLUMN     "stopId" TEXT NOT NULL,
ALTER COLUMN "siteId" DROP NOT NULL;

-- AlterTable: yard inventory becomes inventory lots at any location.
ALTER TABLE "YardInventoryItem"
ADD COLUMN     "finalSiteId" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "parentLotId" TEXT,
ADD COLUMN     "siteReceiptLineId" TEXT,
ADD COLUMN     "status" "InventoryStatus" NOT NULL DEFAULT 'IN_STOCK';

-- Carry existing stock over: it sits at its yard's location and is for its order line's job.
UPDATE "YardInventoryItem" i SET "locationId" = sl."id" FROM "ShippingLocation" sl WHERE sl."siteId" = i."yardId";
UPDATE "YardInventoryItem" i SET "finalSiteId" = ol."siteId" FROM "OrderLine" ol WHERE ol."id" = i."orderLineId";

ALTER TABLE "YardInventoryItem"
ALTER COLUMN "finalSiteId" SET NOT NULL,
ALTER COLUMN "locationId" SET NOT NULL,
DROP COLUMN "yardId";

-- CreateTable
CREATE TABLE "BolStop" (
    "id" TEXT NOT NULL,
    "bolId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "StopKind" NOT NULL,
    "locationId" TEXT NOT NULL,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BolStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "deletedById" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "restoredById" TEXT,

    CONSTRAINT "DeletedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BolStop_bolId_seq_key" ON "BolStop"("bolId", "seq");

-- CreateIndex
CREATE INDEX "DeletedRecord_organizationId_deletedAt_idx" ON "DeletedRecord"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "YardInventoryItem_siteReceiptLineId_key" ON "YardInventoryItem"("siteReceiptLineId");

-- CreateIndex
CREATE INDEX "YardInventoryItem_locationId_companyId_idx" ON "YardInventoryItem"("locationId", "companyId");

-- CreateIndex
CREATE INDEX "YardInventoryItem_orderLineId_idx" ON "YardInventoryItem"("orderLineId");

-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_finalSiteId_fkey" FOREIGN KEY ("finalSiteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ShippingLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_siteReceiptLineId_fkey" FOREIGN KEY ("siteReceiptLineId") REFERENCES "SiteReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_parentLotId_fkey" FOREIGN KEY ("parentLotId") REFERENCES "YardInventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfLading" ADD CONSTRAINT "BillOfLading_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BolStop" ADD CONSTRAINT "BolStop_bolId_fkey" FOREIGN KEY ("bolId") REFERENCES "BillOfLading"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BolStop" ADD CONSTRAINT "BolStop_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ShippingLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOLLine" ADD CONSTRAINT "BOLLine_sourceLotId_fkey" FOREIGN KEY ("sourceLotId") REFERENCES "YardInventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOLLine" ADD CONSTRAINT "BOLLine_pickupStopId_fkey" FOREIGN KEY ("pickupStopId") REFERENCES "BolStop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOLLine" ADD CONSTRAINT "BOLLine_dropStopId_fkey" FOREIGN KEY ("dropStopId") REFERENCES "BolStop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReceipt" ADD CONSTRAINT "SiteReceipt_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "BolStop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReceipt" ADD CONSTRAINT "SiteReceipt_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

