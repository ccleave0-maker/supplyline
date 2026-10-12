-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "rfqSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "deliverToYardId" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_deliverToYardId_fkey" FOREIGN KEY ("deliverToYardId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
