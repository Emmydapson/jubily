ALTER TABLE "VideoJob"
ADD COLUMN "durationSeconds" DOUBLE PRECISION,
ADD COLUMN "sceneCount" INTEGER,
ADD COLUMN "hasBurnedSubtitles" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hasTrackingLink" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "shotstackPayloadDebugPath" TEXT;
