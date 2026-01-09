-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('PENDING', 'USED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('READY', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "status" "TopicStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "promptVer" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishResult" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformPostId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishResult_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishResult" ADD CONSTRAINT "PublishResult_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
