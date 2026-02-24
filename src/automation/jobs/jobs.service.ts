/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable prettier/prettier */
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrchestratorService } from '../orchestrator.service';
import { scheduledForSlot } from '../time.utils';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  // ... keep list(), failedSummary(), getOne(), getJobAssets() exactly as you have them ...

  async runSlot(slot: 'MORNING'|'AFTERNOON'|'EVENING') {
    // Match cron logic (important for @@unique([slot, scheduledFor]))
    const tz = process.env.TOPIC_INGEST_TZ || process.env.APP_TZ || 'America/New_York';
    const scheduledFor = scheduledForSlot(slot, tz);

    // ✅ fire-and-return (prevents nginx 504)
    void this.orchestrator
      .runSlot(slot, scheduledFor)
      .then((res: any) => {
        this.logger.log(
          `✅ runSlot async done slot=${slot} scheduledFor=${scheduledFor.toISOString()} result=${res ? 'ok' : 'n/a'}`,
        );
      })
      .catch((e: any) => {
        this.logger.error(
          `❌ runSlot async crash slot=${slot} scheduledFor=${scheduledFor.toISOString()} msg=${e?.message || e}`,
        );
      });

    this.logger.log(`⏩ runSlot queued slot=${slot} scheduledFor=${scheduledFor.toISOString()}`);

    // return immediately to client
    return {
      ok: true,
      queued: true,
      slot,
      scheduledFor,
      note: 'Triggered asynchronously. Check /automation/jobs for progress.',
    };
  }

  async retryJob(jobId: string) {
    const job = await this.prisma.videoJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    await this.prisma.videoJob.update({
      where: { id: jobId },
      data: {
        status: job.renderId ? 'PROCESSING' : 'PENDING',
        error: null,
        attempts: 0,
      },
    });

    return { ok: true };
  }
}