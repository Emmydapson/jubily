CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "name" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT,
  "ownerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMember" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceInvite" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
  "tokenHash" TEXT NOT NULL,
  "invitedById" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceYoutubeConnection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "encrypted" TEXT NOT NULL,
  "last4" TEXT NOT NULL,
  "channelId" TEXT,
  "channelTitle" TEXT,
  "channelCustomUrl" TEXT,
  "scope" TEXT,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceYoutubeConnection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Topic" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Script" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "VideoJob" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Offer" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Click" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Conversion" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "PipelineEvent" ADD COLUMN "workspaceId" TEXT;

DROP INDEX IF EXISTS "Offer_externalProductId_key";

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");
CREATE INDEX "WorkspaceInvite_workspaceId_idx" ON "WorkspaceInvite"("workspaceId");
CREATE INDEX "WorkspaceInvite_email_idx" ON "WorkspaceInvite"("email");
CREATE UNIQUE INDEX "WorkspaceYoutubeConnection_workspaceId_key" ON "WorkspaceYoutubeConnection"("workspaceId");

CREATE INDEX "Topic_workspaceId_idx" ON "Topic"("workspaceId");
CREATE INDEX "Script_workspaceId_idx" ON "Script"("workspaceId");
CREATE INDEX "VideoJob_workspaceId_idx" ON "VideoJob"("workspaceId");
CREATE INDEX "Offer_workspaceId_idx" ON "Offer"("workspaceId");
CREATE UNIQUE INDEX "Offer_workspaceId_externalProductId_key" ON "Offer"("workspaceId", "externalProductId");
CREATE UNIQUE INDEX "Offer_workspaceId_network_hoplink_key" ON "Offer"("workspaceId", "network", "hoplink");
CREATE INDEX "Click_workspaceId_createdAt_idx" ON "Click"("workspaceId", "createdAt");
CREATE INDEX "Conversion_workspaceId_createdAt_idx" ON "Conversion"("workspaceId", "createdAt");
CREATE INDEX "PipelineEvent_workspaceId_createdAt_idx" ON "PipelineEvent"("workspaceId", "createdAt");

ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceYoutubeConnection" ADD CONSTRAINT "WorkspaceYoutubeConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Topic" ADD CONSTRAINT "Topic_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Script" ADD CONSTRAINT "Script_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Click" ADD CONSTRAINT "Click_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PipelineEvent" ADD CONSTRAINT "PipelineEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
