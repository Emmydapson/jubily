/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { PipelineSeverity, PipelineStage, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type MonitoringQuery = {
  limit?: string | number;
  stage?: string;
  severity?: string;
  status?: string;
  jobId?: string;
  offerId?: string;
  clickId?: string;
  provider?: string;
  sinceHours?: string | number;
  hours?: string | number;
};

type EventInput = {
  stage: PipelineStage;
  severity?: PipelineSeverity;
  status: string;
  message: string;
  jobId?: string | null;
  offerId?: string | null;
  clickId?: string | null;
  topicId?: string | null;
  scriptId?: string | null;
  provider?: string | null;
  meta?: Prisma.InputJsonValue;
};

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(private prisma: PrismaService) {}

  async logEvent(input: EventInput) {
    try {
      return await this.prisma.pipelineEvent.create({
        data: {
          stage: input.stage,
          severity: input.severity ?? 'INFO',
          status: input.status,
          message: input.message,
          jobId: input.jobId ?? null,
          offerId: input.offerId ?? null,
          clickId: input.clickId ?? null,
          topicId: input.topicId ?? null,
          scriptId: input.scriptId ?? null,
          provider: input.provider ?? null,
          meta: input.meta ?? undefined,
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to persist pipeline event: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async info(input: Omit<EventInput, 'severity'>) {
    return this.logEvent({ ...input, severity: 'INFO' });
  }

  async warn(input: Omit<EventInput, 'severity'>) {
    return this.logEvent({ ...input, severity: 'WARN' });
  }

  async error(input: Omit<EventInput, 'severity'>) {
    return this.logEvent({ ...input, severity: 'ERROR' });
  }

  async list(query: MonitoringQuery) {
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const where: Prisma.PipelineEventWhereInput = {};

    if (query.stage) where.stage = String(query.stage).toUpperCase() as PipelineStage;
    if (query.severity) where.severity = String(query.severity).toUpperCase() as PipelineSeverity;
    if (query.status) where.status = String(query.status);
    if (query.jobId) where.jobId = String(query.jobId);
    if (query.offerId) where.offerId = String(query.offerId);
    if (query.clickId) where.clickId = String(query.clickId);
    if (query.provider) where.provider = String(query.provider);
    if (query.sinceHours) {
      const hours = Math.max(Number(query.sinceHours), 1);
      where.createdAt = { gte: new Date(Date.now() - hours * 60 * 60 * 1000) };
    }

    return this.prisma.pipelineEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async summary(query: MonitoringQuery) {
    const hours = Math.max(Number(query.hours ?? 24), 1);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const events = await this.prisma.pipelineEvent.findMany({
      where: { createdAt: { gte: since } },
      select: {
        stage: true,
        severity: true,
        status: true,
        createdAt: true,
      },
    });

    const byStage = {
      IMAGE_GENERATION: { total: 0, errors: 0, warns: 0, lastEventAt: null as string | null },
      RENDER: { total: 0, errors: 0, warns: 0, lastEventAt: null as string | null },
      PUBLISH: { total: 0, errors: 0, warns: 0, lastEventAt: null as string | null },
      TRACKING: { total: 0, errors: 0, warns: 0, lastEventAt: null as string | null },
      CONVERSION: { total: 0, errors: 0, warns: 0, lastEventAt: null as string | null },
    };

    for (const event of events) {
      const bucket = byStage[event.stage];
      bucket.total += 1;
      if (event.severity === 'ERROR') bucket.errors += 1;
      if (event.severity === 'WARN') bucket.warns += 1;
      if (!bucket.lastEventAt || event.createdAt.toISOString() > bucket.lastEventAt) {
        bucket.lastEventAt = event.createdAt.toISOString();
      }
    }

    return {
      since: since.toISOString(),
      hours,
      totals: {
        events: events.length,
        errors: events.filter((x) => x.severity === 'ERROR').length,
        warns: events.filter((x) => x.severity === 'WARN').length,
      },
      byStage,
    };
  }
}
