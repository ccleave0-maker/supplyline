-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'PROJECT_DOC';

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "linkName" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderDocument" (
    "purchaseOrderId" TEXT NOT NULL,
    "projectDocumentId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderDocument_pkey" PRIMARY KEY ("purchaseOrderId","projectDocumentId")
);

-- CreateIndex
CREATE INDEX "ProjectDocument_siteId_idx" ON "ProjectDocument"("siteId");

-- CreateIndex
CREATE INDEX "PurchaseOrderDocument_purchaseOrderId_idx" ON "PurchaseOrderDocument"("purchaseOrderId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderDocument" ADD CONSTRAINT "PurchaseOrderDocument_projectDocumentId_fkey" FOREIGN KEY ("projectDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

