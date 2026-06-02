import { OrchestratorService, topicToNicheCandidates } from './orchestrator.service';
import { VideoJobStatus } from './video-job-status';

describe('topicToNicheCandidates', () => {
  it.each([
    ['sleep better through insomnia habits', ['sleep']],
    ['weight loss diet fat burn routine', ['weight-loss']],
    ['morning energy and fatigue reset', ['energy']],
    ['stress anxiety calm breathing', ['stress']],
    ['gut digestion bloat support', ['gut-health']],
    ['brain focus concentration tips', ['focus', 'memory']],
    ['fitness workout strength body tone', ['fitness']],
    ['hormonal menopause cycle balance', ['hormones']],
    ['memory recall concentration training', ['focus', 'memory']],
    ['male prostate testosterone urinary health', ['mens-health']],
    ['teeth gum oral breath support', ['dental-health']],
    ['joint knee pain mobility cartilage', ['joint-health']],
    ['hearing tinnitus ear sound support', ['hearing-health']],
  ])('maps "%s" to expected niches', (title, expected) => {
    expect(topicToNicheCandidates(title)).toEqual(expect.arrayContaining(expected));
  });

  it('returns unique niche matches', () => {
    expect(topicToNicheCandidates('memory memory recall')).toEqual(['focus', 'memory']);
  });
});

describe('OrchestratorService force slot rerun', () => {
  function makeService(existing: { id: string; status: string } | null) {
    const prisma = {
      videoJob: {
        findUnique: jest.fn().mockResolvedValue(existing),
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

    expect(prisma.videoJob.findUnique).toHaveBeenCalledWith({
      where: { slot_scheduledFor: { slot: 'MORNING', scheduledFor: new Date('2026-06-02T09:00:00.000Z') } },
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
});
