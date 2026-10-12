-- AlterTable
ALTER TABLE "BillOfLading" ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "shippedById" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "overdueNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SiteNotifyRule" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "name" TEXT,
    "events" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteNotifyRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteNotifyRule_siteId_userId_key" ON "SiteNotifyRule"("siteId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteNotifyRule_siteId_email_key" ON "SiteNotifyRule"("siteId", "email");

-- AddForeignKey
ALTER TABLE "SiteNotifyRule" ADD CONSTRAINT "SiteNotifyRule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteNotifyRule" ADD CONSTRAINT "SiteNotifyRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- BOLs already issued count as shipped.
UPDATE "BillOfLading" SET "shippedAt" = "issuedAt" WHERE "status" <> 'DRAFT' AND "issuedAt" IS NOT NULL;
