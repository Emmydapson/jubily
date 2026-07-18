import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import crypto from 'crypto';
import type { ScriptQualityResult } from './content-quality.service';

@Injectable()
export class ScriptService {
  constructor(private prisma: PrismaService) {}

  private PROMPT_VERSION = 'v1';

  async generate(topicId: string, content: string) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    const exists = await this.prisma.script.findFirst({
      where: { outputHash: hash },
    });

    if (exists) return exists;

    return this.prisma.script.create({
      data: {
        topicId,
        promptVer: this.PROMPT_VERSION,
        content,
        outputHash: hash,
      },
    });
  }

  async createReviewed(
    topicId: string,
    promptVer: string,
    quality: ScriptQualityResult,
    workspaceId?: string | null,
  ) {
    const exists = await this.prisma.script.findFirst({
      where: {
        outputHash: quality.outputHash,
        workspaceId: workspaceId ?? null,
      },
    });

    if (exists) return exists;

    return this.prisma.script.create({
      data: {
        topicId,
        workspaceId: workspaceId ?? null,
        promptVer,
        content: quality.content,
        outputHash: quality.outputHash,
        reviewStatus: quality.reviewStatus,
        qualityScore: quality.qualityScore,
        qualityReview: quality.qualityReview,
        titleCandidates: quality.titleCandidates,
        selectedTitle: quality.selectedTitle,
        youtubeDescription: quality.youtubeDescription,
        hashtags: quality.hashtags,
        thumbnailPrompt: quality.thumbnailPrompt,
        rewriteAttempts: quality.rewriteAttempts,
      },
    });
  }
}
