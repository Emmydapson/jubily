import { NotFoundException } from '@nestjs/common';
import { ThumbnailService } from './thumbnail.service';

describe('ThumbnailService', () => {
  let prisma: {
    script: { findUnique: jest.Mock; update: jest.Mock };
    videoJob: { findUnique: jest.Mock; update: jest.Mock };
  };
  let images: { generateThumbnailImageUrl: jest.Mock };
  let service: ThumbnailService;

  beforeEach(() => {
    prisma = {
      script: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      videoJob: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    images = { generateThumbnailImageUrl: jest.fn() };
    service = new ThumbnailService(prisma as never, images as never);
  });

  it('generates and stores script thumbnail metadata', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      thumbnailPrompt: 'clear subject',
    });
    images.generateThumbnailImageUrl.mockResolvedValue('https://cdn.example.com/thumb.jpg');
    prisma.script.update
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        id: 'script-1',
        thumbnailPrompt: 'clear subject',
        thumbnailImageUrl: 'https://cdn.example.com/thumb.jpg',
        thumbnailStatus: 'READY',
        thumbnailError: null,
        thumbnailGeneratedAt: new Date('2026-05-31T12:00:00.000Z'),
      });

    await expect(service.generateForScript('script-1')).resolves.toEqual(
      expect.objectContaining({
        target: 'script',
        id: 'script-1',
        scriptId: 'script-1',
        thumbnailStatus: 'READY',
        thumbnailImageUrl: 'https://cdn.example.com/thumb.jpg',
      }),
    );

    expect(prisma.script.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ thumbnailStatus: 'GENERATING', thumbnailError: null }),
      }),
    );
    expect(images.generateThumbnailImageUrl).toHaveBeenCalledWith(
      'clear subject',
      'thumbnail-script-script-1',
    );
  });

  it('stores failed script thumbnail status without throwing provider errors', async () => {
    prisma.script.findUnique.mockResolvedValue({
      id: 'script-1',
      thumbnailPrompt: 'clear subject',
    });
    images.generateThumbnailImageUrl.mockRejectedValue(new Error('provider down'));
    prisma.script.update
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        id: 'script-1',
        thumbnailPrompt: 'clear subject',
        thumbnailImageUrl: null,
        thumbnailStatus: 'FAILED',
        thumbnailError: 'provider down',
        thumbnailGeneratedAt: null,
      });

    await expect(service.generateForScript('script-1')).resolves.toEqual(
      expect.objectContaining({
        thumbnailStatus: 'FAILED',
        thumbnailError: 'provider down',
      }),
    );
  });

  it('generates job thumbnail from job or script prompt', async () => {
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      scriptId: 'script-1',
      thumbnailPrompt: null,
      script: { thumbnailPrompt: 'script prompt' },
    });
    images.generateThumbnailImageUrl.mockResolvedValue('https://cdn.example.com/job-thumb.jpg');
    prisma.videoJob.update
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        id: 'job-1',
        scriptId: 'script-1',
        thumbnailPrompt: 'script prompt',
        thumbnailImageUrl: 'https://cdn.example.com/job-thumb.jpg',
        thumbnailStatus: 'READY',
        thumbnailError: null,
        thumbnailGeneratedAt: new Date('2026-05-31T12:00:00.000Z'),
      });

    await expect(service.generateForJob('job-1')).resolves.toEqual(
      expect.objectContaining({
        target: 'job',
        id: 'job-1',
        jobId: 'job-1',
        scriptId: 'script-1',
        thumbnailStatus: 'READY',
      }),
    );

    expect(images.generateThumbnailImageUrl).toHaveBeenCalledWith(
      'script prompt',
      'thumbnail-job-job-1',
      'job-1',
    );
  });

  it('throws not found for missing scripts', async () => {
    prisma.script.findUnique.mockResolvedValue(null);

    await expect(service.getScriptThumbnail('script-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
