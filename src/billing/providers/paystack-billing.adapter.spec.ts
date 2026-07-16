import axios from 'axios';
import { createHmac } from 'crypto';
import { Logger } from '@nestjs/common';
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
    jest.mocked(axios.get).mockReset().mockResolvedValue({
      data: {
        data: {
          id: 'txn-1',
          status: 'success',
          reference: 'ref-1',
          amount: 750000,
          currency: 'NGN',
          metadata: {
            workspaceId: 'workspace-1',
            userId: 'user-1',
            plan: Plan.PRO,
            interval: BillingInterval.MONTHLY,
          },
          authorization: { authorization_code: 'AUTH_code' },
          subscription: { subscription_code: 'SUB_code' },
        },
      },
    });
    jest.mocked(axios.isAxiosError).mockReset().mockReturnValue(false);
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
      successUrl: 'https://joinjubily.com/billing/paystack/callback',
      cancelUrl: 'https://joinjubily.com/billing/cancelled',
    })).resolves.toEqual({
      provider: BillingProvider.PAYSTACK,
      checkoutUrl: 'https://paystack.com/pay/ref',
      reference: 'ref-1',
      sessionId: 'ref-1',
    });

    const body = jest.mocked(axios.post).mock.calls[0][1] as any;
    expect(body.plan).toBe('PLN_pro_monthly');
    expect(body.amount).toBe(750000);
    expect(body.callback_url).toBe('https://joinjubily.com/billing/paystack/callback');
    expect(body.metadata).toEqual(expect.objectContaining({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      plan: Plan.PRO,
      interval: BillingInterval.MONTHLY,
      provider: 'PAYSTACK',
    }));
  });

  it('returns a friendly error and does not log secrets when Paystack rejects initialization', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.mocked(axios.isAxiosError).mockReturnValue(true);
    jest.mocked(axios.post).mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: {
          message: 'Invalid plan code',
          reference: 'ref-provider-1',
        },
      },
      config: {
        headers: {
          Authorization: 'Bearer sk_paystack',
        },
      },
    });
    const adapter = new PaystackBillingAdapter(new BillingPricingService());

    await expect(adapter.createCheckout({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'user@example.com',
      plan: Plan.PRO,
      interval: BillingInterval.MONTHLY,
      successUrl: 'https://joinjubily.com/billing/success',
      cancelUrl: 'https://joinjubily.com/billing/cancel',
    })).rejects.toMatchObject({
      response: expect.objectContaining({
        success: false,
        provider: BillingProvider.PAYSTACK,
        statusCode: 400,
        providerMessage: 'Invalid plan code',
        reference: 'ref-provider-1',
      }),
    });

    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).toContain('Invalid plan code');
    expect(logged).toContain('ref-provider-1');
    expect(logged).not.toContain('sk_paystack');
    expect(logged).not.toContain('Authorization');
    expect(logged).not.toContain('headers');

    warnSpy.mockRestore();
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

  it('verifies callback transactions by reference', async () => {
    const adapter = new PaystackBillingAdapter(new BillingPricingService());

    await expect(adapter.verifyTransaction('ref-1')).resolves.toEqual(expect.objectContaining({
      providerEventId: 'txn-1',
      eventType: 'charge.success',
      subscriptionUpdate: expect.objectContaining({
        workspaceId: 'workspace-1',
        plan: Plan.PRO,
        providerCustomerId: 'AUTH_code',
        providerSubscriptionId: 'SUB_code',
      }),
    }));

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/verify/ref-1',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk_paystack' } }),
    );
  });
});
