import { ArrayUnique, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PaystackDiscountMode, PromoAppliesToPlan, PromoDiscountType, PromoRegionScope } from '@prisma/client';

export class CreatePromoCodeDto {
  @IsString()
  code!: string;

  @IsString()
  influencerName!: string;

  @IsOptional()
  @IsEmail()
  influencerEmail?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PromoDiscountType)
  discountType?: PromoDiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  discountValue?: number;

  @IsOptional()
  @IsEnum(PromoAppliesToPlan)
  appliesToPlans?: PromoAppliesToPlan;

  @IsOptional()
  @IsEnum(PromoRegionScope)
  regionScope?: PromoRegionScope;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  allowedCountries?: string[];

  @IsOptional()
  @IsString()
  stripePromotionCodeId?: string;

  @IsOptional()
  @IsString()
  stripeCouponId?: string;

  @IsOptional()
  @IsEnum(PaystackDiscountMode)
  paystackDiscountMode?: PaystackDiscountMode;

  @IsOptional()
  @IsInt()
  @Min(1)
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
