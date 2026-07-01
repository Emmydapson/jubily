import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingProvider, Plan } from '@prisma/client';
import { BillingInterval } from '../dto/start-checkout.dto';

const DISPLAY_PRICES = {
  [BillingProvider.STRIPE]: {
    currency: 'USD',
    locale: 'en-US',
    amounts: {
      [Plan.PRO]: {
        [BillingInterval.MONTHLY]: 999,
        [BillingInterval.YEARLY]: 10999,
      },
      [Plan.PREMIUM]: {
        [BillingInterval.MONTHLY]: 2499,
        [BillingInterval.YEARLY]: 27399,
      },
    },
  },
  [BillingProvider.PAYSTACK]: {
    currency: 'NGN',
    locale: 'en-NG',
    amounts: {
      [Plan.PRO]: {
        [BillingInterval.MONTHLY]: 750000,
        [BillingInterval.YEARLY]: 8250000,
      },
      [Plan.PREMIUM]: {
        [BillingInterval.MONTHLY]: 2000000,
        [BillingInterval.YEARLY]: 22000000,
      },
    },
  },
} as const;

@Injectable()
export class BillingPricingService {
  private envName(provider: BillingProvider, plan: Plan, interval: BillingInterval) {
    const suffix = `${plan}_${interval === BillingInterval.YEARLY ? 'YEARLY' : 'MONTHLY'}`;
    return provider === BillingProvider.STRIPE
      ? `STRIPE_${suffix}_PRICE_ID`
      : `PAYSTACK_${suffix}_PLAN_CODE`;
  }

  getPriceId(provider: BillingProvider, plan: Plan, interval: BillingInterval) {
    if (plan === Plan.FREE) throw new BadRequestException('FREE plan does not require checkout');
    const envName = this.envName(provider, plan, interval);
    const value = String(process.env[envName] || '').trim();
    if (!value) throw new BadRequestException(`${envName} is not configured`);
    return value;
  }

  getDisplayPrice(provider: BillingProvider, plan: Exclude<Plan, 'FREE'>, interval: BillingInterval) {
    const providerPricing = DISPLAY_PRICES[provider];
    const amountMinor = providerPricing.amounts[plan][interval];
    const monthlyAmountMinor = providerPricing.amounts[plan][BillingInterval.MONTHLY];
    const annualMonthlyEquivalentMinor = monthlyAmountMinor * 12;
    const savingsMinor =
      interval === BillingInterval.YEARLY ? Math.max(0, annualMonthlyEquivalentMinor - amountMinor) : 0;

    return {
      provider,
      plan,
      interval,
      currency: providerPricing.currency,
      amountMinor,
      amount: amountMinor / 100,
      formatted: new Intl.NumberFormat(providerPricing.locale, {
        style: 'currency',
        currency: providerPricing.currency,
      }).format(amountMinor / 100),
      savings:
        interval === BillingInterval.YEARLY
          ? {
              label: '1 month free',
              monthsFree: 1,
              amountMinor: savingsMinor,
              amount: savingsMinor / 100,
              formatted: new Intl.NumberFormat(providerPricing.locale, {
                style: 'currency',
                currency: providerPricing.currency,
              }).format(savingsMinor / 100),
            }
          : null,
    };
  }

  listDisplayPrices() {
    return [BillingProvider.STRIPE, BillingProvider.PAYSTACK].map((provider) => ({
      provider,
      enabled: this.providerEnabled(provider),
      prices: [Plan.PRO, Plan.PREMIUM].flatMap((plan) =>
        [BillingInterval.MONTHLY, BillingInterval.YEARLY].map((interval) =>
          this.getDisplayPrice(provider, plan, interval),
        ),
      ),
    }));
  }

  listConfiguredPrices() {
    return [BillingProvider.STRIPE, BillingProvider.PAYSTACK].map((provider) => ({
      provider,
      enabled: this.providerEnabled(provider),
      prices: [Plan.PRO, Plan.PREMIUM].flatMap((plan) =>
        [BillingInterval.MONTHLY, BillingInterval.YEARLY].map((interval) => ({
          ...this.getDisplayPrice(provider, plan, interval),
          plan,
          interval,
          configured: Boolean(process.env[this.envName(provider, plan, interval)]),
        })),
      ),
    }));
  }

  providerEnabled(provider: BillingProvider) {
    const key = provider === BillingProvider.STRIPE ? 'STRIPE_ENABLED' : 'PAYSTACK_ENABLED';
    return String(process.env[key] || 'false').toLowerCase() === 'true';
  }
}
