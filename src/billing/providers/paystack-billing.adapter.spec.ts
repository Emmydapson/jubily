import axios from 'axios';
import { createHmac } from 'crypto';
import { BillingProvider, Plan } from '@prisma/client';
import { BillingInterval } from '../dto/start-checkout.dto';
import { BillingPricingService } from './billing-pricing.service';
import { PaystackBillingAdapter } from './paystack-billing.adapter';

jest.mock('axios');

describe('PaystackBillingAdapter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      PAYSTACK_SECRET_KEY: 'sk_paystack',
      PAYSTACK_WEBHOOK_SECRET: '',
      PAYSTACK_PRO_MONTHLY_PLAN_CODE: 'PLN_pro_monthly',
    };
    jest.mocked(axios.post).mockReset().mockResolvedValue({
      data: { data: { authorization_url: 'https://paystack.com/pay/ref', reference: 'ref-1' } },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('initializes checkout with plan code and metadata', async () => {
    const adapter = new PaystackBillingAdapter(new BillingPricingService());

    await expect(adapter.createCheckout({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'user@example.com',
      plan: Plan.PRO,
      interval: BillingInterval.MONTHLY,
      successUrl: 'https://api.example.com/billing/success',
      cancelUrl: 'https://api.example.com/billing/cancel',
    })).resolves.toEqual({
      provider: BillingProvider.PAYSTACK,
      checkoutUrl: 'https://paystack.com/pay/ref',
      reference: 'ref-1',
      sessionId: 'ref-1',
    });

    const body = jest.mocked(axios.post).mock.calls[0][1] as any;
    expect(body.plan).toBe('PLN_pro_monthly');
    expect(body.amount).toBeUndefined();
    expect(body.metadata).toEqual(expect.objectContaining({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      provider: 'PAYSTACK',
    }));
  });

  it('requires and verifies Paystack webhook signatures', () => {
    const adapter = new PaystackBillingAdapter(new BillingPricingService());
    const raw = JSON.stringify({ event: 'charge.success' });
    const sig = createHmac('sha512', 'sk_paystack').update(raw).digest('hex');

    expect(adapter.verifyWebhook(raw, { 'x-paystack-signature': sig })).toEqual({
      valid: true,
      reason: 'paystack_hmac_sha512',
    });
    expect(adapter.verifyWebhook(raw, {})).toEqual({ valid: false, reason: 'missing_signature' });
  });
});
