import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingProvider, Plan } from '@prisma/client';
import { BillingInterval } from '../dto/start-checkout.dto';

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

  listConfiguredPrices() {
    return [BillingProvider.STRIPE, BillingProvider.PAYSTACK].map((provider) => ({
      provider,
      enabled: this.providerEnabled(provider),
      prices: [Plan.PRO, Plan.PREMIUM].flatMap((plan) =>
        [BillingInterval.MONTHLY, BillingInterval.YEARLY].map((interval) => ({
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
