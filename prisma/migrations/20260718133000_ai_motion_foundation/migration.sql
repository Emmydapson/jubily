-- AI Motion Phase 1 foundation. Standard remains the default for existing rows.
CREATE TYPE "VideoGenerationMode" AS ENUM ('STANDARD', 'AI_MOTION');
CREATE TYPE "MotionPlanningStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PLANNED', 'FAILED');
CREATE TYPE "MotionFallbackPolicy" AS ENUM ('FALLBACK_TO_STANDARD', 'FAIL_JOB');
CREATE TYPE "MotionSceneGenerationStatus" AS ENUM ('PLANNED', 'PROVIDER_CREATED', 'PROCESSING', 'COMPLETED', 'FAILED', 'FALLBACK_APPLIED');
CREATE TYPE "MotionSceneAssetType" AS ENUM ('IMAGE', 'VIDEO');

ALTER TABLE "VideoJob"
  ADD COLUMN "generationMode" "VideoGenerationMode" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "motionPlanningStatus" "MotionPlanningStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "plannedMotionSceneCount" INTEGER,
  ADD COLUMN "estimatedMotionCredits" INTEGER,
  ADD COLUMN "motionEstimateFinal" BOOLEAN,
  ADD COLUMN "motionPricingVersion" TEXT,
  ADD COLUMN "motionEstimateCreatedAt" TIMESTAMP(3),
  ADD COLUMN "motionFallbackPolicy" "MotionFallbackPolicy" NOT NULL DEFAULT 'FALLBACK_TO_STANDARD',
  ADD COLUMN "completedMotionSceneCount" INTEGER,
  ADD COLUMN "fallbackMotionSceneCount" INTEGER,
  ADD COLUMN "motionPlannerVersion" TEXT;

CREATE TABLE "VideoJobMotionScene" (
  "id" TEXT NOT NULL,
  "videoJobId" TEXT NOT NULL,
  "sceneIndex" INTEGER NOT NULL,
  "sourceSceneIndex" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "plannerVersion" TEXT NOT NULL,
  "assetType" "MotionSceneAssetType" NOT NULL DEFAULT 'IMAGE',
  "motionEligible" BOOLEAN NOT NULL DEFAULT false,
  "motionSelected" BOOLEAN NOT NULL DEFAULT false,
  "selectionReason" TEXT,
  "rejectionReason" TEXT,
  "plannedClipDuration" DOUBLE PRECISION,
  "prompt" JSONB,
  "fallbackAssetUrl" TEXT,
  "motionClipUrl" TEXT,
  "provider" TEXT,
  "providerJobId" TEXT,
  "generationStatus" "MotionSceneGenerationStatus" NOT NULL DEFAULT 'PLANNED',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VideoJobMotionScene_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoJobMotionScene_idempotencyKey_key" ON "VideoJobMotionScene"("idempotencyKey");
CREATE UNIQUE INDEX "VideoJobMotionScene_videoJobId_sceneIndex_plannerVersion_attempt_key" ON "VideoJobMotionScene"("videoJobId", "sceneIndex", "plannerVersion", "attempt");
CREATE INDEX "VideoJobMotionScene_videoJobId_idx" ON "VideoJobMotionScene"("videoJobId");
CREATE INDEX "VideoJobMotionScene_generationStatus_idx" ON "VideoJobMotionScene"("generationStatus");
CREATE INDEX "VideoJobMotionScene_providerJobId_idx" ON "VideoJobMotionScene"("providerJobId");
CREATE INDEX "VideoJob_generationMode_motionPlanningStatus_idx" ON "VideoJob"("generationMode", "motionPlanningStatus");

ALTER TABLE "VideoJobMotionScene"
  ADD CONSTRAINT "VideoJobMotionScene_videoJobId_fkey"
  FOREIGN KEY ("videoJobId") REFERENCES "VideoJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
