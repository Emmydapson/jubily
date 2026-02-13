-- AlterTable
ALTER TABLE "VideoJob" ADD COLUMN     "offerId" TEXT,
ADD COLUMN     "videoSrt" TEXT;

-- CreateIndex
CREATE INDEX "VideoJob_offerId_idx" ON "VideoJob"("offerId");

-- AddForeignKey
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
