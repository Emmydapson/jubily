import { RenderWorker } from './render.worker';
import { PublishWorker } from './publish.worker';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload: jest.fn() },
  },
}));

describe('Worker lease claims', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      WORKER_LOCK_TTL_MS: '60000',
      PUBLISH_MAX_ATTEMPTS: '6',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function renderWorker(prisma: { videoJob: { updateMany: jest.Mock } }) {
    return new RenderWorker(
      prisma as never,
      { append: jest.fn() } as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { getSettings: jest.fn() } as never,
    );
  }

  function publishWorker(prisma: { videoJob: { updateMany: jest.Mock } }) {
    return new PublishWorker(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { getSettings: jest.fn() } as never,
      { consumePublish: jest.fn(), assertWorkspaceActive: jest.fn() } as never,
      { record: jest.fn() } as never,
    );
  }

  it('claims pending render jobs only when a single conditional update wins', async () => {
    const prisma = {
      videoJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const worker = renderWorker(prisma);

    await expect(
      (
        worker as never as {
          claimPendingRender: (job: unknown) => Promise<boolean>;
        }
      ).claimPendingRender({
        id: 'job-1',
      }),
    ).resolves.toBe(true);

    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'job-1',
        renderId: null,
        published: false,
        attempts: { lt: 6 },
        status: { in: ['PENDING', 'FAILED'] },
        script: { reviewStatus: 'APPROVED' },
        OR: [
          { workerLockedAt: null },
          { workerLockedAt: { lt: expect.any(Date) } },
        ],
      }),
      data: expect.objectContaining({
        workerLockedAt: expect.any(Date),
        workerLockedBy: expect.stringMatching(/^render-/),
        workerStage: 'RENDER_START',
        error: null,
      }),
    });
  });

  it('skips render claims when another worker already owns the lease', async () => {
    const prisma = {
      videoJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const worker = renderWorker(prisma);

    await expect(
      (
        worker as never as {
          claimRenderPoll: (job: unknown) => Promise<boolean>;
        }
      ).claimRenderPoll({
        id: 'job-1',
        renderId: 'render-1',
      }),
    ).resolves.toBe(false);
  });

  it('recovers stale render start and poll leases with stage-specific behavior', async () => {
    const prisma = {
      videoJob: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 2 })
          .mockResolvedValueOnce({ count: 1 }),
      },
    };
    const worker = renderWorker(prisma);

    await (
      worker as never as { recoverStaleClaims: () => Promise<void> }
    ).recoverStaleClaims();

    expect(prisma.videoJob.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          workerStage: 'RENDER_START',
          workerLockedAt: { lt: expect.any(Date) },
        }),
        data: expect.objectContaining({
          status: 'FAILED',
          attempts: { increment: 1 },
          workerLockedAt: null,
          workerLockedBy: null,
          workerStage: null,
        }),
      }),
    );
    expect(prisma.videoJob.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          workerStage: 'RENDER_POLL',
          status: 'PROCESSING',
        }),
        data: {
          workerLockedAt: null,
          workerLockedBy: null,
          workerStage: null,
        },
      }),
    );
  });

  it('claims publish jobs with status, renderId, attempt, and lease guards', async () => {
    const prisma = {
      videoJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const worker = publishWorker(prisma);

    await expect(
      (
        worker as never as {
          claimPublishJob: (job: unknown) => Promise<boolean>;
        }
      ).claimPublishJob({
        id: 'job-1',
        renderId: 'render-1',
      }),
    ).resolves.toBe(true);

    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'job-1',
        status: 'COMPLETED',
        published: false,
        renderId: 'render-1',
        attempts: { lt: 6 },
        script: { reviewStatus: 'APPROVED' },
        OR: [
          { workerStage: 'PUBLISH_QUEUED' },
          { workerLockedAt: null },
          { workerLockedAt: { lt: expect.any(Date) } },
        ],
      }),
      data: expect.objectContaining({
        workerLockedAt: expect.any(Date),
        workerLockedBy: expect.stringMatching(/^publish-/),
        workerStage: 'PUBLISH',
        error: null,
      }),
    });
  });

  it('recovers stale publish leases without changing completed unpublished jobs otherwise', async () => {
    const prisma = {
      videoJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const worker = publishWorker(prisma);

    await (
      worker as never as { recoverStaleClaims: () => Promise<void> }
    ).recoverStaleClaims();

    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: {
        workerStage: 'PUBLISH',
        workerLockedAt: { lt: expect.any(Date) },
        status: 'COMPLETED',
        published: false,
      },
      data: {
        error: 'Publish claim expired before completion',
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
  });
});
