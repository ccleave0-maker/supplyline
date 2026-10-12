-- AlterTable
ALTER TABLE "BolStop" ADD COLUMN     "plannedDate" DATE,
ADD COLUMN     "plannedTime" TEXT;

-- CreateIndex
CREATE INDEX "BolStop_plannedDate_idx" ON "BolStop"("plannedDate");


-- Existing BOLs: the old ship date becomes the pickup date.
UPDATE "BolStop" s SET "plannedDate" = b."scheduledDate" FROM "BillOfLading" b WHERE s."bolId" = b.id AND s.kind = 'PICKUP';
