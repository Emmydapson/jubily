CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "PromoDiscountType" AS ENUM ('PERCENTAGE', 'FIXED', 'NONE');
CREATE TYPE "PromoAppliesToPlan" AS ENUM ('PRO', 'PREMIUM', 'ALL');
CREATE TYPE "PromoAttributionStatus" AS ENUM ('SIGNUP', 'CHECKOUT_STARTED', 'SUBSCRIBED', 'FAILED', 'CANCELLED');

CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "influencerName" TEXT NOT NULL,
    "influencerEmail" TEXT,
    "description" TEXT,
    "discountType" "PromoDiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DOUBLE PRECISION,
    "appliesToPlans" "PromoAppliesToPlan" NOT NULL DEFAULT 'ALL',
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromoAttribution" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "subscriptionId" TEXT,
    "provider" "BillingProvider",
    "plan" "Plan",
    "interval" "BillingInterval",
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "status" "PromoAttributionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoAttribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");
CREATE INDEX "PromoCode_isActive_idx" ON "PromoCode"("isActive");
CREATE INDEX "PromoCode_createdByAdminId_idx" ON "PromoCode"("createdByAdminId");
CREATE INDEX "PromoCode_createdAt_idx" ON "PromoCode"("createdAt");
CREATE INDEX "PromoAttribution_promoCodeId_status_idx" ON "PromoAttribution"("promoCodeId", "status");
CREATE INDEX "PromoAttribution_userId_createdAt_idx" ON "PromoAttribution"("userId", "createdAt");
CREATE INDEX "PromoAttribution_workspaceId_createdAt_idx" ON "PromoAttribution"("workspaceId", "createdAt");
CREATE INDEX "PromoAttribution_subscriptionId_idx" ON "PromoAttribution"("subscriptionId");
CREATE INDEX "PromoAttribution_provider_createdAt_idx" ON "PromoAttribution"("provider", "createdAt");

ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromoAttribution" ADD CONSTRAINT "PromoAttribution_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoAttribution" ADD CONSTRAINT "PromoAttribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoAttribution" ADD CONSTRAINT "PromoAttribution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromoAttribution" ADD CONSTRAINT "PromoAttribution_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WorkspaceSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
