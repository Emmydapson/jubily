import axios from 'axios';
import { createHmac } from 'crypto';
import { BillingProvider, Plan } from '@prisma/client';
import { BillingInterval } from '../dto/start-checkout.dto';
import { BillingPricingService } from './billing-pricing.service';
import { StripeBillingAdapter } from './stripe-billing.adapter';

jest.mock('axios');

describe('StripeBillingAdapter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      STRIPE_SECRET_KEY: 'sk_test_secret',
      STRIPE_WEBHOOK_SECRET: 'whsec_secret',
      STRIPE_PRO_MONTHLY_PRICE_ID: 'price_pro_monthly',
    };
    jest.mocked(axios.post).mockReset().mockResolvedValue({
      data: { id: 'cs_123', url: 'https://checkout.stripe.com/cs_123' },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates a subscription checkout session with workspace metadata', async () => {
    const adapter = new StripeBillingAdapter(new BillingPricingService());

    await expect(adapter.createCheckout({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'user@example.com',
      plan: Plan.PRO,
      interval: BillingInterval.MONTHLY,
      successUrl: 'https://api.example.com/billing/success',
      cancelUrl: 'https://api.example.com/billing/cancel',
    })).resolves.toEqual({
      provider: BillingProvider.STRIPE,
      checkoutUrl: 'https://checkout.stripe.com/cs_123',
      reference: 'cs_123',
      sessionId: 'cs_123',
    });

    const params = jest.mocked(axios.post).mock.calls[0][1] as URLSearchParams;
    expect(params.get('mode')).toBe('subscription');
    expect(params.get('line_items[0][price]')).toBe('price_pro_monthly');
    expect(params.get('metadata[workspaceId]')).toBe('workspace-1');
    expect(params.get('metadata[userId]')).toBe('user-1');
    expect(params.get('metadata[provider]')).toBe('STRIPE');
  });

  it('requires and verifies Stripe webhook signatures', () => {
    const adapter = new StripeBillingAdapter(new BillingPricingService());
    const raw = JSON.stringify({ id: 'evt-1' });
    const t = '1780580000';
    const sig = createHmac('sha256', 'whsec_secret').update(`${t}.${raw}`).digest('hex');

    expect(adapter.verifyWebhook(raw, { 'stripe-signature': `t=${t},v1=${sig}` })).toEqual({
      valid: true,
      reason: 'stripe_hmac_sha256',
    });
    expect(adapter.verifyWebhook(raw, {})).toEqual({ valid: false, reason: 'missing_signature' });
  });
});
