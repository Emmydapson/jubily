CREATE TYPE "AuditAction" AS ENUM (
  'LOGIN',
  'SIGNUP',
  'WORKSPACE_CREATED',
  'YOUTUBE_CONNECTED',
  'YOUTUBE_DISCONNECTED',
  'VIDEO_GENERATED',
  'VIDEO_RENDERED',
  'VIDEO_PUBLISHED',
  'BILLING_CHECKOUT_REQUESTED',
  'BILLING_CANCEL_REQUESTED',
  'SUBSCRIPTION_CHANGED',
  'WORKSPACE_SUSPENDED',
  'WORKSPACE_UNSUSPENDED',
  'PERMISSION_DENIED'
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "userId" TEXT,
  "adminId" TEXT,
  "action" "AuditAction" NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_adminId_createdAt_idx" ON "AuditLog"("adminId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE UNIQUE INDEX "BillingWebhookEvent_provider_providerEventId_key" ON "BillingWebhookEvent"("provider", "providerEventId");
CREATE INDEX "BillingWebhookEvent_provider_receivedAt_idx" ON "BillingWebhookEvent"("provider", "receivedAt");
CREATE INDEX "BillingWebhookEvent_status_receivedAt_idx" ON "BillingWebhookEvent"("status", "receivedAt");

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
