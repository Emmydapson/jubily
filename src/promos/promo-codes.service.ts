import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingProvider,
  Plan,
  PromoAppliesToPlan,
  PromoAttributionStatus,
  PromoDiscountType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingInterval } from '../billing/dto/start-checkout.dto';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';

type CheckoutAttributionInput = {
  code: string;
  userId: string;
  workspaceId: string;
  provider: BillingProvider;
  plan: Exclude<Plan, 'FREE'>;
  interval: BillingInterval;
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
  currency?: string | null;
};

@Injectable()
export class PromoCodesService {
  constructor(private readonly prisma: PrismaService) {}

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

  private assertApplies(code: { appliesToPlans: PromoAppliesToPlan }, plan?: Plan | null) {
    if (!plan || plan === Plan.FREE || code.appliesToPlans === PromoAppliesToPlan.ALL) return;
    if (code.appliesToPlans !== plan) throw new BadRequestException('Promo code does not apply to this plan');
  }

  private assertUsable(code: {
    isActive: boolean;
    startsAt?: Date | null;
    expiresAt?: Date | null;
    maxRedemptions?: number | null;
    redemptionCount: number;
    appliesToPlans: PromoAppliesToPlan;
  }, plan?: Plan | null) {
    const now = new Date();
    if (!code.isActive) throw new BadRequestException('Promo code is inactive');
    if (code.startsAt && code.startsAt > now) throw new BadRequestException('Promo code is not active yet');
    if (code.expiresAt && code.expiresAt <= now) throw new BadRequestException('Promo code has expired');
    if (code.maxRedemptions != null && code.redemptionCount >= code.maxRedemptions) {
      throw new BadRequestException('Promo code redemption limit reached');
    }
    this.assertApplies(code, plan);
  }

  private async findUsableByCode(code: string, plan?: Plan | null) {
    const normalized = this.normalizeCode(code);
    if (!normalized) throw new BadRequestException('Promo code is required');
    const promo = await this.prisma.promoCode.findUnique({ where: { code: normalized } });
    if (!promo) throw new BadRequestException('Promo code is invalid');
    this.assertUsable(promo, plan);
    return promo;
  }

  private stripePromotionCodeEnv(code: string) {
    const suffix = code.replace(/[^A-Z0-9]/g, '_');
    return String(process.env[`STRIPE_PROMO_${suffix}_PROMOTION_CODE_ID`] || '').trim() || null;
  }

  private publicPromo(promo: any, plan?: Plan | null) {
    const stripePromotionCodeId = promo.discountType === PromoDiscountType.NONE ? null : this.stripePromotionCodeEnv(promo.code);
    return {
      code: promo.code,
      influencerName: promo.influencerName,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      appliesToPlans: promo.appliesToPlans,
      planApplies: !plan || promo.appliesToPlans === PromoAppliesToPlan.ALL || promo.appliesToPlans === plan,
      trackingOnly: promo.discountType === PromoDiscountType.NONE,
      stripeDiscountConfigured: Boolean(stripePromotionCodeId),
    };
  }

  async validatePublic(code: string, plan?: Plan) {
    const promo = await this.findUsableByCode(code, plan);
    return { valid: true, promo: this.publicPromo(promo, plan) };
  }

  async create(dto: CreatePromoCodeDto, adminId?: string | null) {
    this.assertDiscount(dto);
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
          appliesToPlans: dto.appliesToPlans ?? PromoAppliesToPlan.ALL,
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
    const data: any = {
      influencerName: dto.influencerName != null ? String(dto.influencerName).trim() : undefined,
      influencerEmail: dto.influencerEmail != null ? String(dto.influencerEmail).trim().toLowerCase() : undefined,
      description: dto.description != null ? String(dto.description).trim() : undefined,
      discountType: dto.discountType,
      discountValue: dto.discountType === PromoDiscountType.NONE ? null : dto.discountValue,
      appliesToPlans: dto.appliesToPlans,
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
    const promo = await this.findUsableByCode(input.code, input.plan);
    const stripePromotionCodeId =
      input.provider === BillingProvider.STRIPE && promo.discountType !== PromoDiscountType.NONE
        ? this.stripePromotionCodeEnv(promo.code)
        : null;
    const attribution = await this.prisma.promoAttribution.create({
      data: {
        promoCodeId: promo.id,
        userId: input.userId,
        workspaceId: input.workspaceId,
        provider: input.provider,
        plan: input.plan,
        interval: this.intervalToDb(input.interval) as any,
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
        promoDiscountApplied: Boolean(stripePromotionCodeId),
      },
      stripePromotionCodeId,
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
      amount: input.amount ?? undefined,
      currency: input.currency ? String(input.currency).toUpperCase() : undefined,
      status: PromoAttributionStatus.SUBSCRIBED,
    };

    const existing = promoAttributionId
      ? await this.prisma.promoAttribution.findUnique({ where: { id: promoAttributionId } })
      : await this.prisma.promoAttribution.findFirst({
          where: { promoCodeId, workspaceId: input.workspaceId, status: { in: [PromoAttributionStatus.CHECKOUT_STARTED, PromoAttributionStatus.SIGNUP] } },
          orderBy: { createdAt: 'desc' },
        });
    if (!existing) return null;

    const updated = await this.prisma.promoAttribution.update({ where: { id: existing.id }, data });
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
    const revenue = subscribed.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const revenueByProvider: Record<string, number> = {};
    const revenueByPlan: Record<string, number> = {};
    for (const item of subscribed) {
      if (item.provider) revenueByProvider[item.provider] = (revenueByProvider[item.provider] || 0) + Number(item.amount || 0);
      if (item.plan) revenueByPlan[item.plan] = (revenueByPlan[item.plan] || 0) + Number(item.amount || 0);
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
      revenueByProvider,
      revenueByPlan,
      latestRedemptions: attributions.slice(0, 20),
    };
  }
}
