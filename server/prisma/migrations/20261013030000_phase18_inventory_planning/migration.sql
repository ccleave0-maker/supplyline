-- DropForeignKey
ALTER TABLE "YardInventoryItem" DROP CONSTRAINT "YardInventoryItem_finalSiteId_fkey";

-- DropForeignKey
ALTER TABLE "YardInventoryItem" DROP CONSTRAINT "YardInventoryItem_orderLineId_fkey";

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "equipmentPriority" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "SiteReceipt" ADD COLUMN     "reportFileId" TEXT;

-- AlterTable
ALTER TABLE "YardInventoryItem" ADD COLUMN     "equipmentId" TEXT,
ALTER COLUMN "orderLineId" DROP NOT NULL,
ALTER COLUMN "finalSiteId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "YardReceipt" ADD COLUMN     "reportFileId" TEXT;

-- CreateTable
CREATE TABLE "JobEquipmentNeed" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "equipmentId" TEXT,
    "coverage" TEXT NOT NULL DEFAULT 'NEEDED',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobEquipmentNeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobEquipmentNeed_organizationId_fromDate_idx" ON "JobEquipmentNeed"("organizationId", "fromDate");

-- CreateIndex
CREATE INDEX "JobEquipmentNeed_siteId_idx" ON "JobEquipmentNeed"("siteId");

-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_finalSiteId_fkey" FOREIGN KEY ("finalSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

