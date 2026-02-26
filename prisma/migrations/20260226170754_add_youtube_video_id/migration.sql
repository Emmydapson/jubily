-- AlterTable
ALTER TABLE "VideoJob" ADD COLUMN     "publishStage" TEXT,
ADD COLUMN     "youtubeVideoId" TEXT;

-- CreateIndex
CREATE INDEX "VideoJob_youtubeVideoId_idx" ON "VideoJob"("youtubeVideoId");
