import { IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PromoAppliesToPlan, PromoDiscountType } from '@prisma/client';

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
