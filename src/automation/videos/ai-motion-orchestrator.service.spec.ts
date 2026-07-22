import { AiMotionCreditEstimatorService } from './ai-motion-credit-estimator.service';
import { AiMotionEligibilityService } from './ai-motion-eligibility.service';
import { AiMotionOrchestratorService } from './ai-motion-orchestrator.service';
import { FakeAiMotionProvider } from './fake-ai-motion.provider';
import { MotionPromptBuilder } from './motion-prompt.builder';
import { MotionScenePlannerService } from './motion-scene-planner.service';

describe('AiMotionOrchestratorService', () => {
  const originalEnv = process.env;
  type UpsertCall = {
    create: {
      videoJobId: string;
      motionEligible: boolean;
      motionSelected: boolean;
      plannerVersion: string;
      generationStatus: string;
      idempotencyKey: string;
    };
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      AI_MOTION_ENABLED: 'true',
      AI_MOTION_PROVIDER: 'fake',
      AI_MOTION_FAKE_PROVIDER_ENABLED: 'false',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('persists an idempotent scene plan and non-final estimate without running a provider by default', async () => {
    const upsertMock = jest
      .fn<Promise<unknown>, [UpsertCall]>()
      .mockResolvedValue({});
    const tx = {
      videoJobMotionScene: { upsert: upsertMock },
      videoJob: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      videoJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job-1',
          workspaceId: 'workspace-1',
          scriptId: 'script-1',
          offerId: 'offer-1',
          generationMode: 'AI_MOTION',
          publishTarget: 'YOUTUBE',
          workspace: { id: 'workspace-1', suspended: false },
          offer: { id: 'offer-1', name: 'Jubily' },
          script: {
            id: 'script-1',
            content: JSON.stringify({
              scenes: [
                {
                  narration: 'Hook viewers with a product demo.',
                  caption: 'Start faster',
                  visualPrompt: 'creator using product demo',
                  seconds: 4,
                },
                {
                  narration: 'Use a logo CTA card.',
                  caption: 'Link in profile',
                  visualPrompt: 'logo cta card',
                  seconds: 3,
                },
              ],
            }),
          },
        }),
        update: jest.fn(),
      },
      videoJobMotionScene: { findMany: jest.fn() },
      $transaction: jest.fn((callback: (arg: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };
    const monitoring = {
      info: jest.fn().mockResolvedValue(null),
      warn: jest.fn().mockResolvedValue(null),
    };
    const service = new AiMotionOrchestratorService(
      prisma as never,
      new AiMotionEligibilityService(),
      new MotionScenePlannerService(new MotionPromptBuilder()),
      new AiMotionCreditEstimatorService(),
      new FakeAiMotionProvider(),
      monitoring as never,
    );

    await expect(service.prepareJob('job-1')).resolves.toMatchObject({
      estimate: { isFinal: false },
    });

    expect(tx.videoJobMotionScene.upsert).toHaveBeenCalledTimes(2);
    const firstUpsert = upsertMock.mock.calls[0][0];
    const selectedCreate = firstUpsert.create;
    expect(selectedCreate).toMatchObject({
      videoJobId: 'job-1',
      motionEligible: true,
      motionSelected: true,
      plannerVersion: 'ai-motion-planner-v1',
      generationStatus: 'PLANNED',
    });
    expect(selectedCreate.idempotencyKey).toHaveLength(64);
    const expectedMotionData: unknown = expect.objectContaining({
      motionPlanningStatus: 'PLANNED',
      plannedMotionSceneCount: 1,
      motionFallbackPolicy: 'FALLBACK_TO_STANDARD',
      motionPlannerVersion: 'ai-motion-planner-v1',
      motionEstimateFinal: false,
    });
    expect(tx.videoJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expectedMotionData,
    });
    expect(prisma.videoJobMotionScene.findMany).not.toHaveBeenCalled();
  });
});
