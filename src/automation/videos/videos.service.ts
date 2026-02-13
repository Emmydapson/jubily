/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable prettier/prettier */
import { Injectable, NotFoundException,} from '@nestjs/common';
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

 async createVideoJob(scriptId: string, offerId: string | undefined, slot: 'MORNING' | 'AFTERNOON' | 'EVENING',
  scheduledFor: Date,) {
  const script = await this.prisma.script.findUnique({ where: { id: scriptId } });
  if (!script) throw new Error('Script not found');

  const scenes = extractScenes(script.content);

  const job = await this.prisma.videoJob.create({
    data: {
      scriptId,
      offerId: offerId ?? null, // ✅ NEW
      slot,
      scheduledFor,
    },
  });

  const renderId = await this.shotStackService.renderVideo(scenes);

  await this.prisma.videoJob.update({
    where: { id: job.id },
    data: { status: 'PROCESSING', renderId },
  });

  return { jobId: job.id, renderId };
}


async listVideos(query: any) {
  const page = Math.max(Number(query.page ?? 1), 1);
  const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
  const skip = (page - 1) * limit;

  const where: any = {};
  if (query.status) where.status = query.status; // READY | PUBLISHED | FAILED

  // platform filter (optional) -> based on PublishResult rows
  if (query.platform) {
    where.publishResults = { some: { platform: query.platform } };
  }

  // q filter (optional) -> search topic title
  if (query.q) {
    where.topic = { title: { contains: query.q, mode: 'insensitive' } };
  }

  const [items, total] = await Promise.all([
    this.prisma.video.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        topic: { select: { title: true } },
        publishResults: { select: { platform: true, status: true } },
      },
    }),
    this.prisma.video.count({ where }),
  ]);

  // shape for frontend
  const mapped = items.map((v) => ({
    id: v.id,
    title: v.topic?.title ?? 'Untitled',
    platform: v.publishResults?.map((p) => p.platform).join(', ') || '—',
    status: v.status, // READY | PUBLISHED | FAILED
    thumbnail: null, // you can add later
    videoUrl: v.videoUrl,
    format: v.format,
    duration: v.duration,
    createdAt: v.createdAt,
  }));

  return { items: mapped, page, limit, total };
}

async getVideoAssets(videoId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        topicId: true,
        scriptId: true,
        videoUrl: true,
        format: true,
        duration: true,
        status: true,
        createdAt: true,
      },
    });

    if (!video) throw new NotFoundException('Video not found');

    const script = await this.prisma.script.findUnique({
      where: { id: video.scriptId },
      select: {
        id: true,
        content: true,
        promptVer: true,
        createdAt: true,
      },
    });

    // OPTIONAL: if captions are stored somewhere else, swap this part.
    // Using VideoJob linked to scriptId (latest job)
    const latestJob = await this.prisma.videoJob.findFirst({
      where: { scriptId: video.scriptId },
      orderBy: { createdAt: 'desc' },
      select: {
  id: true,
  renderId: true,
  status: true,
  error: true,
  videoSrt: true,
  offerId: true, // ✅
  offer: { select: { name: true } }, // ✅ (requires schema back relation fix)
},

    });

    return {
  video,
  script,
  captionsSrt: latestJob?.videoSrt ?? null,
  job: latestJob,
};

  }

}
