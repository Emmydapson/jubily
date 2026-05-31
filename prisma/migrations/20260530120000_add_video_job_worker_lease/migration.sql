-- Backward-compatible worker lease fields for distributed render/publish claiming.
ALTER TABLE "VideoJob"
  ADD COLUMN "workerLockedAt" TIMESTAMP(3),
  ADD COLUMN "workerLockedBy" TEXT,
  ADD COLUMN "workerStage" TEXT;

CREATE INDEX "VideoJob_workerStage_workerLockedAt_idx" ON "VideoJob"("workerStage", "workerLockedAt");
