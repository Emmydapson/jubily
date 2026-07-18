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
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'https://example.partnerstack.com/ai-tool',
  })
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  hoplink!: string;

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
