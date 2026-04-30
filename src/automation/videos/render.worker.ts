/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleSheetsService } from '../../common/google-sheets.service';
import { ShotstackServeService } from './shotstack-serve.service';
import { VideosService } from './videos.service';
import { MonitoringService } from 'src/monitoring/monitoring.service';

@Injectable()
export class RenderWorker implements OnModuleInit {
  private readonly logger = new Logger(RenderWorker.name);
  private running = false;
  private readonly enabled =
    (process.env.WORKERS_ENABLED ??
      (process.env.NODE_ENV === 'test' ? 'false' : 'true')).toLowerCase() === 'true';

  constructor(
    private prisma: PrismaService,
    private sheets: GoogleSheetsService,
    private serve: ShotstackServeService,
    private videos: VideosService,
    private monitoring: MonitoringService,
  ) {}

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('Render worker disabled via WORKERS_ENABLED');
      return;
    }

    this.logger.log('🎬 Render worker started');
    this.loop();
  }

  async loop() {
    if (this.running) return;
    this.running = true;

    while (true) {
      try {
        const pendingJobs = await this.prisma.videoJob.findMany({
          where: {
            renderId: null,
            published: false,
            attempts: { lt: 6 },
            status: { in: ['PENDING', 'FAILED'] },
          },
          orderBy: { createdAt: 'asc' },
          take: 25,
        });

        for (const job of pendingJobs) {
          await this.startPendingRender(job);
        }

        const jobs = await this.prisma.videoJob.findMany({
          where: {
            status: 'PROCESSING',
            renderId: { not: null },
            attempts: { lt: 6 },
          },
        });

        for (const job of jobs) {
          await this.handle(job);
        }
      } catch (err: any) {
        this.logger.error('Worker crashed', err?.message || err);
      }

      await new Promise((r) => setTimeout(r, 60000));
    }
  }

  async startPendingRender(job: any) {
    try {
      const started = await this.videos.startRenderForJob(job.id);
      this.logger.log(`[Render] started job=${started.jobId} renderId=${started.renderId}`);
      await this.monitoring.info({
        stage: 'RENDER',
        status: 'STARTED',
        message: 'Render job started',
        jobId: started.jobId,
        provider: 'shotstack',
        meta: { renderId: started.renderId, resumed: !!started.resumed },
      });
    } catch (e: any) {
      const message = e?.message || 'Failed to create render job';

      await this.prisma.videoJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          error: message,
        },
      });

      this.logger.error(`[Render] failed to start job=${job.id}: ${message}`);
      await this.monitoring.error({
        stage: 'RENDER',
        status: 'START_FAILED',
        message,
        jobId: job.id,
        offerId: job.offerId ?? null,
        scriptId: job.scriptId ?? null,
        provider: 'shotstack',
      });
    }
  }

  private shortHost(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid-url';
    }
  }

  async handle(job: any) {
    const renderId = String(job.renderId || '');
    if (!renderId) return;

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

          await this.prisma.videoJob.update({
            where: { id: job.id },
            data: {
              status: 'COMPLETED',
              videoUrl: serveUrl,
              error: null,
            },
          });

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
        } catch (e: any) {
          // Serve not ready yet → wait for next poll, don't increment attempts
          this.logger.warn(
            `⏳ Serve not ready job=${job.id} renderId=${renderId} msg=${e?.message || e}`,
          );
          await this.monitoring.warn({
            stage: 'RENDER',
            status: 'ASSET_PENDING',
            message: e?.message || String(e),
            jobId: job.id,
            offerId: job.offerId ?? null,
            scriptId: job.scriptId ?? null,
            provider: 'shotstack',
            meta: { renderId },
          });
          return;
        }
      }

      if (status === 'failed') {
        const error = String(data.error || 'Unknown Shotstack error');

        await this.prisma.videoJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', error },
        });

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
      return;
    } catch (e: any) {
      const message =
        e?.response?.data?.response?.error ||
        e?.response?.data?.error ||
        e?.message ||
        'Worker error';

      await this.prisma.videoJob.update({
        where: { id: job.id },
        data: { attempts: { increment: 1 }, error: message },
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
