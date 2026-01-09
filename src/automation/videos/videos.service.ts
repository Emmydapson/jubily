import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterVideoDto } from './dto/register-video.dto';

@Injectable()
export class VideosService {
  constructor(private prisma: PrismaService) {}

  async registerVideo(dto: RegisterVideoDto) {
    return this.prisma.video.create({
      data: {
        topicId: dto.topicId,
        scriptId: dto.scriptId,
        videoUrl: dto.videoUrl,
        format: dto.format,
        duration: dto.duration,
      },
    });
  }

  async markAsPublished(videoId: string) {
    return this.prisma.video.update({
      where: { id: videoId },
      data: { status: 'PUBLISHED' },
    });
  }

  async markAsFailed(videoId: string) {
    return this.prisma.video.update({
      where: { id: videoId },
      data: { status: 'FAILED' },
    });
  }
}
