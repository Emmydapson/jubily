import { PublishWorker } from './publish.worker';
import { v2 as cloudinary } from 'cloudinary';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload: jest.fn() },
  },
}));

describe('PublishWorker', () => {
  const originalEnv = process.env;
  let prisma: {
    videoJob: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let youtube: {
    upload: jest.Mock;
    updateMetadata: jest.Mock;
    uploadCaptions: jest.Mock;
  };
  let sheets: { append: jest.Mock };
  let serve: { getRenderAsset: jest.Mock };
  let monitoring: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let worker: PublishWorker;

  const job = {
    id: 'job-1',
    scriptId: 'script-1',
    attempts: 0,
    createdAt: new Date('2026-05-30T12:00:00.000Z'),
  };

  const fullJob = {
    id: 'job-1',
    offerId: 'offer-1',
    youtubeUrl: null,
    published: false,
    status: 'COMPLETED',
    createdAt: job.createdAt,
    scriptId: 'script-1',
    videoUrl: 'https://res.cloudinary.com/demo/video/upload/video.mp4',
    renderId: 'render-1',
    script: {
      reviewStatus: 'APPROVED',
      content: JSON.stringify({
        title: 'Better Morning Energy',
        hook: 'Start with water',
        cta: 'Try it today',
        scenes: [{ caption: 'Drink water', seconds: 2 }],
      }),
      topic: { title: 'Morning habits for more energy' },
    },
    offer: { name: 'Wellness Offer' },
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      PUBLIC_API_BASE_URL: 'https://api.joinjubily.com',
      PUBLISH_MAX_ATTEMPTS: '3',
      CLOUDINARY_FOLDER: 'jubily/videos',
    };
    prisma = {
      videoJob: {
        findUnique: jest.fn().mockResolvedValue(fullJob),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    youtube = {
      upload: jest.fn().mockResolvedValue('youtube-1'),
      updateMetadata: jest.fn().mockResolvedValue(undefined),
      uploadCaptions: jest.fn().mockResolvedValue(undefined),
    };
    sheets = { append: jest.fn().mockResolvedValue(undefined) };
    serve = { getRenderAsset: jest.fn() };
    monitoring = {
      info: jest.fn().mockResolvedValue(undefined),
      warn: jest.fn().mockResolvedValue(undefined),
      error: jest.fn().mockResolvedValue(undefined),
    };
    worker = new PublishWorker(
      prisma as never,
      youtube as never,
      sheets as never,
      serve as never,
      monitoring as never,
      { getSettings: jest.fn() } as never,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('publishes a completed claimed job once, persists the YouTube anchor, updates metadata, captions, sheets, and releases the claim', async () => {
    await worker.publish(job);

    expect(youtube.upload).toHaveBeenCalledWith(
      'Better Morning Energy',
      expect.stringContaining('Start with water'),
      fullJob.videoUrl,
      expect.arrayContaining(['health', 'wellness']),
    );
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: {
        published: true,
        youtubeVideoId: 'youtube-1',
        youtubeUrl: 'https://www.youtube.com/watch?v=youtube-1',
        attempts: 0,
        error: null,
      },
    });
    expect(sheets.append).toHaveBeenCalledWith([
      'job-1',
      'script-1',
      'Morning habits for more energy',
      'Wellness Offer',
      'youtube',
      'PUBLISHED',
      'https://www.youtube.com/watch?v=youtube-1',
      '',
      job.createdAt,
      expect.any(Date),
    ]);
    expect(youtube.updateMetadata).toHaveBeenCalledWith(
      'youtube-1',
      'Better Morning Energy',
      expect.stringContaining('https://api.joinjubily.com/r/offer-1?jobId=job-1&yt=youtube-1'),
      expect.any(Array),
    );
    expect(youtube.uploadCaptions).toHaveBeenCalledWith('youtube-1', expect.any(String));
    expect(prisma.videoJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: {
        status: 'COMPLETED',
        published: true,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
    expect(monitoring.info).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'PUBLISH', status: 'COMPLETED', jobId: 'job-1' }),
    );
  });

  it('does not re-upload when a prior YouTube URL already anchors idempotency', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      ...fullJob,
      youtubeUrl: 'https://www.youtube.com/watch?v=existing-id',
    });

    await worker.publish(job);

    expect(youtube.upload).not.toHaveBeenCalled();
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: { published: true, youtubeVideoId: 'existing-id' },
    });
    expect(youtube.updateMetadata).toHaveBeenCalledWith(
      'existing-id',
      expect.any(String),
      expect.any(String),
      expect.any(Array),
    );
  });

  it('uploads a non-Cloudinary video URL to Cloudinary before publishing', async () => {
    jest.mocked(cloudinary.uploader.upload).mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/demo/video/upload/stable.mp4',
    } as never);
    prisma.videoJob.findUnique.mockResolvedValue({
      ...fullJob,
      videoUrl: 'https://temporary.example.com/render.mp4',
    });

    await worker.publish(job);

    expect(cloudinary.uploader.upload).toHaveBeenCalledWith('https://temporary.example.com/render.mp4', {
      resource_type: 'video',
      folder: 'jubily/videos',
      public_id: 'job-1',
      overwrite: true,
    });
    expect(prisma.videoJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { videoUrl: 'https://res.cloudinary.com/demo/video/upload/stable.mp4' },
    });
    expect(youtube.upload).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'https://res.cloudinary.com/demo/video/upload/stable.mp4',
      expect.any(Array),
    );
  });

  it('falls back to the serve asset when the job has no stored video URL', async () => {
    jest.mocked(cloudinary.uploader.upload).mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/demo/video/upload/from-serve.mp4',
    } as never);
    serve.getRenderAsset.mockResolvedValue({
      url: 'https://serve.example.com/render.mp4',
      status: 'ready',
    });
    prisma.videoJob.findUnique.mockResolvedValue({
      ...fullJob,
      videoUrl: null,
    });

    await worker.publish(job);

    expect(serve.getRenderAsset).toHaveBeenCalledWith('render-1');
    expect(youtube.upload).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'https://res.cloudinary.com/demo/video/upload/from-serve.mp4',
      expect.any(Array),
    );
  });

  it('skips stale jobs by releasing the claim without uploading', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      ...fullJob,
      published: true,
      youtubeUrl: 'https://www.youtube.com/watch?v=existing-id',
    });

    await worker.publish(job);

    expect(youtube.upload).not.toHaveBeenCalled();
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: {
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
  });

  it('does not continue publish side effects if the upload result cannot be saved under the claim', async () => {
    prisma.videoJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await worker.publish(job);

    expect(youtube.upload).toHaveBeenCalled();
    expect(sheets.append).not.toHaveBeenCalled();
    expect(youtube.updateMetadata).not.toHaveBeenCalled();
    expect(youtube.uploadCaptions).not.toHaveBeenCalled();
  });

  it('logs metadata and caption failures as warnings while keeping the publish successful', async () => {
    youtube.updateMetadata.mockRejectedValue(new Error('metadata denied'));
    youtube.uploadCaptions.mockRejectedValue(new Error('captions denied'));

    await worker.publish(job);

    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: { error: 'Metadata failed: metadata denied' },
    });
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: { error: 'Captions failed: captions denied' },
    });
    expect(monitoring.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'PUBLISH', status: 'METADATA_FAILED' }),
    );
    expect(monitoring.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'PUBLISH', status: 'CAPTIONS_FAILED' }),
    );
    expect(monitoring.info).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'PUBLISH', status: 'COMPLETED' }),
    );
  });

  it('warns and publishes without a tracking link when no public API base URL is configured', async () => {
    delete process.env.PUBLIC_API_BASE_URL;
    delete process.env.JUBILY_API_BASE_URL;

    await worker.publish(job);

    expect(youtube.updateMetadata).toHaveBeenCalledWith(
      'youtube-1',
      expect.any(String),
      expect.not.stringContaining('/r/offer-1'),
      expect.any(Array),
    );
    expect(monitoring.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'PUBLISH',
        status: 'TRACKING_LINK_SKIPPED',
        jobId: 'job-1',
      }),
    );
  });

  it('falls back to topic title when script content is not JSON and rebuilds an empty SRT safely', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      ...fullJob,
      script: {
        reviewStatus: 'APPROVED',
        content: 'plain text script',
        topic: { title: 'Plain Topic Title' },
      },
    });

    await worker.publish(job);

    expect(youtube.upload).toHaveBeenCalledWith(
      'Plain Topic Title',
      expect.stringContaining('Plain Topic Title'),
      fullJob.videoUrl,
      expect.any(Array),
    );
    expect(prisma.videoJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { videoSrt: expect.stringContaining('plain text script') },
    });
  });

  it('handles invalid existing YouTube URLs by uploading once and replacing the anchor', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      ...fullJob,
      youtubeUrl: 'not a url',
    });

    await worker.publish(job);

    expect(youtube.upload).toHaveBeenCalled();
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: {
        published: true,
        youtubeVideoId: 'youtube-1',
        youtubeUrl: 'https://www.youtube.com/watch?v=youtube-1',
        attempts: 0,
        error: null,
      },
    });
  });

  it('records normal upload failures, tolerates sheet logging failure, and leaves the job retryable before max attempts', async () => {
    youtube.upload.mockRejectedValue(new Error('network down'));
    sheets.append.mockRejectedValue(new Error('sheet offline'));

    await worker.publish(job);

    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: {
        attempts: { increment: 1 },
        error: 'network down',
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
    expect(monitoring.error).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'PUBLISH',
        status: 'FAILED',
        message: 'network down',
        meta: { attempts: 1, maxAttempts: 3 },
      }),
    );
  });

  it('formats captions from scene timings without negative timestamps', () => {
    const srt = (
      worker as never as {
        buildSrtFromScenes: (scenes: Array<Record<string, unknown>>) => string;
      }
    ).buildSrtFromScenes([
      { caption: 'First line', seconds: 1.25 },
      { narration: 'Second line', duration: 2 },
      { caption: '', seconds: 3 },
      { caption: 'Negative start is clamped', seconds: -1 },
    ]);

    expect(srt).toContain('00:00:00,000 --> 00:00:01,250');
    expect(srt).toContain('First line');
    expect(srt).toContain('00:00:01,250 --> 00:00:03,250');
    expect(srt).toContain('Second line');
    expect(srt).toContain('00:00:06,250 --> 00:00:05,250');
  });

  it('pauses publishing on YouTube quota errors instead of retrying as a normal failure', async () => {
    youtube.upload.mockRejectedValue(new Error('quota exceeded'));

    await worker.publish(job);

    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: {
        status: 'FAILED_QUOTA',
        attempts: { increment: 1 },
        error: expect.stringContaining('YouTube publish blocked'),
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
    expect(sheets.append).not.toHaveBeenCalled();
    expect(monitoring.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'PUBLISH',
        status: 'PAUSED_QUOTA',
        jobId: 'job-1',
      }),
    );
  });

  it('blocks publish side effects when the script is not approved', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      ...fullJob,
      script: {
        ...fullJob.script,
        reviewStatus: 'NEEDS_REVIEW',
      },
    });

    await worker.publish(job);

    expect(youtube.upload).not.toHaveBeenCalled();
    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: {
        error: 'Publish blocked: script requires manual approval',
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
    expect(monitoring.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'PUBLISH',
        status: 'QUALITY_GATE_BLOCKED',
        jobId: 'job-1',
      }),
    );
  });

  it('marks repeated publish failures permanent at the configured attempt threshold', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({ ...fullJob, script: null });

    await worker.publish({ ...job, attempts: 2 });

    expect(prisma.videoJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', workerLockedBy: expect.stringMatching(/^publish-/) },
      data: {
        attempts: { increment: 1 },
        error: 'Script not found',
        status: 'FAILED_PUBLISH',
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
      'youtube',
      'FAILED',
      '',
      'Script not found',
      job.createdAt,
      expect.any(Date),
    ]);
    expect(monitoring.error).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'PUBLISH',
        status: 'FAILED_PERMANENT',
        message: 'Script not found',
      }),
    );
  });
});
