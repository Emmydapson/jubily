import { BadRequestException } from '@nestjs/common';
import { AiMotionCreditEstimatorService } from './ai-motion-credit-estimator.service';
import { AiMotionEligibilityService } from './ai-motion-eligibility.service';
import { FakeAiMotionProvider } from './fake-ai-motion.provider';
import { MotionPromptBuilder } from './motion-prompt.builder';
import {
  AI_MOTION_PLANNER_VERSION,
  MotionScenePlannerService,
} from './motion-scene-planner.service';
import { Scene } from './interfaces/scene.interface';

describe('AI Motion foundation services', () => {
  const originalEnv = process.env;
  const scenes: Scene[] = [
    {
      index: 1,
      narration:
        'Hook the viewer by showing the product solving a painful workflow.',
      caption: 'Stop wasting time',
      duration: 4,
      visualPrompt: 'creator opens the product and fixes a workflow',
    },
    {
      index: 2,
      narration: 'Show a dashboard screenshot with exact text labels.',
      caption: 'Dashboard proof',
      duration: 4,
      visualPrompt: 'text-heavy dashboard screenshot',
    },
    {
      index: 3,
      narration: 'Show the product result after the automation is complete.',
      caption: 'See the result',
      duration: 4,
      visualPrompt: 'happy creator reviewing finished video output',
    },
    {
      index: 4,
      narration: 'Find the link in the profile.',
      caption: 'Link in profile',
      duration: 3,
      visualPrompt: 'cta card with logo',
    },
  ];

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      AI_MOTION_ENABLED: 'true',
      AI_MOTION_PROVIDER: 'fake',
      AI_MOTION_FAKE_CREDITS_PER_SECOND: '2',
      AI_MOTION_FAKE_BASE_CREDITS: '1',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects AI Motion when the feature flag is disabled', () => {
    process.env.AI_MOTION_ENABLED = 'false';
    const service = new AiMotionEligibilityService();

    expect(() =>
      service.assertEligible({
        workspace: { id: 'workspace-1', suspended: false },
        scenes,
        targetDurationSeconds: 15,
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts AI Motion when enabled and basic inputs are valid', () => {
    const service = new AiMotionEligibilityService();

    expect(
      service.validateAiMotionEligibility({
        workspace: { id: 'workspace-1', suspended: false },
        scenes,
        targetDurationSeconds: 15,
      }),
    ).toMatchObject({ eligible: true, code: 'ELIGIBLE' });
  });

  it('builds bounded provider-neutral prompts without affiliate URLs', () => {
    const prompt = new MotionPromptBuilder().build({
      scene: {
        ...scenes[0],
        narration: `${scenes[0].narration} https://affiliate.example/secret`,
      },
      platform: 'YOUTUBE',
      offerName: 'Jubily',
    });

    expect(prompt.aspectRatio).toBe('9:16');
    expect(prompt.action).not.toContain('https://affiliate.example');
    expect(prompt.negativeConstraints).toContain('no affiliate URLs');
  });

  it('plans deterministic capped motion scenes and excludes CTA/screenshots', () => {
    const planner = new MotionScenePlannerService(new MotionPromptBuilder());
    const first = planner.plan({
      scenes,
      targetDurationSeconds: 30,
      platform: 'YOUTUBE',
      offerName: 'Jubily',
    });
    const second = planner.plan({
      scenes,
      targetDurationSeconds: 30,
      platform: 'YOUTUBE',
      offerName: 'Jubily',
    });

    expect(first).toEqual(second);
    expect(first.planningVersion).toBe(AI_MOTION_PLANNER_VERSION);
    expect(first.selectedScenes.length).toBeLessThanOrEqual(2);
    expect(first.selectedScenes[0].sceneIndex).toBe(1);
    expect(first.selectedScenes.map((scene) => scene.sceneIndex)).not.toContain(
      4,
    );
    expect(first.rejectedScenes.map((scene) => scene.sceneIndex)).toEqual(
      expect.arrayContaining([2, 4]),
    );
  });

  it('estimates fake credits deterministically without marking them final', () => {
    const planner = new MotionScenePlannerService(new MotionPromptBuilder());
    const plan = planner.plan({
      scenes,
      targetDurationSeconds: 30,
      platform: 'YOUTUBE',
    });
    const estimate = new AiMotionCreditEstimatorService().estimate(plan);

    expect(estimate.totalCredits).toBe(
      Math.ceil(1 + estimate.totalMotionSeconds * 2),
    );
    expect(estimate.motionSceneCount).toBe(plan.selectedScenes.length);
    expect(estimate.isFinal).toBe(false);
    expect(estimate.pricingVersion).toContain('fake-motion-pricing-v1');
  });

  it('fake provider is deterministic, idempotent, and makes no network calls', async () => {
    process.env.AI_MOTION_FAKE_PROVIDER_ENABLED = 'true';
    const provider = new FakeAiMotionProvider();
    const input = {
      idempotencyKey: 'job-1:scene-1',
      prompt: new MotionPromptBuilder().build({
        scene: scenes[0],
        platform: 'YOUTUBE',
      }),
    };

    const first = await provider.createClip(input);
    const second = await provider.createClip(input);

    expect(first.providerJobId).toBe(second.providerJobId);
    expect(first.status).toBe('COMPLETED');
    await expect(
      provider.getClipStatus(first.providerJobId),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      clipUrl: first.clipUrl,
    });
  });

  it('fake provider refuses production execution', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AI_MOTION_FAKE_PROVIDER_ENABLED = 'true';
    const provider = new FakeAiMotionProvider();

    await expect(
      provider.createClip({
        idempotencyKey: 'job-1:scene-1',
        prompt: new MotionPromptBuilder().build({
          scene: scenes[0],
          platform: 'YOUTUBE',
        }),
      }),
    ).rejects.toThrow('cannot run in production');
  });
});
