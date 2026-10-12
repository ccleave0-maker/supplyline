-- CreateTable
CREATE TABLE "AssistantConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "action" JSONB,
    "actionStatus" TEXT,
    "actionResult" JSONB,
    "unanswered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nickname" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "phrase" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nickname_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contextKey" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantConversation_organizationId_userId_updatedAt_idx" ON "AssistantConversation"("organizationId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_conversationId_createdAt_idx" ON "AssistantMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Nickname_organizationId_phrase_idx" ON "Nickname"("organizationId", "phrase");

-- CreateIndex
CREATE INDEX "SuggestionEvent_organizationId_kind_contextKey_idx" ON "SuggestionEvent"("organizationId", "kind", "contextKey");

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

