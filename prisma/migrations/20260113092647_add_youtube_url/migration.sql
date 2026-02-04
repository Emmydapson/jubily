-- AlterTable
ALTER TABLE "VideoJob" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "youtubeUrl" TEXT;
