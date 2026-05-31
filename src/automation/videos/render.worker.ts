/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleSheetsService } from '../../common/google-sheets.service';
import { ShotstackServeService } from './shotstack-serve.service';
import { VideosService } from './videos.service';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { SettingsService } from '../../settings/settings.service';

type RenderWorkerScript = {
  topicId: string | null;
};

type RenderWorkerJob = {
  id: string;
  scriptId: string;
  offerId: string | null;
  renderId: string | null;
  status: string;
  attempts: number;
  published: boolean;
  createdAt: Date;
  error: string | null;
  provider?: string | null;
  script?: RenderWorkerScript | null;
};

@Injectable()
export class RenderWorker implements OnModuleInit {
  private readonly logger = new Logger(RenderWorker.name);
  private running = false;
  private automationPausedLogged = false;
  private readonly workerId = `render-${process.pid}-${randomUUID()}`;
  private readonly lockTtlMs = Number(process.env.WORKER_LOCK_TTL_MS || 30 * 60 * 1000);
  private readonly enabled =
    (process.env.WORKERS_ENABLED ??
      (process.env.NODE_ENV === 'test' ? 'false' : 'true')).toLowerCase() === 'true';

  constructor(
    private prisma: PrismaService,
    private sheets: GoogleSheetsService,
    private serve: ShotstackServeService,
    private videos: VideosService,
    private monitoring: MonitoringService,
    private settingsService: SettingsService,
  ) {}

private lockCutoff() {
  return new Date(Date.now() - this.lockTtlMs);
}

private availableLeaseWhere() {
  return [
    { workerLockedAt: null },
    { workerLockedAt: { lt: this.lockCutoff() } },
  ];
}

private async claimPendingRender(job: RenderWorkerJob) {
  const claimed = await this.prisma.videoJob.updateMany({
    where: {
      id: job.id,
      renderId: null,
      published: false,
      attempts: { lt: 6 },
      status: { in: ['PENDING', 'FAILED'] },
      script: { reviewStatus: 'APPROVED' },
      OR: this.availableLeaseWhere(),
    },
    data: {
      workerLockedAt: new Date(),
      workerLockedBy: this.workerId,
      workerStage: 'RENDER_START',
      error: null,
    },
  });

  if (claimed.count === 1) {
    this.logger.log(`[RenderClaim] claimed start job=${job.id}`);
    return true;
  }

  this.logger.log(`[RenderClaim] skipped start job=${job.id}`);
  return false;
}

private async claimRenderPoll(job: RenderWorkerJob) {
  const claimed = await this.prisma.videoJob.updateMany({
    where: {
      id: job.id,
      status: 'PROCESSING',
      renderId: job.renderId,
      attempts: { lt: 6 },
      OR: this.availableLeaseWhere(),
    },
    data: {
      workerLockedAt: new Date(),
      workerLockedBy: this.workerId,
      workerStage: 'RENDER_POLL',
    },
  });

  if (claimed.count === 1) {
    this.logger.log(`[RenderClaim] claimed poll job=${job.id}`);
    return true;
  }

  this.logger.log(`[RenderClaim] skipped poll job=${job.id}`);
  return false;
}

private async releaseClaim(jobId: string, data: Record<string, unknown> = {}) {
  return this.prisma.videoJob.updateMany({
    where: { id: jobId, workerLockedBy: this.workerId },
    data: {
      ...data,
      workerLockedAt: null,
      workerLockedBy: null,
      workerStage: null,
    },
  });
}

private async bumpAttempt(jobId: string, message: string) {
  return this.releaseClaim(jobId, {
    status: 'FAILED',
    attempts: { increment: 1 },
    error: message,
  });
}

private async recoverStaleClaims() {
  const staleStarts = await this.prisma.videoJob.updateMany({
    where: {
      workerStage: 'RENDER_START',
      workerLockedAt: { lt: this.lockCutoff() },
      renderId: null,
      attempts: { lt: 6 },
    },
    data: {
      status: 'FAILED',
      attempts: { increment: 1 },
      error: 'Render claim expired before initialization',
      workerLockedAt: null,
      workerLockedBy: null,
      workerStage: null,
    },
  });

  if (staleStarts.count) {
    this.logger.warn(`[RenderClaim] recovered stale start claims count=${staleStarts.count}`);
  }

  const stalePolls = await this.prisma.videoJob.updateMany({
    where: {
      workerStage: 'RENDER_POLL',
      workerLockedAt: { lt: this.lockCutoff() },
      status: 'PROCESSING',
      renderId: { not: null },
    },
    data: {
      workerLockedAt: null,
      workerLockedBy: null,
      workerStage: null,
    },
  });

  if (stalePolls.count) {
    this.logger.warn(`[RenderClaim] recovered stale poll claims count=${stalePolls.count}`);
  }
}

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('Render worker disabled via WORKERS_ENABLED');
      return;
    }

    this.logger.log('Render worker started');
    void this.loop();
  }

  async loop() {
  if (this.running) return;
  this.running = true;

  while (true) {
    try {
      await this.recoverStaleClaims();
      const settings = await this.settingsService.getSettings();
      // 🧨 1. HARD STUCK JOB CLEANUP (no renderId after retries)
      const stuckJobs = await this.prisma.videoJob.findMany({
        where: {
          renderId: null,
          attempts: { gte: 6 },
          status: { in: ['PENDING', 'FAILED'] },
        },
        include: {
          script: {
            select: { id: true, topicId: true },
          },
        },
      });

      for (const job of stuckJobs) {
        await this.prisma.videoJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED_PERMANENT',
            error: 'Render never initialized (no renderId after retries)',
            workerLockedAt: null,
            workerLockedBy: null,
            workerStage: null,
          },
        });

        await this.monitoring.error({
          stage: 'RENDER',
          status: 'FAILED_PERMANENT',
          message: 'Render stuck before initialization',
          jobId: job.id,
          scriptId: job.scriptId,
          provider: 'shotstack',
        });
      }

      // 🔁 2. NORMAL RETRY JOBS
      if (settings.automationEnabled) {
        this.automationPausedLogged = false;
        const pendingJobs = await this.prisma.videoJob.findMany({
          where: {
            renderId: null,
            published: false,
            attempts: { lt: 6 },
            status: { in: ['PENDING', 'FAILED'] },
            script: { reviewStatus: 'APPROVED' },
          },
          orderBy: { createdAt: 'asc' },
          take: 25,
        });

        for (const job of pendingJobs) {
          if (await this.claimPendingRender(job)) {
            await this.startPendingRender(job);
          }
        }
      } else {
        if (!this.automationPausedLogged) {
          this.logger.warn('[RenderWorker] automationEnabled=false; new render starts paused');
          this.automationPausedLogged = true;
        }
      }

      // 🎬 3. ACTIVE RENDER POLLING
      const jobs = await this.prisma.videoJob.findMany({
  where: {
    status: 'PROCESSING',
    renderId: { not: null },
    attempts: { lt: 6 },
  },
  select: {
    id: true,
    scriptId: true,
    offerId: true,
    renderId: true,
    status: true,
    attempts: true,
    published: true,
    createdAt: true,
    error: true,
    provider: true, // ✅ ADD THIS
  },
});

      for (const job of jobs) {
        if (await this.claimRenderPoll(job)) {
          await this.handle(job);
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        'Worker crashed',
        error instanceof Error ? error.message : String(error),
      );
    }

    await new Promise((r) => setTimeout(r, 60000));
  }
}

  async startPendingRender(job: RenderWorkerJob) {
  try {
    const started = await this.videos.startRenderForJob(job.id, this.workerId);

    if (!started?.renderId) {
      throw new Error('Render service did not return renderId');
    }

    this.logger.log(
      `[Render] started job=${started.jobId} renderId=${started.renderId}`,
    );

    await this.monitoring.info({
      stage: 'RENDER',
      status: 'CREATION_SUCCESS',
      message: 'Render successfully initialized',
      jobId: started.jobId,
      provider: 'shotstack',
      meta: {
        renderId: started.renderId,
        resumed: !!started.resumed,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to create render job';

    await this.bumpAttempt(job.id, message);

    const updated = await this.prisma.videoJob.findUnique({
      where: { id: job.id },
    });

    const attempts = updated?.attempts ?? 0;

    if (attempts >= 6) {
      await this.prisma.videoJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED_PERMANENT',
          workerLockedAt: null,
          workerLockedBy: null,
          workerStage: null,
        },
      });

      await this.monitoring.error({
        stage: 'RENDER',
        status: 'FAILED_PERMANENT',
        message,
        jobId: job.id,
        provider: 'shotstack',
      });
    } else {
      await this.monitoring.error({
        stage: 'RENDER',
        status: 'START_FAILED',
        message,
        jobId: job.id,
        provider: 'shotstack',
      });
    }

    this.logger.error(`[Render] failed job=${job.id} msg=${message}`);
  }
}

  async finalizePermanentFailure(job: RenderWorkerJob) {
    const message = String(job.error || 'Render start failed too many times');

    await this.prisma.videoJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED_PERMANENT',
        error: message,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });

    if (job.script?.topicId) {
      await this.prisma.topic.updateMany({
        where: { id: job.script.topicId },
        data: { status: 'PENDING' },
      });
    }

    this.logger.error(`[Render] permanent failure job=${job.id}: ${message}`);
    await this.monitoring.error({
      stage: 'RENDER',
      status: 'FAILED_PERMANENT',
      message,
      jobId: job.id,
      scriptId: job.scriptId ?? null,
      topicId: job.script?.topicId ?? null,
      offerId: job.offerId ?? null,
      provider: 'shotstack',
      meta: { attempts: job.attempts ?? 0, recoveredTopic: !!job.script?.topicId },
    });
  }

  private shortHost(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid-url';
    }
  }

  async handle(job: RenderWorkerJob) {
   if (job.provider === 'replicate') {
  const completed = await this.releaseClaim(job.id, {
      status: 'COMPLETED',
      videoUrl: job.renderId,
      error: null,
  });

  if (completed.count !== 1) {
    this.logger.log(`[RenderClaim] skipped replicate completion job=${job.id}`);
    return;
  }

  await this.sheets.append([
    job.id,
    job.scriptId,
    '',
    '',
    'replicate',
    'COMPLETED',
    job.renderId,
    '',
    job.createdAt,
    new Date(),
  ]);

  await this.monitoring.info({
    stage: 'RENDER',
    status: 'COMPLETED',
    message: 'Replicate video completed',
    jobId: job.id,
    provider: 'replicate',
    meta: { videoUrl: job.renderId },
  });

  this.logger.log(`✅ Replicate video done job=${job.id}`);

  return;
}
    const renderId = String(job.renderId || '');
    if (!renderId) {
      await this.releaseClaim(job.id);
      return;
    }

    try {
      // 1) Poll render status (stage render API)
      const res = await axios.get(`https://api.shotstack.io/stage/render/${renderId}`, {
        headers: { 'x-api-key': process.env.SHOTSTACK_API_KEY },
        timeout: 20000,
      });

      const data = res.data?.response;
      if (!data) throw new Error('Empty Shotstack response');

      const status: string = String(data.status || 'unknown').toLowerCase();
      this.logger.log(`[Render] job=${job.id} renderId=${renderId} status=${status}`);

      // 2) If render is done, resolve CDN URL from Serve API
      if (status === 'done') {
        try {
          const serveUrl = await this.serve.getReadyUrl(renderId);

          const completed = await this.releaseClaim(job.id, {
              status: 'COMPLETED',
              videoUrl: serveUrl,
              error: null,
          });

          if (completed.count !== 1) {
            this.logger.log(`[RenderClaim] skipped completion job=${job.id}`);
            return;
          }

          // ✅ Sheets: only log COMPLETED / FAILED, unified schema (10 cols)
          await this.sheets.append([
            job.id,
            job.scriptId,
            '',          // topic
            '',          // offer
            'shotstack',  // provider
            'COMPLETED',  // status
            serveUrl,     // url
            '',           // error
            job.createdAt,
            new Date(),
          ]);

          this.logger.log(`✅ Render complete job=${job.id} cdnHost=${this.shortHost(serveUrl)}`);
          await this.monitoring.info({
            stage: 'RENDER',
            status: 'COMPLETED',
            message: 'Render completed',
            jobId: job.id,
            offerId: job.offerId ?? null,
            scriptId: job.scriptId ?? null,
            provider: 'shotstack',
            meta: { renderId, videoUrl: serveUrl },
          });
          return;
        } catch (error: unknown) {
          // Serve not ready yet → wait for next poll, don't increment attempts
          this.logger.warn(
            `⏳ Serve not ready job=${job.id} renderId=${renderId} msg=${error instanceof Error ? error.message : String(error)}`,
          );
          await this.monitoring.warn({
            stage: 'RENDER',
            status: 'ASSET_PENDING',
            message: error instanceof Error ? error.message : String(error),
            jobId: job.id,
            offerId: job.offerId ?? null,
            scriptId: job.scriptId ?? null,
            provider: 'shotstack',
            meta: { renderId },
          });
          await this.releaseClaim(job.id);
          return;
        }
      }

      if (status === 'failed') {
        const error = String(data.error || 'Unknown Shotstack error');

        await this.releaseClaim(job.id, { status: 'FAILED', error });

        await this.sheets.append([
          job.id,
          job.scriptId,
          '',
          '',
          'shotstack',
          'FAILED',
          '',
          error,
          job.createdAt,
          new Date(),
        ]);

        this.logger.warn(`❌ Render failed job=${job.id} — ${error}`);
        await this.monitoring.error({
          stage: 'RENDER',
          status: 'FAILED',
          message: error,
          jobId: job.id,
          offerId: job.offerId ?? null,
          scriptId: job.scriptId ?? null,
          provider: 'shotstack',
          meta: { renderId },
        });
        return;
      }

      // still rendering → do nothing
      await this.releaseClaim(job.id);
      return;
    } catch (error: unknown) {
      const message =
        (axios.isAxiosError(error) && typeof error.response?.data === 'object'
          ? (error.response.data as { response?: { error?: string }; error?: string }).response?.error ||
            (error.response.data as { error?: string }).error
          : undefined) ||
        (error instanceof Error ? error.message : undefined) ||
        'Worker error';

      await this.releaseClaim(job.id, {
        attempts: { increment: 1 },
        error: message,
      });

      // ✅ No Sheets logging for retries
      this.logger.error(`🔁 Retry job=${job.id} renderId=${renderId}: ${message}`);
      await this.monitoring.warn({
        stage: 'RENDER',
        status: 'RETRY',
        message,
        jobId: job.id,
        offerId: job.offerId ?? null,
        scriptId: job.scriptId ?? null,
        provider: 'shotstack',
        meta: { renderId, attempts: (job.attempts ?? 0) + 1 },
      });
    }
  }
}
