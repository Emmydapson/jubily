import { TrackingService } from './tracking.service';

describe('TrackingService', () => {
  const originalEnv = process.env;
  let prisma: {
    offer: { findFirst: jest.Mock; findUnique: jest.Mock };
    videoJob: { findUnique: jest.Mock };
    click: { create: jest.Mock };
  };
  let monitoring: { info: jest.Mock };
  let service: TrackingService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AFFILIATE_CLICK_PARAM;
    prisma = {
      offer: { findFirst: jest.fn(), findUnique: jest.fn() },
      videoJob: { findUnique: jest.fn() },
      click: { create: jest.fn() },
    };
    monitoring = { info: jest.fn() };
    service = new TrackingService(prisma as never, monitoring as never);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('records attributed clicks only for active offers and matching video jobs', async () => {
    prisma.offer.findFirst.mockResolvedValue({
      id: 'offer-1',
      workspaceId: 'workspace-1',
    });
    prisma.videoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      offerId: 'offer-1',
      workspaceId: 'workspace-1',
    });
    prisma.click.create.mockResolvedValue({ id: 'click-1' });

    await expect(
      service.createClick({
        offerId: 'offer-1',
        videoJobId: 'job-1',
        youtubeId: 'yt-1',
        source: 'youtube',
        ip: '127.0.0.1',
        userAgent: 'jest',
      }),
    ).resolves.toEqual({ id: 'click-1' });

    expect(prisma.click.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-1',
        offerId: 'offer-1',
        videoJobId: 'job-1',
        youtubeId: 'yt-1',
        source: 'youtube',
        ip: '127.0.0.1',
        userAgent: 'jest',
      },
      select: { id: true },
    });
    expect(monitoring.info).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'TRACKING',
        status: 'CLICK_RECORDED',
        clickId: 'click-1',
      }),
    );
  });

  it('rejects disabled offers and offer/job mismatches before creating clicks', async () => {
    prisma.offer.findFirst.mockResolvedValueOnce(null);

    await expect(service.createClick({ offerId: 'offer-1' })).rejects.toThrow(
      'Offer not found/disabled',
    );

    prisma.offer.findFirst.mockResolvedValueOnce({
      id: 'offer-1',
      workspaceId: 'workspace-1',
    });
    prisma.videoJob.findUnique.mockResolvedValueOnce({
      id: 'job-1',
      offerId: 'other-offer',
      workspaceId: 'workspace-1',
    });

    await expect(
      service.createClick({ offerId: 'offer-1', videoJobId: 'job-1' }),
    ).rejects.toThrow('does not belong to offer');
    expect(prisma.click.create).not.toHaveBeenCalled();
  });

  it('rejects video jobs from another workspace before creating clicks', async () => {
    prisma.offer.findFirst.mockResolvedValueOnce({
      id: 'offer-1',
      workspaceId: 'workspace-1',
    });
    prisma.videoJob.findUnique.mockResolvedValueOnce({
      id: 'job-1',
      offerId: 'offer-1',
      workspaceId: 'workspace-2',
    });

    await expect(
      service.createClick({ offerId: 'offer-1', videoJobId: 'job-1' }),
    ).rejects.toThrow('does not belong to offer workspace');
    expect(prisma.click.create).not.toHaveBeenCalled();
  });

  it('adds the correct affiliate click parameter by network and optional override', async () => {
    prisma.offer.findUnique.mockResolvedValueOnce({
      id: 'offer-1',
      hoplink: 'https://vendor.example/path?existing=1',
      network: 'digistore24',
    });
    await expect(service.buildOfferUrl('offer-1', 'click-1')).resolves.toBe(
      'https://vendor.example/path?existing=1&custom=click-1',
    );

    process.env.AFFILIATE_CLICK_PARAM = 'subid';
    prisma.offer.findUnique.mockResolvedValueOnce({
      id: 'offer-2',
      hoplink: 'https://vendor.example/path',
      network: 'clickbank',
    });
    await expect(service.buildOfferUrl('offer-2', 'click-2')).resolves.toBe(
      'https://vendor.example/path?tid=click-2&subid=click-2',
    );
  });
});
