import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  BillingWebhookAdapter,
  BillingWebhookVerificationInput,
} from './billing-webhook-adapter';

@Injectable()
export class GenericBillingWebhookAdapter implements BillingWebhookAdapter {
  provider = 'generic';

  verify(input: BillingWebhookVerificationInput) {
    const secret = String(process.env.BILLING_WEBHOOK_SECRET || '').trim();
    if (!secret) return { valid: true, reason: 'signature_not_configured' };

    const signature = String(
      input.headers?.['x-billing-signature'] ||
        input.headers?.['x-paystack-signature'] ||
        input.headers?.['stripe-signature'] ||
        '',
    ).trim();
    if (!signature) return { valid: false, reason: 'missing_signature' };

    const raw = Buffer.isBuffer(input.rawBody)
      ? input.rawBody
      : Buffer.from(String(input.rawBody || ''), 'utf8');
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return {
      valid: a.length === b.length && timingSafeEqual(a, b),
      reason: 'hmac_sha256',
    };
  }

  extractEventId(payload: unknown) {
    const record =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};
    const data =
      record.data && typeof record.data === 'object'
        ? (record.data as Record<string, unknown>)
        : {};
    return (
      String(
        record.id || record.eventId || record.reference || data.id || '',
      ).trim() || null
    );
  }

  extractEventType(payload: unknown) {
    const record =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};
    return (
      String(record.type || record.event || record.eventType || '').trim() ||
      null
    );
  }
}
