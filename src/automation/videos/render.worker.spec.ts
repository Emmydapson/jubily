import axios from 'axios';
import { RenderWorker } from './render.worker';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('RenderWorker Shotstack polling', () => {
  const originalEnv = process.env;
  const job = {
    id: 'job-1',
    scriptId: 'script-1',
    offerId: null,
    renderId: 'render-1',
    status: 'PROCESSING',
    attempts: 0,
    published: false,
    createdAt: new Date('2026-07-18T10:00:00.000Z'),
    error: null,
    provider: 'shotstack',
  };
  let prisma: { videoJob: { updateMany: jest.Mock } };
  let sheets: { append: jest.Mock };
  let serve: { getReadyUrl: jest.Mock };
  let monitoring: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let worker: RenderWorker;
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      SHOTSTACK_API_KEY: ' production-key ',
      SHOTSTACK_BASE_URL: ' https://api.shotstack.io/edit/v1/ ',
    };
    prisma = {
      videoJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    sheets = { append: jest.fn().mockResolvedValue(undefined) };
    serve = {
      getReadyUrl: jest
        .fn()
        .mockResolvedValue('https://cdn.shotstack.io/render.mp4'),
    };
    monitoring = {
      info: jest.fn().mockResolvedValue(undefined),
      warn: jest.fn().mockResolvedValue(undefined),
      error: jest.fn().mockResolvedValue(undefined),
    };
    worker = new RenderWorker(
      prisma as never,
      sheets as never,
      serve as never,
      {} as never,
      monitoring as never,
      { getSettings: jest.fn() } as never,
    );
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    (worker as never as { logger: typeof logger }).logger = logger;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('polls production render status with the trimmed Shotstack API key', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { response: { status: 'rendering' } },
    });

    await worker.handle(job);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.shotstack.io/edit/v1/render/render-1',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': 'production-key',
        },
        timeout: 20000,
      }),
    );
    expect(mockedAxios.get.mock.calls[0][0]).not.toContain('/edit/stage');
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^render-/) },
      data: {
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
  });

  it('keeps successful render completion behavior', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { response: { status: 'done' } },
    });

    await worker.handle(job);

    expect(serve.getReadyUrl).toHaveBeenCalledWith('render-1');
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^render-/) },
      data: {
        status: 'COMPLETED',
        videoUrl: 'https://cdn.shotstack.io/render.mp4',
        error: null,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
    expect(sheets.append).toHaveBeenCalledWith([
      'job-1',
      'script-1',
      '',
      '',
      'shotstack',
      'COMPLETED',
      'https://cdn.shotstack.io/render.mp4',
      '',
      job.createdAt,
      expect.any(Date),
    ]);
  });

  it('logs safe Shotstack 403 polling diagnostics and preserves retry behavior', async () => {
    const error = {
      isAxiosError: true,
      code: 'ERR_BAD_REQUEST',
      response: {
        status: 403,
        data: { error: 'Forbidden: invalid key for this environment' },
      },
      config: {
        url: 'https://api.shotstack.io/edit/v1/render/render-1',
        method: 'get',
        headers: { 'x-api-key': 'production-key' },
      },
      message: 'Request failed with status code 403',
    };
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get.mockRejectedValueOnce(error);

    await worker.handle(job);

    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^render-/) },
      data: {
        attempts: { increment: 1 },
        error: 'Forbidden: invalid key for this environment',
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Shotstack render polling failed',
        renderId: 'render-1',
        status: 403,
        response: { error: 'Forbidden: invalid key for this environment' },
        url: 'https://api.shotstack.io/edit/v1/render/render-1',
        method: 'get',
        hasApiKey: true,
        axiosCode: 'ERR_BAD_REQUEST',
        jobId: 'job-1',
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'production-key',
    );
    expect(monitoring.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'RETRY',
        meta: { renderId: 'render-1', attempts: 1 },
      }),
    );
  });
});
