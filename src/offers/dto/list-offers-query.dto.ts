import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { OFFER_NETWORKS, OFFER_NICHES } from '../offer.constants';
import { normalizeAffiliateNiche, normalizeAffiliatePlatform } from '../../affiliates/affiliate.constants';

export class ListOffersQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: OFFER_NETWORKS, example: 'PARTNERSTACK' })
  @IsOptional()
  @Transform(({ value }) => normalizeAffiliatePlatform(value) ?? value)
  @IsIn(OFFER_NETWORKS)
  network?: string;

  @ApiPropertyOptional({ enum: OFFER_NICHES, example: 'AI_SOFTWARE' })
  @IsOptional()
  @Transform(({ value }) => normalizeAffiliateNiche(value) ?? value)
  @IsIn(OFFER_NICHES)
  nicheTag?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 'software' })
  @IsOptional()
  @IsString()
  q?: string;
}
