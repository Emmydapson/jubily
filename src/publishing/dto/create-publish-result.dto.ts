import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PublishStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export class CreatePublishResultDto {
  @ApiPropertyOptional({
    example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c',
    description: 'Video job ID associated with the publish result.',
  })
  @IsOptional()
  @IsString()
  jobId?: string;

  @ApiPropertyOptional({
    example: 'f7e5f407-3dfb-43c7-87ef-8600cf2aa103',
    description: 'Internal video ID associated with the publish result.',
  })
  @IsString()
  @IsOptional()
  videoId?: string;

  @ApiProperty({
    example: 'youtube',
    description: 'Publishing platform name.',
  })
  @IsString()
  @IsNotEmpty()
  platform: string;

  @ApiProperty({
    example: 'dQw4w9WgXcQ',
    description: 'Platform-specific post or video identifier.',
  })
  @IsString()
  @IsNotEmpty()
  platformPostId: string;

  @ApiProperty({
    enum: PublishStatus,
    example: PublishStatus.SUCCESS,
    description: 'Publish outcome.',
  })
  @IsEnum(PublishStatus)
  status: PublishStatus;

  @ApiPropertyOptional({
    example: 'YouTube quota exceeded',
    description: 'Failure reason when status is FAILED.',
  })
  @IsOptional()
  @IsString()
  errorMessage?: string;
}
