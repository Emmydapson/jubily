import { ConflictException } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { VideoJobStatus } from '../video-job-status';

describe('JobsService admin recovery controls', () => {
  let prisma: {
    videoJob: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let orchestrator: { runSlot: jest.Mock };
  let settings: { getSettings: jest.Mock };
  let service: JobsService;

  beforeEach(() => {
    prisma = {
      videoJob: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    orchestrator = { runSlot: jest.fn().mockResolvedValue({ ok: true }) };
    settings = {
      getSettings: jest.fn().mockResolvedValue({
        timezone: 'UTC',
        runHours: [9, 13, 18],
      }),
    };

    service = new JobsService(
      prisma as never,
      orchestrator as never,
      settings as never,
      { tokenStorageStatus: jest.fn() } as never,
    );
  });

  it('cancels a failed job, clears its lease, and prevents worker retries', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: VideoJobStatus.Failed,
      attempts: 2,
      error: 'render failed',
    });
    prisma.videoJob.update.mockResolvedValue({});

    await expect(service.cancelJob('job-1')).resolves.toEqual({ ok: true });

    expect(prisma.videoJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: VideoJobStatus.Cancelled,
        attempts: 6,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      }),
    });
  });

  it('does not cancel active processing jobs', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: VideoJobStatus.Processing,
      attempts: 1,
    });

    await expect(service.cancelJob('job-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.videoJob.update).not.toHaveBeenCalled();
  });

  it('resets failed render and publish fields while preserving slot identity fields', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: VideoJobStatus.FailedPublish,
    });
    prisma.videoJob.update.mockResolvedValue({});

    await expect(service.resetRender('job-1')).resolves.toEqual({ ok: true });

    expect(prisma.videoJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        status: VideoJobStatus.Pending,
        provider: null,
        renderId: null,
        videoUrl: null,
        youtubeVideoId: null,
        youtubeUrl: null,
        publishStage: null,
        videoSrt: null,
        published: false,
        attempts: 0,
        error: null,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
  });

  it('rejects reset-render for non-failed jobs', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: VideoJobStatus.Completed,
    });

    await expect(service.resetRender('job-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.videoJob.update).not.toHaveBeenCalled();
  });

  it('passes scheduledFor and force through manual run-slot', async () => {
    const scheduledFor = '2026-06-02T09:00:00.000Z';

    await expect(
      service.runSlot('MORNING', scheduledFor, true),
    ).resolves.toEqual(
      expect.objectContaining({ ok: true, queued: true, force: true }),
    );

    expect(orchestrator.runSlot).toHaveBeenCalledWith(
      'MORNING',
      new Date(scheduledFor),
      { force: true },
    );
  });
});
