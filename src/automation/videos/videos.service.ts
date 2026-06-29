/* eslint-disable prettier/prettier */
import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
import { BillingService } from '../../billing/billing.service';
import { AuditService } from '../../audit/audit.service';
import { safeErrorMessage } from '../../common/safe-metadata';
import { YoutubeService } from '../../common/youtube.service';

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shotStackService: ShotstackService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
    private readonly youtube: YoutubeService,
  ) {}

  private publicApiBaseUrl() {
    const raw = String(process.env.PUBLIC_API_BASE_URL || process.env.JUBILY_API_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return url.toString().replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  private trackingUrl(job: { id: string; offerId?: string | null; youtubeVideoId?: string | null }) {
    if (!job.offerId) return null;
    const base = this.publicApiBaseUrl();
    if (!base) return null;
    const url = new URL(`/r/${encodeURIComponent(job.offerId)}`, `${base}/`);
    url.searchParams.set('jobId', job.id);
    if (job.youtubeVideoId) url.searchParams.set('yt', job.youtubeVideoId);
    return url.toString();
  }

  private presentCustomerJob(job: Parameters<typeof presentVideoJob>[0]) {
    const summary = presentVideoJob(job);
    return {
      ...summary,
      renderStatus: summary.renderId
        ? summary.videoUrl
          ? 'READY'
          : summary.status === VideoJobStatus.Processing
            ? 'PROCESSING'
            : 'SUBMITTED'
        : 'NOT_STARTED',
      progress: this.progressFor(summary.status, summary.videoUrl, summary.published),
      trackingUrl: this.trackingUrl({
        id: summary.id,
        offerId: summary.offerId,
        youtubeVideoId: summary.youtubeVideoId,
      }),
    };
  }

  private progressFor(status: string, videoUrl: string | null, published: boolean) {
    if (published) return 100;
    if (videoUrl) return 85;
    if (status === VideoJobStatus.Processing) return 60;
    if (status === VideoJobStatus.Pending) return 10;
    if (String(status).startsWith('FAILED')) return 100;
    return null;
  }

  private async getVideoJobSummary(jobId: string, workspaceId?: string | null) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        offer: { select: { id: true, name: true } },
        script: { select: { id: true, topic: { select: { id: true, title: true } } } },
      },
    });

    if (!job || (workspaceId !== undefined && job.workspaceId !== workspaceId)) throw new NotFoundException('Job not found');
    return this.presentCustomerJob(job);
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

  async registerVideo(dto: RegisterVideoDto, workspaceId?: string | null) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: dto.jobId },
      select: { id: true, workspaceId: true, youtubeUrl: true, published: true },
    });

    if (!job || (workspaceId !== undefined && job.workspaceId !== workspaceId)) throw new NotFoundException('Job not found');

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

    return this.getVideoJobSummary(dto.jobId, workspaceId);
  }

  async markAsPublished(jobId: string, workspaceId?: string | null) {
    await this.getVideoJobSummary(jobId, workspaceId);
    await this.prisma.videoJob.update({
      where: { id: jobId },
      data: { published: true, status: VideoJobStatus.Completed, error: null },
    });

    return this.getVideoJobSummary(jobId, workspaceId);
  }

  async markAsFailed(jobId: string, error = 'Marked failed manually', workspaceId?: string | null) {
    await this.getVideoJobSummary(jobId, workspaceId);
    await this.prisma.videoJob.update({
      where: { id: jobId },
      data: { status: VideoJobStatus.Failed, error },
    });

    return this.getVideoJobSummary(jobId, workspaceId);
  }

  async createVideoJob(
    scriptId: string,
    offerId: string | undefined,
    slot: 'MORNING' | 'AFTERNOON' | 'EVENING',
    scheduledFor: Date,
    workspaceId?: string | null,
  ) {
    const script = await this.prisma.script.findUnique({
      where: { id: scriptId },
      select: { id: true, workspaceId: true, reviewStatus: true },
    });
    if (!script || (workspaceId !== undefined && script.workspaceId !== workspaceId)) throw new NotFoundException('Script not found');
    this.assertScriptApproved(script);

    if (offerId) {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        select: { id: true, workspaceId: true },
      });
      if (!offer || (workspaceId !== undefined && offer.workspaceId !== workspaceId)) {
        throw new NotFoundException('Offer not found');
      }
    }

    const workerId = `inline-render-${process.pid}-${randomUUID()}`;
    const job = await this.prisma.videoJob.create({
      data: {
        scriptId,
        workspaceId: workspaceId ?? script.workspaceId ?? null,
        offerId: offerId ?? null,
        slot,
        scheduledFor,
        workerLockedAt: new Date(),
        workerLockedBy: workerId,
        workerStage: 'RENDER_START',
      },
    });
    if (job.workspaceId) {
      await this.audit.record({
        action: 'VIDEO_GENERATED',
        workspaceId: job.workspaceId,
        targetType: 'VideoJob',
        targetId: job.id,
        metadata: { scriptId, offerId: offerId ?? null, slot },
      });
    }

    try {
      return await this.startRenderForJob(job.id, workerId);
    } catch (error: unknown) {
      const message = safeErrorMessage(error instanceof Error ? error : 'Failed to create render job');

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

  async createCustomerVideo(
    scriptId: string,
    input: { offerId?: string; slot?: 'MORNING' | 'AFTERNOON' | 'EVENING'; scheduledFor?: string },
    workspaceId: string,
  ) {
    const slot = input.slot ?? 'MORNING';
    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : new Date();
    const render = await this.createVideoJob(scriptId, input.offerId, slot, scheduledFor, workspaceId);
    const job = await this.getVideoStatus(render.jobId, workspaceId);

    return {
      videoId: job.id,
      scriptId: job.scriptId,
      status: job.status,
      renderStatus: job.renderStatus,
      progress: job.progress,
      trackingUrl: job.trackingUrl,
      message: render.resumed ? 'Render already started' : 'Render started',
    };
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
    if (job.workspaceId) {
      await this.billing.consumeVideoGeneration(job.workspaceId);
    }

    const scenes = extractScenes(job.script.content);
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('No scenes extracted from script');
    }

    const render = await this.shotStackService.renderVideo(scenes, job.id);

    const saved = await this.prisma.videoJob.updateMany({
      where: {
        id: job.id,
        renderId: null,
        ...(workerId ? { workerLockedBy: workerId } : {}),
      },
      data: {
        status: VideoJobStatus.Processing,
        renderId: render.renderId,
        provider: 'shotstack',
        durationSeconds: render.durationSeconds,
        sceneCount: render.sceneCount,
        hasBurnedSubtitles: render.hasBurnedSubtitles,
        shotstackPayloadDebugPath: render.shotstackPayloadDebugPath,
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

    if (job.workspaceId) {
      await this.billing.incrementUsage(job.workspaceId, {
        renderMinutes: render.durationSeconds ? render.durationSeconds / 60 : 0,
      });
      await this.audit.record({
        action: 'VIDEO_RENDERED',
        workspaceId: job.workspaceId,
        targetType: 'VideoJob',
        targetId: job.id,
        metadata: { renderId: render.renderId, durationSeconds: render.durationSeconds, sceneCount: render.sceneCount },
      });
    }

    return {
      jobId: job.id,
      renderId: render.renderId,
      qa: {
        durationSeconds: render.durationSeconds,
        sceneCount: render.sceneCount,
        hasBurnedSubtitles: render.hasBurnedSubtitles,
        shotstackPayloadDebugPath: render.shotstackPayloadDebugPath,
      },
    };
  }

  async listVideos(query: ListVideosQueryDto, workspaceId?: string | null): Promise<ApiListResponse<VideoJobSummary>> {
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.VideoJobWhereInput = {};
    if (workspaceId !== undefined) where.workspaceId = workspaceId;
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

    return { items: items.map((job) => this.presentCustomerJob(job)), page, limit, total };
  }

  async getVideoStatus(jobId: string, workspaceId?: string | null) {
    return this.getVideoJobSummary(jobId, workspaceId);
  }

  async publishVideo(jobId: string, workspaceId?: string | null) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        offer: { select: { id: true, name: true } },
        script: { select: { id: true, reviewStatus: true, topic: { select: { id: true, title: true } } } },
      },
    });
    if (!job || (workspaceId !== undefined && job.workspaceId !== workspaceId)) throw new NotFoundException('Job not found');
    if (!job.workspaceId) throw new BadRequestException('Workspace is required to publish');
    if (job.script.reviewStatus !== 'APPROVED') throw new ConflictException('Script must be approved before publishing');
    if (job.status !== VideoJobStatus.Completed || !job.renderId) {
      throw new ConflictException('Render must be completed before publishing');
    }
    if (job.published) return { queued: false, status: 'PUBLISHED', job: this.presentCustomerJob(job) };

    const youtube = await this.youtube.getWorkspaceChannelDiagnostics(job.workspaceId);
    if (!youtube.connected) throw new ConflictException('Connect YouTube before publishing');

    const claimed = await this.prisma.videoJob.updateMany({
      where: {
        id: job.id,
        workspaceId: job.workspaceId,
        published: false,
        status: VideoJobStatus.Completed,
        renderId: { not: null },
        workerStage: null,
      },
      data: {
        error: null,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: 'PUBLISH_QUEUED',
      },
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.videoJob.findUnique({
        where: { id: job.id },
        include: {
          offer: { select: { id: true, name: true } },
          script: { select: { id: true, reviewStatus: true, topic: { select: { id: true, title: true } } } },
        },
      });
      return {
        queued: false,
        status: current?.published ? 'PUBLISHED' : 'ALREADY_QUEUED',
        job: current ? this.presentCustomerJob(current) : this.presentCustomerJob(job),
      };
    }

    try {
      await this.billing.consumePublish(job.workspaceId);
    } catch (error) {
      await this.prisma.videoJob.updateMany({
        where: { id: job.id, workerStage: 'PUBLISH_QUEUED', published: false },
        data: { workerStage: null, workerLockedAt: null, workerLockedBy: null },
      });
      throw error;
    }

    const refreshed = await this.prisma.videoJob.findUnique({
      where: { id: job.id },
      include: {
        offer: { select: { id: true, name: true } },
        script: { select: { id: true, reviewStatus: true, topic: { select: { id: true, title: true } } } },
      },
    });
    return {
      queued: true,
      status: 'QUEUED_FOR_PUBLISH',
      trackingUrl: this.trackingUrl({ id: job.id, offerId: job.offerId, youtubeVideoId: job.youtubeVideoId }),
      job: refreshed ? this.presentCustomerJob(refreshed) : this.presentCustomerJob(job),
    };
  }

  async getVideoAssets(jobId: string, workspaceId?: string | null) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        script: {
          select: {
            id: true,
            content: true,
            promptVer: true,
            createdAt: true,
            thumbnailPrompt: true,
            thumbnailImageUrl: true,
            thumbnailStatus: true,
            thumbnailError: true,
            thumbnailGeneratedAt: true,
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

    if (!job || (workspaceId !== undefined && job.workspaceId !== workspaceId)) throw new NotFoundException('Job not found');

    return {
      job: this.presentCustomerJob(job),
      script: job.script,
      captionsSrt: job.videoSrt ?? null,
    };
  }
}
