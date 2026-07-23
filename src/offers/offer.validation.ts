import { BadRequestException } from '@nestjs/common';
import { OFFER_NETWORKS, OFFER_NICHES, OfferNetwork } from './offer.constants';
import {
  normalizeAffiliateNiche,
  normalizeAffiliatePlatform,
} from '../affiliates/affiliate.constants';

export type OfferSeedInput = {
  network?: unknown;
  externalProductId?: unknown;
  name?: unknown;
  title?: unknown;
  nicheTag?: unknown;
  hoplink?: unknown;
  affiliateUrl?: unknown;
  active?: unknown;
};

export type NormalizedOfferInput = {
  network: OfferNetwork;
  externalProductId?: string | null;
  name: string;
  nicheTag?: string | null;
  hoplink: string;
  active?: boolean;
};

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value == null) return value;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

export function normalizeAndValidateOfferInput(
  input: OfferSeedInput,
  options: { partial?: boolean } = {},
): Partial<NormalizedOfferInput> {
  const partial = options.partial === true;
  const output: Partial<NormalizedOfferInput> = {};

  if (!partial || input.network != null) {
    const network = normalizeAffiliatePlatform(input.network);
    if (!network) {
      throw new BadRequestException(
        `network must be one of: ${OFFER_NETWORKS.join(', ')}`,
      );
    }
    output.network = network;
  }

  if (!partial || input.name != null || input.title != null) {
    const name = String(input.name ?? input.title ?? '').trim();
    if (!name) throw new BadRequestException('name is required');
    output.name = name;
  }

  if (!partial || input.hoplink != null || input.affiliateUrl != null) {
    const hoplink = String(input.hoplink ?? input.affiliateUrl ?? '').trim();
    try {
      const parsed = new URL(hoplink);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('invalid protocol');
      }
    } catch {
      throw new BadRequestException('hoplink must be a valid http(s) URL');
    }
    output.hoplink = hoplink;
  }

  if (input.nicheTag !== undefined) {
    const rawNicheTag = normalizeOptionalString(input.nicheTag);
    const nicheTag =
      rawNicheTag == null ? rawNicheTag : normalizeAffiliateNiche(rawNicheTag);
    if (rawNicheTag != null && !nicheTag) {
      throw new BadRequestException(
        `nicheTag must be one of: ${OFFER_NICHES.join(', ')}`,
      );
    }
    output.nicheTag = nicheTag;
  }

  if (input.externalProductId !== undefined) {
    output.externalProductId = normalizeOptionalString(input.externalProductId);
  }

  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') {
      throw new BadRequestException('active must be a boolean');
    }
    output.active = input.active;
  }

  return output;
}
