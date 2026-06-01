export const OFFER_NETWORKS = ['digistore24', 'clickbank'] as const;
export type OfferNetwork = (typeof OFFER_NETWORKS)[number];

export const OFFER_NICHES = [
  'sleep',
  'weight-loss',
  'energy',
  'stress',
  'gut-health',
  'focus',
  'fitness',
  'hormones',
  'memory',
  'mens-health',
  'dental-health',
  'joint-health',
  'hearing-health',
] as const;
export type OfferNiche = (typeof OFFER_NICHES)[number];
