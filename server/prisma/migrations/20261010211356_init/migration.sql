-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SITE', 'YARD', 'PROCUREMENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('JOB', 'YARD');

-- CreateEnum
CREATE TYPE "EmailRecipientKind" AS ENUM ('PROCUREMENT', 'YARD', 'CC');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LineStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SENT_FOR_RFQ', 'YARD_STOCK', 'ON_ORDER', 'RECEIVED_AT_YARD', 'SHIPPED_PARTIAL', 'SHIPPED', 'RECEIVED_ON_SITE', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomColumnType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- CreateEnum
CREATE TYPE "PoSource" AS ENUM ('MANUAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "InventorySource" AS ENUM ('YARD_STOCK', 'PO_RECEIPT', 'RETURN');

-- CreateEnum
CREATE TYPE "BolDirection" AS ENUM ('OUTBOUND', 'RETURN');

-- CreateEnum
CREATE TYPE "BolStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('MANUAL', 'AUTO', 'IMPORT');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('TRUCKING', 'VENDOR', 'BUSINESS', 'ANCILLARY', 'PERSON');

-- CreateEnum
CREATE TYPE "StorageProviderKind" AS ENUM ('LOCAL', 'SUPABASE', 'SHAREPOINT', 'GOOGLE_DRIVE');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('LOGO', 'BACKGROUND', 'PHOTO', 'BOL_PDF', 'ORDER_PDF', 'DELIVERY_DOC', 'MTR', 'CERT', 'SUBCONTRACT', 'EXPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "QcDocType" AS ENUM ('MTR', 'CERT', 'OTHER');

-- CreateEnum
CREATE TYPE "MailboxProvider" AS ENUM ('GMAIL', 'MICROSOFT365');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "aiFallbackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiFallbackMonthlyCapCad" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "themeColor" TEXT NOT NULL DEFAULT '#334155',
    "logoFileId" TEXT,
    "loginBackgroundFileId" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "phone" TEXT,
    "roles" "Role"[],
    "isPlatformOwner" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientApp" TEXT,
    "clientVersion" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "roles" "Role"[],
    "siteIds" TEXT[],
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceRegistration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "pushToken" TEXT NOT NULL,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "type" "SiteType" NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'CA',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YardCompany" (
    "yardId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "YardCompany_pkey" PRIMARY KEY ("yardId","companyId")
);

-- CreateTable
CREATE TABLE "SiteMembership" (
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteMembership_pkey" PRIMARY KEY ("siteId","userId")
);

-- CreateTable
CREATE TABLE "CompanyEmailRecipient" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "EmailRecipientKind" NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "CompanyEmailRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteEmailRoute" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" "EmailRecipientKind" NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "SiteEmailRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteContact" (
    "siteId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "roleOnSite" TEXT,

    CONSTRAINT "SiteContact_pkey" PRIMARY KEY ("siteId","contactId")
);

-- CreateTable
CREATE TABLE "CostCode" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CostCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OrderForm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "listNo" INTEGER,
    "companySeq" INTEGER,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "orderFormId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "uom" TEXT NOT NULL,
    "costCodeId" TEXT,
    "orderedByInitials" TEXT NOT NULL,
    "requiredOnSite" DATE,
    "status" "LineStatus" NOT NULL DEFAULT 'DRAFT',
    "statusChangedAt" TIMESTAMP(3),
    "yardQtyAvailable" DECIMAL(14,3),
    "yardCheckedById" TEXT,
    "yardCheckedAt" TIMESTAMP(3),
    "unitCost" DECIMAL(14,4),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomColumn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataType" "CustomColumnType" NOT NULL DEFAULT 'TEXT',
    "options" JSONB,
    "sharedWithSite" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomValue" (
    "columnId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomValue_pkey" PRIMARY KEY ("columnId","orderLineId")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactId" TEXT,
    "externalId" TEXT,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "source" "PoSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4),
    "vendorEta" DATE,
    "externalLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YardReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "yardId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "orderFormId" TEXT,
    "returnBolId" TEXT,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "YardReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YardReceiptLine" (
    "id" TEXT NOT NULL,
    "yardReceiptId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "bolLineId" TEXT,
    "qtyExpected" DECIMAL(14,3) NOT NULL,
    "qtyReceived" DECIMAL(14,3) NOT NULL,
    "problem" BOOLEAN NOT NULL DEFAULT false,
    "problemNote" TEXT,

    CONSTRAINT "YardReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YardInventoryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "yardId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "source" "InventorySource" NOT NULL,
    "yardReceiptLineId" TEXT,
    "description" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "qtyIn" DECIMAL(14,3) NOT NULL,
    "qtyAvailable" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YardInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillOfLading" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bolNumber" INTEGER NOT NULL,
    "direction" "BolDirection" NOT NULL DEFAULT 'OUTBOUND',
    "status" "BolStatus" NOT NULL DEFAULT 'DRAFT',
    "siteId" TEXT NOT NULL,
    "shipFromLocationId" TEXT NOT NULL,
    "shipToLocationId" TEXT NOT NULL,
    "carrierContactId" TEXT,
    "pdfFileId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillOfLading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOLLine" (
    "id" TEXT NOT NULL,
    "bolId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "yardInventoryItemId" TEXT,
    "description" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "BOLLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bolId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "SiteReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteReceiptLine" (
    "id" TEXT NOT NULL,
    "siteReceiptId" TEXT NOT NULL,
    "bolLineId" TEXT NOT NULL,
    "qtyReceived" DECIMAL(14,3) NOT NULL,
    "qtyShort" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "damaged" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "SiteReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteInventoryItem" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "qtyOrdered" DECIMAL(14,3) NOT NULL,
    "qtyShipped" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qtyReceived" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qtyReturned" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "siteId" TEXT,
    "businessName" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "cell" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "source" "EntrySource" NOT NULL DEFAULT 'MANUAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "type" "ContactType" NOT NULL,
    "name" TEXT NOT NULL,
    "businessName" TEXT,
    "phone" TEXT,
    "cell" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "source" "EntrySource" NOT NULL DEFAULT 'MANUAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "serial" TEXT,
    "category" TEXT,
    "currentLocationId" TEXT,
    "currentLocationText" TEXT,
    "currentLat" DOUBLE PRECISION,
    "currentLng" DOUBLE PRECISION,
    "importedRaw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentMovement" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "fromText" TEXT,
    "toLocationId" TEXT,
    "toText" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "bolId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "provider" "StorageProviderKind" NOT NULL,
    "connectionId" TEXT,
    "storageKey" TEXT NOT NULL,
    "externalId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "kind" "FileKind" NOT NULL DEFAULT 'OTHER',
    "uploadedById" TEXT,
    "yardReceiptId" TEXT,
    "siteReceiptId" TEXT,
    "documentScanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QCDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT,
    "type" "QcDocType" NOT NULL,
    "title" TEXT NOT NULL,
    "heatNumber" TEXT,
    "fileId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "vendorId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QCDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QCDocumentLine" (
    "qcDocumentId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,

    CONSTRAINT "QCDocumentLine_pkey" PRIMARY KEY ("qcDocumentId","orderLineId")
);

-- CreateTable
CREATE TABLE "SubcontractDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "subcontractor" TEXT NOT NULL,
    "contactId" TEXT,
    "docType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "effectiveDate" DATE,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubcontractDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "provider" "StorageProviderKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "credentialsEncrypted" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "MailboxProvider" NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "credentialsEncrypted" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "provider" TEXT,
    "fromName" TEXT NOT NULL,
    "replyTo" TEXT,
    "to" TEXT[],
    "cc" TEXT[],
    "subject" TEXT NOT NULL,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "attachments" JSONB,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePost" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "clientApp" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB,
    "valueEncrypted" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AiConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyEncrypted" TEXT,
    "model" TEXT,
    "sttProvider" TEXT,
    "sttKeyEncrypted" TEXT,
    "monthlyCapCad" DECIMAL(10,2),
    "alertedMonth80" TEXT,
    "alertedMonth100" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiToggle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "role" "Role",
    "screen" TEXT,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "AiToggle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRequestLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "siteId" TEXT,
    "userId" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "usedPlatformKey" BOOLEAN NOT NULL DEFAULT false,
    "transcript" TEXT,
    "fieldsFilled" JSONB,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costCad" DECIMAL(10,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentScan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "yardReceiptId" TEXT,
    "purchaseOrderId" TEXT,
    "extracted" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "target" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkSyncSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkSyncSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Company_logoFileId_key" ON "Company"("logoFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_loginBackgroundFileId_key" ON "Company"("loginBackgroundFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_organizationId_code_key" ON "Company"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerSubject_key" ON "AuthIdentity"("provider", "providerSubject");

-- CreateIndex
CREATE INDEX "LoginCode_email_createdAt_idx" ON "LoginCode"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceRegistration_platform_pushToken_key" ON "DeviceRegistration"("platform", "pushToken");

-- CreateIndex
CREATE INDEX "Site_organizationId_type_idx" ON "Site"("organizationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Site_companyId_jobNumber_key" ON "Site"("companyId", "jobNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEmailRecipient_companyId_kind_email_key" ON "CompanyEmailRecipient"("companyId", "kind", "email");

-- CreateIndex
CREATE UNIQUE INDEX "SiteEmailRoute_siteId_kind_email_key" ON "SiteEmailRoute"("siteId", "kind", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CostCode_companyId_siteId_code_key" ON "CostCode"("companyId", "siteId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "OrderForm_siteId_listNo_key" ON "OrderForm"("siteId", "listNo");

-- CreateIndex
CREATE UNIQUE INDEX "OrderForm_companyId_companySeq_key" ON "OrderForm"("companyId", "companySeq");

-- CreateIndex
CREATE INDEX "OrderLine_siteId_status_idx" ON "OrderLine"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLine_orderFormId_lineNo_key" ON "OrderLine"("orderFormId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_companyId_name_key" ON "Vendor"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_poNumber_key" ON "PurchaseOrder"("companyId", "poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "YardInventoryItem_yardReceiptLineId_key" ON "YardInventoryItem"("yardReceiptLineId");

-- CreateIndex
CREATE INDEX "YardInventoryItem_yardId_companyId_idx" ON "YardInventoryItem"("yardId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BillOfLading_pdfFileId_key" ON "BillOfLading"("pdfFileId");

-- CreateIndex
CREATE UNIQUE INDEX "BillOfLading_companyId_bolNumber_key" ON "BillOfLading"("companyId", "bolNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BOLLine_bolId_lineNo_key" ON "BOLLine"("bolId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "SiteInventoryItem_orderLineId_key" ON "SiteInventoryItem"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingLocation_siteId_key" ON "ShippingLocation"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_companyId_unitNumber_key" ON "Equipment"("companyId", "unitNumber");

-- CreateIndex
CREATE UNIQUE INDEX "QCDocument_fileId_key" ON "QCDocument"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractDocument_fileId_key" ON "SubcontractDocument"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxConnection_userId_key" ON "MailboxConnection"("userId");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_createdAt_idx" ON "EmailOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entityType_entityId_idx" ON "AuditLog"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_at_idx" ON "AuditLog"("organizationId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "AiConfig_organizationId_key" ON "AiConfig"("organizationId");

-- CreateIndex
CREATE INDEX "AiRequestLog_organizationId_createdAt_idx" ON "AiRequestLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_loginBackgroundFileId_fkey" FOREIGN KEY ("loginBackgroundFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceRegistration" ADD CONSTRAINT "DeviceRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardCompany" ADD CONSTRAINT "YardCompany_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardCompany" ADD CONSTRAINT "YardCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMembership" ADD CONSTRAINT "SiteMembership_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMembership" ADD CONSTRAINT "SiteMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyEmailRecipient" ADD CONSTRAINT "CompanyEmailRecipient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteEmailRoute" ADD CONSTRAINT "SiteEmailRoute_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteContact" ADD CONSTRAINT "SiteContact_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteContact" ADD CONSTRAINT "SiteContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCode" ADD CONSTRAINT "CostCode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCode" ADD CONSTRAINT "CostCode_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderForm" ADD CONSTRAINT "OrderForm_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderForm" ADD CONSTRAINT "OrderForm_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderForm" ADD CONSTRAINT "OrderForm_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderForm" ADD CONSTRAINT "OrderForm_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderFormId_fkey" FOREIGN KEY ("orderFormId") REFERENCES "OrderForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomColumn" ADD CONSTRAINT "CustomColumn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomValue" ADD CONSTRAINT "CustomValue_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "CustomColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomValue" ADD CONSTRAINT "CustomValue_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardReceipt" ADD CONSTRAINT "YardReceipt_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardReceipt" ADD CONSTRAINT "YardReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardReceipt" ADD CONSTRAINT "YardReceipt_orderFormId_fkey" FOREIGN KEY ("orderFormId") REFERENCES "OrderForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardReceipt" ADD CONSTRAINT "YardReceipt_returnBolId_fkey" FOREIGN KEY ("returnBolId") REFERENCES "BillOfLading"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardReceipt" ADD CONSTRAINT "YardReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardReceiptLine" ADD CONSTRAINT "YardReceiptLine_yardReceiptId_fkey" FOREIGN KEY ("yardReceiptId") REFERENCES "YardReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardReceiptLine" ADD CONSTRAINT "YardReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardReceiptLine" ADD CONSTRAINT "YardReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardReceiptLine" ADD CONSTRAINT "YardReceiptLine_bolLineId_fkey" FOREIGN KEY ("bolLineId") REFERENCES "BOLLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_yardReceiptLineId_fkey" FOREIGN KEY ("yardReceiptLineId") REFERENCES "YardReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfLading" ADD CONSTRAINT "BillOfLading_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfLading" ADD CONSTRAINT "BillOfLading_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfLading" ADD CONSTRAINT "BillOfLading_shipFromLocationId_fkey" FOREIGN KEY ("shipFromLocationId") REFERENCES "ShippingLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfLading" ADD CONSTRAINT "BillOfLading_shipToLocationId_fkey" FOREIGN KEY ("shipToLocationId") REFERENCES "ShippingLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfLading" ADD CONSTRAINT "BillOfLading_carrierContactId_fkey" FOREIGN KEY ("carrierContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfLading" ADD CONSTRAINT "BillOfLading_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfLading" ADD CONSTRAINT "BillOfLading_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOLLine" ADD CONSTRAINT "BOLLine_bolId_fkey" FOREIGN KEY ("bolId") REFERENCES "BillOfLading"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOLLine" ADD CONSTRAINT "BOLLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOLLine" ADD CONSTRAINT "BOLLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOLLine" ADD CONSTRAINT "BOLLine_yardInventoryItemId_fkey" FOREIGN KEY ("yardInventoryItemId") REFERENCES "YardInventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReceipt" ADD CONSTRAINT "SiteReceipt_bolId_fkey" FOREIGN KEY ("bolId") REFERENCES "BillOfLading"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReceipt" ADD CONSTRAINT "SiteReceipt_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReceipt" ADD CONSTRAINT "SiteReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReceiptLine" ADD CONSTRAINT "SiteReceiptLine_siteReceiptId_fkey" FOREIGN KEY ("siteReceiptId") REFERENCES "SiteReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReceiptLine" ADD CONSTRAINT "SiteReceiptLine_bolLineId_fkey" FOREIGN KEY ("bolLineId") REFERENCES "BOLLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteInventoryItem" ADD CONSTRAINT "SiteInventoryItem_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteInventoryItem" ADD CONSTRAINT "SiteInventoryItem_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingLocation" ADD CONSTRAINT "ShippingLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingLocation" ADD CONSTRAINT "ShippingLocation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "ShippingLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMovement" ADD CONSTRAINT "EquipmentMovement_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMovement" ADD CONSTRAINT "EquipmentMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "ShippingLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMovement" ADD CONSTRAINT "EquipmentMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "ShippingLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMovement" ADD CONSTRAINT "EquipmentMovement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMovement" ADD CONSTRAINT "EquipmentMovement_bolId_fkey" FOREIGN KEY ("bolId") REFERENCES "BillOfLading"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "StorageConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_yardReceiptId_fkey" FOREIGN KEY ("yardReceiptId") REFERENCES "YardReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_siteReceiptId_fkey" FOREIGN KEY ("siteReceiptId") REFERENCES "SiteReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_documentScanId_fkey" FOREIGN KEY ("documentScanId") REFERENCES "DocumentScan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QCDocument" ADD CONSTRAINT "QCDocument_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QCDocument" ADD CONSTRAINT "QCDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QCDocument" ADD CONSTRAINT "QCDocument_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QCDocument" ADD CONSTRAINT "QCDocument_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QCDocumentLine" ADD CONSTRAINT "QCDocumentLine_qcDocumentId_fkey" FOREIGN KEY ("qcDocumentId") REFERENCES "QCDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QCDocumentLine" ADD CONSTRAINT "QCDocumentLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractDocument" ADD CONSTRAINT "SubcontractDocument_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractDocument" ADD CONSTRAINT "SubcontractDocument_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractDocument" ADD CONSTRAINT "SubcontractDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageConnection" ADD CONSTRAINT "StorageConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxConnection" ADD CONSTRAINT "MailboxConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePost" ADD CONSTRAINT "SitePost_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePost" ADD CONSTRAINT "SitePost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConfig" ADD CONSTRAINT "AiConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentScan" ADD CONSTRAINT "DocumentScan_yardReceiptId_fkey" FOREIGN KEY ("yardReceiptId") REFERENCES "YardReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentScan" ADD CONSTRAINT "DocumentScan_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
