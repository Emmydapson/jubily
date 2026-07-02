/* eslint-disable prettier/prettier */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BillingProvider, Plan, SubscriptionStatus } from '@prisma/client';
import axios from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import { BillingInterval } from '../dto/start-checkout.dto';
import { BillingPricingService } from './billing-pricing.service';
import { CheckoutRequest, CheckoutResponse, LiveBillingProviderAdapter, ProviderWebhookResult } from './billing-provider.types';
import { logAndThrowProviderError } from './provider-error';

@Injectable()
export class StripeBillingAdapter implements LiveBillingProviderAdapter {
  provider = BillingProvider.STRIPE;
  private readonly logger = new Logger(StripeBillingAdapter.name);

  constructor(private readonly pricing: BillingPricingService) {}

  private secret() {
    const secret = String(process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secret) throw new BadRequestException('STRIPE_SECRET_KEY is not configured');
    return secret;
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResponse> {
    const price = this.pricing.getPriceId(this.provider, input.plan, input.interval);
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('success_url', input.successUrl);
    params.set('cancel_url', input.cancelUrl);
    params.set('line_items[0][price]', price);
    params.set('line_items[0][quantity]', '1');
    if (input.email) params.set('customer_email', input.email);
    params.set('metadata[workspaceId]', input.workspaceId);
    params.set('metadata[userId]', input.userId);
    params.set('metadata[plan]', input.plan);
    params.set('metadata[interval]', input.interval);
    params.set('metadata[provider]', this.provider);
    params.set('subscription_data[metadata][workspaceId]', input.workspaceId);
    params.set('subscription_data[metadata][userId]', input.userId);
    params.set('subscription_data[metadata][plan]', input.plan);
    params.set('subscription_data[metadata][interval]', input.interval);
    params.set('subscription_data[metadata][provider]', this.provider);
    if (input.promo) {
      params.set('metadata[promoCodeId]', input.promo.promoCodeId);
      params.set('metadata[promoCode]', input.promo.promoCode);
      params.set('metadata[promoAttributionId]', input.promo.promoAttributionId);
      params.set('metadata[promoDiscountType]', input.promo.promoDiscountType);
      params.set('metadata[promoDiscountApplied]', String(input.promo.promoDiscountApplied));
      params.set('subscription_data[metadata][promoCodeId]', input.promo.promoCodeId);
      params.set('subscription_data[metadata][promoCode]', input.promo.promoCode);
      params.set('subscription_data[metadata][promoAttributionId]', input.promo.promoAttributionId);
      params.set('subscription_data[metadata][promoDiscountType]', input.promo.promoDiscountType);
      params.set('subscription_data[metadata][promoDiscountApplied]', String(input.promo.promoDiscountApplied));
      if (input.promo.stripePromotionCodeId) {
        params.set('discounts[0][promotion_code]', input.promo.stripePromotionCodeId);
      }
    }

    let response;
    try {
      response = await axios.post('https://api.stripe.com/v1/checkout/sessions', params, {
        headers: {
          Authorization: `Bearer ${this.secret()}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    } catch (error) {
      logAndThrowProviderError(this.logger, error, {
        provider: this.provider,
        endpoint: 'checkout.sessions.create',
        userId: input.userId,
        workspaceId: input.workspaceId,
      });
    }

    return {
      provider: this.provider,
      checkoutUrl: response.data?.url,
      reference: response.data?.id,
      sessionId: response.data?.id,
    };
  }

  async cancelSubscription(subscriptionId: string) {
    if (!subscriptionId) throw new BadRequestException('Stripe subscription id is missing');
    try {
      await axios.post(
        `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
        new URLSearchParams({ cancel_at_period_end: 'true' }),
        {
          headers: {
            Authorization: `Bearer ${this.secret()}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );
    } catch (error) {
      logAndThrowProviderError(this.logger, error, {
        provider: this.provider,
        endpoint: 'subscriptions.update',
      });
    }
    return { cancelAtPeriodEnd: true };
  }

  verifyWebhook(rawBody: string | Buffer | undefined, headers: Record<string, unknown>) {
    const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!secret) return { valid: false, reason: 'missing_stripe_webhook_secret' };
    const signature = String(headers['stripe-signature'] || '').trim();
    if (!signature) return { valid: false, reason: 'missing_signature' };

    const parts = Object.fromEntries(signature.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    }));
    const timestamp = parts.t;
    const sig = parts.v1;
    if (!timestamp || !sig) return { valid: false, reason: 'invalid_signature_format' };

    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
    const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return { valid: a.length === b.length && timingSafeEqual(a, b), reason: 'stripe_hmac_sha256' };
  }

  private fromUnix(seconds?: unknown) {
    const value = Number(seconds || 0);
    return value > 0 ? new Date(value * 1000) : undefined;
  }

  private planFromMetadata(metadata: any): Plan | undefined {
    const plan = String(metadata?.plan || '').toUpperCase();
    return plan === Plan.PRO || plan === Plan.PREMIUM || plan === Plan.FREE ? (plan as Plan) : undefined;
  }

  private amountFromObject(object: any) {
    const amount = object.amount_paid ?? object.amount_total ?? object.total ?? object.amount_due;
    return amount == null ? null : Number(amount);
  }

  parseWebhook(payload: any): ProviderWebhookResult {
    const eventType = String(payload?.type || '');
    const object = payload?.data?.object || {};
    const metadata = object.metadata || {};
    const subscription = object.subscription || object.id;
    const workspaceId = String(metadata.workspaceId || object.metadata?.workspaceId || '').trim();

    const base = {
      providerEventId: String(payload?.id || object.id || `${eventType}:${Date.now()}`),
      eventType,
    };

    if (!workspaceId) return { ...base, ignored: true };

    if (eventType === 'checkout.session.completed' || eventType === 'customer.subscription.created' || eventType === 'customer.subscription.updated') {
      return {
        ...base,
        subscriptionUpdate: {
          workspaceId,
          plan: this.planFromMetadata(metadata) ?? Plan.PRO,
          status: object.status === 'trialing' ? SubscriptionStatus.TRIALING : object.status === 'past_due' ? SubscriptionStatus.PAST_DUE : SubscriptionStatus.ACTIVE,
          providerCustomerId: String(object.customer || ''),
          providerSubscriptionId: String(subscription || object.id || ''),
          userId: String(metadata.userId || ''),
          promoCodeId: String(metadata.promoCodeId || ''),
          promoAttributionId: String(metadata.promoAttributionId || ''),
          interval: String(metadata.interval || ''),
          amount: this.amountFromObject(object),
          currency: object.currency ? String(object.currency).toUpperCase() : null,
          currentPeriodStart: this.fromUnix(object.current_period_start),
          currentPeriodEnd: this.fromUnix(object.current_period_end),
          cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
          trialEndsAt: this.fromUnix(object.trial_end),
        },
      };
    }

    if (eventType === 'customer.subscription.deleted') {
      return {
        ...base,
        subscriptionUpdate: {
          workspaceId,
          status: SubscriptionStatus.CANCELED,
          providerCustomerId: String(object.customer || ''),
          providerSubscriptionId: String(object.id || ''),
          currentPeriodEnd: this.fromUnix(object.ended_at || object.current_period_end),
          cancelAtPeriodEnd: false,
        },
      };
    }

    if (eventType === 'invoice.payment_succeeded' || eventType === 'invoice.payment_failed') {
      const invoiceMetadata = object.subscription_details?.metadata || metadata;
      return {
        ...base,
        subscriptionUpdate: {
          workspaceId: String(invoiceMetadata.workspaceId || workspaceId),
          plan: this.planFromMetadata(invoiceMetadata),
          status: eventType === 'invoice.payment_failed' ? SubscriptionStatus.PAST_DUE : SubscriptionStatus.ACTIVE,
          providerCustomerId: String(object.customer || ''),
          providerSubscriptionId: String(object.subscription || ''),
          userId: String(invoiceMetadata.userId || ''),
          promoCodeId: String(invoiceMetadata.promoCodeId || ''),
          promoAttributionId: String(invoiceMetadata.promoAttributionId || ''),
          interval: String(invoiceMetadata.interval || ''),
          amount: this.amountFromObject(object),
          currency: object.currency ? String(object.currency).toUpperCase() : null,
        },
      };
    }

    return { ...base, ignored: true };
  }
}
