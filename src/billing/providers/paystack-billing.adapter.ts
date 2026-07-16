/* eslint-disable prettier/prettier */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BillingProvider, Plan, SubscriptionStatus } from '@prisma/client';
import axios from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import { BillingPricingService } from './billing-pricing.service';
import { CheckoutRequest, CheckoutResponse, LiveBillingProviderAdapter, ProviderWebhookResult } from './billing-provider.types';
import { logAndThrowProviderError } from './provider-error';

@Injectable()
export class PaystackBillingAdapter implements LiveBillingProviderAdapter {
  provider = BillingProvider.PAYSTACK;
  private readonly logger = new Logger(PaystackBillingAdapter.name);

  constructor(private readonly pricing: BillingPricingService) {}

  private secret() {
    const secret = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
    if (!secret) throw new BadRequestException('PAYSTACK_SECRET_KEY is not configured');
    return secret;
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResponse> {
    const planCode = this.pricing.getPriceId(this.provider, input.plan, input.interval);
    const amount = input.promo?.finalAmount ?? this.pricing.getDisplayPrice(this.provider, input.plan, input.interval).amountMinor;
    try {
      const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
        email: input.email,
        amount,
        plan: planCode,
        callback_url: input.successUrl,
        metadata: {
          workspaceId: input.workspaceId,
          userId: input.userId,
          plan: input.plan,
          interval: input.interval,
          provider: this.provider,
          promoCodeId: input.promo?.promoCodeId,
          promoCode: input.promo?.promoCode,
          promoAttributionId: input.promo?.promoAttributionId,
          promoDiscountType: input.promo?.promoDiscountType,
          promoDiscountApplied: Boolean(input.promo?.promoDiscountApplied),
          discountDuration: input.promo?.discountDuration,
          originalAmount: input.promo?.originalAmount,
          discountAmount: input.promo?.discountAmount,
          finalAmount: input.promo?.finalAmount,
          renewalAmount: input.promo?.renewalAmount,
          currency: input.promo?.currency,
          countryCode: input.promo?.countryCode,
          regionScope: input.promo?.regionScope,
          paystackDiscountMode: input.promo?.paystackDiscountMode,
        },
      },
        { headers: { Authorization: `Bearer ${this.secret()}` } },
      );

      return {
        provider: this.provider,
        checkoutUrl: response.data?.data?.authorization_url,
        reference: response.data?.data?.reference,
        sessionId: response.data?.data?.reference,
      };
    } catch (error) {
      logAndThrowProviderError(this.logger, error, {
        provider: this.provider,
        endpoint: 'transaction.initialize',
        userId: input.userId,
        workspaceId: input.workspaceId,
      });
    }
  }

  async cancelSubscription(subscriptionId: string, customerId?: string | null) {
    if (!subscriptionId || !customerId) throw new BadRequestException('Paystack subscription code/token is missing');
    try {
      await axios.post(
        'https://api.paystack.co/subscription/disable',
        { code: subscriptionId, token: customerId },
        { headers: { Authorization: `Bearer ${this.secret()}` } },
      );
    } catch (error) {
      logAndThrowProviderError(this.logger, error, {
        provider: this.provider,
        endpoint: 'subscription.disable',
      });
    }
    return { cancelAtPeriodEnd: false };
  }

  async verifyTransaction(reference: string): Promise<ProviderWebhookResult> {
    const value = String(reference || '').trim();
    if (!value) throw new BadRequestException('Paystack reference is required');
    let response;
    try {
      response = await axios.get(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(value)}`,
        { headers: { Authorization: `Bearer ${this.secret()}` } },
      );
    } catch (error) {
      logAndThrowProviderError(this.logger, error, {
        provider: this.provider,
        endpoint: 'transaction.verify',
      });
    }

    return this.parseWebhook({
      event: response.data?.data?.status === 'success' ? 'charge.success' : 'charge.failed',
      data: response.data?.data,
    });
  }


  verifyWebhook(rawBody: string | Buffer | undefined, headers: Record<string, unknown>) {
    const secret = String(process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY || '').trim();
    if (!secret) return { valid: false, reason: 'missing_paystack_webhook_secret' };
    const signature = String(headers['x-paystack-signature'] || '').trim();
    if (!signature) return { valid: false, reason: 'missing_signature' };
    const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
    const expected = createHmac('sha512', secret).update(raw).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return { valid: a.length === b.length && timingSafeEqual(a, b), reason: 'paystack_hmac_sha512' };
  }

  private parseDate(value: unknown) {
    const date = value ? new Date(String(value)) : null;
    return date && !Number.isNaN(date.getTime()) ? date : undefined;
  }

  private metadata(payload: any) {
    return payload?.data?.metadata || payload?.metadata || {};
  }

  private planFromMetadata(metadata: any): Plan | undefined {
    const plan = String(metadata?.plan || '').toUpperCase();
    return plan === Plan.PRO || plan === Plan.PREMIUM || plan === Plan.FREE ? (plan as Plan) : undefined;
  }

  parseWebhook(payload: any): ProviderWebhookResult {
    const eventType = String(payload?.event || '');
    const data = payload?.data || {};
    const metadata = this.metadata(payload);
    const workspaceId = String(metadata.workspaceId || '').trim();
    const base = {
      providerEventId: String(data.id || data.reference || data.subscription_code || `${eventType}:${Date.now()}`),
      eventType,
    };

    if (!workspaceId) return { ...base, ignored: true };

    if (eventType === 'charge.success' || eventType === 'subscription.create' || eventType === 'invoice.create') {
      return {
        ...base,
        subscriptionUpdate: {
          workspaceId,
          plan: this.planFromMetadata(metadata) ?? Plan.PRO,
          status: SubscriptionStatus.ACTIVE,
          providerCustomerId: String(data.email_token || data.customer?.email_token || data.authorization?.authorization_code || ''),
          providerSubscriptionId: String(data.subscription_code || data.subscription?.subscription_code || ''),
          userId: String(metadata.userId || ''),
          promoCodeId: String(metadata.promoCodeId || ''),
          promoAttributionId: String(metadata.promoAttributionId || ''),
          interval: String(metadata.interval || ''),
          amount: data.amount == null ? null : Number(data.amount),
          originalAmount: metadata.originalAmount == null ? null : Number(metadata.originalAmount),
          discountAmount: metadata.discountAmount == null ? null : Number(metadata.discountAmount),
          finalAmount: metadata.finalAmount == null ? null : Number(metadata.finalAmount),
          renewalAmount: metadata.renewalAmount == null ? null : Number(metadata.renewalAmount),
          currency: data.currency ? String(data.currency).toUpperCase() : null,
          countryCode: String(metadata.countryCode || ''),
          regionScope: String(metadata.regionScope || ''),
          discountDuration: String(metadata.discountDuration || ''),
          currentPeriodStart: this.parseDate(data.created_at || data.period_start),
          currentPeriodEnd: this.parseDate(data.next_payment_date || data.period_end),
          cancelAtPeriodEnd: false,
        },
      };
    }

    if (eventType === 'subscription.disable') {
      return {
        ...base,
        subscriptionUpdate: {
          workspaceId,
          status: SubscriptionStatus.CANCELED,
          providerSubscriptionId: String(data.subscription_code || ''),
          cancelAtPeriodEnd: false,
        },
      };
    }

    if (eventType === 'invoice.payment_failed') {
      return {
        ...base,
        subscriptionUpdate: {
          workspaceId,
          status: SubscriptionStatus.PAST_DUE,
          providerSubscriptionId: String(data.subscription?.subscription_code || data.subscription_code || ''),
        },
      };
    }

    return { ...base, ignored: true };
  }
}
