-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "chasedForDate" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

