import { BadRequestException, ConflictException } from '@nestjs/common';
import { VideosService } from './videos.service';
import { ShotstackProviderError } from './shotstack.service';

describe('VideosService quality gate', () => {
  let prisma: {
    script: { findUnique: jest.Mock };
    offer: { findUnique: jest.Mock };
    videoJob: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    topic: { updateMany: jest.Mock };
    workspace: { findUnique: jest.Mock };
  };
  let shotstack: { renderVideo: jest.Mock };
  let billing: {
    consumeVideoGeneration: jest.Mock;
    consumePublish: jest.Mock;
    incrementUsage: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let youtube: { getWorkspaceChannelDiagnostics: jest.Mock };
  let socialAccounts: { listAccounts: jest.Mock; publish: jest.Mock };
  let aiMotionEligibility: { assertEligible: jest.Mock };
  let aiMotionOrchestrator: { prepareJob: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    prisma = {
      script: { findUnique: jest.fn() },
      offer: { findUnique: jest.fn() },
      videoJob: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      topic: { updateMany: jest.fn() },
      workspace: { findUnique: jest.fn() },
    };
    shotstack = { renderVideo: jest.fn() };
    billing = {
      consumeVideoGeneration: jest.fn().mockResolvedValue(undefined),
      consumePublish: jest.fn().mockResolvedValue(undefined),
      incrementUsage: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue(null) };
    youtube = {
      getWorkspaceChannelDiagnostics: jest
        .fn()
        .mockResolvedValue({ connected: true }),
    };
    socialAccounts = {
      listAccounts: jest
        .fn()
        .mockResolvedValue([{ provider: 'TIKTOK', status: 'CONNECTED' }]),
      publish: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'TikTok publishing is not enabled yet. App review approval is required.',
          ),
        ),
    };
    aiMotionEligibility = { assertEligible: jest.fn() };
    aiMotionOrchestrator = {
      prepareJob: jest.fn().mockResolvedValue(null),
    };
    service = new VideosService(
      prisma as never,
      shotstack as never,
      billing as never,
      audit as never,
      youtube as never,
      socialAccounts as never,
      aiMotionEligibility as never,
      aiMotionOrchestrator as never,
    );
  });

  it('blocks rejected scripts before creating an inline render job', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      reviewStatus: 'REJECTED',
    });

    await expect(
      service.createVideoJob(
        'script-1',
        undefined,
        'MORNING',
        new Date('2026-05-31T09:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.videoJob.create).not.toHaveBeenCalled();
    expect(shotstack.renderVideo).not.toHaveBeenCalled();
  });

  it('blocks needs-review scripts before starting a render', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      workspaceId: null,
      renderId: null,
      script: {
        id: 'script-1',
        content: JSON.stringify({
          scenes: [
            {
              narration: 'Do this habit today',
              caption: 'Do this habit',
              seconds: 5,
            },
          ],
        }),
        topicId: 'topic-1',
        reviewStatus: 'NEEDS_REVIEW',
      },
    });

    await expect(
      service.startRenderForJob('job-1', 'worker-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(shotstack.renderVideo).not.toHaveBeenCalled();
    expect(prisma.videoJob.updateMany).not.toHaveBeenCalled();
  });

  it('allows approved scripts to start render normally', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      workspaceId: null,
      renderId: null,
      script: {
        id: 'script-1',
        content: JSON.stringify({
          scenes: [
            {
              narration: 'Do this habit today',
              caption: 'Do this habit',
              seconds: 5,
            },
          ],
        }),
        topicId: 'topic-1',
        reviewStatus: 'APPROVED',
      },
    });
    shotstack.renderVideo.mockResolvedValue({
      renderId: 'render-1',
      durationSeconds: 75,
      sceneCount: 1,
      hasBurnedSubtitles: true,
      shotstackPayloadDebugPath: null,
    });
    prisma.videoJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.topic.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.startRenderForJob('job-1', 'worker-1'),
    ).resolves.toEqual({
      jobId: 'job-1',
      renderId: 'render-1',
      qa: {
        durationSeconds: 75,
        sceneCount: 1,
        hasBurnedSubtitles: true,
        shotstackPayloadDebugPath: null,
      },
    });

    expect(shotstack.renderVideo).toHaveBeenCalledWith(
      expect.any(Array),
      'job-1',
    );
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        renderId: null,
        workerLockedBy: 'worker-1',
      },
      data: expect.objectContaining({
        renderId: 'render-1',
        durationSeconds: 75,
        sceneCount: 1,
        hasBurnedSubtitles: true,
        shotstackPayloadDebugPath: null,
      }),
    });
    expect(billing.consumeVideoGeneration).not.toHaveBeenCalled();
    expect(billing.incrementUsage).not.toHaveBeenCalled();
  });

  it('enforces and increments workspace video generation usage when rendering workspace jobs', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      workspaceId: 'workspace-1',
      renderId: null,
      script: {
        id: 'script-1',
        content: JSON.stringify({
          scenes: [
            {
              narration: 'Do this habit today',
              caption: 'Do this habit',
              seconds: 5,
            },
          ],
        }),
        topicId: 'topic-1',
        reviewStatus: 'APPROVED',
      },
    });
    shotstack.renderVideo.mockResolvedValue({
      renderId: 'render-1',
      durationSeconds: 75,
      sceneCount: 1,
      hasBurnedSubtitles: true,
      shotstackPayloadDebugPath: null,
    });
    prisma.videoJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.topic.updateMany.mockResolvedValue({ count: 1 });

    await service.startRenderForJob('job-1', 'worker-1');

    expect(billing.consumeVideoGeneration).toHaveBeenCalledWith('workspace-1');
    expect(billing.incrementUsage).toHaveBeenCalledWith('workspace-1', {
      renderMinutes: 1.25,
    });
  });

  it('does not double-count usage when a render already has a render id', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      workspaceId: 'workspace-1',
      renderId: 'render-existing',
      script: {
        id: 'script-1',
        content: JSON.stringify({
          scenes: [{ narration: 'Done', caption: 'Done', seconds: 5 }],
        }),
        topicId: 'topic-1',
        reviewStatus: 'APPROVED',
      },
    });

    await expect(
      service.startRenderForJob('job-1', 'worker-1'),
    ).resolves.toEqual({
      jobId: 'job-1',
      renderId: 'render-existing',
      resumed: true,
    });

    expect(billing.consumeVideoGeneration).not.toHaveBeenCalled();
    expect(billing.incrementUsage).not.toHaveBeenCalled();
    expect(shotstack.renderVideo).not.toHaveBeenCalled();
  });

  it('returns a clear frontend error when Shotstack rejects an invalid payload', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-1',
      reviewStatus: 'APPROVED',
    });
    prisma.videoJob.create.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
    });
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      workspaceId: 'workspace-1',
      renderId: null,
      script: {
        id: 'script-1',
        content: JSON.stringify({
          scenes: [{ narration: 'Done', caption: 'Done', seconds: 5 }],
        }),
        topicId: 'topic-1',
        reviewStatus: 'APPROVED',
      },
    });
    prisma.videoJob.update.mockResolvedValue({ id: 'job-1' });
    shotstack.renderVideo.mockRejectedValue(
      new ShotstackProviderError(
        'Video render failed because the render payload was invalid.',
        {
          statusCode: 400,
          requestId: 'req-1',
          validationMessages: ['Validation failed for timeline.'],
        },
      ),
    );

    await expect(
      service.createVideoJob(
        'script-1',
        undefined,
        'MORNING',
        new Date('2026-05-31T09:00:00.000Z'),
        'workspace-1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'Video render failed because the render payload was invalid.',
        provider: 'shotstack',
        providerError: {
          statusCode: 400,
          requestId: 'req-1',
          validationMessages: ['Validation failed for timeline.'],
        },
      }),
    });
    expect(prisma.videoJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          error: 'Video render failed because the render payload was invalid.',
        }),
      }),
    );
  });

  it('creates video jobs only for scripts and offers in the active workspace', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-1',
      reviewStatus: 'APPROVED',
    });
    prisma.offer.findUnique.mockResolvedValue({
      id: 'offer-1',
      workspaceId: 'workspace-1',
    });
    prisma.videoJob.create.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
    });
    jest.spyOn(service, 'startRenderForJob').mockResolvedValue({
      jobId: 'job-1',
      renderId: 'render-1',
      qa: {
        durationSeconds: 75,
        sceneCount: 8,
        hasBurnedSubtitles: true,
        shotstackPayloadDebugPath: null,
      },
    });

    await service.createVideoJob(
      'script-1',
      'offer-1',
      'MORNING',
      new Date('2026-05-31T09:00:00.000Z'),
      'workspace-1',
    );

    expect(prisma.videoJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scriptId: 'script-1',
        offerId: 'offer-1',
        workspaceId: 'workspace-1',
      }),
    });

    prisma.script.findUnique.mockResolvedValue({
      id: 'script-2',
      workspaceId: 'workspace-2',
      reviewStatus: 'APPROVED',
    });

    await expect(
      service.createVideoJob(
        'script-2',
        undefined,
        'MORNING',
        new Date('2026-05-31T09:00:00.000Z'),
        'workspace-1',
      ),
    ).rejects.toThrow('Script not found');
  });

  it('returns customer-safe status with tracking URL', async () => {
    process.env.PUBLIC_API_BASE_URL = 'https://api.jubily.test';
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
      offerId: 'offer-1',
      status: 'COMPLETED',
      provider: 'shotstack',
      videoUrl: 'https://cdn.example.com/video.mp4',
      youtubeVideoId: 'youtube-1',
      renderId: 'render-1',
      error: null,
      youtubeUrl: 'https://www.youtube.com/watch?v=youtube-1',
      slot: 'MORNING',
      scheduledFor: new Date('2026-05-31T09:00:00.000Z'),
      published: true,
      attempts: 0,
      createdAt: new Date('2026-05-31T09:00:00.000Z'),
      videoSrt: '1\n00:00:00,000 --> 00:00:01,000\nHi',
      offer: { id: 'offer-1', name: 'Offer' },
      script: { id: 'script-1', topic: { id: 'topic-1', title: 'Topic' } },
    });

    await expect(
      service.getVideoStatus('job-1', 'workspace-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'job-1',
        renderStatus: 'READY',
        progress: 100,
        trackingUrl:
          'https://api.jubily.test/r/offer-1?jobId=job-1&yt=youtube-1',
      }),
    );
  });

  it('lets a customer start render for their own approved workspace script and returns a safe response', async () => {
    process.env.PUBLIC_API_BASE_URL = 'https://api.jubily.test';
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-1',
      reviewStatus: 'APPROVED',
    });
    prisma.offer.findUnique.mockResolvedValue({
      id: 'offer-1',
      workspaceId: 'workspace-1',
    });
    prisma.videoJob.create.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
    });
    jest.spyOn(service, 'startRenderForJob').mockResolvedValue({
      jobId: 'job-1',
      renderId: 'render-1',
      qa: {
        durationSeconds: 75,
        sceneCount: 8,
        hasBurnedSubtitles: true,
        shotstackPayloadDebugPath: null,
      },
    });
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
      offerId: 'offer-1',
      status: 'PROCESSING',
      provider: 'shotstack',
      videoUrl: null,
      youtubeVideoId: null,
      renderId: 'render-1',
      error: null,
      youtubeUrl: null,
      slot: 'MORNING',
      scheduledFor: new Date('2026-05-31T09:00:00.000Z'),
      published: false,
      attempts: 0,
      createdAt: new Date('2026-05-31T09:00:00.000Z'),
      videoSrt: null,
      offer: { id: 'offer-1', name: 'Offer' },
      script: { id: 'script-1', topic: { id: 'topic-1', title: 'Topic' } },
    });

    await expect(
      service.createCustomerVideo(
        'script-1',
        {
          offerId: 'offer-1',
          slot: 'MORNING',
          scheduledFor: '2026-05-31T09:00:00.000Z',
        },
        'workspace-1',
      ),
    ).resolves.toEqual({
      videoId: 'job-1',
      scriptId: 'script-1',
      generationMode: 'STANDARD',
      status: 'PROCESSING',
      renderStatus: 'PROCESSING',
      progress: 60,
      trackingUrl: 'https://api.jubily.test/r/offer-1?jobId=job-1',
      message: 'Render started',
    });

    expect(prisma.videoJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scriptId: 'script-1',
        workspaceId: 'workspace-1',
        offerId: 'offer-1',
        generationMode: 'STANDARD',
        motionPlanningStatus: 'NOT_REQUIRED',
      }),
    });
  });

  it('rejects AI Motion before job creation when eligibility fails', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-1',
      reviewStatus: 'APPROVED',
      content:
        '{"scenes":[{"narration":"Show the product demo","caption":"Demo","visualPrompt":"product demo","seconds":4}]}',
    });
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'workspace-1',
      suspended: false,
    });
    aiMotionEligibility.assertEligible.mockImplementation(() => {
      throw new BadRequestException({
        message: 'AI Motion is not available yet.',
        code: 'AI_MOTION_DISABLED',
      });
    });

    await expect(
      service.createCustomerVideo(
        'script-1',
        { generationMode: 'AI_MOTION' },
        'workspace-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.videoJob.create).not.toHaveBeenCalled();
    expect(aiMotionOrchestrator.prepareJob).not.toHaveBeenCalled();
  });

  it('stores AI Motion planning metadata and prepares the job before Standard fallback render', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-1',
      reviewStatus: 'APPROVED',
      content:
        '{"scenes":[{"narration":"Show the product demo","caption":"Demo","visualPrompt":"product demo","seconds":4}]}',
    });
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'workspace-1',
      suspended: false,
    });
    prisma.videoJob.create.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
      offerId: null,
    });
    jest.spyOn(service, 'startRenderForJob').mockResolvedValue({
      jobId: 'job-1',
      renderId: 'render-1',
      qa: {
        durationSeconds: 4,
        sceneCount: 1,
        hasBurnedSubtitles: true,
        shotstackPayloadDebugPath: null,
      },
    });
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
      offerId: null,
      status: 'PROCESSING',
      provider: 'shotstack',
      videoUrl: null,
      youtubeVideoId: null,
      renderId: 'render-1',
      error: null,
      youtubeUrl: null,
      slot: 'MORNING',
      scheduledFor: new Date('2026-05-31T09:00:00.000Z'),
      published: false,
      attempts: 0,
      createdAt: new Date('2026-05-31T09:00:00.000Z'),
      videoSrt: null,
      generationMode: 'AI_MOTION',
      motionPlanningStatus: 'PLANNED',
      plannedMotionSceneCount: 1,
      estimatedMotionCredits: 4,
      motionEstimateFinal: false,
      motionFallbackPolicy: 'FALLBACK_TO_STANDARD',
      completedMotionSceneCount: 0,
      fallbackMotionSceneCount: 0,
      motionPlannerVersion: 'ai-motion-planner-v1',
      offer: null,
      script: { id: 'script-1', topic: { id: 'topic-1', title: 'Topic' } },
    });

    await expect(
      service.createCustomerVideo(
        'script-1',
        { generationMode: 'AI_MOTION' },
        'workspace-1',
      ),
    ).resolves.toMatchObject({
      videoId: 'job-1',
      generationMode: 'AI_MOTION',
      motion: {
        planningStatus: 'PLANNED',
        plannedSceneCount: 1,
        estimatedCredits: 4,
        estimateFinal: false,
      },
    });

    expect(aiMotionEligibility.assertEligible).toHaveBeenCalled();
    expect(prisma.videoJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        generationMode: 'AI_MOTION',
        motionPlanningStatus: 'PENDING',
      }),
    });
    expect(aiMotionOrchestrator.prepareJob).toHaveBeenCalledWith('job-1');
  });

  it('does not expose worker or render internals in the customer render response', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-1',
      reviewStatus: 'APPROVED',
    });
    prisma.videoJob.create.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
    });
    jest.spyOn(service, 'startRenderForJob').mockResolvedValue({
      jobId: 'job-1',
      renderId: 'render-secret',
      qa: {
        durationSeconds: 75,
        sceneCount: 8,
        hasBurnedSubtitles: true,
        shotstackPayloadDebugPath: 'tmp/secret.json',
      },
    });
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
      offerId: null,
      status: 'PROCESSING',
      provider: 'shotstack',
      videoUrl: null,
      youtubeVideoId: null,
      renderId: 'render-secret',
      error: null,
      youtubeUrl: null,
      slot: 'MORNING',
      scheduledFor: new Date('2026-05-31T09:00:00.000Z'),
      published: false,
      attempts: 0,
      createdAt: new Date('2026-05-31T09:00:00.000Z'),
      videoSrt: null,
      offer: null,
      script: { id: 'script-1', topic: { id: 'topic-1', title: 'Topic' } },
    });

    const response = await service.createCustomerVideo(
      'script-1',
      {},
      'workspace-1',
    );

    expect(response).toEqual({
      videoId: 'job-1',
      scriptId: 'script-1',
      generationMode: 'STANDARD',
      status: 'PROCESSING',
      renderStatus: 'PROCESSING',
      progress: 60,
      trackingUrl: null,
      message: 'Render started',
    });
    expect(response).not.toHaveProperty('renderId');
    expect(response).not.toHaveProperty('worker');
    expect(response).not.toHaveProperty('qa');
  });

  it('rejects customer render for another workspace script', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-2',
      reviewStatus: 'APPROVED',
    });

    await expect(
      service.createCustomerVideo('script-1', {}, 'workspace-1'),
    ).rejects.toThrow('Script not found');

    expect(prisma.videoJob.create).not.toHaveBeenCalled();
    expect(shotstack.renderVideo).not.toHaveBeenCalled();
  });

  it('rejects customer render for unapproved scripts', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-1',
      reviewStatus: 'NEEDS_REVIEW',
    });

    await expect(
      service.createCustomerVideo('script-1', {}, 'workspace-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.videoJob.create).not.toHaveBeenCalled();
    expect(shotstack.renderVideo).not.toHaveBeenCalled();
  });

  it('enforces quota before calling the render provider for customer renders', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      workspaceId: 'workspace-1',
      reviewStatus: 'APPROVED',
    });
    prisma.videoJob.create.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
    });
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      workspaceId: 'workspace-1',
      renderId: null,
      script: {
        id: 'script-1',
        content: JSON.stringify({
          scenes: [
            {
              narration: 'Do this habit today',
              caption: 'Do this habit',
              seconds: 5,
            },
          ],
        }),
        topicId: 'topic-1',
        reviewStatus: 'APPROVED',
      },
    });
    billing.consumeVideoGeneration.mockRejectedValue(
      new ConflictException('Video generation limit reached for FREE plan'),
    );

    await expect(
      service.createCustomerVideo('script-1', {}, 'workspace-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(billing.consumeVideoGeneration).toHaveBeenCalledWith('workspace-1');
    expect(shotstack.renderVideo).not.toHaveBeenCalled();
    expect(prisma.videoJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        error: 'Video generation limit reached for FREE plan',
      }),
    });
  });

  it('queues completed workspace jobs for publishing after YouTube validation', async () => {
    prisma.videoJob.findUnique.mockResolvedValueOnce({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
      offerId: 'offer-1',
      status: 'COMPLETED',
      provider: 'shotstack',
      videoUrl: 'https://cdn.example.com/video.mp4',
      youtubeVideoId: null,
      renderId: 'render-1',
      error: null,
      youtubeUrl: null,
      slot: 'MORNING',
      scheduledFor: new Date('2026-05-31T09:00:00.000Z'),
      published: false,
      attempts: 0,
      createdAt: new Date('2026-05-31T09:00:00.000Z'),
      offer: { id: 'offer-1', name: 'Offer' },
      script: {
        id: 'script-1',
        reviewStatus: 'APPROVED',
        topic: { id: 'topic-1', title: 'Topic' },
      },
    });
    prisma.videoJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.videoJob.findUnique.mockResolvedValueOnce({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
      offerId: 'offer-1',
      status: 'COMPLETED',
      provider: 'shotstack',
      videoUrl: 'https://cdn.example.com/video.mp4',
      youtubeVideoId: null,
      renderId: 'render-1',
      error: null,
      youtubeUrl: null,
      slot: 'MORNING',
      scheduledFor: new Date('2026-05-31T09:00:00.000Z'),
      published: false,
      attempts: 0,
      createdAt: new Date('2026-05-31T09:00:00.000Z'),
      offer: { id: 'offer-1', name: 'Offer' },
      script: {
        id: 'script-1',
        reviewStatus: 'APPROVED',
        topic: { id: 'topic-1', title: 'Topic' },
      },
    });

    await expect(service.publishVideo('job-1', 'workspace-1')).resolves.toEqual(
      expect.objectContaining({ queued: true, status: 'QUEUED_FOR_PUBLISH' }),
    );
    expect(youtube.getWorkspaceChannelDiagnostics).toHaveBeenCalledWith(
      'workspace-1',
    );
    expect(billing.consumePublish).toHaveBeenCalledWith('workspace-1');
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        workspaceId: 'workspace-1',
        published: false,
        status: 'COMPLETED',
        renderId: { not: null },
        workerStage: null,
      },
      data: {
        error: null,
        publishTarget: 'YOUTUBE',
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: 'PUBLISH_QUEUED',
      },
    });
  });

  it('queues connected social provider jobs without publishing during the request', async () => {
    prisma.videoJob.findUnique.mockResolvedValueOnce({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
      offerId: null,
      status: 'COMPLETED',
      provider: 'shotstack',
      videoUrl: 'https://cdn.example.com/video.mp4',
      youtubeVideoId: null,
      renderId: 'render-1',
      error: null,
      youtubeUrl: null,
      slot: 'MORNING',
      scheduledFor: new Date('2026-05-31T09:00:00.000Z'),
      published: false,
      attempts: 0,
      createdAt: new Date('2026-05-31T09:00:00.000Z'),
      offer: null,
      script: {
        id: 'script-1',
        reviewStatus: 'APPROVED',
        topic: { id: 'topic-1', title: 'Topic' },
      },
    });
    prisma.videoJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.videoJob.findUnique.mockResolvedValueOnce({
      id: 'job-1',
      scriptId: 'script-1',
      workspaceId: 'workspace-1',
      offerId: null,
      status: 'COMPLETED',
      provider: 'shotstack',
      videoUrl: 'https://cdn.example.com/video.mp4',
      youtubeVideoId: null,
      renderId: 'render-1',
      error: null,
      youtubeUrl: null,
      slot: 'MORNING',
      scheduledFor: new Date('2026-05-31T09:00:00.000Z'),
      published: false,
      attempts: 0,
      createdAt: new Date('2026-05-31T09:00:00.000Z'),
      offer: null,
      script: {
        id: 'script-1',
        reviewStatus: 'APPROVED',
        topic: { id: 'topic-1', title: 'Topic' },
      },
    });

    await expect(
      service.publishVideo('job-1', 'workspace-1', { target: 'TIKTOK' }),
    ).resolves.toEqual(
      expect.objectContaining({ queued: true, status: 'QUEUED_FOR_PUBLISH' }),
    );
    expect(socialAccounts.listAccounts).toHaveBeenCalledWith('workspace-1');
    expect(socialAccounts.publish).not.toHaveBeenCalled();
    expect(youtube.getWorkspaceChannelDiagnostics).not.toHaveBeenCalled();
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publishTarget: 'TIKTOK',
          workerStage: 'PUBLISH_QUEUED',
        }),
      }),
    );
  });
});
