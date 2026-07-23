import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { OFFER_NETWORKS, OFFER_NICHES } from '../offer.constants';
import {
  normalizeAffiliateNiche,
  normalizeAffiliatePlatform,
} from '../../affiliates/affiliate.constants';

export class UpdateOfferDto {
  @ApiPropertyOptional({ enum: OFFER_NETWORKS, example: 'CLICKBANK' })
  @IsOptional()
  @Transform(({ value }) => normalizeAffiliatePlatform(value) ?? value)
  @IsIn(OFFER_NETWORKS)
  network?: string;

  @ApiPropertyOptional({ example: 'Budgeting App' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'Budgeting App', description: 'Alias for name.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({ example: 'https://hop.clickbank.net/?affiliate=demo' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  hoplink?: string;

  @ApiPropertyOptional({
    example: 'https://hop.clickbank.net/?affiliate=demo',
    description: 'Alias for hoplink.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  affiliateUrl?: string;

  @ApiPropertyOptional({
    enum: OFFER_NICHES,
    example: 'FINANCE',
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeAffiliateNiche(value) ?? value)
  @IsIn(OFFER_NICHES)
  nicheTag?: string;

  @ApiPropertyOptional({ example: '987654', nullable: true })
  @IsOptional()
  @IsString()
  externalProductId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
