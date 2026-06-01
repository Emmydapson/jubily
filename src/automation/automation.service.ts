/* eslint-disable prettier/prettier */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { ScriptService } from './script.service';
import { AiService } from './ai/ai.service';
import { ContentQualityService } from './content-quality.service';
import type { ScriptReviewStatus } from './dto/update-script-review-status.dto';

type OfferInput = {
  id: string;
  name: string;
  hoplink: string;
  nicheTag?: string | null;
  network?: string | null;
  bullets?: string[];
};

@Injectable()
export class AutomationService {
  constructor(private prisma: PrismaService,
    private scriptService: ScriptService,
    private aiService: AiService,
    private contentQuality: ContentQualityService,
  ) {}

  async generateScript(body: { topicId: string; content: string }) {
  const topic = await this.prisma.topic.findUnique({
    where: { id: body.topicId },
    select: { title: true },
  });
  if (!topic) throw new NotFoundException('Topic not found');

  const quality = await this.contentQuality.prepareScript({
    topic: topic.title,
    content: body.content,
  });

  return this.scriptService.createReviewed(body.topicId, 'v1-reviewed', quality);
}

  async createTopic(dto: CreateTopicDto) {
  const title = dto.title.trim();
  const source = (dto.source ?? "manual").trim();
  const score = dto.score ?? 50;

  const existing = await this.prisma.topic.findFirst({
    where: { title },
  });
  if (existing) return existing;

  return this.prisma.topic.create({
    data: { title, source, score },
  });
}


 async generateScriptWithAi(topicId: string, topicTitle: string) {
  const content = await this.aiService.generateScript(topicTitle);
  const quality = await this.contentQuality.prepareScript({
    topic: topicTitle,
    content,
  });

  return this.scriptService.createReviewed(topicId, 'v2-ai-reviewed', quality);
}


async getTopics() {
  return this.prisma.topic.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

async getPendingTopics() {
  return this.prisma.topic.findMany({
    where: { status: 'PENDING' },
    take: 5,
  });
}

async markTopicUsed(topicId: string) {
  return this.prisma.topic.update({
    where: { id: topicId },
    data: { status: 'USED' },
  });
}

  async getAllScripts() {
  return this.prisma.script.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

async getScriptById(id: string) {
    const script = await this.prisma.script.findUnique({
      where: { id },
      select: {
        id: true,
        topicId: true,
        promptVer: true,
        content: true,
        reviewStatus: true,
        qualityScore: true,
        qualityReview: true,
        titleCandidates: true,
        selectedTitle: true,
        youtubeDescription: true,
        hashtags: true,
        thumbnailPrompt: true,
        thumbnailImageUrl: true,
        thumbnailStatus: true,
        thumbnailError: true,
        thumbnailGeneratedAt: true,
        rewriteAttempts: true,
        createdAt: true,
      },
    });

    if (!script) throw new NotFoundException('Script not found');
    return script;
  }

async getScriptQualityMetadata(id: string) {
    const script = await this.prisma.script.findUnique({
      where: { id },
      select: {
        id: true,
        topicId: true,
        reviewStatus: true,
        qualityScore: true,
        qualityReview: true,
        titleCandidates: true,
        selectedTitle: true,
        youtubeDescription: true,
        hashtags: true,
        thumbnailPrompt: true,
        thumbnailImageUrl: true,
        thumbnailStatus: true,
        thumbnailError: true,
        thumbnailGeneratedAt: true,
        rewriteAttempts: true,
        createdAt: true,
      },
    });

    if (!script) throw new NotFoundException('Script not found');
    return script;
  }

async updateScriptReviewStatus(id: string, reviewStatus: ScriptReviewStatus, note?: string) {
    const script = await this.prisma.script.findUnique({
      where: { id },
      select: { id: true, qualityReview: true },
    });
    if (!script) throw new NotFoundException('Script not found');

    const qualityReview =
      script.qualityReview && typeof script.qualityReview === 'object' && !Array.isArray(script.qualityReview)
        ? script.qualityReview
        : {};

    return this.prisma.script.update({
      where: { id },
      data: {
        reviewStatus,
        qualityReview: {
          ...qualityReview,
          adminReview: {
            status: reviewStatus,
            note: note ?? null,
            reviewedAt: new Date().toISOString(),
          },
        },
      },
      select: {
        id: true,
        reviewStatus: true,
        qualityScore: true,
        qualityReview: true,
        selectedTitle: true,
        hashtags: true,
        youtubeDescription: true,
        thumbnailPrompt: true,
        thumbnailImageUrl: true,
        thumbnailStatus: true,
        thumbnailError: true,
        thumbnailGeneratedAt: true,
        rewriteAttempts: true,
      },
    });
  }

async reReviewScript(id: string) {
    const script = await this.prisma.script.findUnique({
      where: { id },
      include: { topic: { select: { title: true } } },
    });
    if (!script) throw new NotFoundException('Script not found');
    if (!script.topic?.title) throw new BadRequestException('Script topic is missing');

    const quality = await this.contentQuality.prepareScript({
      topic: script.topic.title,
      content: script.content,
    });

    return this.prisma.script.update({
      where: { id },
      data: {
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
      select: {
        id: true,
        topicId: true,
        reviewStatus: true,
        qualityScore: true,
        qualityReview: true,
        titleCandidates: true,
        selectedTitle: true,
        youtubeDescription: true,
        hashtags: true,
        thumbnailPrompt: true,
        thumbnailImageUrl: true,
        thumbnailStatus: true,
        thumbnailError: true,
        thumbnailGeneratedAt: true,
        rewriteAttempts: true,
        createdAt: true,
      },
    });
  }

  async generateScriptWithAiOffer(topicId: string, topicTitle: string, offer: OfferInput) {
  const content = await this.aiService.generateScriptWithOffer(topicTitle, {
    name: offer.name,
    url: offer.hoplink, // ✅ map hoplink -> url for your AiService method
    bullets: offer.nicheTag ? [`Best for: ${offer.nicheTag}`] : [],
  });
  const quality = await this.contentQuality.prepareScript({
    topic: topicTitle,
    content,
    offerName: offer.name,
  });

  return this.scriptService.createReviewed(
    topicId,
    `v2-ai-offer-${offer.network ?? 'offer'}-reviewed`,
    quality,
  );
}
}
