-- Conversational assistant: conversation mode, memory, live session usage.
ALTER TABLE "AssistantConversation" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'quick';
ALTER TABLE "AssistantConversation" ADD COLUMN "personalityId" TEXT NOT NULL DEFAULT 'puck';
ALTER TABLE "AssistantConversation" ADD COLUMN "title" TEXT;
ALTER TABLE "AssistantConversation" ADD COLUMN "summary" TEXT;
ALTER TABLE "AssistantConversation" ADD COLUMN "endedAt" TIMESTAMP(3);

ALTER TABLE "AssistantMessage" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'text';

ALTER TABLE "UserPreferences" ADD COLUMN "personalityId" TEXT NOT NULL DEFAULT 'puck';

CREATE TABLE "ConversationSummary" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "decisions" TEXT NOT NULL DEFAULT '',
    "unresolved" TEXT NOT NULL DEFAULT '',
    "commitments" TEXT NOT NULL DEFAULT '',
    "carryForward" TEXT NOT NULL DEFAULT '',
    "modelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationSummary_conversationId_key" ON "ConversationSummary"("conversationId");

ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PersonalMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalMemory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalMemory_userId_status_idx" ON "PersonalMemory"("userId", "status");

ALTER TABLE "PersonalMemory" ADD CONSTRAINT "PersonalMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "providerSessionId" TEXT NOT NULL,
    "personalityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "changeSeq" INT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveSession_providerSessionId_key" ON "LiveSession"("providerSessionId");
CREATE INDEX "LiveSession_userId_createdAt_idx" ON "LiveSession"("userId", "createdAt");

ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LiveUsage" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "pausedSeconds" INTEGER NOT NULL DEFAULT 0,
    "backendInputTokens" INTEGER NOT NULL DEFAULT 0,
    "backendOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveUsage_liveSessionId_key" ON "LiveUsage"("liveSessionId");
CREATE INDEX "LiveUsage_userId_createdAt_idx" ON "LiveUsage"("userId", "createdAt");

ALTER TABLE "LiveUsage" ADD CONSTRAINT "LiveUsage_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveUsage" ADD CONSTRAINT "LiveUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
