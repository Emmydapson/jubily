/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable prettier/prettier */
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrchestratorService } from '../orchestrator.service';
import { scheduledForHour, SLOT_ORDER } from '../time.utils';
import { SettingsService } from '../../settings/settings.service';
import { YoutubeService } from '../../common/youtube.service';
import { Prisma } from '@prisma/client';
import { ApiListResponse, ApiOkResponse } from '../../common/api-response';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { presentVideoJob, VideoJobSummary } from '../video-job.presenter';
import { VideoJobStatus } from '../video-job-status';

type Slot = 'MORNING' | 'AFTERNOON' | 'EVENING';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly orchestrator: OrchestratorService,
    private readonly settingsService: SettingsService,
    private readonly youtubeService: YoutubeService,
  ) {}

  async list(query: ListJobsQueryDto): Promise<ApiListResponse<VideoJobSummary>> {
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.VideoJobWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.published != null) where.published = query.published;
    if (query.slot) where.slot = query.slot as Prisma.EnumRunSlotFilter['equals'];

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

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

    const mapped = items.map(presentVideoJob);

    return { items: mapped, page, limit, total };
  }

  async failedSummary() {
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const [failedToday, stuckProcessing] = await Promise.all([
      this.prisma.videoJob.count({
        where: { status: { in: [VideoJobStatus.Failed, VideoJobStatus.FailedPublish] }, createdAt: { gte: since } },
      }),
      this.prisma.videoJob.count({
        where: { status: 'PROCESSING', createdAt: { gte: since } },
      }),
    ]);

    return { failedToday, stuckProcessing };
  }

  async getOne(id: string) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id },
      include: {
        offer: { select: { id: true, name: true } },
        script: { select: { id: true, topic: { select: { id: true, title: true } } } },
      },
    });

    if (!job) throw new NotFoundException('Job not found');
    return presentVideoJob(job);
  }

  async getJobAssets(jobId: string) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        script: { select: { id: true, content: true, promptVer: true, createdAt: true, topic: { select: { id: true, title: true } } } },
        offer: { select: { id: true, name: true } },
      },
    });

    if (!job) throw new NotFoundException('Job not found');

    return {
      job: presentVideoJob(job),
      script: job.script,
      captionsSrt: job.videoSrt ?? null,
    };
  }

  async runSlot(slot: Slot) {
    // IMPORTANT: this must match cron/idempotency logic
    const settings = await this.settingsService.getSettings();
    const tz = settings.timezone || process.env.APP_TZ || 'America/New_York';
    const slotIndex = SLOT_ORDER.indexOf(slot);
    const configuredHour = slotIndex >= 0 ? settings.runHours?.[slotIndex] : undefined;
    const hour = Number.isInteger(configuredHour) ? Number(configuredHour) : new Date().getHours();
    const scheduledFor = scheduledForHour(hour, tz);

    // ✅ fire-and-return (prevents nginx 504)
    void this.orchestrator
      .runSlot(slot, scheduledFor)
      .then((res: any) => {
        this.logger.log(
          `✅ runSlot async done slot=${slot} scheduledFor=${scheduledFor.toISOString()} skipped=${res?.skipped ?? false}`,
        );
      })
      .catch((e: any) => {
        this.logger.error(
          `❌ runSlot async crash slot=${slot} scheduledFor=${scheduledFor.toISOString()} msg=${e?.message || e}`,
        );
      });

    this.logger.log(`⏩ runSlot queued slot=${slot} scheduledFor=${scheduledFor.toISOString()}`);

    return {
      ok: true,
      queued: true,
      slot,
      scheduledFor,
      note: 'Triggered asynchronously. Check /automation/jobs for progress.',
    };
  }

  async retryJob(jobId: string): Promise<ApiOkResponse> {
    const job = await this.prisma.videoJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    await this.prisma.videoJob.update({
      where: { id: jobId },
      data: {
        status: job.renderId ? VideoJobStatus.Processing : VideoJobStatus.Pending,
        error: null,
        attempts: 0,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });

    return { ok: true };
  }

  async workerStatus() {
    const settings = await this.settingsService.getSettings();
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - Number(process.env.WORKER_LOCK_TTL_MS || 30 * 60 * 1000));

    const [pendingRender, processingRender, readyToPublish, activeLeases, staleLeases, failedToday, lastWorkerEvents, youtubeTokenStorage] =
      await Promise.all([
        this.prisma.videoJob.count({ where: { renderId: null, published: false, attempts: { lt: 6 }, status: { in: ['PENDING', 'FAILED'] } } }),
        this.prisma.videoJob.count({ where: { status: 'PROCESSING', renderId: { not: null }, attempts: { lt: 6 } } }),
        this.prisma.videoJob.count({ where: { status: 'COMPLETED', published: false, renderId: { not: null } } }),
        this.prisma.videoJob.count({ where: { workerLockedAt: { not: null } } }),
        this.prisma.videoJob.count({ where: { workerLockedAt: { lt: staleCutoff } } }),
        this.prisma.videoJob.count({
          where: {
            status: { in: [VideoJobStatus.Failed, VideoJobStatus.FailedPermanent, VideoJobStatus.FailedQuota, VideoJobStatus.FailedPublish] },
            createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
          },
        }),
        this.prisma.pipelineEvent.findMany({
          where: { stage: { in: ['RENDER', 'PUBLISH'] } },
          select: { stage: true, severity: true, status: true, message: true, jobId: true, provider: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.youtubeService.tokenStorageStatus(),
      ]);

    const configuredRunHours = (settings.runHours || []).slice(0, Math.min(settings.videosPerDay, SLOT_ORDER.length));

    return {
      workersEnabled: (process.env.WORKERS_ENABLED ?? (process.env.NODE_ENV === 'test' ? 'false' : 'true')).toLowerCase() === 'true',
      automationEnabled: settings.automationEnabled,
      autoPublish: settings.autoPublish,
      timezone: settings.timezone,
      runHours: settings.runHours,
      videosPerDay: settings.videosPerDay,
      activeSchedule: SLOT_ORDER.slice(0, configuredRunHours.length).map((slot, index) => ({
        slot,
        hour: configuredRunHours[index],
        scheduledFor: scheduledForHour(configuredRunHours[index], settings.timezone, now).toISOString(),
      })),
      pauseState: {
        newRenderStartsPaused: !settings.automationEnabled,
        publishingPaused: !settings.autoPublish,
      },
      queues: {
        pendingRender,
        processingRender,
        readyToPublish,
        activeLeases,
        staleLeases,
        failedToday,
      },
      youtube: {
        tokenStorage: youtubeTokenStorage,
      },
      recentWorkerEvents: lastWorkerEvents,
      checkedAt: now.toISOString(),
    };
  }
}
