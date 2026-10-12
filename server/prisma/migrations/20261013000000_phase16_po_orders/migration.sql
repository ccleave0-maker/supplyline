-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "addedFromPoId" TEXT,
ADD COLUMN     "offListReason" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "directBolId" TEXT,
ADD COLUMN     "shipDirect" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shipToLocationId" TEXT,
ADD COLUMN     "shipViaId" TEXT,
ADD COLUMN     "siteContact1Id" TEXT,
ADD COLUMN     "siteContact2Id" TEXT,
ADD COLUMN     "supplierContactId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "offListReason" TEXT;

-- AlterTable
ALTER TABLE "ShippingLocation" ADD COLUMN     "forSiteId" TEXT;

-- CreateTable
CREATE TABLE "ShipVia" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "accountNumber" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "contactId" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipVia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipVia_organizationId_active_idx" ON "ShipVia"("organizationId", "active");

