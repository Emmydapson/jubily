-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'digistore24',
    "name" TEXT NOT NULL,
    "nicheTag" TEXT,
    "hoplink" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Click" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "videoJobId" TEXT,
    "youtubeId" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "Click_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "clickId" TEXT,
    "videoJobId" TEXT,
    "event" TEXT,
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Click_offerId_createdAt_idx" ON "Click"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "Click_videoJobId_idx" ON "Click"("videoJobId");

-- CreateIndex
CREATE INDEX "Conversion_offerId_createdAt_idx" ON "Conversion"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversion_clickId_idx" ON "Conversion"("clickId");

-- CreateIndex
CREATE INDEX "Conversion_videoJobId_idx" ON "Conversion"("videoJobId");

-- CreateIndex
CREATE INDEX "VideoJob_status_published_idx" ON "VideoJob"("status", "published");

-- CreateIndex
CREATE INDEX "VideoJob_renderId_idx" ON "VideoJob"("renderId");

-- CreateIndex
CREATE INDEX "VideoJob_scriptId_idx" ON "VideoJob"("scriptId");

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_videoJobId_fkey" FOREIGN KEY ("videoJobId") REFERENCES "VideoJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_videoJobId_fkey" FOREIGN KEY ("videoJobId") REFERENCES "VideoJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
