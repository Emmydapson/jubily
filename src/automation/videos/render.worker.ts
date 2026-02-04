/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleSheetsService } from '../../common/google-sheets.service';
import { ShotstackServeService } from './shotstack-serve.service'; // adjust path

@Injectable()
export class RenderWorker implements OnModuleInit {
  private readonly logger = new Logger(RenderWorker.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private sheets: GoogleSheetsService,
    private serve: ShotstackServeService,
  ) {}

  onModuleInit() {
    this.logger.log('🎬 Render worker started');
    this.loop();
  }

  async loop() {
    if (this.running) return;
    this.running = true;

    while (true) {
      try {
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

  private shortHost(url: string) {
    try { return new URL(url).host; } catch { return 'invalid-url'; }
  }

  async handle(job: any) {
    const renderId = String(job.renderId || '');

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

      await this.sheets.append([
        job.id,
        job.scriptId,
        'shotstack',
        status.toUpperCase(),
        '',
        '',
        job.createdAt,
        new Date(),
      ]);

      // 2) If render is done, resolve CDN URL from Serve API
      if (status === 'done') {
        // Serve might not be ready immediately; if not ready, just keep waiting.
        try {
          const serveUrl = await this.serve.getReadyUrl(renderId);

          await this.prisma.videoJob.update({
            where: { id: job.id },
            data: {
              status: 'COMPLETED',
              videoUrl: serveUrl,     // ✅ store CDN url
              error: null,
            },
          });

          await this.sheets.append([
            job.id,
            job.scriptId,
            'shotstack',
            'COMPLETED',
            serveUrl,
            '',
            job.createdAt,
            new Date(),
          ]);

          this.logger.log(`✅ Render complete job=${job.id} cdnHost=${this.shortHost(serveUrl)}`);
          return;
        } catch (e: any) {
          // Not ready yet → do NOT increment attempts; just wait for next poll.
          this.logger.warn(
            `⏳ Serve not ready job=${job.id} renderId=${renderId} msg=${e?.message || e}`,
          );
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
          'shotstack',
          'FAILED',
          '',
          error,
          job.createdAt,
          new Date(),
        ]);

        this.logger.warn(`❌ Render failed job=${job.id} — ${error}`);
        return;
      }

      // still rendering → do nothing
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

      await this.sheets.append([
        job.id,
        job.scriptId,
        'shotstack',
        'RETRYING',
        '',
        message,
        job.createdAt,
        new Date(),
      ]);

      this.logger.error(`🔁 Retry job=${job.id} renderId=${renderId}: ${message}`);
    }
  }
}
