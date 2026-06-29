import { BillingProvider, Plan, SubscriptionStatus } from '@prisma/client';
import { BillingInterval } from '../dto/start-checkout.dto';

export type CheckoutRequest = {
  workspaceId: string;
  userId: string;
  email?: string | null;
  plan: Exclude<Plan, 'FREE'>;
  interval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResponse = {
  provider: BillingProvider;
  checkoutUrl: string;
  reference: string;
  sessionId?: string | null;
};

export type ProviderSubscriptionUpdate = {
  workspaceId: string;
  plan?: Plan;
  status: SubscriptionStatus;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  trialEndsAt?: Date | null;
};

export type ProviderWebhookResult = {
  providerEventId: string;
  eventType: string | null;
  subscriptionUpdate?: ProviderSubscriptionUpdate;
  ignored?: boolean;
};

export interface LiveBillingProviderAdapter {
  provider: BillingProvider;
  createCheckout(input: CheckoutRequest): Promise<CheckoutResponse>;
  cancelSubscription(subscriptionId: string, customerId?: string | null): Promise<{ cancelAtPeriodEnd: boolean }>;
  verifyWebhook(rawBody: string | Buffer | undefined, headers: Record<string, unknown>): { valid: boolean; reason?: string };
  parseWebhook(payload: unknown): ProviderWebhookResult;
}
