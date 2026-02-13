-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GOOGLE', 'OPENAI', 'DIGISTORE', 'CLICKBANK', 'YOUTUBE', 'SHOTSTACK');

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'app',
    "automationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "verticalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoPublish" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "videosPerDay" INTEGER NOT NULL DEFAULT 3,
    "runHours" INTEGER[] DEFAULT ARRAY[9, 13, 18]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationKey" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "encrypted" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationKey_provider_key" ON "IntegrationKey"("provider");
