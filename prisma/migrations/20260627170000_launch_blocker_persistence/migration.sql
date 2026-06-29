CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "adminId" TEXT,
    "adminEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "to" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthState_stateHash_key" ON "OAuthState"("stateHash");
CREATE INDEX "OAuthState_purpose_expiresAt_idx" ON "OAuthState"("purpose", "expiresAt");
CREATE INDEX "OAuthState_workspaceId_idx" ON "OAuthState"("workspaceId");
CREATE INDEX "OAuthState_userId_idx" ON "OAuthState"("userId");
CREATE INDEX "OAuthState_adminId_idx" ON "OAuthState"("adminId");
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");
CREATE INDEX "EmailOutbox_userId_createdAt_idx" ON "EmailOutbox"("userId", "createdAt");
CREATE INDEX "EmailOutbox_to_createdAt_idx" ON "EmailOutbox"("to", "createdAt");
