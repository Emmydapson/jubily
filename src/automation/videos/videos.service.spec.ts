import { ConflictException } from '@nestjs/common';
import { VideosService } from './videos.service';

describe('VideosService quality gate', () => {
  let prisma: {
    script: { findUnique: jest.Mock };
    videoJob: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    topic: { updateMany: jest.Mock };
  };
  let shotstack: { renderVideo: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    prisma = {
      script: { findUnique: jest.fn() },
      videoJob: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      topic: { updateMany: jest.fn() },
    };
    shotstack = { renderVideo: jest.fn() };
    service = new VideosService(prisma as never, shotstack as never);
  });

  it('blocks rejected scripts before creating an inline render job', async () => {
    prisma.script.findUnique.mockResolvedValue({ id: 'script-1', reviewStatus: 'REJECTED' });

    await expect(
      service.createVideoJob('script-1', undefined, 'MORNING', new Date('2026-05-31T09:00:00.000Z')),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.videoJob.create).not.toHaveBeenCalled();
    expect(shotstack.renderVideo).not.toHaveBeenCalled();
  });

  it('blocks needs-review scripts before starting a render', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      renderId: null,
      script: {
        id: 'script-1',
        content: JSON.stringify({
          scenes: [{ narration: 'Do this habit today', caption: 'Do this habit', seconds: 5 }],
        }),
        topicId: 'topic-1',
        reviewStatus: 'NEEDS_REVIEW',
      },
    });

    await expect(service.startRenderForJob('job-1', 'worker-1')).rejects.toBeInstanceOf(ConflictException);

    expect(shotstack.renderVideo).not.toHaveBeenCalled();
    expect(prisma.videoJob.updateMany).not.toHaveBeenCalled();
  });

  it('allows approved scripts to start render normally', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      renderId: null,
      script: {
        id: 'script-1',
        content: JSON.stringify({
          scenes: [{ narration: 'Do this habit today', caption: 'Do this habit', seconds: 5 }],
        }),
        topicId: 'topic-1',
        reviewStatus: 'APPROVED',
      },
    });
    shotstack.renderVideo.mockResolvedValue('render-1');
    prisma.videoJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.topic.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.startRenderForJob('job-1', 'worker-1')).resolves.toEqual({
      jobId: 'job-1',
      renderId: 'render-1',
    });

    expect(shotstack.renderVideo).toHaveBeenCalledWith(expect.any(Array), 'job-1');
  });
});
