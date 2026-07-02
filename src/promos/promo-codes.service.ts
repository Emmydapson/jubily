import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
import { PrismaService } from '../prisma/prisma.service';
import { BillingInterval } from '../billing/dto/start-checkout.dto';
import { BillingPricingService } from '../billing/providers/billing-pricing.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';

type CheckoutAttributionInput = {
  code: string;
  userId: string;
  workspaceId: string;
  provider: BillingProvider;
  plan: Exclude<Plan, 'FREE'>;
  interval: BillingInterval;
  countryCode?: string | null;
};

type SubscribeInput = {
  promoCodeId?: string | null;
  promoAttributionId?: string | null;
  userId?: string | null;
  workspaceId: string;
  subscriptionId?: string | null;
  provider: BillingProvider;
  plan?: Plan | null;
  interval?: BillingInterval | string | null;
  amount?: number | null;
  originalAmount?: number | null;
  discountAmount?: number | null;
  finalAmount?: number | null;
  renewalAmount?: number | null;
  currency?: string | null;
  countryCode?: string | null;
  regionScope?: string | null;
  discountDuration?: string | null;
};

@Injectable()
export class PromoCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: BillingPricingService,
  ) {}

  private readonly africanCountryCodes = new Set([
    'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'DJ', 'EG', 'GQ',
    'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU',
    'MA', 'MZ', 'NA', 'NE', 'NG', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN',
    'UG', 'ZM', 'ZW',
  ]);

  normalizeCode(code?: string | null) {
    return String(code || '').trim().toUpperCase();
  }

  private parseDate(value?: string | Date | null) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid promo code date');
    return date;
  }

  private intervalToDb(interval?: BillingInterval | string | null) {
    const value = String(interval || '').toUpperCase();
    if (value === 'MONTHLY') return 'MONTHLY';
    if (value === 'YEARLY') return 'YEARLY';
    return undefined;
  }

  private normalizeCountry(code?: string | null) {
    return String(code || '').trim().toUpperCase();
  }

  private normalizeCountries(codes?: string[] | null) {
    return (codes || []).map((code) => this.normalizeCountry(code)).filter(Boolean);
  }

  private assertDiscount(dto: Pick<CreatePromoCodeDto, 'discountType' | 'discountValue'>) {
    const type = dto.discountType ?? PromoDiscountType.NONE;
    if (type === PromoDiscountType.NONE) return;
    if (dto.discountValue == null || Number(dto.discountValue) <= 0) {
      throw new BadRequestException('discountValue is required for discount promo codes');
    }
    if (type === PromoDiscountType.PERCENTAGE && Number(dto.discountValue) > 100) {
      throw new BadRequestException('Percentage discount cannot exceed 100');
    }
  }

  private normalizeOptional(value?: string | null) {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  private assertProviderConfig(dto: Pick<CreatePromoCodeDto, 'stripePromotionCodeId' | 'stripeCouponId'>) {
    const stripePromotionCodeId = this.normalizeOptional(dto.stripePromotionCodeId);
    const stripeCouponId = this.normalizeOptional(dto.stripeCouponId);
    if (stripePromotionCodeId && !stripePromotionCodeId.startsWith('promo_')) {
      throw new BadRequestException('stripePromotionCodeId must start with "promo_"');
    }
    if (stripeCouponId && !stripeCouponId.startsWith('coupon_')) {
      throw new BadRequestException('stripeCouponId must start with "coupon_"');
    }
  }

  private assertApplies(code: { appliesToPlans: PromoAppliesToPlan }, plan?: Plan | null) {
    if (!plan || plan === Plan.FREE || code.appliesToPlans === PromoAppliesToPlan.ALL) return;
    if (code.appliesToPlans !== plan) throw new BadRequestException('Promo code does not apply to this plan');
  }

  private assertRegion(code: { regionScope?: PromoRegionScope | null; allowedCountries?: string[] | null }, countryCode?: string | null) {
    const scope = code.regionScope ?? PromoRegionScope.ALL;
    if (scope === PromoRegionScope.ALL) return;
    const country = this.normalizeCountry(countryCode);
    if (!country) throw new BadRequestException('Country is required for this promo code');
    const isAfrica = this.africanCountryCodes.has(country);
    if (scope === PromoRegionScope.NIGERIA && country !== 'NG') {
      throw new BadRequestException('Promo code is not valid for this country');
    }
    if (scope === PromoRegionScope.AFRICA && !isAfrica) {
      throw new BadRequestException('Promo code is not valid for this country');
    }
    if (scope === PromoRegionScope.GLOBAL && isAfrica) {
      throw new BadRequestException('Promo code is not valid for this country');
    }
    if (scope === PromoRegionScope.CUSTOM_COUNTRIES && !this.normalizeCountries(code.allowedCountries).includes(country)) {
      throw new BadRequestException('Promo code is not valid for this country');
    }
  }

  private assertUsable(code: {
    isActive: boolean;
    startsAt?: Date | null;
    expiresAt?: Date | null;
    maxRedemptions?: number | null;
    redemptionCount: number;
    appliesToPlans: PromoAppliesToPlan;
    regionScope?: PromoRegionScope | null;
    allowedCountries?: string[] | null;
  }, plan?: Plan | null, countryCode?: string | null) {
    const now = new Date();
    if (!code.isActive) throw new BadRequestException('Promo code is inactive');
    if (code.startsAt && code.startsAt > now) throw new BadRequestException('Promo code is not active yet');
    if (code.expiresAt && code.expiresAt <= now) throw new BadRequestException('Promo code has expired');
    if (code.maxRedemptions != null && code.redemptionCount >= code.maxRedemptions) {
      throw new BadRequestException('Promo code redemption limit reached');
    }
    this.assertApplies(code, plan);
    this.assertRegion(code, countryCode);
  }

  private async findUsableByCode(code: string, plan?: Plan | null, countryCode?: string | null) {
    const normalized = this.normalizeCode(code);
    if (!normalized) throw new BadRequestException('Promo code is required');
    const promo = await this.prisma.promoCode.findUnique({ where: { code: normalized } });
    if (!promo) throw new BadRequestException('Promo code is invalid');
    this.assertUsable(promo, plan, countryCode);
    return promo;
  }

  private selectProvider(provider?: BillingProvider | null, countryCode?: string | null) {
    if (provider) return provider;
    return this.africanCountryCodes.has(this.normalizeCountry(countryCode)) ? BillingProvider.PAYSTACK : BillingProvider.STRIPE;
  }

  private pricingPreview(promo: any, input: { provider?: BillingProvider | null; plan?: Plan | null; interval?: BillingInterval | null; countryCode?: string | null }) {
    const plan = input.plan && input.plan !== Plan.FREE ? input.plan as Exclude<Plan, 'FREE'> : Plan.PRO;
    const provider = this.selectProvider(input.provider, input.countryCode);
    const interval = input.interval ?? BillingInterval.MONTHLY;
    const price = this.pricing.getDisplayPrice(provider, plan, interval);
    const originalAmount = price.amountMinor;
    const discountValue = Number(promo.discountValue || 0);
    const discountAmount =
      promo.discountType === PromoDiscountType.PERCENTAGE
        ? Math.round(originalAmount * Math.min(100, Math.max(0, discountValue)) / 100)
        : promo.discountType === PromoDiscountType.FIXED
          ? Math.round(Math.max(0, discountValue))
          : 0;
    const clampedDiscount = Math.min(originalAmount, Math.max(0, discountAmount));
    const finalAmount = Math.max(0, originalAmount - clampedDiscount);
    return {
      provider,
      plan,
      interval,
      originalAmount,
      discountAmount: clampedDiscount,
      finalAmount,
      currency: price.currency,
      discountLabel:
        promo.discountType === PromoDiscountType.PERCENTAGE
          ? `${discountValue}% off`
          : promo.discountType === PromoDiscountType.FIXED
            ? `${price.currency} ${(clampedDiscount / 100).toFixed(2)} off`
            : 'Tracking only',
      renewalAmount: originalAmount,
      renewalNotice: 'Discount applies to this payment only. Renewals continue at the standard price.',
    };
  }

  private async assertNotRedeemed(promoCodeId: string, userId?: string | null, workspaceId?: string | null) {
    if (!userId && !workspaceId) return;
    const existing = await this.prisma.promoAttribution.findFirst({
      where: {
        promoCodeId,
        status: PromoAttributionStatus.SUBSCRIBED,
        OR: [
          ...(userId ? [{ userId }] : []),
          ...(workspaceId ? [{ workspaceId }] : []),
        ],
      },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('This promo code has already been used on this account.');
  }

  private publicPromo(promo: any, input: { provider?: BillingProvider | null; plan?: Plan | null; interval?: BillingInterval | null; countryCode?: string | null }) {
    const preview = this.pricingPreview(promo, input);
    const isDiscount = promo.discountType !== PromoDiscountType.NONE && preview.discountAmount > 0;
    const stripeDiscountConfigured = Boolean(this.normalizeOptional(promo.stripePromotionCodeId));
    const paystackDiscountMode = promo.paystackDiscountMode ?? PaystackDiscountMode.UNSUPPORTED;
    let providerSupported = true;
    let providerError: string | null = null;
    if (isDiscount && preview.provider === BillingProvider.STRIPE && !stripeDiscountConfigured) {
      providerSupported = false;
      providerError = 'This promo code is not configured for Stripe checkout yet.';
    }
    if (isDiscount && preview.provider === BillingProvider.PAYSTACK && paystackDiscountMode === PaystackDiscountMode.UNSUPPORTED) {
      providerSupported = false;
      providerError = 'Paystack one-time subscription discounts are not yet supported.';
    }
    if (isDiscount && preview.provider === BillingProvider.PAYSTACK && paystackDiscountMode === PaystackDiscountMode.TRACKING_ONLY) {
      providerError = 'This Paystack promo code is tracking-only and will not change the checkout price.';
    }
    return {
      valid: true,
      code: promo.code,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      discountDuration: PromoDiscountDuration.ONE_TIME,
      originalAmount: preview.originalAmount,
      discountAmount: preview.discountAmount,
      finalAmount: preview.finalAmount,
      currency: preview.currency,
      discountLabel: preview.discountLabel,
      renewalAmount: preview.renewalAmount,
      renewalNotice: preview.renewalNotice,
      regionScope: promo.regionScope ?? PromoRegionScope.ALL,
      allowedCountries: this.normalizeCountries(promo.allowedCountries),
      influencerName: promo.influencerName,
      appliesToPlans: promo.appliesToPlans,
      planApplies: !input.plan || promo.appliesToPlans === PromoAppliesToPlan.ALL || promo.appliesToPlans === input.plan,
      trackingOnly: promo.discountType === PromoDiscountType.NONE,
      stripeDiscountConfigured,
      paystackDiscountMode,
      providerSupported,
      providerError,
    };
  }

  async validatePublic(code: string, plan?: Plan, provider?: BillingProvider, interval?: BillingInterval, countryCode?: string) {
    const promo = await this.findUsableByCode(code, plan, countryCode);
    return this.publicPromo(promo, { plan, provider, interval, countryCode });
  }

  async create(dto: CreatePromoCodeDto, adminId?: string | null) {
    this.assertDiscount(dto);
    this.assertProviderConfig(dto);
    const code = this.normalizeCode(dto.code);
    if (!code) throw new BadRequestException('code is required');
    try {
      return await this.prisma.promoCode.create({
        data: {
          code,
          influencerName: String(dto.influencerName || '').trim(),
          influencerEmail: dto.influencerEmail ? String(dto.influencerEmail).trim().toLowerCase() : null,
          description: dto.description ? String(dto.description).trim() : null,
          discountType: dto.discountType ?? PromoDiscountType.NONE,
          discountValue: dto.discountType && dto.discountType !== PromoDiscountType.NONE ? dto.discountValue ?? null : null,
          discountDuration: PromoDiscountDuration.ONE_TIME,
          appliesToPlans: dto.appliesToPlans ?? PromoAppliesToPlan.ALL,
          regionScope: dto.regionScope ?? PromoRegionScope.ALL,
          allowedCountries: this.normalizeCountries(dto.allowedCountries),
          stripePromotionCodeId: this.normalizeOptional(dto.stripePromotionCodeId),
          stripeCouponId: this.normalizeOptional(dto.stripeCouponId),
          paystackDiscountMode: dto.paystackDiscountMode ?? PaystackDiscountMode.UNSUPPORTED,
          maxRedemptions: dto.maxRedemptions ?? null,
          startsAt: this.parseDate(dto.startsAt),
          expiresAt: this.parseDate(dto.expiresAt),
          isActive: dto.isActive ?? true,
          createdByAdminId: adminId ?? null,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('Promo code already exists');
      throw error;
    }
  }

  list() {
    return this.prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async get(id: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException('Promo code not found');
    return promo;
  }

  async update(id: string, dto: UpdatePromoCodeDto) {
    await this.get(id);
    this.assertDiscount(dto);
    this.assertProviderConfig(dto);
    const data: any = {
      influencerName: dto.influencerName != null ? String(dto.influencerName).trim() : undefined,
      influencerEmail: dto.influencerEmail != null ? String(dto.influencerEmail).trim().toLowerCase() : undefined,
      description: dto.description != null ? String(dto.description).trim() : undefined,
      discountType: dto.discountType,
      discountValue: dto.discountType === PromoDiscountType.NONE ? null : dto.discountValue,
      discountDuration: PromoDiscountDuration.ONE_TIME,
      appliesToPlans: dto.appliesToPlans,
      regionScope: dto.regionScope,
      allowedCountries: dto.allowedCountries !== undefined ? this.normalizeCountries(dto.allowedCountries) : undefined,
      stripePromotionCodeId: dto.stripePromotionCodeId !== undefined ? this.normalizeOptional(dto.stripePromotionCodeId) : undefined,
      stripeCouponId: dto.stripeCouponId !== undefined ? this.normalizeOptional(dto.stripeCouponId) : undefined,
      paystackDiscountMode: dto.paystackDiscountMode,
      maxRedemptions: dto.maxRedemptions,
      startsAt: dto.startsAt !== undefined ? this.parseDate(dto.startsAt) : undefined,
      expiresAt: dto.expiresAt !== undefined ? this.parseDate(dto.expiresAt) : undefined,
      isActive: dto.isActive,
    };
    if (dto.code != null) data.code = this.normalizeCode(dto.code);
    try {
      return await this.prisma.promoCode.update({ where: { id }, data });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('Promo code already exists');
      throw error;
    }
  }

  setActive(id: string, isActive: boolean) {
    return this.prisma.promoCode.update({ where: { id }, data: { isActive } });
  }

  async recordSignup(code: string | undefined | null, userId: string, workspaceId?: string | null) {
    if (!code) return null;
    const promo = await this.findUsableByCode(code);
    return this.prisma.promoAttribution.create({
      data: {
        promoCodeId: promo.id,
        userId,
        workspaceId: workspaceId ?? null,
        status: PromoAttributionStatus.SIGNUP,
      },
    });
  }

  async recordCheckoutStarted(input: CheckoutAttributionInput) {
    const promo = await this.findUsableByCode(input.code, input.plan, input.countryCode);
    await this.assertNotRedeemed(promo.id, input.userId, input.workspaceId);
    const preview = this.pricingPreview(promo, input);
    const stripePromotionCodeId =
      input.provider === BillingProvider.STRIPE && promo.discountType !== PromoDiscountType.NONE
        ? this.normalizeOptional((promo as any).stripePromotionCodeId)
        : null;
    if (promo.discountType !== PromoDiscountType.NONE && input.provider === BillingProvider.STRIPE && !stripePromotionCodeId) {
      throw new BadRequestException('This promo code is not configured for Stripe checkout yet.');
    }
    const paystackDiscountMode = (promo as any).paystackDiscountMode ?? PaystackDiscountMode.UNSUPPORTED;
    if (
      promo.discountType !== PromoDiscountType.NONE &&
      input.provider === BillingProvider.PAYSTACK &&
      preview.discountAmount > 0 &&
      paystackDiscountMode === PaystackDiscountMode.UNSUPPORTED
    ) {
      throw new BadRequestException('Paystack one-time subscription discounts are not yet supported.');
    }
    const paystackTrackingOnly =
      promo.discountType !== PromoDiscountType.NONE &&
      input.provider === BillingProvider.PAYSTACK &&
      preview.discountAmount > 0 &&
      paystackDiscountMode === PaystackDiscountMode.TRACKING_ONLY;
    const checkoutAmounts = paystackTrackingOnly
      ? { discountAmount: 0, finalAmount: preview.originalAmount }
      : { discountAmount: preview.discountAmount, finalAmount: preview.finalAmount };
    const attribution = await this.prisma.promoAttribution.create({
      data: {
        promoCodeId: promo.id,
        userId: input.userId,
        workspaceId: input.workspaceId,
        provider: input.provider,
        plan: input.plan,
        interval: this.intervalToDb(input.interval) as any,
        originalAmount: preview.originalAmount,
        discountAmount: checkoutAmounts.discountAmount,
        finalAmount: checkoutAmounts.finalAmount,
        renewalAmount: preview.renewalAmount,
        amount: checkoutAmounts.finalAmount,
        currency: preview.currency,
        countryCode: this.normalizeCountry(input.countryCode) || null,
        regionScope: promo.regionScope ?? PromoRegionScope.ALL,
        discountDuration: PromoDiscountDuration.ONE_TIME,
        status: PromoAttributionStatus.CHECKOUT_STARTED,
      },
    });
    return {
      promo,
      attribution,
      metadata: {
        promoCodeId: promo.id,
        promoCode: promo.code,
        promoAttributionId: attribution.id,
        promoDiscountType: promo.discountType,
        promoDiscountApplied: Boolean(stripePromotionCodeId) || (input.provider === BillingProvider.PAYSTACK && paystackDiscountMode === PaystackDiscountMode.ONE_TIME_AMOUNT_DISCOUNT && preview.discountAmount > 0),
        discountDuration: PromoDiscountDuration.ONE_TIME,
        originalAmount: preview.originalAmount,
        discountAmount: checkoutAmounts.discountAmount,
        finalAmount: checkoutAmounts.finalAmount,
        renewalAmount: preview.renewalAmount,
        currency: preview.currency,
        countryCode: this.normalizeCountry(input.countryCode) || null,
        regionScope: promo.regionScope ?? PromoRegionScope.ALL,
        paystackDiscountMode,
      },
      stripePromotionCodeId,
      preview,
    };
  }

  async markSubscribed(input: SubscribeInput) {
    const promoAttributionId = String(input.promoAttributionId || '').trim();
    const promoCodeId = String(input.promoCodeId || '').trim();
    if (!promoAttributionId && !promoCodeId) return null;
    const subscriptionId = input.subscriptionId || null;
    const data = {
      subscriptionId,
      provider: input.provider,
      plan: input.plan ?? undefined,
      interval: this.intervalToDb(input.interval) as any,
      originalAmount: input.originalAmount ?? undefined,
      discountAmount: input.discountAmount ?? undefined,
      finalAmount: input.finalAmount ?? input.amount ?? undefined,
      renewalAmount: input.renewalAmount ?? undefined,
      amount: input.finalAmount ?? input.amount ?? undefined,
      currency: input.currency ? String(input.currency).toUpperCase() : undefined,
      countryCode: this.normalizeCountry(input.countryCode) || undefined,
      regionScope: input.regionScope as any,
      discountDuration: (input.discountDuration as any) || PromoDiscountDuration.ONE_TIME,
      redeemedAt: new Date(),
      status: PromoAttributionStatus.SUBSCRIBED,
    };

    const existing = promoAttributionId
      ? await this.prisma.promoAttribution.findUnique({ where: { id: promoAttributionId } })
      : await this.prisma.promoAttribution.findFirst({
          where: { promoCodeId, workspaceId: input.workspaceId, status: { in: [PromoAttributionStatus.CHECKOUT_STARTED, PromoAttributionStatus.SIGNUP] } },
          orderBy: { createdAt: 'desc' },
        });
    if (!existing) return null;

    const updated = await this.prisma.promoAttribution.update({ where: { id: existing.id }, data }).catch((error: any) => {
      if (error?.code === 'P2002') throw new BadRequestException('This promo code has already been used on this account.');
      throw error;
    });
    if (existing.status !== PromoAttributionStatus.SUBSCRIBED) {
      await this.prisma.promoCode.update({ where: { id: updated.promoCodeId }, data: { redemptionCount: { increment: 1 } } });
    }
    return updated;
  }

  async performance(id: string) {
    const promo = await this.get(id);
    const attributions = await this.prisma.promoAttribution.findMany({
      where: { promoCodeId: id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true, name: true } }, workspace: { select: { id: true, name: true } } },
    });
    const count = (status: PromoAttributionStatus) => attributions.filter((item) => item.status === status).length;
    const subscribed = attributions.filter((item) => item.status === PromoAttributionStatus.SUBSCRIBED);
    const revenue = subscribed.reduce((sum, item) => sum + Number(item.finalAmount ?? item.amount ?? 0), 0);
    const revenueBeforeDiscount = subscribed.reduce((sum, item) => sum + Number(item.originalAmount ?? item.amount ?? 0), 0);
    const discountTotal = subscribed.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0);
    const revenueByProvider: Record<string, number> = {};
    const revenueByPlan: Record<string, number> = {};
    for (const item of subscribed) {
      const amount = Number(item.finalAmount ?? item.amount ?? 0);
      if (item.provider) revenueByProvider[item.provider] = (revenueByProvider[item.provider] || 0) + amount;
      if (item.plan) revenueByPlan[item.plan] = (revenueByPlan[item.plan] || 0) + amount;
    }
    const checkoutStarts = count(PromoAttributionStatus.CHECKOUT_STARTED);
    const successfulSubscriptions = subscribed.length;
    return {
      promoCode: promo,
      signups: count(PromoAttributionStatus.SIGNUP),
      checkoutStarts,
      successfulSubscriptions,
      conversionRate: checkoutStarts ? successfulSubscriptions / checkoutStarts : 0,
      revenueAttributed: revenue,
      revenueAfterDiscount: revenue,
      revenueBeforeDiscount,
      discountTotal,
      discountGiven: discountTotal,
      stripeConfigured: {
        configured: Boolean(this.normalizeOptional((promo as any).stripePromotionCodeId)),
        count: this.normalizeOptional((promo as any).stripePromotionCodeId) ? 1 : 0,
      },
      paystackDiscountMode: (promo as any).paystackDiscountMode ?? PaystackDiscountMode.UNSUPPORTED,
      redemptionUniqueness: {
        uniqueUsers: new Set(subscribed.map((item) => item.userId)).size,
        uniqueWorkspaces: new Set(subscribed.map((item) => item.workspaceId).filter(Boolean)).size,
      },
      revenueByProvider,
      revenueByPlan,
      latestRedemptions: attributions.slice(0, 20),
    };
  }
}
