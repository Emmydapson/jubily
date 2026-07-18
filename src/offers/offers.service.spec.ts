import { BadRequestException } from '@nestjs/common';
import { OffersService } from './offers.service';
import { OFFER_NICHES } from './offer.constants';
import { normalizeAndValidateOfferInput } from './offer.validation';

describe('OffersService', () => {
  let prisma: {
    offer: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    click: { count: jest.Mock; findFirst: jest.Mock };
    conversion: {
      count: jest.Mock;
      groupBy: jest.Mock;
      findFirst: jest.Mock;
    };
    videoJob: { count: jest.Mock };
  };
  let tracking: { buildOfferUrl: jest.Mock };
  let service: OffersService;

  beforeEach(() => {
    prisma = {
      offer: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      click: { count: jest.fn(), findFirst: jest.fn() },
      conversion: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findFirst: jest.fn(),
      },
      videoJob: { count: jest.fn() },
    };
    tracking = { buildOfferUrl: jest.fn() };
    service = new OffersService(prisma as never, tracking as never);
  });

  it('validates supported network, niche, name, URL, and boolean fields', () => {
    for (const nicheTag of OFFER_NICHES) {
      expect(
        normalizeAndValidateOfferInput({
          network: 'CLICKBANK',
          name: `${nicheTag} offer`,
          hoplink: 'https://vendor.example/path',
          nicheTag,
        }),
      ).toMatchObject({ nicheTag });
    }

    expect(
      normalizeAndValidateOfferInput({
        network: 'selar',
        name: ' AI Offer ',
        hoplink: 'https://vendor.example/path',
        nicheTag: 'ai-software',
        active: true,
      }),
    ).toMatchObject({
      network: 'SELAR',
      name: 'AI Offer',
      hoplink: 'https://vendor.example/path',
      nicheTag: 'AI_SOFTWARE',
      active: true,
    });

    expect(() =>
      normalizeAndValidateOfferInput({
        network: 'bad-network',
        name: 'Bad',
        hoplink: 'https://example.com',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeAndValidateOfferInput({
        network: 'CLICKBANK',
        name: 'Bad',
        hoplink: 'not-a-url',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeAndValidateOfferInput({
        network: 'CLICKBANK',
        name: 'Bad',
        hoplink: 'https://example.com',
        nicheTag: 'unknown',
      }),
    ).toThrow(BadRequestException);
  });

  it('creates, updates, deactivates, and reactivates offers', async () => {
    prisma.offer.findFirst.mockResolvedValue(null);
    prisma.offer.create.mockResolvedValue({
      id: 'offer-1',
      network: 'PARTNERSTACK',
      name: 'AI Offer',
      hoplink: 'https://vendor.example/ai',
      nicheTag: 'AI_SOFTWARE',
      active: true,
    });

    await expect(
      service.create({
        network: 'partnerstack',
        name: 'AI Offer',
        hoplink: 'https://vendor.example/ai',
        nicheTag: 'ai-software',
      }),
    ).resolves.toMatchObject({ id: 'offer-1', active: true });

    prisma.offer.findUnique.mockResolvedValue({ id: 'offer-1' });
    prisma.offer.update.mockImplementation(async ({ data }) => ({
      id: 'offer-1',
      ...data,
    }));

    await expect(
      service.update('offer-1', { name: 'Focus Offer 2' }),
    ).resolves.toMatchObject({ id: 'offer-1', name: 'Focus Offer 2' });
    await expect(service.deactivate('offer-1')).resolves.toMatchObject({
      active: false,
    });
    await expect(service.reactivate('offer-1')).resolves.toMatchObject({
      active: true,
    });
  });

  it('aggregates performance from clicks, conversions, and video jobs', async () => {
    const offer = {
      id: 'offer-1',
      network: 'PARTNERSTACK',
      name: 'AI Writer Pro',
    };
    prisma.offer.findUnique.mockResolvedValue(offer);
    prisma.click.count.mockResolvedValue(10);
    prisma.conversion.count.mockResolvedValue(2);
    prisma.videoJob.count.mockResolvedValue(4);
    prisma.conversion.groupBy.mockResolvedValue([
      { currency: 'USD', _count: { _all: 2 }, _sum: { amount: 42 } },
    ]);
    prisma.click.findFirst.mockResolvedValue({
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
    });
    prisma.conversion.findFirst.mockResolvedValue({
      createdAt: new Date('2026-06-01T10:05:00.000Z'),
    });

    await expect(service.performance('offer-1')).resolves.toEqual({
      offer,
      totals: {
        clicks: 10,
        conversions: 2,
        videoJobs: 4,
        conversionRate: 0.2,
        revenueByCurrency: [{ currency: 'USD', conversions: 2, amount: 42 }],
      },
      recent: {
        lastClickAt: new Date('2026-06-01T10:00:00.000Z'),
        lastConversionAt: new Date('2026-06-01T10:05:00.000Z'),
      },
    });
  });

  it('previews redirect URLs without creating clicks', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 'offer-1',
      network: 'CLICKBANK',
      hoplink: 'https://vendor.example',
    });
    tracking.buildOfferUrl.mockResolvedValue(
      'https://vendor.example/?tid=00000000-0000-4000-8000-000000000000',
    );

    await expect(service.testRedirect('offer-1')).resolves.toMatchObject({
      offerId: 'offer-1',
      createsClick: false,
      previewClickId: '00000000-0000-4000-8000-000000000000',
      redirectUrl:
        'https://vendor.example/?tid=00000000-0000-4000-8000-000000000000',
    });
  });

  it('filters offers and rejects cross-workspace access', async () => {
    prisma.offer.findMany.mockResolvedValue([]);
    prisma.offer.count.mockResolvedValue(0);

    await service.list({}, 'workspace-1');

    expect(prisma.offer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'workspace-1' },
      }),
    );

    prisma.offer.findUnique.mockResolvedValue({
      id: 'offer-2',
      workspaceId: 'workspace-2',
    });

    await expect(service.getOne('offer-2', 'workspace-1')).rejects.toThrow(
      'Offer not found',
    );
  });
});
