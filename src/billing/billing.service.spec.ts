import { ConflictException, ForbiddenException } from '@nestjs/common';
import { BillingProvider, Plan, SubscriptionStatus } from '@prisma/client';
import { BillingService } from './billing.service';
import { PlanLimitsService } from './plan-limits.service';

describe('BillingService', () => {
  const periodStart = new Date('2026-06-01T00:00:00.000Z');
  const periodEnd = new Date('2026-07-01T00:00:00.000Z');
  let prisma: any;
  let audit: { record: jest.Mock };
  let webhookAdapter: { verify: jest.Mock; extractEventId: jest.Mock; extractEventType: jest.Mock };
  let stripe: { createCheckout: jest.Mock; cancelSubscription: jest.Mock; verifyWebhook: jest.Mock; parseWebhook: jest.Mock };
  let paystack: { createCheckout: jest.Mock; cancelSubscription: jest.Mock; verifyWebhook: jest.Mock; parseWebhook: jest.Mock };
  let service: BillingService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
    prisma = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ id: 'workspace-1', suspended: false, suspensionReason: null }),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      workspaceSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub-1',
          workspaceId: 'workspace-1',
          plan: Plan.FREE,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          trialEndsAt: null,
        }),
        create: jest.fn(),
        update: jest.fn((args) => Promise.resolve({ id: 'sub-1', workspaceId: 'workspace-1', ...args.data })),
        upsert: jest.fn((args) => Promise.resolve({ id: 'sub-1', workspaceId: args.where.workspaceId, ...args.update })),
      },
      workspaceUsage: {
        upsert: jest.fn().mockResolvedValue({
          id: 'usage-1',
          workspaceId: 'workspace-1',
          periodStart,
          periodEnd,
          videoGenerations: 0,
          publishes: 0,
          aiGenerations: 0,
          renderMinutes: 0,
          storageBytes: 0n,
        }),
        update: jest.fn().mockResolvedValue({ id: 'usage-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'usage-1',
          workspaceId: 'workspace-1',
          periodStart,
          periodEnd,
          videoGenerations: 1,
          publishes: 0,
          aiGenerations: 0,
          renderMinutes: 0,
          storageBytes: 0n,
        }),
      },
      user: { findMany: jest.fn(), findUnique: jest.fn() },
      billingWebhookEvent: { create: jest.fn(), update: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(null) };
    webhookAdapter = {
      verify: jest.fn().mockReturnValue({ valid: true }),
      extractEventId: jest.fn().mockReturnValue('evt-1'),
      extractEventType: jest.fn().mockReturnValue('subscription.updated'),
    };
    stripe = {
      createCheckout: jest.fn(),
      cancelSubscription: jest.fn(),
      verifyWebhook: jest.fn().mockReturnValue({ valid: true }),
      parseWebhook: jest.fn(),
    };
    paystack = {
      createCheckout: jest.fn(),
      cancelSubscription: jest.fn(),
      verifyWebhook: jest.fn().mockReturnValue({ valid: true }),
      parseWebhook: jest.fn(),
    };
    service = new BillingService(prisma, new PlanLimitsService(), audit as never, webhookAdapter as never, stripe as never, paystack as never);
  });

  afterEach(() => jest.useRealTimers());

  it('blocks a free workspace after the monthly video generation limit', async () => {
    prisma.workspaceUsage.upsert.mockResolvedValueOnce({
      id: 'usage-1',
      workspaceId: 'workspace-1',
      periodStart,
      periodEnd,
      videoGenerations: 3,
      publishes: 0,
      aiGenerations: 0,
      renderMinutes: 0,
      storageBytes: 0n,
    });

    await expect(service.assertCanGenerateVideo('workspace-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows pro and premium workspaces within their limits', async () => {
    prisma.workspaceSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      workspaceId: 'workspace-1',
      plan: Plan.PRO,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    });
    prisma.workspaceUsage.upsert.mockResolvedValue({
      id: 'usage-1',
      workspaceId: 'workspace-1',
      periodStart,
      periodEnd,
      videoGenerations: 49,
      publishes: 0,
      aiGenerations: 0,
      renderMinutes: 0,
      storageBytes: 0n,
    });

    await expect(service.assertCanGenerateVideo('workspace-1')).resolves.toBeUndefined();

    prisma.workspaceSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      workspaceId: 'workspace-1',
      plan: Plan.PREMIUM,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    });
    prisma.workspaceUsage.upsert.mockResolvedValue({
      id: 'usage-1',
      workspaceId: 'workspace-1',
      periodStart,
      periodEnd,
      videoGenerations: 199,
      publishes: 0,
      aiGenerations: 0,
      renderMinutes: 0,
      storageBytes: 0n,
    });

    await expect(service.assertCanGenerateVideo('workspace-1')).resolves.toBeUndefined();
  });

  it('increments usage counters in the current billing period', async () => {
    await service.incrementUsage('workspace-1', { videoGenerations: 1, publishes: 1, aiGenerations: 2, renderMinutes: 1.5 });

    expect(prisma.workspaceUsage.update).toHaveBeenCalledWith({
      where: { id: 'usage-1' },
      data: {
        videoGenerations: { increment: 1 },
        publishes: { increment: 1 },
        aiGenerations: { increment: 2 },
        renderMinutes: { increment: 1.5 },
        storageBytes: undefined,
      },
    });
  });

  it('atomically consumes video quota with a conditional counter update', async () => {
    await service.consumeVideoGeneration('workspace-1');

    expect(prisma.workspaceUsage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'usage-1',
        videoGenerations: { lte: 2 },
      },
      data: expect.objectContaining({
        videoGenerations: { increment: 1 },
      }),
    });
  });

  it('rejects repeated concurrent-style quota consumption when the atomic update loses the race', async () => {
    prisma.workspaceUsage.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(service.consumePublish('workspace-1')).resolves.toBeTruthy();
    await expect(service.consumePublish('workspace-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows only one concurrent publish consumption at the final free-plan slot', async () => {
    prisma.workspaceUsage.updateMany.mockImplementation(({ where }: any) => {
      if (where.publishes?.lte !== 0) return Promise.resolve({ count: 0 });
      const count = prisma.workspaceUsage.updateMany.mock.calls.length;
      return Promise.resolve({ count: count === 1 ? 1 : 0 });
    });

    const results = await Promise.allSettled([
      service.consumePublish('workspace-1'),
      service.consumePublish('workspace-1'),
      service.consumePublish('workspace-1'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2);
    expect(prisma.workspaceUsage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ publishes: { lte: 0 } }),
      data: expect.objectContaining({ publishes: { increment: 1 } }),
    }));
  });

  it('returns subscription and usage payloads with limits for billing endpoints', async () => {
    await expect(service.getSubscriptionResponse('workspace-1')).resolves.toEqual(
      expect.objectContaining({
        plan: Plan.FREE,
        effectivePlan: Plan.FREE,
        limits: expect.objectContaining({ videoGenerations: 3, publishes: 1 }),
      }),
    );

    await expect(service.getUsageResponse('workspace-1')).resolves.toEqual(
      expect.objectContaining({
        plan: Plan.FREE,
        usage: expect.objectContaining({ storageBytes: '0' }),
      }),
    );
  });

  it('lets platform admin helpers update subscription and suspend workspaces', async () => {
    await service.updateSubscription('workspace-1', {
      plan: Plan.PRO,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: periodEnd,
    });

    expect(prisma.workspaceSubscription.update).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-1' },
      data: expect.objectContaining({
        plan: Plan.PRO,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: periodEnd,
      }),
    });

    await service.suspendWorkspace('workspace-1', 'policy');
    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: 'workspace-1' },
      data: expect.objectContaining({ suspended: true, suspensionReason: 'policy' }),
    });
  });

  it('blocks usage checks for suspended workspaces', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-1', suspended: true, suspensionReason: 'billing issue' });

    await expect(service.assertCanPublish('workspace-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('treats expired paid subscriptions as free and blocks paid actions over free limits', async () => {
    prisma.workspaceSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      workspaceId: 'workspace-1',
      plan: Plan.PREMIUM,
      status: SubscriptionStatus.EXPIRED,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    });
    prisma.workspaceUsage.upsert.mockResolvedValue({
      id: 'usage-1',
      workspaceId: 'workspace-1',
      periodStart,
      periodEnd,
      videoGenerations: 3,
      publishes: 0,
      aiGenerations: 0,
      renderMinutes: 0,
      storageBytes: 0n,
    });

    await expect(service.assertCanGenerateVideo('workspace-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('persists billing webhooks once and ignores duplicates safely', async () => {
    prisma.billingWebhookEvent.create.mockResolvedValueOnce({
      providerEventId: 'evt-1',
    });
    await expect(service.handleWebhook('generic', { id: 'evt-1', secret: 'hidden' })).resolves.toEqual(
      expect.objectContaining({ duplicate: false, providerEventId: 'evt-1' }),
    );
    expect(prisma.billingWebhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'generic',
        providerEventId: 'evt-1',
        payload: expect.objectContaining({ secret: '[REDACTED]' }),
      }),
    });

    prisma.billingWebhookEvent.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.handleWebhook('generic', { id: 'evt-1' })).resolves.toEqual(
      expect.objectContaining({ duplicate: true, status: 'IGNORED_DUPLICATE' }),
    );
  });

  it('rejects invalid checkout providers', async () => {
    await expect(
      service.startCheckout('workspace-1', Plan.PRO, { userId: 'user-1' }, { provider: 'bad-provider' }),
    ).rejects.toThrow('Invalid billing provider');
  });

  it('creates checkout with the selected provider', async () => {
    process.env.BILLING_RETURN_BASE_URL = 'https://api.example.com';
    prisma.user.findUnique.mockResolvedValue({ email: 'user@example.com' });
    stripe.createCheckout.mockResolvedValue({
      provider: BillingProvider.STRIPE,
      checkoutUrl: 'https://checkout.stripe.com/session',
      reference: 'cs-1',
      sessionId: 'cs-1',
    });

    await expect(
      service.startCheckout('workspace-1', Plan.PRO, { userId: 'user-1' }, { provider: BillingProvider.STRIPE }),
    ).resolves.toEqual(expect.objectContaining({ provider: BillingProvider.STRIPE, reference: 'cs-1' }));

    expect(stripe.createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'user@example.com',
      plan: Plan.PRO,
    }));
  });

  it('cancels through the active provider adapter', async () => {
    prisma.workspaceSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      workspaceId: 'workspace-1',
      plan: Plan.PRO,
      status: SubscriptionStatus.ACTIVE,
      billingProvider: BillingProvider.STRIPE,
      providerCustomerId: 'cus-1',
      providerSubscriptionId: 'sub-provider-1',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    });
    stripe.cancelSubscription.mockResolvedValue({ cancelAtPeriodEnd: true });

    await service.cancel('workspace-1', { userId: 'user-1' });

    expect(stripe.cancelSubscription).toHaveBeenCalledWith('sub-provider-1', 'cus-1');
  });

  it('processes provider webhook subscription updates after idempotency insert', async () => {
    stripe.parseWebhook.mockReturnValue({
      providerEventId: 'evt-stripe-1',
      eventType: 'customer.subscription.updated',
      subscriptionUpdate: {
        workspaceId: 'workspace-1',
        plan: Plan.PREMIUM,
        status: SubscriptionStatus.ACTIVE,
        providerCustomerId: 'cus-1',
        providerSubscriptionId: 'sub-1',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });
    prisma.billingWebhookEvent.create.mockResolvedValueOnce({ id: 'webhook-1', providerEventId: 'evt-stripe-1' });

    await expect(service.handleWebhook('stripe', { id: 'evt-stripe-1' }, {}, '{}')).resolves.toEqual(
      expect.objectContaining({ providerEventId: 'evt-stripe-1', status: 'PROCESSED' }),
    );

    expect(prisma.workspaceSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: 'workspace-1' },
      update: expect.objectContaining({
        plan: Plan.PREMIUM,
        status: SubscriptionStatus.ACTIVE,
        billingProvider: BillingProvider.STRIPE,
      }),
    }));
  });
});
