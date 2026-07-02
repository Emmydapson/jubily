import { ContentQualityService } from './content-quality.service';

describe('ContentQualityService duration gate', () => {
  let ai: {
    rewriteScriptForQuality: jest.Mock;
    generateTitleCandidates: jest.Mock;
    generateYoutubeDescription: jest.Mock;
  };
  let service: ContentQualityService;

  function script(sceneCount: number, seconds: number) {
    return JSON.stringify({
      title: 'Why your morning energy feels low',
      hook: 'Most people miss this simple morning energy signal.',
      cta: 'Save this and try it tomorrow.',
      scenes: Array.from({ length: sceneCount }, (_, index) => ({
        narration: `Scene ${index + 1} gives one practical product comparison step you can repeat before buying.`,
        caption: `Step ${index + 1}`,
        visualPrompt: 'person comparing affiliate products, slow push in camera movement, bright natural lighting, realistic lifestyle mood, no text',
        seconds,
      })),
    });
  }

  beforeEach(() => {
    ai = {
      rewriteScriptForQuality: jest.fn(),
      generateTitleCandidates: jest.fn().mockResolvedValue([
        'The morning energy mistake most people miss',
      ]),
      generateYoutubeDescription: jest.fn().mockResolvedValue('Most people miss this simple morning signal.\nSave this for tomorrow.\n#shorts'),
    };
    service = new ContentQualityService(ai as never);
  });

  it('rewrites scripts that remain below 60 seconds after normalization', async () => {
    ai.rewriteScriptForQuality.mockResolvedValue(script(8, 9));

    const result = await service.prepareScript({
      topic: 'Morning energy',
      content: script(4, 5),
    });

    expect(ai.rewriteScriptForQuality).toHaveBeenCalled();
    expect(result.rewriteAttempts).toBeGreaterThan(0);
    expect(result.reviewStatus).not.toBe('REJECTED');
  });

  it('rejects scripts that are still below 60 seconds after rewrite attempts', async () => {
    ai.rewriteScriptForQuality.mockResolvedValue(script(4, 5));

    const result = await service.prepareScript({
      topic: 'Morning energy',
      content: script(4, 5),
    });

    expect(ai.rewriteScriptForQuality).toHaveBeenCalledTimes(2);
    expect(result.reviewStatus).toBe('REJECTED');
  });

  it('rejects scripts with fewer than 8 scenes unless rewrite fixes scene count', async () => {
    ai.rewriteScriptForQuality.mockResolvedValue(script(7, 10));

    const result = await service.prepareScript({
      topic: 'Morning energy',
      content: script(7, 10),
    });

    expect(ai.rewriteScriptForQuality).toHaveBeenCalledTimes(2);
    expect(result.reviewStatus).toBe('REJECTED');
    expect(result.qualityReview.issues).toContain('script should use 8-12 scenes');
  });

  it('uses affiliate-oriented fallback metadata', async () => {
    ai.generateTitleCandidates.mockResolvedValue([]);
    ai.generateYoutubeDescription.mockResolvedValue('');

    const result = await service.prepareScript({
      topic: 'Compare AI software tools',
      content: script(8, 9),
    });

    expect(result.youtubeDescription).toContain('affiliate product');
    expect(result.hashtags).toContain('#affiliatemarketing');
    expect(result.hashtags).toContain('#productreview');
  });
});
