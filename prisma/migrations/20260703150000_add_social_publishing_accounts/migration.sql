-- CreateEnum
CREATE TYPE "PublishingProvider" AS ENUM ('YOUTUBE', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM');

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'TIKTOK';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'FACEBOOK';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'INSTAGRAM';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SOCIAL_ACCOUNT_CONNECTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SOCIAL_ACCOUNT_DISCONNECTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SOCIAL_ACCOUNT_SELECTED';

-- AlterTable
ALTER TABLE "VideoJob" ADD COLUMN "publishTarget" "PublishingProvider" NOT NULL DEFAULT 'YOUTUBE',
ADD COLUMN "socialPostId" TEXT,
ADD COLUMN "socialPostUrl" TEXT;

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PublishingProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "username" TEXT,
    "avatarUrl" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "accessTokenLast4" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "refreshTokenLast4" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedPageId" TEXT,
    "selectedInstagramBusinessAccountId" TEXT,
    "metadata" JSONB,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_workspaceId_provider_providerAccountId_key" ON "SocialAccount"("workspaceId", "provider", "providerAccountId");
CREATE INDEX "SocialAccount_workspaceId_provider_idx" ON "SocialAccount"("workspaceId", "provider");
CREATE INDEX "SocialAccount_userId_idx" ON "SocialAccount"("userId");
CREATE INDEX "SocialAccount_disconnectedAt_idx" ON "SocialAccount"("disconnectedAt");
CREATE INDEX "VideoJob_publishTarget_published_idx" ON "VideoJob"("publishTarget", "published");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
