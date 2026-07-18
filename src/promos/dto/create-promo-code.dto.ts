import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import {
  PaystackDiscountMode,
  PromoAppliesToPlan,
  PromoDiscountDuration,
  PromoDiscountType,
  PromoRegionScope,
} from '@prisma/client';

export class CreatePromoCodeDto {
  @IsString({ message: 'code is required' })
  code!: string;

  @IsString({ message: 'influencerName is required' })
  influencerName!: string;

  @IsOptional()
  @IsEmail({}, { message: 'influencerEmail must be a valid email address' })
  influencerEmail?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PromoDiscountType, {
    message: 'discountType must be PERCENTAGE, FIXED, or NONE',
  })
  discountType?: PromoDiscountType;

  @IsOptional()
  @IsNumber({}, { message: 'discountValue must be a number' })
  @Min(0, { message: 'discountValue must be at least 0' })
  @Max(1000000000, { message: 'discountValue must be at most 1000000000' })
  discountValue?: number;

  @IsOptional()
  @IsEnum(PromoDiscountDuration, {
    message: 'discountDuration must be ONE_TIME',
  })
  discountDuration?: PromoDiscountDuration;

  @IsOptional()
  @IsEnum(PromoAppliesToPlan, {
    message: 'appliesToPlans must be PRO, PREMIUM, or ALL',
  })
  appliesToPlans?: PromoAppliesToPlan;

  @IsOptional()
  @IsEnum(PromoRegionScope, {
    message:
      'regionScope must be ALL, GLOBAL, AFRICA, NIGERIA, or CUSTOM_COUNTRIES',
  })
  regionScope?: PromoRegionScope;

  @IsOptional()
  @IsArray({
    message:
      'allowedCountries must be an array of ISO 3166-1 alpha-2 country codes',
  })
  @ArrayUnique({
    message: 'allowedCountries must not contain duplicate country codes',
  })
  @IsString({
    each: true,
    message:
      'allowedCountries must contain only ISO 3166-1 alpha-2 country codes',
  })
  @Length(2, 2, {
    each: true,
    message:
      'allowedCountries must contain only ISO 3166-1 alpha-2 country codes',
  })
  allowedCountries?: string[];

  @IsOptional()
  @IsString({ message: 'stripePromotionCodeId must start with "promo_"' })
  stripePromotionCodeId?: string;

  @IsOptional()
  @IsString({ message: 'stripeCouponId must start with "coupon_"' })
  stripeCouponId?: string;

  @IsOptional()
  @IsEnum(PaystackDiscountMode, {
    message:
      'paystackDiscountMode must be TRACKING_ONLY, ONE_TIME_AMOUNT_DISCOUNT, or UNSUPPORTED',
  })
  paystackDiscountMode?: PaystackDiscountMode;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'maxRedemptions must be at least 1' })
  maxRedemptions?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
