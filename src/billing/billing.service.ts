/* eslint-disable prettier/prettier */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BillingProvider, Plan, SubscriptionStatus, WorkspaceSubscription, WorkspaceUsage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanLimitsService } from './plan-limits.service';
import { AuditService } from '../audit/audit.service';
import { sanitizeMetadata } from '../common/safe-metadata';
import { GenericBillingWebhookAdapter } from './webhooks/generic-billing-webhook.adapter';
import { BillingInterval } from './dto/start-checkout.dto';
import { StripeBillingAdapter } from './providers/stripe-billing.adapter';
import { PaystackBillingAdapter } from './providers/paystack-billing.adapter';
import { LiveBillingProviderAdapter, ProviderSubscriptionUpdate } from './providers/billing-provider.types';
import { BillingPricingService } from './providers/billing-pricing.service';

type UsageIncrement = {
  videoGenerations?: number;
  publishes?: number;
  aiGenerations?: number;
  renderMinutes?: number;
  storageBytes?: bigint | number;
};

type SubscriptionUpdate = {
  plan?: Plan;
  status?: SubscriptionStatus;
  billingProvider?: BillingProvider | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  trialEndsAt?: Date | null;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
    private readonly audit: AuditService,
    private readonly webhookAdapter: GenericBillingWebhookAdapter,
    private readonly stripe: StripeBillingAdapter,
    private readonly paystack: PaystackBillingAdapter,
    private readonly pricing: BillingPricingService,
  ) {}

  private startOfMonth(date = new Date()) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  }

  private startOfNextMonth(date = new Date()) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  }

  private defaultPeriod() {
    const now = new Date();
    return { start: this.startOfMonth(now), end: this.startOfNextMonth(now) };
  }

  private initialTrialDays() {
    return Math.max(0, Number(process.env.WORKSPACE_TRIAL_DAYS || 0));
  }

  private async requireWorkspace(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, suspended: true, suspensionReason: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async assertWorkspaceActive(workspaceId: string) {
    const workspace = await this.requireWorkspace(workspaceId);
    if (workspace.suspended) {
      throw new ForbiddenException(workspace.suspensionReason || 'Workspace is suspended');
    }
  }

  async getOrCreateSubscription(workspaceId: string) {
    await this.requireWorkspace(workspaceId);
    const existing = await this.prisma.workspaceSubscription.findUnique({ where: { workspaceId } });
    if (existing) return this.normalizeSubscription(existing);

    const period = this.defaultPeriod();
    const trialDays = this.initialTrialDays();
    const trialEndsAt = trialDays > 0 ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null;

    const created = await this.prisma.workspaceSubscription.create({
      data: {
        workspaceId,
        plan: trialEndsAt ? Plan.PREMIUM : Plan.FREE,
        status: trialEndsAt ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        currentPeriodStart: period.start,
        currentPeriodEnd: trialEndsAt ?? period.end,
        trialEndsAt,
      },
    });

    return this.normalizeSubscription(created);
  }

  private async normalizeSubscription(subscription: WorkspaceSubscription) {
    const now = new Date();
    const trialExpired = subscription.status === SubscriptionStatus.TRIALING && subscription.trialEndsAt && subscription.trialEndsAt <= now;
    const periodExpired = subscription.status === SubscriptionStatus.ACTIVE && subscription.currentPeriodEnd <= now && subscription.plan !== Plan.FREE;

    if (!trialExpired && !periodExpired) return subscription;

    return this.prisma.workspaceSubscription.update({
      where: { workspaceId: subscription.workspaceId },
      data: {
        plan: Plan.FREE,
        status: SubscriptionStatus.EXPIRED,
        cancelAtPeriodEnd: false,
      },
    });
  }

  effectivePlan(subscription: WorkspaceSubscription): Plan {
    const now = new Date();
    if (subscription.status === SubscriptionStatus.TRIALING && subscription.trialEndsAt && subscription.trialEndsAt > now) {
      return subscription.plan;
    }
    if (subscription.status === SubscriptionStatus.ACTIVE && subscription.currentPeriodEnd > now) {
      return subscription.plan;
    }
    if (
      subscription.plan === Plan.FREE &&
      (subscription.status === SubscriptionStatus.ACTIVE || subscription.status === SubscriptionStatus.EXPIRED)
    ) {
      return Plan.FREE;
    }
    return Plan.FREE;
  }

  private usagePeriod(subscription: WorkspaceSubscription) {
    const now = new Date();
    if (subscription.currentPeriodStart <= now && subscription.currentPeriodEnd > now) {
      return { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd };
    }
    return this.defaultPeriod();
  }

  async getUsage(workspaceId: string) {
    const subscription = await this.getOrCreateSubscription(workspaceId);
    const period = this.usagePeriod(subscription);

    const usage = await this.prisma.workspaceUsage.upsert({
      where: { workspaceId_periodStart: { workspaceId, periodStart: period.start } },
      update: { periodEnd: period.end },
      create: {
        workspaceId,
        periodStart: period.start,
        periodEnd: period.end,
      },
    });

    return usage;
  }

  private serializeSubscription(subscription: WorkspaceSubscription) {
    const effectivePlan = this.effectivePlan(subscription);
    return {
      ...subscription,
      effectivePlan,
      limits: this.planLimits.serializeLimits(this.planLimits.getLimits(effectivePlan)),
    };
  }

  private serializeUsage(usage: WorkspaceUsage) {
    return {
      ...usage,
      storageBytes: usage.storageBytes.toString(),
    };
  }

  async getSubscriptionResponse(workspaceId: string) {
    const response = this.serializeSubscription(await this.getOrCreateSubscription(workspaceId));
    this.logger.debug({ message: 'Subscription fetched', workspaceId, plan: response.effectivePlan });
    return response;
  }

  async getUsageResponse(workspaceId: string) {
    const subscription = await this.getOrCreateSubscription(workspaceId);
    const usage = await this.getUsage(workspaceId);
    const effectivePlan = this.effectivePlan(subscription);
    const response = {
      usage: this.serializeUsage(usage),
      plan: effectivePlan,
      limits: this.planLimits.serializeLimits(this.planLimits.getLimits(effectivePlan)),
    };
    this.logger.debug({ message: 'Usage fetched', workspaceId, plan: effectivePlan });
    return response;
  }

  private async assertWithinLimit(workspaceId: string, field: keyof Pick<WorkspaceUsage, 'videoGenerations' | 'publishes' | 'aiGenerations'>, label: string) {
    await this.assertWorkspaceActive(workspaceId);
    const subscription = await this.getOrCreateSubscription(workspaceId);
    const plan = this.effectivePlan(subscription);
    const limits = this.planLimits.getLimits(plan);
    const usage = await this.getUsage(workspaceId);

    if (Number(usage[field]) >= limits[field]) {
      throw new ConflictException(`${label} limit reached for ${plan} plan`);
    }
  }

  assertCanGenerateVideo(workspaceId: string) {
    return this.assertWithinLimit(workspaceId, 'videoGenerations', 'Video generation');
  }

  assertCanPublish(workspaceId: string) {
    return this.assertWithinLimit(workspaceId, 'publishes', 'Publish');
  }

  assertCanGenerateAi(workspaceId: string) {
    return this.assertWithinLimit(workspaceId, 'aiGenerations', 'AI generation');
  }

  async incrementUsage(workspaceId: string, increment: UsageIncrement) {
    const usage = await this.getUsage(workspaceId);
    return this.prisma.workspaceUsage.update({
      where: { id: usage.id },
      data: {
        videoGenerations: increment.videoGenerations ? { increment: increment.videoGenerations } : undefined,
        publishes: increment.publishes ? { increment: increment.publishes } : undefined,
        aiGenerations: increment.aiGenerations ? { increment: increment.aiGenerations } : undefined,
        renderMinutes: increment.renderMinutes ? { increment: increment.renderMinutes } : undefined,
        storageBytes: increment.storageBytes ? { increment: increment.storageBytes } : undefined,
      },
    });
  }

  private async consumeUsageWithinLimits(
    workspaceId: string,
    increment: UsageIncrement,
    limited: Array<keyof Pick<WorkspaceUsage, 'videoGenerations' | 'publishes' | 'aiGenerations'>>,
    label: string,
  ) {
    await this.assertWorkspaceActive(workspaceId);
    const subscription = await this.getOrCreateSubscription(workspaceId);
    const plan = this.effectivePlan(subscription);
    const limits = this.planLimits.getLimits(plan);
    const usage = await this.getUsage(workspaceId);
    const where: any = { id: usage.id };

    for (const field of limited) {
      const amount = Number(increment[field] ?? 0);
      if (amount <= 0) continue;
      where[field] = { lte: Math.max(0, Number(limits[field]) - amount) };
    }

    const result = await this.prisma.workspaceUsage.updateMany({
      where,
      data: {
        videoGenerations: increment.videoGenerations ? { increment: increment.videoGenerations } : undefined,
        publishes: increment.publishes ? { increment: increment.publishes } : undefined,
        aiGenerations: increment.aiGenerations ? { increment: increment.aiGenerations } : undefined,
        renderMinutes: increment.renderMinutes ? { increment: increment.renderMinutes } : undefined,
        storageBytes: increment.storageBytes ? { increment: increment.storageBytes } : undefined,
      },
    });

    if (result.count !== 1) {
      throw new ConflictException(`${label} limit reached for ${plan} plan`);
    }

    return this.prisma.workspaceUsage.findUnique({ where: { id: usage.id } });
  }

  consumeVideoGeneration(workspaceId: string, increment: UsageIncrement = { videoGenerations: 1 }) {
    return this.consumeUsageWithinLimits(workspaceId, increment, ['videoGenerations'], 'Video generation');
  }

  consumePublish(workspaceId: string, increment: UsageIncrement = { publishes: 1 }) {
    return this.consumeUsageWithinLimits(workspaceId, increment, ['publishes'], 'Publish');
  }

  consumeAiGeneration(workspaceId: string, increment: UsageIncrement = { aiGenerations: 1 }) {
    return this.consumeUsageWithinLimits(workspaceId, increment, ['aiGenerations'], 'AI generation');
  }

  listPlans() {
    return {
      plans: this.planLimits.listPlans(),
      pricing: this.pricing.listDisplayPrices(),
    };
  }

  private providerAdapter(provider: BillingProvider): LiveBillingProviderAdapter {
    if (provider === BillingProvider.STRIPE) return this.stripe;
    if (provider === BillingProvider.PAYSTACK) return this.paystack;
    throw new BadRequestException('Unsupported billing provider');
  }

  private normalizeProvider(provider?: string | BillingProvider | null): BillingProvider | null {
    if (!provider) return null;
    const value = String(provider).toUpperCase();
    if (value === 'GENERIC') return null;
    if (value === BillingProvider.STRIPE) return BillingProvider.STRIPE;
    if (value === BillingProvider.PAYSTACK) return BillingProvider.PAYSTACK;
    throw new BadRequestException('Invalid billing provider');
  }

  private selectProvider(provider?: string | BillingProvider | null, country?: string | null) {
    const requested = this.normalizeProvider(provider);
    if (requested) return requested;
    const code = String(country || '').trim().toUpperCase();
    const paystackCountries = new Set(['NG', 'GH', 'ZA', 'KE', 'CI', 'EG', 'RW']);
    return paystackCountries.has(code) ? BillingProvider.PAYSTACK : BillingProvider.STRIPE;
  }

  private checkoutUrl(kind: 'success' | 'cancel') {
    const base = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
    if (!base) throw new BadRequestException('FRONTEND_URL is required for billing redirects');
    return `${base}/billing/${kind}`;
  }

  private async actorEmail(actor?: { userId?: string | null }) {
    if (!actor?.userId) return null;
    const user = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { email: true } });
    return user?.email ?? null;
  }

  async startCheckout(
    workspaceId: string,
    requestedPlan?: Plan,
    actor?: { userId?: string | null; adminId?: string | null },
    options?: { provider?: BillingProvider | string | null; interval?: BillingInterval | null; country?: string | null },
  ) {
    await this.assertWorkspaceActive(workspaceId);
    await this.getOrCreateSubscription(workspaceId);
    const plan = requestedPlan ?? Plan.PRO;
    if (plan === Plan.FREE) throw new BadRequestException('FREE plan does not require checkout');
    if (!actor?.userId) throw new ForbiddenException('SaaS user is required for checkout');
    const provider = this.selectProvider(options?.provider, options?.country);
    const interval = options?.interval ?? BillingInterval.MONTHLY;
    const checkout = await this.providerAdapter(provider).createCheckout({
      workspaceId,
      userId: actor.userId,
      email: await this.actorEmail(actor),
      plan: plan as Exclude<Plan, 'FREE'>,
      interval,
      successUrl: this.checkoutUrl('success'),
      cancelUrl: this.checkoutUrl('cancel'),
    });
    await this.audit.record({
      action: 'BILLING_CHECKOUT_REQUESTED',
      workspaceId,
      userId: actor?.userId ?? null,
      adminId: actor?.adminId ?? null,
      metadata: { requestedPlan: plan, provider, interval, reference: checkout.reference },
    });
    return checkout;
  }

  async cancel(workspaceId: string, actor?: { userId?: string | null; adminId?: string | null }) {
    await this.assertWorkspaceActive(workspaceId);
    const subscription = await this.getOrCreateSubscription(workspaceId);
    const provider = this.normalizeProvider(subscription.billingProvider);
    if (provider && subscription.providerSubscriptionId) {
      await this.providerAdapter(provider).cancelSubscription(subscription.providerSubscriptionId, subscription.providerCustomerId);
    }
    const updated = await this.prisma.workspaceSubscription.update({
      where: { workspaceId },
      data: {
        cancelAtPeriodEnd: true,
        status: subscription.status === SubscriptionStatus.TRIALING ? SubscriptionStatus.CANCELED : subscription.status,
      },
    });
    await this.audit.record({
      action: 'BILLING_CANCEL_REQUESTED',
      workspaceId,
      userId: actor?.userId ?? null,
      adminId: actor?.adminId ?? null,
      targetType: 'WorkspaceSubscription',
      targetId: updated.id,
    });
    return this.serializeSubscription(updated);
  }

  private async applyProviderSubscriptionUpdate(provider: BillingProvider, update: ProviderSubscriptionUpdate) {
    const period = this.defaultPeriod();
    return this.prisma.workspaceSubscription.upsert({
      where: { workspaceId: update.workspaceId },
      create: {
        workspaceId: update.workspaceId,
        plan: update.plan ?? Plan.PRO,
        status: update.status,
        billingProvider: provider,
        providerCustomerId: update.providerCustomerId ?? null,
        providerSubscriptionId: update.providerSubscriptionId ?? null,
        currentPeriodStart: update.currentPeriodStart ?? period.start,
        currentPeriodEnd: update.currentPeriodEnd ?? period.end,
        cancelAtPeriodEnd: update.cancelAtPeriodEnd ?? false,
        trialEndsAt: update.trialEndsAt ?? null,
      },
      update: {
        plan: update.plan,
        status: update.status,
        billingProvider: provider,
        providerCustomerId: update.providerCustomerId ?? undefined,
        providerSubscriptionId: update.providerSubscriptionId ?? undefined,
        currentPeriodStart: update.currentPeriodStart,
        currentPeriodEnd: update.currentPeriodEnd,
        cancelAtPeriodEnd: update.cancelAtPeriodEnd,
        trialEndsAt: update.trialEndsAt,
      },
    });
  }

  async handleWebhook(provider = 'generic', payload: unknown = {}, headers: Record<string, unknown> = {}, rawBody?: string | Buffer) {
    const normalizedProvider = this.normalizeProvider(provider);
    const adapter = normalizedProvider ? this.providerAdapter(normalizedProvider) : null;
    const verification = adapter
      ? adapter.verifyWebhook(rawBody, headers)
      : this.webhookAdapter.verify({ provider, payload, headers, rawBody } as never);
    if (!verification.valid) {
      throw new ForbiddenException(`Invalid billing webhook signature: ${verification.reason || 'unknown'}`);
    }

    const parsed = adapter?.parseWebhook(payload);
    const eventId = parsed?.providerEventId || this.webhookAdapter.extractEventId(payload) || `${provider}:${Date.now()}`;
    const eventType = parsed?.eventType || this.webhookAdapter.extractEventType(payload);

    try {
      const event = await this.prisma.billingWebhookEvent.create({
        data: {
          provider,
          providerEventId: eventId,
          eventType,
          payload: sanitizeMetadata(payload) as never,
          status: 'RECEIVED',
        },
      });
      if (normalizedProvider && parsed?.subscriptionUpdate && !parsed.ignored) {
        await this.applyProviderSubscriptionUpdate(normalizedProvider, parsed.subscriptionUpdate);
        await this.prisma.billingWebhookEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', processedAt: new Date() },
        });
      }

      return {
        received: true,
        duplicate: false,
        provider,
        providerEventId: event.providerEventId,
        eventType,
        status: parsed?.ignored ? 'IGNORED' : normalizedProvider ? 'PROCESSED' : 'PLACEHOLDER',
      };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return {
          received: true,
          duplicate: true,
          provider,
          providerEventId: eventId,
          eventType,
          status: 'IGNORED_DUPLICATE',
        };
      }
      throw error;
    }
  }

  async listWorkspaces() {
    return this.prisma.workspace.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, email: true, name: true } },
        subscription: true,
        _count: { select: { members: true, videoJobs: true } },
      },
    });
  }

  async listUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        _count: { select: { memberships: true, ownedWorkspaces: true } },
      },
    });
  }

  async updateSubscription(workspaceId: string, update: SubscriptionUpdate, actor?: { adminId?: string | null }) {
    await this.requireWorkspace(workspaceId);
    await this.getOrCreateSubscription(workspaceId);
    const period = this.defaultPeriod();
    const updated = await this.prisma.workspaceSubscription.update({
      where: { workspaceId },
      data: {
        plan: update.plan,
        status: update.status,
        billingProvider: update.billingProvider,
        providerCustomerId: update.providerCustomerId,
        providerSubscriptionId: update.providerSubscriptionId,
        currentPeriodStart: update.currentPeriodStart ?? undefined,
        currentPeriodEnd: update.currentPeriodEnd ?? (update.plan ? period.end : undefined),
        cancelAtPeriodEnd: update.cancelAtPeriodEnd,
        trialEndsAt: update.trialEndsAt,
      },
    });
    await this.audit.record({
      action: 'SUBSCRIPTION_CHANGED',
      workspaceId,
      adminId: actor?.adminId ?? null,
      targetType: 'WorkspaceSubscription',
      targetId: updated.id,
      metadata: { plan: updated.plan, status: updated.status, billingProvider: updated.billingProvider },
    });
    return this.serializeSubscription(updated);
  }

  async suspendWorkspace(workspaceId: string, reason?: string, actor?: { adminId?: string | null }) {
    await this.requireWorkspace(workspaceId);
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        suspended: true,
        suspendedAt: new Date(),
        suspensionReason: reason ?? null,
      },
    });
    await this.audit.record({
      action: 'WORKSPACE_SUSPENDED',
      workspaceId,
      adminId: actor?.adminId ?? null,
      targetType: 'Workspace',
      targetId: workspaceId,
      metadata: { reason },
    });
    return workspace;
  }

  async unsuspendWorkspace(workspaceId: string, actor?: { adminId?: string | null }) {
    await this.requireWorkspace(workspaceId);
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        suspended: false,
        suspendedAt: null,
        suspensionReason: null,
      },
    });
    await this.audit.record({
      action: 'WORKSPACE_UNSUSPENDED',
      workspaceId,
      adminId: actor?.adminId ?? null,
      targetType: 'Workspace',
      targetId: workspaceId,
    });
    return workspace;
  }
}
