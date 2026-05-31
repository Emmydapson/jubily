import { Transform, Type } from 'class-transformer';
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
import { VIDEO_JOB_STATUSES } from '../../video-job-status';

export class ListVideosQueryDto {
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
    example: 'COMPLETED',
    description: 'Filter by video job status.',
  })
  @IsOptional()
  @IsIn(VIDEO_JOB_STATUSES)
  status?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Filter by publish state.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({
    example: 'focus',
    description: 'Search term for video, topic, or related metadata.',
  })
  @IsOptional()
  @IsString()
  q?: string;
}
