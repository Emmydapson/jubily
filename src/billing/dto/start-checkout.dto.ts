import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { BillingProvider, Plan } from '@prisma/client';

export enum BillingInterval {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export class StartCheckoutDto {
  @IsOptional()
  @IsEnum(Plan)
  plan?: Plan;

  @IsOptional()
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @IsOptional()
  @IsEnum(BillingInterval)
  interval?: BillingInterval;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
}
