ALTER TABLE "Script"
ADD COLUMN "thumbnailImageUrl" TEXT,
ADD COLUMN "thumbnailStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "thumbnailError" TEXT,
ADD COLUMN "thumbnailGeneratedAt" TIMESTAMP(3);

ALTER TABLE "VideoJob"
ADD COLUMN "thumbnailPrompt" TEXT,
ADD COLUMN "thumbnailImageUrl" TEXT,
ADD COLUMN "thumbnailStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "thumbnailError" TEXT,
ADD COLUMN "thumbnailGeneratedAt" TIMESTAMP(3);

