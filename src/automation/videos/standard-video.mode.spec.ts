import {
  buildModernCaptionChunks,
  buildStandardRenderScenes,
  detectContradictoryBrief,
  motionEffectForScene,
  resolvePlatformCta,
  transitionForScene,
  validateStandardTimeline,
} from './standard-video.mode';
import { Scene } from './interfaces/scene.interface';

describe('Standard image video mode', () => {
  const scenes: Scene[] = [
    {
      index: 1,
      narration:
        'Most teams waste hours rewriting posts because their AI workflow has no repeatable product context.',
      caption: 'Stop rewriting from scratch',
      duration: 9,
      visualPrompt:
        'creator reviewing an AI writing workflow on a laptop dashboard',
    },
    {
      index: 2,
      narration:
        'Jubily keeps the offer, audience, proof, and CTA together so every video feels focused.',
      caption: 'Keep the context together',
      duration: 8,
      visualPrompt: 'product screen showing organized affiliate video plan',
    },
  ];

  it('splits long scenes into short-form visual beats', () => {
    const plan = buildStandardRenderScenes(scenes, {
      offerName: 'Jubily',
      platform: 'YOUTUBE_SHORTS',
    });

    expect(plan.mode).toBe('STANDARD');
    expect(plan.scenes.length).toBeGreaterThan(scenes.length);
    expect(
      plan.scenes.every(
        (scene) => scene.duration >= 2.5 && scene.duration <= 5,
      ),
    ).toBe(true);
    expect(plan.diagnostics.averageSceneDuration).toBeLessThanOrEqual(5);
  });

  it('keeps visual compositions varied across consecutive scenes', () => {
    const plan = buildStandardRenderScenes(scenes);
    const shotTypes = plan.scenes.map((scene) => scene.shotType);

    for (let i = 1; i < shotTypes.length; i++) {
      expect(shotTypes[i]).not.toBe(shotTypes[i - 1]);
    }
  });

  it('prefers supplied product media before AI image fallback', () => {
    const plan = buildStandardRenderScenes(scenes, {
      productMediaUrls: ['https://cdn.example.com/product.jpg'],
    });

    expect(plan.diagnostics.suppliedMediaCount).toBeGreaterThan(0);
    expect(plan.scenes[0].suppliedMediaUrl).toBe(
      'https://cdn.example.com/product.jpg',
    );
  });

  it('falls back to AI image prompts when no supplied media exists', () => {
    const plan = buildStandardRenderScenes(scenes);

    expect(plan.diagnostics.aiImageCount).toBe(plan.scenes.length);
    expect(plan.scenes[0].visualPrompt).toContain('vertical 9:16');
    expect(plan.scenes[0].visualPrompt).toContain('no random dashboards');
  });

  it('resolves platform-aware CTAs', () => {
    expect(resolvePlatformCta('YOUTUBE', 'SHORT').text).toBe(
      'Find the full link in the channel links',
    );
    expect(resolvePlatformCta('YOUTUBE').text).toBe('Link in the description');
    expect(resolvePlatformCta('TIKTOK').text).toBe('Link in bio');
    expect(resolvePlatformCta('INSTAGRAM').text).toBe('Link in bio');
  });

  it('detects contradictory briefs with unrelated categories', () => {
    const result = detectContradictoryBrief({
      topic: 'Fitness routine for busy parents',
      offerName: 'AI SaaS content automation dashboard',
      contentGoal: 'promote a software workflow',
    });

    expect(result.hasContradiction).toBe(true);
    expect(result.message).toContain('fitness + aiSoftware');
  });

  it('creates meaningful two-line caption chunks', () => {
    const chunks = buildModernCaptionChunks(
      'Jubily keeps your offer, audience, proof, and CTA together.',
      0,
      4,
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.lines.length <= 2)).toBe(true);
    expect(chunks.map((chunk) => chunk.lines.join(' ')).join(' ')).toContain(
      'offer, audience, proof',
    );
  });

  it('varies motion and restrained transitions deterministically', () => {
    expect(motionEffectForScene(0)).not.toBe(motionEffectForScene(1));
    expect(transitionForScene(0, 5)).toBeUndefined();
    expect(transitionForScene(2, 5)).toBeDefined();
  });

  it('validates complete sequential timelines', () => {
    const valid = validateStandardTimeline({
      imageClips: [
        {
          asset: { type: 'image', src: 'https://cdn.example.com/1.jpg' },
          start: 0,
          length: 3,
        },
        {
          asset: { type: 'image', src: 'https://cdn.example.com/2.jpg' },
          start: 3,
          length: 3,
        },
      ],
      subtitleClips: [{ start: 0, length: 2 }],
      renderEnd: 6,
      hasCtaOutro: true,
    });

    expect(valid.valid).toBe(true);

    const invalid = validateStandardTimeline({
      imageClips: [
        { asset: { type: 'image', src: 'not-a-url' }, start: -1, length: 0 },
        {
          asset: { type: 'image', src: 'https://cdn.example.com/2.jpg' },
          start: 5,
          length: 1,
        },
      ],
      subtitleClips: [{ start: 7, length: 2 }],
      renderEnd: 8,
      hasCtaOutro: false,
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'NEGATIVE_START',
        'INVALID_DURATION',
        'INVALID_ASSET_URL',
        'GAP_OR_OVERLAP',
        'CTA_OUTRO_MISSING',
      ]),
    );
  });

  it('accepts hybrid image and muted video visual clips in validation', () => {
    const result = validateStandardTimeline({
      imageClips: [
        {
          asset: { type: 'image', src: 'https://cdn.example.com/1.jpg' },
          start: 0,
          length: 3,
        },
        {
          asset: { type: 'video', src: 'https://cdn.example.com/motion.mp4' },
          start: 3,
          length: 3,
        },
      ],
      subtitleClips: [{ start: 0, length: 2 }],
      renderEnd: 6,
      hasCtaOutro: true,
    });

    expect(result.valid).toBe(true);
  });
});
