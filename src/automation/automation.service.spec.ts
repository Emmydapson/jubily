import { NotFoundException } from '@nestjs/common';
import { AutomationService } from './automation.service';

describe('AutomationService customer wizard helpers', () => {
  let prisma: {
    offer: { findUnique: jest.Mock };
    topic: { findFirst: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    script: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  };
  let scriptService: { createReviewed: jest.Mock };
  let ai: { generateScriptWithOffer: jest.Mock };
  let quality: { prepareScript: jest.Mock };
  let billing: { consumeAiGeneration: jest.Mock };
  let audit: { record: jest.Mock };
  let service: AutomationService;

  beforeEach(() => {
    prisma = {
      offer: { findUnique: jest.fn() },
      topic: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
      script: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    };
    scriptService = { createReviewed: jest.fn() };
    ai = { generateScriptWithOffer: jest.fn() };
    quality = { prepareScript: jest.fn() };
    billing = {
      consumeAiGeneration: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue(null) };
    service = new AutomationService(
      prisma as never,
      scriptService as never,
      ai as never,
      quality as never,
      billing as never,
      audit as never,
    );
  });

  it('generates a product-aware AI script for offers in the active workspace', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 'offer-1',
      name: 'AI Writer Pro',
      hoplink: 'https://example.com',
      nicheTag: 'AI_SOFTWARE',
      network: 'PARTNERSTACK',
      workspaceId: 'workspace-1',
      workspace: {
        affiliateNiches: ['AI_SOFTWARE'],
        affiliatePlatforms: ['PARTNERSTACK'],
        primaryAffiliateLink: 'https://workspace.example.com',
        preferredContentTone: 'direct',
        preferredLanguage: 'en',
        targetAudience: 'busy founders',
        contentGoal: 'compare product options',
      },
    });
    prisma.topic.findFirst.mockResolvedValue(null);
    prisma.topic.create.mockResolvedValue({
      id: 'topic-1',
      title: 'Compare AI writing tools',
      workspaceId: 'workspace-1',
    });
    prisma.topic.findUnique.mockResolvedValue({
      id: 'topic-1',
      title: 'Compare AI writing tools',
      workspaceId: 'workspace-1',
    });
    ai.generateScriptWithOffer.mockResolvedValue('script content');
    quality.prepareScript.mockResolvedValue({
      content: 'reviewed script',
      outputHash: 'hash',
      reviewStatus: 'APPROVED',
      qualityScore: 90,
      qualityReview: {},
      titleCandidates: [],
      selectedTitle: 'Compare AI writing tools',
      youtubeDescription: 'desc',
      hashtags: ['aitools'],
      thumbnailPrompt: 'thumb',
      rewriteAttempts: 0,
    });
    scriptService.createReviewed.mockResolvedValue({ id: 'script-1' });

    await expect(
      service.generateScriptWithAiFromOffer({ offerId: 'offer-1', topic: 'Compare AI writing tools' }, 'workspace-1'),
    ).resolves.toEqual({ id: 'script-1' });

    expect(ai.generateScriptWithOffer).toHaveBeenCalledWith('Compare AI writing tools', {
      name: 'AI Writer Pro',
      url: 'https://example.com',
      niche: 'AI_SOFTWARE',
      platform: 'PARTNERSTACK',
      targetAudience: 'busy founders',
      contentTone: 'direct',
      language: 'en',
      contentGoal: 'compare product options',
      bullets: [
        'Affiliate niche: AI_SOFTWARE',
        'Affiliate platform: PARTNERSTACK',
        'Target audience: busy founders',
      ],
    });
    expect(scriptService.createReviewed).toHaveBeenCalledWith(
      'topic-1',
      'v2-ai-offer-PARTNERSTACK-reviewed',
      expect.objectContaining({ content: 'reviewed script' }),
      'workspace-1',
    );
  });

  it('edits script customer-facing fields and records audit log', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-1',
      qualityReview: {},
      topic: { title: 'Topic' },
    });
    prisma.script.update.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-1',
      content: 'new content',
      selectedTitle: 'New title',
      youtubeDescription: 'New description',
      hashtags: ['sleep'],
    });

    await expect(
      service.updateScript(
        'script-1',
        { title: 'New title', content: 'new content', description: 'New description', hashtags: ['#Sleep'] },
        'workspace-1',
      ),
    ).resolves.toEqual(expect.objectContaining({ id: 'script-1' }));

    expect(prisma.script.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'new content',
          selectedTitle: 'New title',
          youtubeDescription: 'New description',
          hashtags: ['sleep'],
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SCRIPT_UPDATED',
      workspaceId: 'workspace-1',
      targetId: 'script-1',
    }));
  });

  it('returns empty create-video page lists safely for a fresh free workspace', async () => {
    prisma.topic.findMany.mockResolvedValue([]);
    prisma.script.findMany.mockResolvedValue([]);

    await expect(service.getTopics('workspace-1')).resolves.toEqual([]);
    await expect(service.getPendingTopics('workspace-1')).resolves.toEqual([]);
    await expect(service.getAllScripts('workspace-1')).resolves.toEqual([]);

    expect(prisma.topic.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: 'workspace-1' },
    }));
    expect(prisma.script.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: 'workspace-1' },
    }));
  });

  it('returns a clear not-found error when create-video offer generation references a missing offer', async () => {
    prisma.offer.findUnique.mockResolvedValue(null);

    await expect(
      service.generateScriptWithAiFromOffer({ offerId: 'missing-offer', topic: 'Topic' }, 'workspace-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
