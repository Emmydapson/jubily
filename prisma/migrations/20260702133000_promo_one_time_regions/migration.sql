CREATE TYPE "PromoDiscountDuration" AS ENUM ('ONE_TIME');
CREATE TYPE "PromoRegionScope" AS ENUM ('ALL', 'GLOBAL', 'AFRICA', 'NIGERIA', 'CUSTOM_COUNTRIES');

ALTER TABLE "PromoCode"
ADD COLUMN "discountDuration" "PromoDiscountDuration" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN "regionScope" "PromoRegionScope" NOT NULL DEFAULT 'ALL',
ADD COLUMN "allowedCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "PromoAttribution"
ADD COLUMN "originalAmount" DOUBLE PRECISION,
ADD COLUMN "discountAmount" DOUBLE PRECISION,
ADD COLUMN "finalAmount" DOUBLE PRECISION,
ADD COLUMN "renewalAmount" DOUBLE PRECISION,
ADD COLUMN "countryCode" TEXT,
ADD COLUMN "regionScope" "PromoRegionScope",
ADD COLUMN "discountDuration" "PromoDiscountDuration",
ADD COLUMN "redeemedAt" TIMESTAMP(3);

CREATE INDEX "PromoAttribution_promoCodeId_userId_status_idx" ON "PromoAttribution"("promoCodeId", "userId", "status");
CREATE INDEX "PromoAttribution_promoCodeId_workspaceId_status_idx" ON "PromoAttribution"("promoCodeId", "workspaceId", "status");

CREATE UNIQUE INDEX "PromoAttribution_once_per_user_subscribed_idx"
ON "PromoAttribution"("promoCodeId", "userId")
WHERE "status" = 'SUBSCRIBED';

CREATE UNIQUE INDEX "PromoAttribution_once_per_workspace_subscribed_idx"
ON "PromoAttribution"("promoCodeId", "workspaceId")
WHERE "status" = 'SUBSCRIBED' AND "workspaceId" IS NOT NULL;
