import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsUrl,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  CONTENT_PLATFORMS,
  MAX_VIDEO_DURATION_SECONDS,
  MIN_VIDEO_DURATION_SECONDS,
  RECOMMENDED_VIDEO_DURATIONS_SECONDS,
} from '../content-platform.constants';

export class GenerateAiFromOfferDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: 'd766cd09-66f7-4a22-a8d5-2cf05a2dc7d4',
    description:
      'Saved workspace offer to use. Omit when providing one-time manual product details.',
  })
  @IsOptional()
  @IsUUID()
  offerId?: string;

  @ApiPropertyOptional({
    example: 'AI Writer Pro',
    description:
      'Manual one-time product name. Required with manualProductUrl when offerId is omitted.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  manualProductName?: string;

  @ApiPropertyOptional({
    example: 'https://vendor.example.com/ai-writer',
    description:
      'Manual one-time affiliate/product URL. Not stored as a saved offer.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  manualProductUrl?: string;

  @ApiPropertyOptional({
    example: 'A writing assistant for founders who need landing pages fast.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1200)
  manualProductDescription?: string;

  @ApiPropertyOptional({ example: 'busy founders' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  targetAudience?: string;

  @ApiPropertyOptional({ example: 'Save time writing launch copy' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  mainSellingPoint?: string;

  @ApiPropertyOptional({
    enum: CONTENT_PLATFORMS,
    example: 'FACEBOOK',
    description:
      'Content formatting target. This does not require a connected publishing account.',
  })
  @IsOptional()
  @Transform(({ value }) => String(value || '').toUpperCase())
  @IsIn(CONTENT_PLATFORMS)
  contentPlatform?: string;

  @ApiPropertyOptional({
    enum: RECOMMENDED_VIDEO_DURATIONS_SECONDS,
    example: 90,
    minimum: MIN_VIDEO_DURATION_SECONDS,
    maximum: MAX_VIDEO_DURATION_SECONDS,
  })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(MIN_VIDEO_DURATION_SECONDS)
  @Max(MAX_VIDEO_DURATION_SECONDS)
  durationSeconds?: number;

  @ApiPropertyOptional({
    example: 'How to compare AI writing tools before buying',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  topic?: string;

  @ApiPropertyOptional({
    example:
      'Make it direct, beginner-friendly, and focused on a practical benefit.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  prompt?: string;
}
