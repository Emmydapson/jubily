/* eslint-disable prettier/prettier */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterVideoDto } from './dto/register-video.dto';
import { extractScenes } from '../scene.parser';
import { ShotstackService } from './shotstack.service';
import { randomUUID } from 'crypto';
import { ListVideosQueryDto } from './dto/list-videos-query.dto';
import { ApiListResponse } from '../../common/api-response';
import { presentVideoJob, VideoJobSummary } from '../video-job.presenter';
import { VideoJobStatus } from '../video-job-status';

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shotStackService: ShotstackService,
  ) {}

  private async getVideoJobSummary(jobId: string) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        offer: { select: { id: true, name: true } },
        script: { select: { id: true, topic: { select: { id: true, title: true } } } },
      },
    });

    if (!job) throw new NotFoundException('Job not found');
    return presentVideoJob(job);
  }

  private assertScriptApproved(script: { reviewStatus?: string | null; id?: string }) {
    if (script.reviewStatus === 'APPROVED') return;

    if (script.reviewStatus === 'REJECTED') {
      throw new ConflictException('Script is REJECTED and cannot be rendered automatically');
    }

    throw new ConflictException(
      'Script requires manual approval before automatic render',
    );
  }

  async registerVideo(dto: RegisterVideoDto) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: dto.jobId },
      select: { id: true, youtubeUrl: true, published: true },
    });

    if (!job) throw new NotFoundException('Job not found');

    await this.prisma.videoJob.update({
      where: { id: dto.jobId },
      data: {
        videoUrl: dto.videoUrl,
        status: dto.status ?? VideoJobStatus.Completed,
        published: dto.published ?? job.published,
        youtubeUrl: dto.youtubeUrl ?? job.youtubeUrl,
        error: null,
      },
    });

    return this.getVideoJobSummary(dto.jobId);
  }

  async markAsPublished(jobId: string) {
    await this.prisma.videoJob.update({
      where: { id: jobId },
      data: { published: true, status: VideoJobStatus.Completed, error: null },
    });

    return this.getVideoJobSummary(jobId);
  }

  async markAsFailed(jobId: string, error = 'Marked failed manually') {
    await this.prisma.videoJob.update({
      where: { id: jobId },
      data: { status: VideoJobStatus.Failed, error },
    });

    return this.getVideoJobSummary(jobId);
  }

  async createVideoJob(
    scriptId: string,
    offerId: string | undefined,
    slot: 'MORNING' | 'AFTERNOON' | 'EVENING',
    scheduledFor: Date,
  ) {
    const script = await this.prisma.script.findUnique({
      where: { id: scriptId },
      select: { id: true, reviewStatus: true },
    });
    if (!script) throw new NotFoundException('Script not found');
    this.assertScriptApproved(script);

    const workerId = `inline-render-${process.pid}-${randomUUID()}`;
    const job = await this.prisma.videoJob.create({
      data: {
        scriptId,
        offerId: offerId ?? null,
        slot,
        scheduledFor,
        workerLockedAt: new Date(),
        workerLockedBy: workerId,
        workerStage: 'RENDER_START',
      },
    });

    try {
      return await this.startRenderForJob(job.id, workerId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create render job';

      await this.prisma.videoJob.update({
        where: { id: job.id },
        data: {
          status: VideoJobStatus.Failed,
          error: message,
          attempts: { increment: 1 },
          workerLockedAt: null,
          workerLockedBy: null,
          workerStage: null,
        },
      });

      throw error;
    }
  }

  async startRenderForJob(jobId: string, workerId?: string) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        script: {
          select: {
            id: true,
            content: true,
            topicId: true,
            reviewStatus: true,
          },
        },
      },
    });

    if (!job) throw new NotFoundException('Job not found');
    if (!job.script) throw new Error('Script not found');
    this.assertScriptApproved(job.script);
    if (job.renderId) {
      return { jobId: job.id, renderId: job.renderId, resumed: true };
    }

    const scenes = extractScenes(job.script.content);
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('No scenes extracted from script');
    }

    const renderId = await this.shotStackService.renderVideo(scenes, job.id);

    const saved = await this.prisma.videoJob.updateMany({
      where: {
        id: job.id,
        renderId: null,
        ...(workerId ? { workerLockedBy: workerId } : {}),
      },
      data: {
        status: VideoJobStatus.Processing,
        renderId,
        provider: 'shotstack',
        error: null,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });

    if (saved.count === 0) {
      const current = await this.prisma.videoJob.findUnique({
        where: { id: job.id },
        select: { renderId: true },
      });

      if (current?.renderId) {
        return { jobId: job.id, renderId: current.renderId, resumed: true };
      }

      throw new Error('Render claim lost before render id could be saved');
    }

    if (job.script.topicId) {
      await this.prisma.topic.updateMany({
        where: { id: job.script.topicId },
        data: { status: 'USED' },
      });
    }

    return { jobId: job.id, renderId };
  }

  async listVideos(query: ListVideosQueryDto): Promise<ApiListResponse<VideoJobSummary>> {
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.VideoJobWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.published != null) where.published = query.published;

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

    return { items: items.map(presentVideoJob), page, limit, total };
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
            externalProductId: true,
          },
        },
      },
    });

    if (!job) throw new NotFoundException('Job not found');

    return {
      job: presentVideoJob(job),
      script: job.script,
      captionsSrt: job.videoSrt ?? null,
    };
  }
}
