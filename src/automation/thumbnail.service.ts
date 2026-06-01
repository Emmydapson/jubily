/* eslint-disable prettier/prettier */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiImageService } from './ai/ai-image.service';

type ThumbnailTarget = 'script' | 'job';

@Injectable()
export class ThumbnailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: AiImageService,
  ) {}

  private normalizePrompt(prompt: string | null | undefined) {
    return String(prompt || '').replace(/\s+/g, ' ').trim();
  }

  private statusShape(input: {
    target: ThumbnailTarget;
    id: string;
    scriptId?: string | null;
    jobId?: string | null;
    thumbnailPrompt?: string | null;
    thumbnailImageUrl?: string | null;
    thumbnailStatus?: string | null;
    thumbnailError?: string | null;
    thumbnailGeneratedAt?: Date | null;
  }) {
    return {
      target: input.target,
      id: input.id,
      scriptId: input.scriptId ?? null,
      jobId: input.jobId ?? null,
      thumbnailPrompt: input.thumbnailPrompt ?? null,
      thumbnailImageUrl: input.thumbnailImageUrl ?? null,
      thumbnailStatus: input.thumbnailStatus ?? 'PENDING',
      thumbnailError: input.thumbnailError ?? null,
      thumbnailGeneratedAt: input.thumbnailGeneratedAt ?? null,
    };
  }

  async getScriptThumbnail(scriptId: string) {
    const script = await this.prisma.script.findUnique({
      where: { id: scriptId },
      select: {
        id: true,
        thumbnailPrompt: true,
        thumbnailImageUrl: true,
        thumbnailStatus: true,
        thumbnailError: true,
        thumbnailGeneratedAt: true,
      },
    });

    if (!script) throw new NotFoundException('Script not found');

    return this.statusShape({
      target: 'script',
      id: script.id,
      scriptId: script.id,
      thumbnailPrompt: script.thumbnailPrompt,
      thumbnailImageUrl: script.thumbnailImageUrl,
      thumbnailStatus: script.thumbnailStatus,
      thumbnailError: script.thumbnailError,
      thumbnailGeneratedAt: script.thumbnailGeneratedAt,
    });
  }

  async getJobThumbnail(jobId: string) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        scriptId: true,
        thumbnailPrompt: true,
        thumbnailImageUrl: true,
        thumbnailStatus: true,
        thumbnailError: true,
        thumbnailGeneratedAt: true,
        script: {
          select: {
            thumbnailPrompt: true,
            thumbnailImageUrl: true,
            thumbnailStatus: true,
            thumbnailError: true,
            thumbnailGeneratedAt: true,
          },
        },
      },
    });

    if (!job) throw new NotFoundException('Job not found');

    return this.statusShape({
      target: 'job',
      id: job.id,
      jobId: job.id,
      scriptId: job.scriptId,
      thumbnailPrompt: job.thumbnailPrompt ?? job.script?.thumbnailPrompt ?? null,
      thumbnailImageUrl: job.thumbnailImageUrl ?? job.script?.thumbnailImageUrl ?? null,
      thumbnailStatus: job.thumbnailStatus ?? job.script?.thumbnailStatus ?? 'PENDING',
      thumbnailError: job.thumbnailError ?? job.script?.thumbnailError ?? null,
      thumbnailGeneratedAt: job.thumbnailGeneratedAt ?? job.script?.thumbnailGeneratedAt ?? null,
    });
  }

  async generateForScript(scriptId: string, promptOverride?: string) {
    const script = await this.prisma.script.findUnique({
      where: { id: scriptId },
      select: { id: true, thumbnailPrompt: true },
    });
    if (!script) throw new NotFoundException('Script not found');

    const prompt = this.normalizePrompt(promptOverride || script.thumbnailPrompt);
    await this.prisma.script.update({
      where: { id: scriptId },
      data: {
        thumbnailPrompt: prompt || script.thumbnailPrompt,
        thumbnailStatus: 'GENERATING',
        thumbnailError: null,
      },
    });

    try {
      const imageUrl = await this.images.generateThumbnailImageUrl(
        prompt || script.thumbnailPrompt || 'YouTube Shorts thumbnail, clear central wellness subject',
        `thumbnail-script-${scriptId}`,
      );

      const updated = await this.prisma.script.update({
        where: { id: scriptId },
        data: {
          thumbnailPrompt: prompt || script.thumbnailPrompt,
          thumbnailImageUrl: imageUrl,
          thumbnailStatus: 'READY',
          thumbnailError: null,
          thumbnailGeneratedAt: new Date(),
        },
        select: {
          id: true,
          thumbnailPrompt: true,
          thumbnailImageUrl: true,
          thumbnailStatus: true,
          thumbnailError: true,
          thumbnailGeneratedAt: true,
        },
      });

      return this.statusShape({
      target: 'script',
      id: updated.id,
      scriptId: updated.id,
      thumbnailPrompt: updated.thumbnailPrompt,
      thumbnailImageUrl: updated.thumbnailImageUrl,
      thumbnailStatus: updated.thumbnailStatus,
      thumbnailError: updated.thumbnailError,
      thumbnailGeneratedAt: updated.thumbnailGeneratedAt,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.prisma.script.update({
        where: { id: scriptId },
        data: {
          thumbnailStatus: 'FAILED',
          thumbnailError: message,
        },
        select: {
          id: true,
          thumbnailPrompt: true,
          thumbnailImageUrl: true,
          thumbnailStatus: true,
          thumbnailError: true,
          thumbnailGeneratedAt: true,
        },
      });

      return this.statusShape({
      target: 'script',
      id: failed.id,
      scriptId: failed.id,
      thumbnailPrompt: failed.thumbnailPrompt,
      thumbnailImageUrl: failed.thumbnailImageUrl,
      thumbnailStatus: failed.thumbnailStatus,
      thumbnailError: failed.thumbnailError,
      thumbnailGeneratedAt: failed.thumbnailGeneratedAt,
      });
    }
  }

  async generateForJob(jobId: string, promptOverride?: string) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        scriptId: true,
        thumbnailPrompt: true,
        script: { select: { thumbnailPrompt: true } },
      },
    });
    if (!job) throw new NotFoundException('Job not found');

    const prompt = this.normalizePrompt(
      promptOverride || job.thumbnailPrompt || job.script?.thumbnailPrompt,
    );

    await this.prisma.videoJob.update({
      where: { id: jobId },
      data: {
        thumbnailPrompt: prompt || job.thumbnailPrompt || job.script?.thumbnailPrompt,
        thumbnailStatus: 'GENERATING',
        thumbnailError: null,
      },
    });

    try {
      const imageUrl = await this.images.generateThumbnailImageUrl(
        prompt || job.thumbnailPrompt || job.script?.thumbnailPrompt || 'YouTube Shorts thumbnail, clear central wellness subject',
        `thumbnail-job-${jobId}`,
        jobId,
      );

      const updated = await this.prisma.videoJob.update({
        where: { id: jobId },
        data: {
          thumbnailPrompt: prompt || job.thumbnailPrompt || job.script?.thumbnailPrompt,
          thumbnailImageUrl: imageUrl,
          thumbnailStatus: 'READY',
          thumbnailError: null,
          thumbnailGeneratedAt: new Date(),
        },
        select: {
          id: true,
          scriptId: true,
          thumbnailPrompt: true,
          thumbnailImageUrl: true,
          thumbnailStatus: true,
          thumbnailError: true,
          thumbnailGeneratedAt: true,
        },
      });

      return this.statusShape({
      target: 'job',
      id: updated.id,
      jobId: updated.id,
      scriptId: updated.scriptId,
      thumbnailPrompt: updated.thumbnailPrompt,
      thumbnailImageUrl: updated.thumbnailImageUrl,
      thumbnailStatus: updated.thumbnailStatus,
      thumbnailError: updated.thumbnailError,
      thumbnailGeneratedAt: updated.thumbnailGeneratedAt,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.prisma.videoJob.update({
        where: { id: jobId },
        data: {
          thumbnailStatus: 'FAILED',
          thumbnailError: message,
        },
        select: {
          id: true,
          scriptId: true,
          thumbnailPrompt: true,
          thumbnailImageUrl: true,
          thumbnailStatus: true,
          thumbnailError: true,
          thumbnailGeneratedAt: true,
        },
      });

      return this.statusShape({
      target: 'job',
      id: failed.id,
      jobId: failed.id,
      scriptId: failed.scriptId,
      thumbnailPrompt: failed.thumbnailPrompt,
      thumbnailImageUrl: failed.thumbnailImageUrl,
      thumbnailStatus: failed.thumbnailStatus,
      thumbnailError: failed.thumbnailError,
      thumbnailGeneratedAt: failed.thumbnailGeneratedAt,
    });
    }
  }
}
