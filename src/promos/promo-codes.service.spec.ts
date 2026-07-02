import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BillingProvider,
  PaystackDiscountMode,
  Plan,
  PromoAppliesToPlan,
  PromoAttributionStatus,
  PromoDiscountDuration,
  PromoDiscountType,
  PromoRegionScope,
} from '@prisma/client';
import { BillingInterval } from '../billing/dto/start-checkout.dto';
import { BillingPricingService } from '../billing/providers/billing-pricing.service';
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
    discountDuration: PromoDiscountDuration.ONE_TIME,
    appliesToPlans: PromoAppliesToPlan.ALL,
    regionScope: PromoRegionScope.ALL,
    allowedCountries: [],
    stripePromotionCodeId: null,
    stripeCouponId: null,
    paystackDiscountMode: PaystackDiscountMode.UNSUPPORTED,
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
        delete: jest.fn(),
      },
      promoAttribution: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new PromoCodesService(prisma, new BillingPricingService());
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
        discountDuration: PromoDiscountDuration.ONE_TIME,
        regionScope: PromoRegionScope.ALL,
        allowedCountries: [],
        stripePromotionCodeId: null,
        stripeCouponId: null,
        paystackDiscountMode: PaystackDiscountMode.TRACKING_ONLY,
      }),
    });
  });

  it('creates promo codes with Stripe promotion code configuration', async () => {
    prisma.promoCode.create.mockResolvedValue({
      ...activeCode,
      discountType: PromoDiscountType.PERCENTAGE,
      discountValue: 20,
      stripePromotionCodeId: 'promo_123',
      stripeCouponId: 'coupon_123',
      paystackDiscountMode: PaystackDiscountMode.TRACKING_ONLY,
    });

    await expect(
      service.create({
        code: 'stripe20',
        influencerName: 'Jane Creator',
        discountType: PromoDiscountType.PERCENTAGE,
        discountValue: 20,
        stripePromotionCodeId: 'promo_123',
        stripeCouponId: 'coupon_123',
        paystackDiscountMode: PaystackDiscountMode.TRACKING_ONLY,
      }, 'admin-1'),
    ).resolves.toMatchObject({ stripePromotionCodeId: 'promo_123' });

    expect(prisma.promoCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stripePromotionCodeId: 'promo_123',
        stripeCouponId: 'coupon_123',
        paystackDiscountMode: PaystackDiscountMode.TRACKING_ONLY,
      }),
    });
  });

  it('creates discount promo codes with default admin fields', async () => {
    prisma.promoCode.create.mockResolvedValue({
      ...activeCode,
      code: 'SUMMER25',
      discountType: PromoDiscountType.PERCENTAGE,
      discountValue: 25,
      paystackDiscountMode: PaystackDiscountMode.UNSUPPORTED,
    });

    await expect(
      service.create({
        code: 'summer25',
        influencerName: 'Summer Campaign',
        discountType: PromoDiscountType.PERCENTAGE,
        discountValue: 25,
      }, 'admin-1'),
    ).resolves.toMatchObject({ code: 'SUMMER25' });

    expect(prisma.promoCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        discountType: PromoDiscountType.PERCENTAGE,
        discountValue: 25,
        discountDuration: PromoDiscountDuration.ONE_TIME,
        regionScope: PromoRegionScope.ALL,
        isActive: true,
        paystackDiscountMode: PaystackDiscountMode.UNSUPPORTED,
      }),
    });
  });

  it('creates documented minimal payloads with sensible defaults', async () => {
    prisma.promoCode.create.mockResolvedValue({
      ...activeCode,
      code: 'JANE',
      discountType: PromoDiscountType.NONE,
      paystackDiscountMode: PaystackDiscountMode.TRACKING_ONLY,
      isActive: true,
    });

    await expect(
      service.create({
        code: 'jane',
        influencerName: 'Jane Creator',
      }, 'admin-1'),
    ).resolves.toMatchObject({
      code: 'JANE',
      discountType: PromoDiscountType.NONE,
      paystackDiscountMode: PaystackDiscountMode.TRACKING_ONLY,
      isActive: true,
    });

    expect(prisma.promoCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'JANE',
        discountType: PromoDiscountType.NONE,
        discountValue: null,
        discountDuration: PromoDiscountDuration.ONE_TIME,
        appliesToPlans: PromoAppliesToPlan.ALL,
        regionScope: PromoRegionScope.ALL,
        allowedCountries: [],
        paystackDiscountMode: PaystackDiscountMode.TRACKING_ONLY,
        isActive: true,
      }),
    });
  });

  it('creates documented discount payloads with explicit provider configuration', async () => {
    prisma.promoCode.create.mockResolvedValue({
      ...activeCode,
      code: 'BLACKFRIDAY50',
      discountType: PromoDiscountType.PERCENTAGE,
      discountValue: 50,
      regionScope: PromoRegionScope.NIGERIA,
      allowedCountries: ['NG'],
      stripePromotionCodeId: 'promo_123',
      stripeCouponId: 'coupon_123',
      paystackDiscountMode: PaystackDiscountMode.ONE_TIME_AMOUNT_DISCOUNT,
    });

    await expect(
      service.create({
        code: 'BLACKFRIDAY50',
        influencerName: 'Black Friday Campaign',
        discountType: PromoDiscountType.PERCENTAGE,
        discountValue: 50,
        discountDuration: PromoDiscountDuration.ONE_TIME,
        appliesToPlans: PromoAppliesToPlan.ALL,
        regionScope: PromoRegionScope.NIGERIA,
        allowedCountries: ['ng'],
        stripePromotionCodeId: 'promo_123',
        stripeCouponId: 'coupon_123',
        paystackDiscountMode: PaystackDiscountMode.ONE_TIME_AMOUNT_DISCOUNT,
        expiresAt: '2026-12-01T00:00:00.000Z',
      }, 'admin-1'),
    ).resolves.toMatchObject({
      code: 'BLACKFRIDAY50',
      regionScope: PromoRegionScope.NIGERIA,
      allowedCountries: ['NG'],
    });

    expect(prisma.promoCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        discountType: PromoDiscountType.PERCENTAGE,
        discountValue: 50,
        discountDuration: PromoDiscountDuration.ONE_TIME,
        regionScope: PromoRegionScope.NIGERIA,
        allowedCountries: ['NG'],
        stripePromotionCodeId: 'promo_123',
        stripeCouponId: 'coupon_123',
        paystackDiscountMode: PaystackDiscountMode.ONE_TIME_AMOUNT_DISCOUNT,
      }),
    });
  });

  it('rejects invalid Stripe provider ids', async () => {
    await expect(
      service.create({
        code: 'stripe20',
        influencerName: 'Jane Creator',
        discountType: PromoDiscountType.PERCENTAGE,
        discountValue: 20,
        stripePromotionCodeId: 'bad_123',
      }),
    ).rejects.toThrow('stripePromotionCodeId must start with "promo_"');

    await expect(
      service.create({
        code: 'stripe20',
        influencerName: 'Jane Creator',
        discountType: PromoDiscountType.PERCENTAGE,
        discountValue: 20,
        stripeCouponId: 'bad_123',
      }),
    ).rejects.toThrow('stripeCouponId must start with "coupon_"');
  });

  it('rejects duplicate codes', async () => {
    prisma.promoCode.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.create({ code: 'JANE20', influencerName: 'Jane' })).rejects.toThrow('Promo code "JANE20" already exists');
    await expect(service.create({ code: 'JANE20', influencerName: 'Jane' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects bad admin create payloads with clear messages', async () => {
    await expect(
      service.create({
        code: 'bad',
        influencerName: 'Bad Campaign',
        discountType: PromoDiscountType.PERCENTAGE,
      }),
    ).rejects.toThrow('discountValue is required for discount promo codes');

    await expect(
      service.create({
        code: 'bad',
        influencerName: 'Bad Campaign',
        discountDuration: 'FOREVER' as any,
      }),
    ).rejects.toThrow('discountDuration must be ONE_TIME');

    await expect(
      service.create({
        code: 'bad',
        influencerName: 'Bad Campaign',
        regionScope: 'LOCAL' as any,
      }),
    ).rejects.toThrow('regionScope must be ALL, GLOBAL, AFRICA, NIGERIA, or CUSTOM_COUNTRIES');

    await expect(
      service.create({
        code: 'bad',
        influencerName: 'Bad Campaign',
        regionScope: PromoRegionScope.CUSTOM_COUNTRIES,
        allowedCountries: [],
      }),
    ).rejects.toThrow('allowedCountries is required when regionScope is CUSTOM_COUNTRIES');

    await expect(
      service.create({
        code: 'bad',
        influencerName: 'Bad Campaign',
        allowedCountries: ['USA'],
      }),
    ).rejects.toThrow('allowedCountries must contain only ISO 3166-1 alpha-2 country codes');

    await expect(
      service.create({
        code: 'bad',
        influencerName: 'Bad Campaign',
        allowedCountries: ['us', 'US'],
      }),
    ).rejects.toThrow('allowedCountries must not contain duplicate country codes');

    await expect(
      service.create({
        code: 'bad',
        influencerName: 'Bad Campaign',
        paystackDiscountMode: 'DISCOUNT' as any,
      }),
    ).rejects.toThrow('paystackDiscountMode must be TRACKING_ONLY, ONE_TIME_AMOUNT_DISCOUNT, or UNSUPPORTED');
  });

  it('validates update payloads against existing promo values', async () => {
    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, discountType: PromoDiscountType.NONE, discountValue: null });

    await expect(service.update('promo-1', { discountType: PromoDiscountType.FIXED })).rejects.toThrow('discountValue is required for discount promo codes');

    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, discountType: PromoDiscountType.PERCENTAGE, discountValue: 20 });
    prisma.promoCode.update.mockResolvedValue({ ...activeCode, regionScope: PromoRegionScope.CUSTOM_COUNTRIES, allowedCountries: ['US', 'CA'] });

    await expect(service.update('promo-1', { regionScope: PromoRegionScope.CUSTOM_COUNTRIES, allowedCountries: ['us', 'ca'] })).resolves.toMatchObject({
      regionScope: PromoRegionScope.CUSTOM_COUNTRIES,
    });

    expect(prisma.promoCode.update).toHaveBeenCalledWith({
      where: { id: 'promo-1' },
      data: expect.objectContaining({
        allowedCountries: ['US', 'CA'],
        discountDuration: PromoDiscountDuration.ONE_TIME,
      }),
    });
  });

  it('rejects duplicate codes on update', async () => {
    prisma.promoCode.findUnique.mockResolvedValueOnce(activeCode);
    prisma.promoCode.update.mockRejectedValue({ code: 'P2002' });

    const update = service.update('promo-1', { code: 'jane20' });

    await expect(update).rejects.toThrow('Promo code "JANE20" already exists');
    await expect(update).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes promo codes by id after verifying they exist', async () => {
    prisma.promoCode.findUnique.mockResolvedValue(activeCode);
    prisma.promoCode.delete.mockResolvedValue(activeCode);

    await expect(service.remove('promo-1')).resolves.toMatchObject({ id: 'promo-1' });
    expect(prisma.promoCode.delete).toHaveBeenCalledWith({ where: { id: 'promo-1' } });
  });

  it('rejects expired and inactive codes', async () => {
    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, expiresAt: new Date('2020-01-01T00:00:00Z') });
    await expect(service.validatePublic('JANE20', Plan.PRO, BillingProvider.STRIPE, BillingInterval.MONTHLY, 'US')).rejects.toBeInstanceOf(BadRequestException);

    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, isActive: false });
    await expect(service.validatePublic('JANE20', Plan.PRO, BillingProvider.STRIPE, BillingInterval.MONTHLY, 'US')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('calculates percentage promo pricing preview', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      ...activeCode,
      code: 'BLACKFRIDAY50',
      discountType: PromoDiscountType.PERCENTAGE,
      discountValue: 50,
      regionScope: PromoRegionScope.NIGERIA,
      allowedCountries: ['NG'],
      paystackDiscountMode: PaystackDiscountMode.ONE_TIME_AMOUNT_DISCOUNT,
    });

    await expect(
      service.validatePublic('blackfriday50', Plan.PREMIUM, BillingProvider.PAYSTACK, BillingInterval.MONTHLY, 'NG'),
    ).resolves.toMatchObject({
      valid: true,
      code: 'BLACKFRIDAY50',
      discountType: PromoDiscountType.PERCENTAGE,
      discountValue: 50,
      discountDuration: PromoDiscountDuration.ONE_TIME,
      originalAmount: 2000000,
      discountAmount: 1000000,
      finalAmount: 1000000,
      currency: 'NGN',
      discountLabel: '50% off',
      renewalAmount: 2000000,
      regionScope: PromoRegionScope.NIGERIA,
      allowedCountries: ['NG'],
      paystackDiscountMode: PaystackDiscountMode.ONE_TIME_AMOUNT_DISCOUNT,
      providerSupported: true,
    });
  });

  it('calculates fixed promo pricing preview and clamps at zero', async () => {
    prisma.promoCode.findUnique.mockResolvedValueOnce({
      ...activeCode,
      discountType: PromoDiscountType.FIXED,
      discountValue: 500,
    });
    await expect(
      service.validatePublic('jane20', Plan.PRO, BillingProvider.STRIPE, BillingInterval.MONTHLY, 'US'),
    ).resolves.toMatchObject({
      originalAmount: 999,
      discountAmount: 500,
      finalAmount: 499,
      renewalAmount: 999,
      currency: 'USD',
      stripeDiscountConfigured: false,
      providerSupported: false,
      providerError: 'This promo code is not configured for Stripe checkout yet.',
    });

    prisma.promoCode.findUnique.mockResolvedValueOnce({
      ...activeCode,
      discountType: PromoDiscountType.FIXED,
      discountValue: 999999,
    });
    await expect(
      service.validatePublic('jane20', Plan.PRO, BillingProvider.STRIPE, BillingInterval.MONTHLY, 'US'),
    ).resolves.toMatchObject({
      originalAmount: 999,
      discountAmount: 999,
      finalAmount: 0,
    });
  });

  it('enforces regional targeting', async () => {
    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, regionScope: PromoRegionScope.NIGERIA });
    await expect(service.validatePublic('jane20', Plan.PRO, BillingProvider.PAYSTACK, BillingInterval.MONTHLY, 'NG')).resolves.toMatchObject({ valid: true });

    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, regionScope: PromoRegionScope.NIGERIA });
    await expect(service.validatePublic('jane20', Plan.PRO, BillingProvider.STRIPE, BillingInterval.MONTHLY, 'US')).rejects.toThrow('Promo code is not valid for this country');

    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, regionScope: PromoRegionScope.AFRICA });
    await expect(service.validatePublic('jane20', Plan.PRO, BillingProvider.PAYSTACK, BillingInterval.MONTHLY, 'GH')).resolves.toMatchObject({ valid: true });

    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, regionScope: PromoRegionScope.GLOBAL });
    await expect(service.validatePublic('jane20', Plan.PRO, BillingProvider.STRIPE, BillingInterval.MONTHLY, 'US')).resolves.toMatchObject({ valid: true });

    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, regionScope: PromoRegionScope.CUSTOM_COUNTRIES, allowedCountries: ['US', 'CA'] });
    await expect(service.validatePublic('jane20', Plan.PRO, BillingProvider.STRIPE, BillingInterval.MONTHLY, 'CA')).resolves.toMatchObject({ valid: true });

    prisma.promoCode.findUnique.mockResolvedValueOnce({ ...activeCode, regionScope: PromoRegionScope.CUSTOM_COUNTRIES, allowedCountries: ['US', 'CA'] });
    await expect(service.validatePublic('jane20', Plan.PRO, BillingProvider.STRIPE, BillingInterval.MONTHLY, 'GB')).rejects.toThrow('Promo code is not valid for this country');
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
    prisma.promoAttribution.findFirst.mockResolvedValue(null);
    prisma.promoAttribution.create.mockResolvedValue({ id: 'attr-1', status: PromoAttributionStatus.CHECKOUT_STARTED });

    await expect(
      service.recordCheckoutStarted({
        code: 'jane20',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: BillingProvider.STRIPE,
        plan: Plan.PRO,
        interval: BillingInterval.MONTHLY,
        countryCode: 'US',
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
        originalAmount: 999,
        discountAmount: 0,
        finalAmount: 999,
        renewalAmount: 999,
        countryCode: 'US',
        discountDuration: PromoDiscountDuration.ONE_TIME,
      }),
    });
  });

  it('uses the DB Stripe promotion code for checkout without env mapping', async () => {
    process.env.STRIPE_PROMO_JANE20_PROMOTION_CODE_ID = '';
    prisma.promoCode.findUnique.mockResolvedValue({
      ...activeCode,
      discountType: PromoDiscountType.PERCENTAGE,
      discountValue: 20,
      stripePromotionCodeId: 'promo_db_123',
    });
    prisma.promoAttribution.findFirst.mockResolvedValue(null);
    prisma.promoAttribution.create.mockResolvedValue({ id: 'attr-1', status: PromoAttributionStatus.CHECKOUT_STARTED });

    await expect(
      service.recordCheckoutStarted({
        code: 'jane20',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: BillingProvider.STRIPE,
        plan: Plan.PRO,
        interval: BillingInterval.MONTHLY,
        countryCode: 'US',
      }),
    ).resolves.toMatchObject({
      stripePromotionCodeId: 'promo_db_123',
      metadata: {
        promoDiscountApplied: true,
        discountAmount: 200,
        finalAmount: 799,
      },
    });
  });

  it('rejects duplicate successful redemption for the same user or workspace', async () => {
    prisma.promoCode.findUnique.mockResolvedValue(activeCode);
    prisma.promoAttribution.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.recordCheckoutStarted({
        code: 'jane20',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: BillingProvider.STRIPE,
        plan: Plan.PRO,
        interval: BillingInterval.MONTHLY,
        countryCode: 'US',
      }),
    ).rejects.toThrow('This promo code has already been used on this account.');
  });

  it('rejects Stripe discount checkout when no promotion code mapping exists', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      ...activeCode,
      discountType: PromoDiscountType.PERCENTAGE,
      discountValue: 20,
    });
    prisma.promoAttribution.findFirst.mockResolvedValue(null);

    await expect(
      service.recordCheckoutStarted({
        code: 'jane20',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: BillingProvider.STRIPE,
        plan: Plan.PRO,
        interval: BillingInterval.MONTHLY,
        countryCode: 'US',
      }),
    ).rejects.toThrow('This promo code is not configured for Stripe checkout yet.');
  });

  it('rejects Paystack discount checkout with a friendly unsupported error', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      ...activeCode,
      discountType: PromoDiscountType.PERCENTAGE,
      discountValue: 20,
      paystackDiscountMode: PaystackDiscountMode.UNSUPPORTED,
    });
    prisma.promoAttribution.findFirst.mockResolvedValue(null);

    await expect(
      service.recordCheckoutStarted({
        code: 'jane20',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: BillingProvider.PAYSTACK,
        plan: Plan.PRO,
        interval: BillingInterval.MONTHLY,
        countryCode: 'NG',
      }),
    ).rejects.toThrow('Paystack one-time subscription discounts are not yet supported.');
  });

  it('allows Paystack tracking-only mode without changing the checkout amount', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      ...activeCode,
      discountType: PromoDiscountType.PERCENTAGE,
      discountValue: 20,
      paystackDiscountMode: PaystackDiscountMode.TRACKING_ONLY,
    });
    prisma.promoAttribution.findFirst.mockResolvedValue(null);
    prisma.promoAttribution.create.mockResolvedValue({ id: 'attr-1', status: PromoAttributionStatus.CHECKOUT_STARTED });

    await expect(
      service.recordCheckoutStarted({
        code: 'jane20',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: BillingProvider.PAYSTACK,
        plan: Plan.PRO,
        interval: BillingInterval.MONTHLY,
        countryCode: 'NG',
      }),
    ).resolves.toMatchObject({
      metadata: {
        promoDiscountApplied: false,
        originalAmount: 750000,
        discountAmount: 0,
        finalAmount: 750000,
        paystackDiscountMode: PaystackDiscountMode.TRACKING_ONLY,
      },
    });
  });

  it('allows Paystack one-time amount discount mode to send finalAmount', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      ...activeCode,
      discountType: PromoDiscountType.PERCENTAGE,
      discountValue: 20,
      paystackDiscountMode: PaystackDiscountMode.ONE_TIME_AMOUNT_DISCOUNT,
    });
    prisma.promoAttribution.findFirst.mockResolvedValue(null);
    prisma.promoAttribution.create.mockResolvedValue({ id: 'attr-1', status: PromoAttributionStatus.CHECKOUT_STARTED });

    await expect(
      service.recordCheckoutStarted({
        code: 'jane20',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: BillingProvider.PAYSTACK,
        plan: Plan.PRO,
        interval: BillingInterval.MONTHLY,
        countryCode: 'NG',
      }),
    ).resolves.toMatchObject({
      metadata: {
        promoDiscountApplied: true,
        originalAmount: 750000,
        discountAmount: 150000,
        finalAmount: 600000,
        paystackDiscountMode: PaystackDiscountMode.ONE_TIME_AMOUNT_DISCOUNT,
      },
    });
  });

  it('allows tracking-only promo checkout', async () => {
    prisma.promoCode.findUnique.mockResolvedValue(activeCode);
    prisma.promoAttribution.findFirst.mockResolvedValue(null);
    prisma.promoAttribution.create.mockResolvedValue({ id: 'attr-1', status: PromoAttributionStatus.CHECKOUT_STARTED });

    await expect(
      service.recordCheckoutStarted({
        code: 'jane20',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: BillingProvider.PAYSTACK,
        plan: Plan.PRO,
        interval: BillingInterval.MONTHLY,
        countryCode: 'NG',
      }),
    ).resolves.toMatchObject({
      metadata: { promoDiscountApplied: false, finalAmount: 750000 },
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
      originalAmount: 300000,
      discountAmount: 50000,
      finalAmount: 250000,
      renewalAmount: 300000,
      currency: 'ngn',
      countryCode: 'ng',
      regionScope: PromoRegionScope.NIGERIA,
      discountDuration: PromoDiscountDuration.ONE_TIME,
    });

    expect(prisma.promoAttribution.update).toHaveBeenCalledWith({
      where: { id: 'attr-1' },
      data: expect.objectContaining({
        status: PromoAttributionStatus.SUBSCRIBED,
        subscriptionId: 'sub-1',
        amount: 250000,
        originalAmount: 300000,
        discountAmount: 50000,
        finalAmount: 250000,
        renewalAmount: 300000,
        currency: 'NGN',
        countryCode: 'NG',
        regionScope: PromoRegionScope.NIGERIA,
        discountDuration: PromoDiscountDuration.ONE_TIME,
        redeemedAt: expect.any(Date),
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
      { id: 'a3', userId: 'u1', workspaceId: 'w1', status: PromoAttributionStatus.SUBSCRIBED, originalAmount: 20000, discountAmount: 10000, finalAmount: 10000, provider: BillingProvider.STRIPE, plan: Plan.PRO },
      { id: 'a4', userId: 'u2', workspaceId: 'w2', status: PromoAttributionStatus.SUBSCRIBED, originalAmount: 30000, discountAmount: 5000, finalAmount: 25000, provider: BillingProvider.PAYSTACK, plan: Plan.PREMIUM },
    ]);

    await expect(service.performance('promo-1')).resolves.toMatchObject({
      signups: 1,
      checkoutStarts: 1,
      successfulSubscriptions: 2,
      revenueAttributed: 35000,
      revenueAfterDiscount: 35000,
      revenueBeforeDiscount: 50000,
      discountTotal: 15000,
      discountGiven: 15000,
      stripeConfigured: { configured: false, count: 0 },
      paystackDiscountMode: PaystackDiscountMode.UNSUPPORTED,
      revenueByProvider: { STRIPE: 10000, PAYSTACK: 25000 },
      revenueByPlan: { PRO: 10000, PREMIUM: 25000 },
      redemptionUniqueness: { uniqueUsers: 2, uniqueWorkspaces: 2 },
    });
  });
});
