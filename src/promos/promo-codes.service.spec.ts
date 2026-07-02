import { BadRequestException, ConflictException } from '@nestjs/common';
import { BillingProvider, Plan, PromoAppliesToPlan, PromoAttributionStatus, PromoDiscountType } from '@prisma/client';
import { BillingInterval } from '../billing/dto/start-checkout.dto';
import { PromoCodesService } from './promo-codes.service';

describe('PromoCodesService', () => {
  let prisma: any;
  let service: PromoCodesService;

  const activeCode = {
    id: 'promo-1',
    code: 'JANE20',
    influencerName: 'Jane Creator',
    influencerEmail: null,
    description: null,
    discountType: PromoDiscountType.NONE,
    discountValue: null,
    appliesToPlans: PromoAppliesToPlan.ALL,
    maxRedemptions: null,
    redemptionCount: 0,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    createdByAdminId: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    prisma = {
      promoCode: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      promoAttribution: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new PromoCodesService(prisma);
  });

  it('creates uppercase promo codes', async () => {
    prisma.promoCode.create.mockResolvedValue({ ...activeCode, code: 'JANE20' });

    await expect(
      service.create({
        code: ' jane20 ',
        influencerName: 'Jane Creator',
        discountType: PromoDiscountType.NONE,
      }, 'admin-1'),
    ).resolves.toMatchObject({ code: 'JANE20' });

    expect(prisma.promoCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'JANE20',
        createdByAdminId: 'admin-1',
        appliesToPlans: PromoAppliesToPlan.ALL,
      }),
    });
  });

  it('rejects duplicate codes', async () => {
    prisma.promoCode.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.create({ code: 'JANE20', influencerName: 'Jane' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects expired and inactive codes', async () => {
    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, expiresAt: new Date('2020-01-01T00:00:00Z') });
    await expect(service.validatePublic('JANE20', Plan.PRO)).rejects.toBeInstanceOf(BadRequestException);

    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, isActive: false });
    await expect(service.validatePublic('JANE20', Plan.PRO)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records signup attribution without incrementing redemption count', async () => {
    prisma.promoCode.findUnique.mockResolvedValue(activeCode);
    prisma.promoAttribution.create.mockResolvedValue({ id: 'attr-1', status: PromoAttributionStatus.SIGNUP });

    await expect(service.recordSignup('jane20', 'user-1', 'workspace-1')).resolves.toMatchObject({
      id: 'attr-1',
      status: PromoAttributionStatus.SIGNUP,
    });

    expect(prisma.promoAttribution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        promoCodeId: 'promo-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        status: PromoAttributionStatus.SIGNUP,
      }),
    });
    expect(prisma.promoCode.update).not.toHaveBeenCalled();
  });

  it('records checkout attribution and returns provider metadata', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({ ...activeCode, appliesToPlans: PromoAppliesToPlan.PRO });
    prisma.promoAttribution.create.mockResolvedValue({ id: 'attr-1', status: PromoAttributionStatus.CHECKOUT_STARTED });

    await expect(
      service.recordCheckoutStarted({
        code: 'jane20',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: BillingProvider.STRIPE,
        plan: Plan.PRO,
        interval: BillingInterval.MONTHLY,
      }),
    ).resolves.toMatchObject({
      metadata: {
        promoCodeId: 'promo-1',
        promoCode: 'JANE20',
        promoAttributionId: 'attr-1',
      },
    });

    expect(prisma.promoAttribution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: PromoAttributionStatus.CHECKOUT_STARTED,
        provider: BillingProvider.STRIPE,
        plan: Plan.PRO,
        interval: 'MONTHLY',
      }),
    });
  });

  it('marks successful webhook attribution subscribed and increments redemption once', async () => {
    prisma.promoAttribution.findUnique.mockResolvedValue({
      id: 'attr-1',
      promoCodeId: 'promo-1',
      status: PromoAttributionStatus.CHECKOUT_STARTED,
    });
    prisma.promoAttribution.update.mockResolvedValue({
      id: 'attr-1',
      promoCodeId: 'promo-1',
      status: PromoAttributionStatus.SUBSCRIBED,
    });

    await service.markSubscribed({
      promoAttributionId: 'attr-1',
      workspaceId: 'workspace-1',
      subscriptionId: 'sub-1',
      provider: BillingProvider.PAYSTACK,
      plan: Plan.PREMIUM,
      interval: BillingInterval.YEARLY,
      amount: 250000,
      currency: 'ngn',
    });

    expect(prisma.promoAttribution.update).toHaveBeenCalledWith({
      where: { id: 'attr-1' },
      data: expect.objectContaining({
        status: PromoAttributionStatus.SUBSCRIBED,
        subscriptionId: 'sub-1',
        amount: 250000,
        currency: 'NGN',
      }),
    });
    expect(prisma.promoCode.update).toHaveBeenCalledWith({
      where: { id: 'promo-1' },
      data: { redemptionCount: { increment: 1 } },
    });
  });

  it('returns performance metrics', async () => {
    prisma.promoCode.findUnique.mockResolvedValue(activeCode);
    prisma.promoAttribution.findMany.mockResolvedValue([
      { id: 'a1', status: PromoAttributionStatus.SIGNUP, amount: null, provider: null, plan: null },
      { id: 'a2', status: PromoAttributionStatus.CHECKOUT_STARTED, amount: null, provider: BillingProvider.STRIPE, plan: Plan.PRO },
      { id: 'a3', status: PromoAttributionStatus.SUBSCRIBED, amount: 10000, provider: BillingProvider.STRIPE, plan: Plan.PRO },
      { id: 'a4', status: PromoAttributionStatus.SUBSCRIBED, amount: 25000, provider: BillingProvider.PAYSTACK, plan: Plan.PREMIUM },
    ]);

    await expect(service.performance('promo-1')).resolves.toMatchObject({
      signups: 1,
      checkoutStarts: 1,
      successfulSubscriptions: 2,
      revenueAttributed: 35000,
      revenueByProvider: { STRIPE: 10000, PAYSTACK: 25000 },
      revenueByPlan: { PRO: 10000, PREMIUM: 25000 },
    });
  });
});
