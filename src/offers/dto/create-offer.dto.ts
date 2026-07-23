import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateOfferDto {
  @ApiProperty({ enum: OFFER_NETWORKS, example: 'PARTNERSTACK' })
  @Transform(({ value }) => normalizeAffiliatePlatform(value) ?? value)
  @IsIn(OFFER_NETWORKS)
  network!: string;

  @ApiProperty({ example: 'AI Writing Tool' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    example: 'AI Writing Tool',
    description: 'Alias for name.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiProperty({
    example: 'https://example.partnerstack.com/ai-tool',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  hoplink?: string;

  @ApiPropertyOptional({
    example: 'https://example.partnerstack.com/ai-tool',
    description: 'Alias for hoplink.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  affiliateUrl?: string;

  @ApiPropertyOptional({ enum: OFFER_NICHES, example: 'AI_SOFTWARE' })
  @IsOptional()
  @Transform(({ value }) => normalizeAffiliateNiche(value) ?? value)
  @IsIn(OFFER_NICHES)
  nicheTag?: string;

  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  externalProductId?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
