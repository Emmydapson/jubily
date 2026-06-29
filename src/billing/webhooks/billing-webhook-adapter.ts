export type BillingWebhookVerificationInput = {
  provider: string;
  rawBody?: string | Buffer;
  headers?: Record<string, unknown>;
};

export type BillingWebhookVerificationResult = {
  valid: boolean;
  reason?: string;
};

export interface BillingWebhookAdapter {
  provider: string;
  verify(input: BillingWebhookVerificationInput): BillingWebhookVerificationResult;
  extractEventId(payload: unknown): string | null;
  extractEventType(payload: unknown): string | null;
}
