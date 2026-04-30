/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable prettier/prettier */
import { Injectable, NotFoundException,} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterVideoDto } from './dto/register-video.dto';
import { extractScenes } from '../scene.parser';
import { ShotstackService } from './shotstack.service';

type ListVideosQuery = {
  page?: string | number;
  limit?: string | number;
  status?: string;
  published?: string | boolean;
  q?: string;
};

@Injectable()
export class VideosService {
  constructor(private readonly prisma: PrismaService,
    private readonly shotStackService: ShotstackService
  ) {}

  async registerVideo(dto: RegisterVideoDto) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: dto.jobId },
      select: { id: true, youtubeUrl: true, published: true },
    });

    if (!job) throw new NotFoundException('Job not found');

    return this.prisma.videoJob.update({
      where: { id: dto.jobId },
      data: {
        videoUrl: dto.videoUrl,
        status: dto.status ?? 'COMPLETED',
        published: dto.published ?? job.published,
        youtubeUrl: dto.youtubeUrl ?? job.youtubeUrl,
        error: null,
      },
    });
  }

  async markAsPublished(jobId: string) {
    return this.prisma.videoJob.update({
      where: { id: jobId },
      data: { published: true, status: 'COMPLETED', error: null },
    });
  }

  async markAsFailed(jobId: string, error = 'Marked failed manually') {
    return this.prisma.videoJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error },
    });
  }

  async createVideoJob(
    scriptId: string,
    offerId: string | undefined,
    slot: 'MORNING' | 'AFTERNOON' | 'EVENING',
    scheduledFor: Date,
  ) {
    const job = await this.prisma.videoJob.create({
      data: {
        scriptId,
        offerId: offerId ?? null,
        slot,
        scheduledFor,
      },
    });

    try {
      const started = await this.startRenderForJob(job.id);
      return started;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create render job';

      await this.prisma.videoJob.update({
  where: { id: job.id },
  data: {
    status: 'FAILED',
    error: message,
    attempts: { increment: 1 },
  },
});

      throw error;
    }
  }

  async startRenderForJob(jobId: string) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        script: {
          select: {
            id: true,
            content: true,
            topicId: true,
          },
        },
      },
    });

    if (!job) throw new NotFoundException('Job not found');
    if (!job.script) throw new Error('Script not found');
    if (job.renderId) {
      return { jobId: job.id, renderId: job.renderId, resumed: true };
    }

    const scenes = extractScenes(job.script.content);
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('No scenes extracted from script');
    }

    const renderId = await this.shotStackService.renderVideo(scenes, job.id);

const result = {
  renderId,
  provider: 'shotstack' as const,
};

await this.prisma.videoJob.update({
  where: { id: job.id },
  data: {
    status: 'PROCESSING',
    renderId,
    provider: 'shotstack',
    error: null,
  },
});

if (job.script.topicId) {
  await this.prisma.topic.updateMany({
    where: { id: job.script.topicId },
    data: { status: 'USED' },
  });
}

return { jobId: job.id, renderId};

async listVideos(query: ListVideosQuery) {
  const page = Math.max(Number(query.page ?? 1), 1);
  const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
  const skip = (page - 1) * limit;

  const where: Prisma.VideoJobWhereInput = {};
  if (query.status) where.status = String(query.status).toUpperCase();
  if (query.published != null) where.published = String(query.published) === 'true';

  if (query.q) {
    const q = String(query.q);
    where.OR = [
      { script: { topic: { title: { contains: q, mode: 'insensitive' } } } },
      { offer: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const [items, total] = await Promise.all([
    this.prisma.videoJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        offer: { select: { id: true, name: true } },
        script: {
          select: {
            id: true,
            topic: { select: { id: true, title: true } },
          },
        },
      },
    }),
    this.prisma.videoJob.count({ where }),
  ]);

  const mapped = items.map((j) => ({
    id: j.id,
    title: j.script?.topic?.title ?? 'Untitled',
    status: j.status,
    published: j.published,
    platform: j.youtubeUrl ? 'youtube' : '—',
    thumbnail: null,
    videoUrl: j.videoUrl,
    youtubeUrl: j.youtubeUrl,
    renderId: j.renderId,
    createdAt: j.createdAt,
    slot: j.slot,
    scheduledFor: j.scheduledFor,
    offerId: j.offer?.id ?? null,
    offerName: j.offer?.name ?? null,
  }));

  return { items: mapped, page, limit, total };
}

async getVideoAssets(jobId: string) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        script: {
          select: {
            id: true,
            content: true,
            promptVer: true,
            createdAt: true,
            topic: { select: { id: true, title: true } },
          },
        },
        offer: {
  select: {
    id: true,
    name: true,
    externalProductId: true, // keep ONLY if it exists in schema
  },
},
      },
    });

    if (!job) throw new NotFoundException('Job not found');

    return {
      job: {
        id: job.id,
        status: job.status,
        published: job.published,
        slot: job.slot,
        scheduledFor: job.scheduledFor,
        renderId: job.renderId,
        youtubeUrl: job.youtubeUrl,
        videoUrl: job.videoUrl,
        error: job.error,
        youtubeVideoId: job.youtubeVideoId,
        offer: job.offer,
      },
      script: job.script,
      captionsSrt: job.videoSrt ?? null,
    };
  }

}
