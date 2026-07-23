import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SLOT_ORDER } from '../../time.utils';
import type { Slot } from '../../time.utils';
import {
  VIDEO_GENERATION_MODES,
  VideoGenerationMode,
} from '../generation-mode';
import {
  CONTENT_PLATFORMS,
  MAX_VIDEO_DURATION_SECONDS,
  MIN_VIDEO_DURATION_SECONDS,
  RECOMMENDED_VIDEO_DURATIONS_SECONDS,
} from '../../content-platform.constants';

export class CreateVideoJobDto {
  @ApiPropertyOptional({
    example: 'd766cd09-66f7-4a22-a8d5-2cf05a2dc7d4',
    format: 'uuid',
    description: 'Offer to associate with the generated video job.',
  })
  @IsOptional()
  @IsUUID()
  offerId?: string;

  @ApiPropertyOptional({
    enum: CONTENT_PLATFORMS,
    example: 'FACEBOOK',
    description:
      'Content formatting target for render instructions. This is separate from connected publishing accounts.',
  })
  @IsOptional()
  @Transform(({ value }) => String(value || '').toUpperCase())
  @IsIn(CONTENT_PLATFORMS)
  contentPlatform?: string;

  @ApiPropertyOptional({
    enum: RECOMMENDED_VIDEO_DURATIONS_SECONDS,
    example: 120,
    minimum: MIN_VIDEO_DURATION_SECONDS,
    maximum: MAX_VIDEO_DURATION_SECONDS,
    description:
      'Requested total video duration in seconds. Recommended values are 15, 30, 45, 60, 90, 120, and 180.',
  })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(MIN_VIDEO_DURATION_SECONDS)
  @Max(MAX_VIDEO_DURATION_SECONDS)
  durationSeconds?: number;

  @ApiPropertyOptional({
    enum: SLOT_ORDER,
    example: 'MORNING',
    description: 'Publishing slot for the new video job. Defaults to MORNING.',
  })
  @IsOptional()
  @IsIn(SLOT_ORDER)
  slot?: Slot;

  @ApiPropertyOptional({
    example: '2026-05-30T14:00:00.000Z',
    format: 'date-time',
    description:
      'Optional ISO timestamp for the scheduled render/publish time.',
  })
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  @ApiPropertyOptional({
    enum: VIDEO_GENERATION_MODES,
    example: VideoGenerationMode.STANDARD,
    description:
      'Optional generation mode. Omitted values resolve to STANDARD for backward compatibility.',
  })
  @IsOptional()
  @IsIn(VIDEO_GENERATION_MODES, {
    message: 'generationMode must be STANDARD or AI_MOTION',
  })
  generationMode?: VideoGenerationMode;
}
