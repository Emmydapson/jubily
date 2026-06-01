import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { OFFER_NETWORKS, OFFER_NICHES } from '../offer.constants';

export class CreateOfferDto {
  @ApiProperty({ enum: OFFER_NETWORKS, example: 'digistore24' })
  @IsIn(OFFER_NETWORKS)
  network!: string;

  @ApiProperty({ example: 'Deep Sleep Support' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'https://www.digistore24.com/redir/example/product',
  })
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  hoplink!: string;

  @ApiPropertyOptional({ enum: OFFER_NICHES, example: 'sleep' })
  @IsOptional()
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

