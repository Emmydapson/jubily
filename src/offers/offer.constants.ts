import { AFFILIATE_NICHES, AFFILIATE_PLATFORMS } from '../affiliates/affiliate.constants';

export const OFFER_NETWORKS = AFFILIATE_PLATFORMS;
export type OfferNetwork = (typeof OFFER_NETWORKS)[number];

export const OFFER_NICHES = AFFILIATE_NICHES;
export type OfferNiche = (typeof OFFER_NICHES)[number];
