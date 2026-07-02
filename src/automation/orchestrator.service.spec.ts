import { OrchestratorService, topicToNicheCandidates } from './orchestrator.service';
import { VideoJobStatus } from './video-job-status';

describe('topicToNicheCandidates', () => {
  it.each([
    ['sleep better through insomnia habits', ['HEALTH_WELLNESS']],
    ['budget app for new investors', ['FINANCE', 'AI_SOFTWARE']],
    ['ai software automation tool comparison', ['AI_SOFTWARE']],
    ['fitness workout strength body tone', ['FITNESS']],
    ['beauty skin routine product review', ['BEAUTY']],
    ['travel luggage deal for long flights', ['TRAVEL', 'ECOMMERCE']],
    ['gaming controller setup for streamers', ['GAMING']],
    ['home desk furniture buying guide', ['HOME_GARDEN']],
    ['business course training for new managers', ['BUSINESS', 'EDUCATION']],
    ['pet dog training product checklist', ['PETS', 'EDUCATION', 'ECOMMERCE']],
  ])('maps "%s" to expected niches', (title, expected) => {
    expect(topicToNicheCandidates(title)).toEqual(expect.arrayContaining(expected));
  });

  it('returns unique niche matches', () => {
    expect(topicToNicheCandidates('focus focus productivity')).toEqual(['PERSONAL_DEVELOPMENT']);
  });
});

describe('OrchestratorService force slot rerun', () => {
  function makeService(existing: { id: string; status: string } | null) {
    const prisma = {
      videoJob: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const videos = {
      startRenderForJob: jest.fn().mockResolvedValue({ jobId: existing?.id ?? 'job-1', renderId: 'render-1' }),
    };
    const settings = {
      getSettings: jest.fn().mockResolvedValue({ automationEnabled: true }),
    };

    const service = new OrchestratorService(
      prisma as never,
      {} as never,
      videos as never,
      settings as never,
    );

    return { service, prisma, videos };
  }

  it('force resets and reruns a failed existing slot job', async () => {
    const { service, prisma, videos } = makeService({
      id: 'job-1',
      status: VideoJobStatus.FailedPermanent,
    });

    await expect(
      service.runSlot('MORNING', new Date('2026-06-02T09:37:00.000Z'), { force: true }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        forced: true,
        reset: true,
        jobId: 'job-1',
        renderId: 'render-1',
      }),
    );

    expect(prisma.videoJob.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: null,
        slot: 'MORNING',
        scheduledFor: new Date('2026-06-02T09:00:00.000Z'),
      },
      select: { id: true, status: true },
    });
    expect(prisma.videoJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: VideoJobStatus.Pending,
        renderId: null,
        videoUrl: null,
        youtubeVideoId: null,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      }),
    });
    expect(videos.startRenderForJob).toHaveBeenCalledWith('job-1');
  });

  it('force does not duplicate successful or processing slot jobs', async () => {
    const { service, prisma, videos } = makeService({
      id: 'job-1',
      status: VideoJobStatus.Processing,
    });

    await expect(
      service.runSlot('MORNING', new Date('2026-06-02T09:00:00.000Z'), { force: true }),
    ).resolves.toEqual(
      expect.objectContaining({
        skipped: true,
        reason: 'already-exists-active-or-successful',
        jobId: 'job-1',
      }),
    );

    expect(prisma.videoJob.update).not.toHaveBeenCalled();
    expect(videos.startRenderForJob).not.toHaveBeenCalled();
  });

  it('scopes slot idempotency, topic selection, and offer selection to workspace', async () => {
    const prisma = {
      videoJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      topic: {
        findFirst: jest.fn().mockResolvedValue({ id: 'topic-1', title: 'Sleep support' }),
      },
      offer: {
        findMany: jest.fn().mockResolvedValue([{ id: 'offer-1', name: 'Offer', hoplink: 'https://example.com', nicheTag: 'HEALTH_WELLNESS', network: 'DIGISTORE24' }]),
      },
    };
    const automation = {
      generateScriptWithAiOffer: jest.fn().mockResolvedValue({ id: 'script-1' }),
    };
    const videos = {
      createVideoJob: jest.fn().mockResolvedValue({ jobId: 'job-1', renderId: 'render-1' }),
    };
    const settings = {
      getSettings: jest.fn().mockResolvedValue({ automationEnabled: true }),
    };

    const service = new OrchestratorService(
      prisma as never,
      automation as never,
      videos as never,
      settings as never,
    );

    await service.runSlot('MORNING', new Date('2026-06-02T09:00:00.000Z'), { workspaceId: 'workspace-1' });

    expect(prisma.videoJob.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        slot: 'MORNING',
        scheduledFor: new Date('2026-06-02T09:00:00.000Z'),
      },
      select: { id: true, status: true },
    });
    expect(prisma.topic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace-1' }),
      }),
    );
    expect(prisma.offer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace-1', active: true }),
      }),
    );
    expect(videos.createVideoJob).toHaveBeenCalledWith(
      'script-1',
      'offer-1',
      'MORNING',
      new Date('2026-06-02T09:00:00.000Z'),
      'workspace-1',
    );
  });
});
