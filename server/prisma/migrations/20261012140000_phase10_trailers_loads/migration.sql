-- AlterTable
ALTER TABLE "BillOfLading" ADD COLUMN     "trailerId" TEXT;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "heightM" DECIMAL(8,3),
ADD COLUMN     "lengthM" DECIMAL(8,3),
ADD COLUMN     "stackable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "unitWeightKg" DECIMAL(12,3),
ADD COLUMN     "widthM" DECIMAL(8,3);

-- CreateTable
CREATE TABLE "Trailer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unitNumber" TEXT,
    "carrierContactId" TEXT,
    "deckLengthM" DECIMAL(6,2) NOT NULL,
    "deckWidthM" DECIMAL(6,2) NOT NULL,
    "deckHeightM" DECIMAL(6,2) NOT NULL,
    "maxHeightM" DECIMAL(6,2) NOT NULL DEFAULT 4.15,
    "maxWidthM" DECIMAL(6,2) NOT NULL DEFAULT 2.6,
    "maxPayloadKg" DECIMAL(10,1) NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trailer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trailer_organizationId_active_idx" ON "Trailer"("organizationId", "active");

-- AddForeignKey
ALTER TABLE "BillOfLading" ADD CONSTRAINT "BillOfLading_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

