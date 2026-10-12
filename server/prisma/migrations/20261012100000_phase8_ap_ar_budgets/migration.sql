-- CreateEnum
CREATE TYPE "ApStatus" AS ENUM ('RECEIVED', 'NEEDS_REVIEW', 'IN_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'ON_HOLD', 'REPLACED');

-- CreateEnum
CREATE TYPE "ApDocKind" AS ENUM ('INVOICE', 'CREDIT');

-- CreateEnum
CREATE TYPE "ArStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileKind" ADD VALUE 'AP_INVOICE';
ALTER TYPE "FileKind" ADD VALUE 'AR_INVOICE';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'AP';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "isApContact" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "costCode" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "arHoldbackPct" DECIMAL(5,2),
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "subHoldbackPct" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "SubHoldback" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "pct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "SubHoldback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ApDocKind" NOT NULL DEFAULT 'INVOICE',
    "status" "ApStatus" NOT NULL DEFAULT 'RECEIVED',
    "vendorId" TEXT,
    "vendorName" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" DATE,
    "dueDate" DATE,
    "purchaseOrderId" TEXT,
    "poNumberText" TEXT,
    "siteId" TEXT,
    "equipmentId" TEXT,
    "costCode" TEXT,
    "subtotal" DECIMAL(14,2),
    "gst" DECIMAL(14,2),
    "pst" DECIMAL(14,2),
    "total" DECIMAL(14,2),
    "holdbackPct" DECIMAL(5,2),
    "holdbackAmount" DECIMAL(14,2),
    "holdbackReleasedAt" TIMESTAMP(3),
    "matchIssues" TEXT[],
    "refInvoiceNumber" TEXT,
    "replacesId" TEXT,
    "fileId" TEXT,
    "receivedVia" TEXT NOT NULL DEFAULT 'UPLOAD',
    "sourcePath" TEXT,
    "folderState" TEXT,
    "readByAi" BOOLEAN NOT NULL DEFAULT false,
    "aiRaw" JSONB,
    "rejectedReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionSentTo" TEXT,
    "rejectionSentAt" TIMESTAMP(3),
    "holdReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" DATE,
    "paymentRef" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(14,3),
    "uom" TEXT,
    "unitPrice" DECIMAL(14,4),
    "amount" DECIMAL(14,2),
    "poLineId" TEXT,
    "matchNote" TEXT,

    CONSTRAINT "ApInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApApproval" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "approverType" TEXT NOT NULL,
    "userId" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "gstNumber" TEXT,
    "termsDays" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "siteId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "ArStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "gstRate" DECIMAL(6,4) NOT NULL,
    "pstRate" DECIMAL(6,4) NOT NULL,
    "gst" DECIMAL(14,2) NOT NULL,
    "pst" DECIMAL(14,2) NOT NULL,
    "holdbackPct" DECIMAL(5,2),
    "holdbackAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "fileId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "uom" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "costCode" TEXT,

    CONSTRAINT "ArInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArPayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paidOn" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "holdbackRelease" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobBudget" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "costCode" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "JobBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubHoldback_siteId_contactId_key" ON "SubHoldback"("siteId", "contactId");

-- CreateIndex
CREATE INDEX "ApInvoice_organizationId_status_idx" ON "ApInvoice"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ApInvoice_companyId_invoiceNumber_idx" ON "ApInvoice"("companyId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "ApApproval_invoiceId_kind_step_idx" ON "ApApproval"("invoiceId", "kind", "step");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_name_key" ON "Customer"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ArInvoice_companyId_invoiceNumber_key" ON "ArInvoice"("companyId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "JobBudget_siteId_costCode_key" ON "JobBudget"("siteId", "costCode");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubHoldback" ADD CONSTRAINT "SubHoldback_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubHoldback" ADD CONSTRAINT "SubHoldback_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApInvoice" ADD CONSTRAINT "ApInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApInvoice" ADD CONSTRAINT "ApInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApInvoice" ADD CONSTRAINT "ApInvoice_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApInvoiceLine" ADD CONSTRAINT "ApInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ApInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApInvoiceLine" ADD CONSTRAINT "ApInvoiceLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApApproval" ADD CONSTRAINT "ApApproval_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ApInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArInvoice" ADD CONSTRAINT "ArInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArInvoice" ADD CONSTRAINT "ArInvoice_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArInvoiceLine" ADD CONSTRAINT "ArInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ArInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArPayment" ADD CONSTRAINT "ArPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ArInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBudget" ADD CONSTRAINT "JobBudget_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

