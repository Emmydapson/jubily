import { BadRequestException } from '@nestjs/common';
import { BillingProvider, Plan } from '@prisma/client';
import { BillingInterval } from '../dto/start-checkout.dto';
import { BillingPricingService } from './billing-pricing.service';

describe('BillingPricingService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      STRIPE_PRO_MONTHLY_PRICE_ID: 'price_stripe_pro_monthly',
      STRIPE_PRO_YEARLY_PRICE_ID: 'price_stripe_pro_yearly',
      STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_stripe_premium_monthly',
      STRIPE_PREMIUM_YEARLY_PRICE_ID: 'price_stripe_premium_yearly',
      PAYSTACK_PRO_MONTHLY_PLAN_CODE: 'PLN_paystack_pro_monthly',
      PAYSTACK_PRO_YEARLY_PLAN_CODE: 'PLN_paystack_pro_yearly',
      PAYSTACK_PREMIUM_MONTHLY_PLAN_CODE: 'PLN_paystack_premium_monthly',
      PAYSTACK_PREMIUM_YEARLY_PLAN_CODE: 'PLN_paystack_premium_yearly',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('maps provider, plan, and interval to Stripe price IDs and Paystack plan codes', () => {
    const service = new BillingPricingService();

    expect(
      service.getPriceId(
        BillingProvider.STRIPE,
        Plan.PRO,
        BillingInterval.MONTHLY,
      ),
    ).toBe('price_stripe_pro_monthly');
    expect(
      service.getPriceId(
        BillingProvider.STRIPE,
        Plan.PREMIUM,
        BillingInterval.YEARLY,
      ),
    ).toBe('price_stripe_premium_yearly');
    expect(
      service.getPriceId(
        BillingProvider.PAYSTACK,
        Plan.PRO,
        BillingInterval.YEARLY,
      ),
    ).toBe('PLN_paystack_pro_yearly');
    expect(
      service.getPriceId(
        BillingProvider.PAYSTACK,
        Plan.PREMIUM,
        BillingInterval.MONTHLY,
      ),
    ).toBe('PLN_paystack_premium_monthly');
  });

  it('does not allow checkout pricing for the free plan', () => {
    expect(() =>
      new BillingPricingService().getPriceId(
        BillingProvider.STRIPE,
        Plan.FREE,
        BillingInterval.MONTHLY,
      ),
    ).toThrow(BadRequestException);
  });

  it('returns display-only pricing metadata for all paid providers and intervals', () => {
    const pricing = new BillingPricingService().listDisplayPrices();

    expect(pricing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: BillingProvider.STRIPE,
          prices: expect.arrayContaining([
            expect.objectContaining({
              plan: Plan.PRO,
              interval: BillingInterval.MONTHLY,
              amountMinor: 999,
            }),
            expect.objectContaining({
              plan: Plan.PRO,
              interval: BillingInterval.YEARLY,
              amountMinor: 10999,
            }),
            expect.objectContaining({
              plan: Plan.PREMIUM,
              interval: BillingInterval.MONTHLY,
              amountMinor: 2499,
            }),
            expect.objectContaining({
              plan: Plan.PREMIUM,
              interval: BillingInterval.YEARLY,
              amountMinor: 27399,
              savings: expect.objectContaining({
                label: '1 month free',
                monthsFree: 1,
              }),
            }),
          ]),
        }),
        expect.objectContaining({
          provider: BillingProvider.PAYSTACK,
          prices: expect.arrayContaining([
            expect.objectContaining({
              plan: Plan.PRO,
              interval: BillingInterval.MONTHLY,
              amountMinor: 750000,
            }),
            expect.objectContaining({
              plan: Plan.PRO,
              interval: BillingInterval.YEARLY,
              amountMinor: 8250000,
            }),
            expect.objectContaining({
              plan: Plan.PREMIUM,
              interval: BillingInterval.MONTHLY,
              amountMinor: 2000000,
            }),
            expect.objectContaining({
              plan: Plan.PREMIUM,
              interval: BillingInterval.YEARLY,
              amountMinor: 22000000,
              savings: expect.objectContaining({
                label: '1 month free',
                monthsFree: 1,
              }),
            }),
          ]),
        }),
      ]),
    );
  });
});
