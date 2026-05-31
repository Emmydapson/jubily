import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const PIPELINE_STAGES = [
  'IMAGE_GENERATION',
  'RENDER',
  'PUBLISH',
  'TRACKING',
  'CONVERSION',
];
const PIPELINE_SEVERITIES = ['INFO', 'WARN', 'ERROR'];

export class MonitoringEventsQueryDto {
  @ApiPropertyOptional({
    example: 50,
    minimum: 1,
    maximum: 200,
    description: 'Maximum event rows to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    enum: PIPELINE_STAGES,
    example: 'RENDER',
    description: 'Filter by pipeline stage.',
  })
  @IsOptional()
  @IsIn(PIPELINE_STAGES)
  stage?: string;

  @ApiPropertyOptional({
    enum: PIPELINE_SEVERITIES,
    example: 'ERROR',
    description: 'Filter by severity.',
  })
  @IsOptional()
  @IsIn(PIPELINE_SEVERITIES)
  severity?: string;

  @ApiPropertyOptional({
    example: 'WEBHOOK_FAILED',
    description: 'Filter by provider or pipeline status code.',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c',
    format: 'uuid',
    description: 'Filter by video job ID.',
  })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({
    example: 'd766cd09-66f7-4a22-a8d5-2cf05a2dc7d4',
    format: 'uuid',
    description: 'Filter by offer ID.',
  })
  @IsOptional()
  @IsUUID()
  offerId?: string;

  @ApiPropertyOptional({
    example: '36ca5c2e-c4bc-4f45-ad02-65f0ed42e2f8',
    format: 'uuid',
    description: 'Filter by click ID.',
  })
  @IsOptional()
  @IsUUID()
  clickId?: string;

  @ApiPropertyOptional({
    example: 'digistore24',
    description: 'Filter by external provider.',
  })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({
    example: 24,
    minimum: 1,
    description: 'Only return events from the last N hours.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sinceHours?: number;
}

export class MonitoringSummaryQueryDto {
  @ApiPropertyOptional({
    example: 24,
    minimum: 1,
    description: 'Summary lookback window in hours.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  hours?: number;
}
