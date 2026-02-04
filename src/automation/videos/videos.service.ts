/* eslint-disable prettier/prettier */
import { Injectable,} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterVideoDto } from './dto/register-video.dto';
import { extractScenes } from '../scene.parser';
import { ShotstackService } from './shotstack.service';

@Injectable()
export class VideosService {
  constructor(private readonly prisma: PrismaService,
    private readonly shotStackService: ShotstackService
  ) {}

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

 async createVideoJob(scriptId: string) {
  const script = await this.prisma.script.findUnique({ where: { id: scriptId } });
  if (!script) throw new Error('Script not found');

  const scenes = extractScenes(script.content);

  const job = await this.prisma.videoJob.create({ data: { scriptId } });

  const renderId = await this.shotStackService.renderVideo(scenes);

  await this.prisma.videoJob.update({
  where: { id: job.id },
  data: { status: 'PROCESSING', renderId },
});


  return { jobId: job.id, renderId };
}

}
