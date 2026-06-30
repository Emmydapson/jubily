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
      name: 'Sleep Support',
      hoplink: 'https://example.com',
      nicheTag: 'sleep',
      network: 'digistore24',
      workspaceId: 'workspace-1',
    });
    prisma.topic.findFirst.mockResolvedValue(null);
    prisma.topic.create.mockResolvedValue({
      id: 'topic-1',
      title: 'Sleep better tonight',
      workspaceId: 'workspace-1',
    });
    prisma.topic.findUnique.mockResolvedValue({
      id: 'topic-1',
      title: 'Sleep better tonight',
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
      selectedTitle: 'Sleep better tonight',
      youtubeDescription: 'desc',
      hashtags: ['sleep'],
      thumbnailPrompt: 'thumb',
      rewriteAttempts: 0,
    });
    scriptService.createReviewed.mockResolvedValue({ id: 'script-1' });

    await expect(
      service.generateScriptWithAiFromOffer({ offerId: 'offer-1', topic: 'Sleep better tonight' }, 'workspace-1'),
    ).resolves.toEqual({ id: 'script-1' });

    expect(ai.generateScriptWithOffer).toHaveBeenCalledWith('Sleep better tonight', {
      name: 'Sleep Support',
      url: 'https://example.com',
      bullets: ['Best for: sleep'],
    });
    expect(scriptService.createReviewed).toHaveBeenCalledWith(
      'topic-1',
      'v2-ai-offer-digistore24-reviewed',
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
