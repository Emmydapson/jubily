import type { PublishingProvider } from '@prisma/client';

export type PublishPayload = {
  workspaceId: string;
  provider: PublishingProvider;
  videoUrl?: string | null;
  mediaAssetId?: string | null;
  title?: string | null;
  caption?: string | null;
  description?: string | null;
  tags?: string[];
  privacy?: string | null;
  status?: string | null;
  scheduledAt?: Date | string | null;
  affiliateLink?: string | null;
  disclosure?: string | null;
};

export class ProviderPublishingError extends Error {
  constructor(
    message: string,
    public readonly provider: PublishingProvider,
  ) {
    super(message);
  }
}
