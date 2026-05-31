import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VIDEO_JOB_STATUSES, VideoJobStatus } from '../../video-job-status';

export class RegisterVideoDto {
  @ApiProperty({
    example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c',
    description: 'Video job identifier.',
  })
  @IsString()
  jobId: string;

  @ApiProperty({
    example: 'https://cdn.example.com/videos/rendered-video.mp4',
    description: 'Rendered video URL.',
  })
  @IsString()
  videoUrl: string;

  @ApiPropertyOptional({
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    description: 'Published YouTube URL, when available.',
  })
  @IsOptional()
  @IsString()
  youtubeUrl?: string;

  @ApiPropertyOptional({
    enum: VIDEO_JOB_STATUSES,
    example: VideoJobStatus.Completed,
    description: 'Resulting job status.',
  })
  @IsOptional()
  @IsIn(VIDEO_JOB_STATUSES)
  status?: VideoJobStatus;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the video has been published.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  published?: boolean;
}
