import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePublishResultDto } from './dto/create-publish-result.dto';
import { MonitoringService } from 'src/monitoring/monitoring.service';

@Injectable()
export class PublishingService {
  constructor(
    private prisma: PrismaService,
    private monitoring: MonitoringService,
  ) {}

  async registerResult(dto: CreatePublishResultDto) {
    const jobId = dto.jobId || dto.videoId;
    if (!jobId) throw new Error('Missing jobId');

    const updated = await this.prisma.videoJob.update({
      where: { id: jobId },
      data: {
        published: dto.status === 'SUCCESS',
        status: dto.status === 'SUCCESS' ? 'COMPLETED' : 'FAILED',
        youtubeVideoId: dto.platform === 'youtube' ? dto.platformPostId : undefined,
        youtubeUrl:
          dto.platform === 'youtube'
            ? `https://www.youtube.com/watch?v=${dto.platformPostId}`
            : undefined,
        error: dto.status === 'FAILED' ? dto.errorMessage || 'Publish failed' : null,
      },
    });

    await this.monitoring.logEvent({
      stage: 'PUBLISH',
      severity: dto.status === 'SUCCESS' ? 'INFO' : 'ERROR',
      status: dto.status,
      message: dto.status === 'SUCCESS' ? 'Publish result registered' : dto.errorMessage || 'Publish failed',
      jobId,
      provider: dto.platform,
      meta: { platformPostId: dto.platformPostId },
    });

    return updated;
  }
}
