import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SLOT_ORDER } from '../../time.utils';
import { VIDEO_JOB_STATUSES } from '../../video-job-status';

export class ListJobsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, description: 'Page number.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: 100,
    description: 'Items per page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: VIDEO_JOB_STATUSES,
    example: 'PENDING',
    description: 'Filter by video job status.',
  })
  @IsOptional()
  @IsIn(VIDEO_JOB_STATUSES)
  status?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Filter by YouTube publish state.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({
    enum: SLOT_ORDER,
    example: 'MORNING',
    description: 'Filter by schedule slot.',
  })
  @IsOptional()
  @IsIn(SLOT_ORDER)
  slot?: string;

  @ApiPropertyOptional({
    example: '2026-05-01T00:00:00.000Z',
    format: 'date-time',
    description: 'Inclusive ISO start timestamp.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-05-30T23:59:59.000Z',
    format: 'date-time',
    description: 'Inclusive ISO end timestamp.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    example: 'energy',
    description: 'Search term for job, topic, or related metadata.',
  })
  @IsOptional()
  @IsString()
  q?: string;
}
