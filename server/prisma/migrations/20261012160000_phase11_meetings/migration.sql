-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileKind" ADD VALUE 'MEETING_PDF';
ALTER TYPE "FileKind" ADD VALUE 'MEETING_AUDIO';

-- AlterTable
ALTER TABLE "FileAsset" ADD COLUMN     "meetingId" TEXT;

-- CreateTable
CREATE TABLE "MeetingTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT,
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "attendees" JSONB NOT NULL DEFAULT '[]',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "transcript" TEXT,
    "summary" TEXT,
    "pdfFileId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingActionItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT,
    "siteId" TEXT,
    "stepKey" TEXT,
    "text" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "assigneeName" TEXT,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "doneAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingTemplate_organizationId_idx" ON "MeetingTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "Meeting_organizationId_siteId_idx" ON "Meeting"("organizationId", "siteId");

-- CreateIndex
CREATE INDEX "MeetingActionItem_organizationId_status_idx" ON "MeetingActionItem"("organizationId", "status");

-- CreateIndex
CREATE INDEX "MeetingActionItem_assigneeUserId_status_idx" ON "MeetingActionItem"("assigneeUserId", "status");

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MeetingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

