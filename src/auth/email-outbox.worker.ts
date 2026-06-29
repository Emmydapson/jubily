import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuthEmailService } from './auth-email.service';

@Injectable()
export class EmailOutboxWorker {
  private readonly logger = new Logger(EmailOutboxWorker.name);
  private running = false;
  private readonly maxAttempts = Math.max(1, Number(process.env.EMAIL_OUTBOX_MAX_ATTEMPTS || 5));
  private readonly batchSize = Math.min(50, Math.max(1, Number(process.env.EMAIL_OUTBOX_BATCH_SIZE || 10)));

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: AuthEmailService,
  ) {}

  @Interval(60_000)
  async processDueEmails() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const rows = await this.prisma.emailOutbox.findMany({
        where: {
          status: { in: ['PENDING', 'FAILED'] },
          attempts: { lt: this.maxAttempts },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: this.batchSize,
      });

      for (const row of rows) {
        await this.emails.retryOutboxEmail(row, this.maxAttempts);
      }

      if (rows.length) {
        this.logger.log({
          message: 'Processed due email outbox rows',
          count: rows.length,
        });
      }
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Email outbox worker failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
    }
  }
}
