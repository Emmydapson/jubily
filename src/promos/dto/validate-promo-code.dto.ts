import { IsEnum, IsOptional, IsString } from 'class-validator';
import { BillingProvider, Plan } from '@prisma/client';
import { BillingInterval } from '../../billing/dto/start-checkout.dto';

export class ValidatePromoCodeDto {
  @IsString()
  code!: string;

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
  countryCode?: string;
}
