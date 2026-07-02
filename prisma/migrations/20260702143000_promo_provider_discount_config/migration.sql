-- CreateEnum
CREATE TYPE "PaystackDiscountMode" AS ENUM ('TRACKING_ONLY', 'ONE_TIME_AMOUNT_DISCOUNT', 'UNSUPPORTED');

-- AlterTable
ALTER TABLE "PromoCode"
ADD COLUMN "stripePromotionCodeId" TEXT,
ADD COLUMN "stripeCouponId" TEXT,
ADD COLUMN "paystackDiscountMode" "PaystackDiscountMode" NOT NULL DEFAULT 'UNSUPPORTED';
