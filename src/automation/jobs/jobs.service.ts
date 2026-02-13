/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable prettier/prettier */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrchestratorService } from '../orchestrator.service';

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  async list(query: any) {
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.status) where.status = String(query.status).toUpperCase(); // PENDING | PROCESSING | COMPLETED | FAILED
    if (query.published != null) where.published = String(query.published) === 'true';
    if (query.slot) where.slot = String(query.slot).toUpperCase(); // MORNING | AFTERNOON | EVENING

    // date filter (optional)
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    // q search: topic title OR offer name
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

    const mapped = items.map((j) => ({
      id: j.id,
      status: j.status,
      published: j.published,
      slot: j.slot,
      scheduledFor: j.scheduledFor,
      createdAt: j.createdAt,
      attempts: j.attempts,
      error: j.error,
      renderId: j.renderId,
      videoUrl: j.videoUrl,
      youtubeUrl: j.youtubeUrl,
      videoSrt: j.videoSrt ? true : false,

      scriptId: j.scriptId,
      topicId: j.script?.topic?.id ?? null,
      topicTitle: j.script?.topic?.title ?? null,

      offerId: j.offer?.id ?? null,
      offerName: j.offer?.name ?? null,
    }));

    return { items: mapped, page, limit, total };
  }

  async failedSummary() {
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const [failedToday, stuckProcessing] = await Promise.all([
      this.prisma.videoJob.count({
        where: { status: 'FAILED', createdAt: { gte: since } },
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
    return job;
  }


  async getJobAssets(jobId: string) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        script: { select: { id: true, content: true, promptVer: true, createdAt: true } },
        offer: { select: { id: true, name: true } },
      },
    });

    if (!job) throw new NotFoundException('Job not found');

    return {
      job: {
        id: job.id,
        status: job.status,
        slot: job.slot,
        scheduledFor: job.scheduledFor,
        published: job.published,
        youtubeUrl: job.youtubeUrl,
        videoUrl: job.videoUrl,
        error: job.error,
        offer: job.offer,
      },
      script: job.script,
      captionsSrt: job.videoSrt ?? null,
    };
  }

  async runSlot(slot: 'MORNING'|'AFTERNOON'|'EVENING') {
    return this.orchestrator.runSlot(slot, new Date());
  }

  async retryJob(jobId: string) {
    // simplest retry: set PROCESSING again if it has renderId; else skip
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


