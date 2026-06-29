-- SaaS billing-ready plan/subscription and workspace usage tracking.
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'PREMIUM');

CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'EXPIRED');

ALTER TABLE "Workspace"
  ADD COLUMN "suspended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspensionReason" TEXT;

CREATE TABLE "WorkspaceSubscription" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "plan" "Plan" NOT NULL DEFAULT 'FREE',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "billingProvider" TEXT,
  "providerCustomerId" TEXT,
  "providerSubscriptionId" TEXT,
  "currentPeriodStart" TIMESTAMP(3) NOT NULL,
  "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "trialEndsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceUsage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "videoGenerations" INTEGER NOT NULL DEFAULT 0,
  "publishes" INTEGER NOT NULL DEFAULT 0,
  "aiGenerations" INTEGER NOT NULL DEFAULT 0,
  "renderMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "storageBytes" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceSubscription_workspaceId_key" ON "WorkspaceSubscription"("workspaceId");
CREATE INDEX "WorkspaceSubscription_plan_idx" ON "WorkspaceSubscription"("plan");
CREATE INDEX "WorkspaceSubscription_status_idx" ON "WorkspaceSubscription"("status");
CREATE INDEX "WorkspaceSubscription_currentPeriodEnd_idx" ON "WorkspaceSubscription"("currentPeriodEnd");

CREATE UNIQUE INDEX "WorkspaceUsage_workspaceId_periodStart_key" ON "WorkspaceUsage"("workspaceId", "periodStart");
CREATE INDEX "WorkspaceUsage_workspaceId_periodEnd_idx" ON "WorkspaceUsage"("workspaceId", "periodEnd");

ALTER TABLE "WorkspaceSubscription"
  ADD CONSTRAINT "WorkspaceSubscription_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceUsage"
  ADD CONSTRAINT "WorkspaceUsage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
