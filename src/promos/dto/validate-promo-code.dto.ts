import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Plan } from '@prisma/client';

export class ValidatePromoCodeDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsEnum(Plan)
  plan?: Plan;
}
