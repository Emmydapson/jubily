ALTER TABLE "Script"
ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "qualityScore" INTEGER,
ADD COLUMN "qualityReview" JSONB,
ADD COLUMN "titleCandidates" JSONB,
ADD COLUMN "selectedTitle" TEXT,
ADD COLUMN "youtubeDescription" TEXT,
ADD COLUMN "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "thumbnailPrompt" TEXT,
ADD COLUMN "rewriteAttempts" INTEGER NOT NULL DEFAULT 0;
