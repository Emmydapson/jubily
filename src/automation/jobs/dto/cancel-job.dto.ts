import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { VideoJobStatus } from '../../video-job-status';

export class CancelJobDto {
  @ApiPropertyOptional({
    enum: [VideoJobStatus.Cancelled, VideoJobStatus.FailedPermanent],
    example: VideoJobStatus.Cancelled,
    description: 'Terminal status to apply. Defaults to CANCELLED.',
  })
  @IsOptional()
  @IsIn([VideoJobStatus.Cancelled, VideoJobStatus.FailedPermanent])
  status?: VideoJobStatus.Cancelled | VideoJobStatus.FailedPermanent;
}
