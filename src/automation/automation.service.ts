/* eslint-disable prettier/prettier */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { ScriptService } from './script.service';
import { AiService } from './ai/ai.service';
import { ContentQualityService } from './content-quality.service';
import type { ScriptReviewStatus } from './dto/update-script-review-status.dto';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../audit/audit.service';
import { UpdateScriptDto } from './dto/update-script.dto';
import { affiliatePlatformLabel } from '../affiliates/affiliate.constants';
import {
  ContentPlatform,
  MAX_VIDEO_DURATION_SECONDS,
  MIN_VIDEO_DURATION_SECONDS,
  normalizeContentPlatform,
} from './content-platform.constants';

type OfferInput = {
  id?: string;
  name: string;
  hoplink: string;
  nicheTag?: string | null;
  network?: string | null;
  bullets?: string[];
  workspace?: {
    affiliateNiches?: string[] | null;
    affiliatePlatforms?: string[] | null;
    primaryAffiliateLink?: string | null;
    preferredContentTone?: string | null;
    preferredLanguage?: string | null;
    targetAudience?: string | null;
    contentGoal?: string | null;
  } | null;
};

type ProductScriptInput = {
  offerId?: string;
  manualProductName?: string;
  manualProductUrl?: string;
  manualProductDescription?: string;
  targetAudience?: string;
  mainSellingPoint?: string;
  contentPlatform?: string;
  durationSeconds?: number;
  topic?: string;
  prompt?: string;
};

@Injectable()
export class AutomationService {
  constructor(
    private prisma: PrismaService,
    private scriptService: ScriptService,
    private aiService: AiService,
    private contentQuality: ContentQualityService,
    private billing: BillingService,
    private audit: AuditService,
  ) {}

  private scopedWhere(workspaceId?: string | null) {
    return workspaceId !== undefined ? { workspaceId } : {};
  }

  private async requireTopic(topicId: string, workspaceId?: string | null) {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true, title: true, workspaceId: true },
    });
    if (!topic || (workspaceId !== undefined && topic.workspaceId !== workspaceId)) {
      throw new NotFoundException('Topic not found');
    }
    return topic;
  }

  private async requireScript(id: string, workspaceId?: string | null) {
    const script = await this.prisma.script.findUnique({
      where: { id },
      include: { topic: { select: { title: true } } },
    });
    if (!script || (workspaceId !== undefined && script.workspaceId !== workspaceId)) {
      throw new NotFoundException('Script not found');
    }
    return script;
  }

  async generateScript(body: { topicId: string; content: string }, workspaceId?: string | null) {
    const topic = await this.requireTopic(body.topicId, workspaceId);
    if (topic.workspaceId) await this.billing.consumeAiGeneration(topic.workspaceId);
    const quality = await this.contentQuality.prepareScript({
      topic: topic.title,
      content: body.content,
    });

    const script = await this.scriptService.createReviewed(body.topicId, 'v1-reviewed', quality, topic.workspaceId);
    return script;
  }

  async createTopic(dto: CreateTopicDto, workspaceId?: string | null) {
    const title = dto.title.trim();
    const source = (dto.source ?? 'manual').trim();
    const score = dto.score ?? 50;

    const existing = await this.prisma.topic.findFirst({
      where: { title, workspaceId: workspaceId ?? null },
    });
    if (existing) return existing;

    return this.prisma.topic.create({
      data: { title, source, score, workspaceId: workspaceId ?? null },
    });
  }

  async generateScriptWithAi(
    topicId: string,
    topicTitle: string,
    workspaceId?: string | null,
    options: { contentPlatform?: string; durationSeconds?: number } = {},
  ) {
    const topic = await this.requireTopic(topicId, workspaceId);
    if (topic.workspaceId) await this.billing.consumeAiGeneration(topic.workspaceId);
    const content = await this.aiService.generateScript(topicTitle, undefined, {
      contentPlatform: options.contentPlatform,
      targetSeconds: options.durationSeconds,
    });
    const quality = await this.contentQuality.prepareScript({
      topic: topicTitle,
      content,
      targetSeconds: options.durationSeconds,
    });

    const script = await this.scriptService.createReviewed(topicId, 'v2-ai-reviewed', quality, topic.workspaceId);
    return script;
  }

  async getTopics(workspaceId?: string | null) {
    return this.prisma.topic.findMany({
      where: this.scopedWhere(workspaceId),
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPendingTopics(workspaceId?: string | null) {
    return this.prisma.topic.findMany({
      where: { status: 'PENDING', ...this.scopedWhere(workspaceId) },
      take: 5,
    });
  }

  async markTopicUsed(topicId: string, workspaceId?: string | null) {
    await this.requireTopic(topicId, workspaceId);
    return this.prisma.topic.update({
      where: { id: topicId },
      data: { status: 'USED' },
    });
  }

  async getAllScripts(workspaceId?: string | null) {
    return this.prisma.script.findMany({
      where: this.scopedWhere(workspaceId),
      orderBy: { createdAt: 'desc' },
    });
  }

  async getScriptById(id: string, workspaceId?: string | null) {
    return this.requireScript(id, workspaceId);
  }

  async getScriptQualityMetadata(id: string, workspaceId?: string | null) {
    const script = await this.requireScript(id, workspaceId);
    return {
      id: script.id,
      topicId: script.topicId,
      workspaceId: script.workspaceId,
      reviewStatus: script.reviewStatus,
      qualityScore: script.qualityScore,
      qualityReview: script.qualityReview,
      titleCandidates: script.titleCandidates,
      selectedTitle: script.selectedTitle,
      youtubeDescription: script.youtubeDescription,
      hashtags: script.hashtags,
      thumbnailPrompt: script.thumbnailPrompt,
      thumbnailImageUrl: script.thumbnailImageUrl,
      thumbnailStatus: script.thumbnailStatus,
      thumbnailError: script.thumbnailError,
      thumbnailGeneratedAt: script.thumbnailGeneratedAt,
      rewriteAttempts: script.rewriteAttempts,
      createdAt: script.createdAt,
    };
  }

  async updateScriptReviewStatus(
    id: string,
    reviewStatus: ScriptReviewStatus,
    note?: string,
    workspaceId?: string | null,
  ) {
    const script = await this.requireScript(id, workspaceId);
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
        workspaceId: true,
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

  async reReviewScript(id: string, workspaceId?: string | null) {
    const script = await this.requireScript(id, workspaceId);
    if (!script.topic?.title) throw new BadRequestException('Script topic is missing');
    if (script.workspaceId) await this.billing.consumeAiGeneration(script.workspaceId);

    const quality = await this.contentQuality.prepareScript({
      topic: script.topic.title,
      content: script.content,
    });

    const updated = await this.prisma.script.update({
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
        workspaceId: true,
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
    return updated;
  }

  async generateScriptWithAiFromOffer(
    input: ProductScriptInput,
    workspaceId?: string | null,
  ) {
    const product = await this.resolveProductInput(input, workspaceId);

    const topicTitle = String(input.topic || input.prompt || `Promote ${product.offer.name}`).trim();
    const topic = await this.createTopic(
      { title: topicTitle, source: 'wizard', score: 80 },
      workspaceId ?? product.workspaceId,
    );

    return this.generateScriptWithAiOffer(
      topic.id,
      topic.title,
      product.offer,
      workspaceId,
      {
        contentPlatform: input.contentPlatform ? product.contentPlatform : undefined,
        durationSeconds: product.durationSeconds,
      },
    );
  }

  private normalizeDuration(value: unknown) {
    if (value == null) return undefined;
    const duration = Number(value);
    if (
      !Number.isInteger(duration) ||
      duration < MIN_VIDEO_DURATION_SECONDS ||
      duration > MAX_VIDEO_DURATION_SECONDS
    ) {
      throw new BadRequestException(
        `durationSeconds must be an integer between ${MIN_VIDEO_DURATION_SECONDS} and ${MAX_VIDEO_DURATION_SECONDS}`,
      );
    }
    return duration;
  }

  private async resolveProductInput(
    input: ProductScriptInput,
    workspaceId?: string | null,
  ): Promise<{
    offer: OfferInput;
    workspaceId: string | null | undefined;
    contentPlatform: ContentPlatform;
    durationSeconds?: number;
  }> {
    const contentPlatform = normalizeContentPlatform(input.contentPlatform) ?? 'YOUTUBE';
    const durationSeconds = this.normalizeDuration(input.durationSeconds);
    if (input.offerId) {
      const offer = await this.prisma.offer.findUnique({
        where: { id: input.offerId },
        select: {
          id: true,
          name: true,
          hoplink: true,
          nicheTag: true,
          network: true,
          active: true,
          workspaceId: true,
          workspace: {
            select: {
              affiliateNiches: true,
              affiliatePlatforms: true,
              primaryAffiliateLink: true,
              preferredContentTone: true,
              preferredLanguage: true,
              targetAudience: true,
              contentGoal: true,
            },
          },
        },
      });
      if (!offer || (workspaceId !== undefined && offer.workspaceId !== workspaceId)) {
        throw new NotFoundException('Offer not found');
      }
      if (offer.active === false) {
        throw new BadRequestException('Offer is inactive and cannot be used for video generation');
      }
      return { offer, workspaceId: offer.workspaceId, contentPlatform, durationSeconds };
    }

    const name = String(input.manualProductName || '').trim();
    const url = String(input.manualProductUrl || '').trim();
    const description = String(input.manualProductDescription || '').trim();
    if (!name || !url || !description) {
      throw new BadRequestException(
        'Provide either offerId or manualProductName, manualProductUrl, and manualProductDescription',
      );
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new BadRequestException('manualProductUrl must be a valid http(s) URL');
    }

    const workspace =
      workspaceId
        ? await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: {
              affiliateNiches: true,
              affiliatePlatforms: true,
              primaryAffiliateLink: true,
              preferredContentTone: true,
              preferredLanguage: true,
              targetAudience: true,
              contentGoal: true,
            },
          })
        : null;
    return {
      workspaceId,
      contentPlatform,
      durationSeconds,
      offer: {
        name,
        hoplink: url,
        nicheTag: workspace?.affiliateNiches?.[0] ?? null,
        network: workspace?.affiliatePlatforms?.[0] ?? null,
        bullets: [
          description ? `Product description: ${description}` : null,
          input.mainSellingPoint ? `Main selling point: ${input.mainSellingPoint}` : null,
          input.targetAudience ? `Target audience: ${input.targetAudience}` : null,
          `Content platform: ${contentPlatform}`,
          'Manual product input: one-time only; do not create or persist an offer.',
        ].filter(Boolean) as string[],
        workspace: {
          ...workspace,
          targetAudience: input.targetAudience || workspace?.targetAudience,
          contentGoal: input.mainSellingPoint || workspace?.contentGoal,
        },
      },
    };
  }

  async updateScript(id: string, dto: UpdateScriptDto, workspaceId?: string | null) {
    const script = await this.requireScript(id, workspaceId);
    const data: Record<string, unknown> = {};
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.title !== undefined) data.selectedTitle = String(dto.title || '').trim() || null;
    if (dto.description !== undefined) data.youtubeDescription = String(dto.description || '').trim() || null;
    if (dto.hashtags !== undefined) {
      data.hashtags = dto.hashtags
        .map((tag) => String(tag || '').trim().replace(/^#+/, '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())
        .filter(Boolean)
        .slice(0, 18);
    }

    const qualityReview =
      script.qualityReview && typeof script.qualityReview === 'object' && !Array.isArray(script.qualityReview)
        ? script.qualityReview
        : {};
    data.qualityReview = {
      ...qualityReview,
      customerEdit: {
        editedAt: new Date().toISOString(),
        fields: Object.keys(dto).filter((key) => dto[key as keyof UpdateScriptDto] !== undefined),
      },
    };

    const updated = await this.prisma.script.update({
      where: { id },
      data,
      select: {
        id: true,
        topicId: true,
        workspaceId: true,
        content: true,
        reviewStatus: true,
        qualityScore: true,
        qualityReview: true,
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

    if (updated.workspaceId) {
      await this.audit.record({
        action: 'SCRIPT_UPDATED',
        workspaceId: updated.workspaceId,
        targetType: 'Script',
        targetId: updated.id,
        metadata: { fields: Object.keys(data).filter((field) => field !== 'qualityReview') },
      });
    }
    return updated;
  }

  async generateScriptWithAiOffer(
    topicId: string,
    topicTitle: string,
    offer: OfferInput,
    workspaceId?: string | null,
    options: { contentPlatform?: string; durationSeconds?: number } = {},
  ) {
    const topic = await this.requireTopic(topicId, workspaceId);
    if (topic.workspaceId) await this.billing.consumeAiGeneration(topic.workspaceId);
    const platform = offer.network || offer.workspace?.affiliatePlatforms?.[0] || null;
    const platformLabel = affiliatePlatformLabel(platform) || platform;
    const generationOptions =
      options.contentPlatform || options.durationSeconds
        ? {
            contentPlatform: options.contentPlatform,
            targetSeconds: options.durationSeconds,
          }
        : undefined;
    const offerContext = {
      name: offer.name,
      url: offer.hoplink || offer.workspace?.primaryAffiliateLink || '',
      niche: offer.nicheTag || offer.workspace?.affiliateNiches?.[0] || null,
      platform: platformLabel,
      targetAudience: offer.workspace?.targetAudience,
      contentTone: offer.workspace?.preferredContentTone,
      language: offer.workspace?.preferredLanguage,
      contentGoal: offer.workspace?.contentGoal,
      bullets: [
        offer.nicheTag ? `Affiliate niche: ${offer.nicheTag}` : null,
        platformLabel ? `Affiliate platform: ${platformLabel}` : null,
        offer.workspace?.targetAudience
          ? `Target audience: ${offer.workspace.targetAudience}`
          : null,
        ...(offer.bullets ?? []),
      ].filter(Boolean) as string[],
    };
    const content = generationOptions
      ? await this.aiService.generateScriptWithOffer(
          topicTitle,
          offerContext,
          generationOptions,
        )
      : await this.aiService.generateScriptWithOffer(topicTitle, offerContext);
    const quality = await this.contentQuality.prepareScript({
      topic: topicTitle,
      content,
      offerName: offer.name,
      targetSeconds: options.durationSeconds,
    });

    const script = await this.scriptService.createReviewed(
      topicId,
      `v2-ai-offer-${offer.network ?? 'offer'}-reviewed`,
      quality,
      topic.workspaceId,
    );
    return script;
  }
}
