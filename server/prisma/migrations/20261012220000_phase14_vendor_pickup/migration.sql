-- AlterEnum
ALTER TYPE "InventorySource" ADD VALUE 'VENDOR';

-- AlterTable
ALTER TABLE "ShippingLocation" ADD COLUMN     "vendorId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ShippingLocation_vendorId_key" ON "ShippingLocation"("vendorId");

