-- DropForeignKey
ALTER TABLE "BOLLine" DROP CONSTRAINT "BOLLine_orderLineId_fkey";

-- DropForeignKey
ALTER TABLE "BOLLine" DROP CONSTRAINT "BOLLine_sourceLotId_fkey";

-- AlterTable
ALTER TABLE "BOLLine" ADD COLUMN     "forSiteId" TEXT,
ADD COLUMN     "manual" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "orderLineId" DROP NOT NULL,
ALTER COLUMN "sourceLotId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "BOLLine" ADD CONSTRAINT "BOLLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOLLine" ADD CONSTRAINT "BOLLine_sourceLotId_fkey" FOREIGN KEY ("sourceLotId") REFERENCES "YardInventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

