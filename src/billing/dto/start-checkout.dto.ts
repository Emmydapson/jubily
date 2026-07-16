import { IsOptional, IsString, Length } from 'class-validator';
import { BillingProvider, Plan } from '@prisma/client';

export enum BillingInterval {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export class StartCheckoutDto {
  @IsOptional()
  @IsString()
  plan?: Plan;

  @IsOptional()
  @IsString()
  provider?: BillingProvider;

  @IsOptional()
  @IsString()
  interval?: BillingInterval;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @IsOptional()
  @IsString()
  promoCode?: string;
}
