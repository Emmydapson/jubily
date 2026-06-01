import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { OFFER_NETWORKS, OFFER_NICHES } from '../offer.constants';

export class UpdateOfferDto {
  @ApiPropertyOptional({ enum: OFFER_NETWORKS, example: 'clickbank' })
  @IsOptional()
  @IsIn(OFFER_NETWORKS)
  network?: string;

  @ApiPropertyOptional({ example: 'Focus Support' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'https://hop.clickbank.net/?affiliate=demo' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  hoplink?: string;

  @ApiPropertyOptional({ enum: OFFER_NICHES, example: 'focus', nullable: true })
  @IsOptional()
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

