/*
  Warnings:

  - A unique constraint covering the columns `[externalProductId]` on the table `Offer` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('RENDER', 'PUBLISH', 'TRACKING', 'CONVERSION');

-- CreateEnum
CREATE TYPE "PipelineSeverity" AS ENUM ('INFO', 'WARN', 'ERROR');

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "externalProductId" TEXT;

-- CreateTable
CREATE TABLE "PipelineEvent" (
    "id" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL,
    "severity" "PipelineSeverity" NOT NULL DEFAULT 'INFO',
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "jobId" TEXT,
    "offerId" TEXT,
    "clickId" TEXT,
    "topicId" TEXT,
    "scriptId" TEXT,
    "provider" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineEvent_stage_createdAt_idx" ON "PipelineEvent"("stage", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_severity_createdAt_idx" ON "PipelineEvent"("severity", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_status_createdAt_idx" ON "PipelineEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_jobId_createdAt_idx" ON "PipelineEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_offerId_createdAt_idx" ON "PipelineEvent"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_clickId_createdAt_idx" ON "PipelineEvent"("clickId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_externalProductId_key" ON "Offer"("externalProductId");
