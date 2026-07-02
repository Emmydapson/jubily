export const AFFILIATE_NICHES = [
  'HEALTH_WELLNESS',
  'FINANCE',
  'AI_SOFTWARE',
  'TECHNOLOGY',
  'BUSINESS',
  'EDUCATION',
  'FITNESS',
  'BEAUTY',
  'TRAVEL',
  'GAMING',
  'ECOMMERCE',
  'REAL_ESTATE',
  'PARENTING',
  'PETS',
  'PERSONAL_DEVELOPMENT',
  'FOOD',
  'FASHION',
  'HOME_GARDEN',
  'AUTOMOTIVE',
  'DIY',
  'RELATIONSHIPS',
  'SPIRITUALITY',
  'OTHER',
] as const;

export const AFFILIATE_PLATFORMS = [
  'CLICKBANK',
  'DIGISTORE24',
  'WARRIORPLUS',
  'JVZOO',
  'AMAZON_ASSOCIATES',
  'TEMU',
  'ALIEXPRESS',
  'IMPACT',
  'PARTNERSTACK',
  'CJ_AFFILIATE',
  'SHAREASALE',
  'RAKUTEN',
  'AWIN',
  'FLEXOFFERS',
  'AVANGATE',
  'EBAY_PARTNER_NETWORK',
  'SHOPIFY_COLLABS',
  'CUSTOM',
] as const;

export type AffiliateNiche = (typeof AFFILIATE_NICHES)[number];
export type AffiliatePlatform = (typeof AFFILIATE_PLATFORMS)[number];

const NICHE_ALIASES: Record<string, AffiliateNiche> = {
  SLEEP: 'HEALTH_WELLNESS',
  'WEIGHT-LOSS': 'HEALTH_WELLNESS',
  ENERGY: 'HEALTH_WELLNESS',
  STRESS: 'HEALTH_WELLNESS',
  'GUT-HEALTH': 'HEALTH_WELLNESS',
  FOCUS: 'PERSONAL_DEVELOPMENT',
  HORMONES: 'HEALTH_WELLNESS',
  MEMORY: 'HEALTH_WELLNESS',
  'MENS-HEALTH': 'HEALTH_WELLNESS',
  'DENTAL-HEALTH': 'HEALTH_WELLNESS',
  'JOINT-HEALTH': 'HEALTH_WELLNESS',
  'HEARING-HEALTH': 'HEALTH_WELLNESS',
};

const PLATFORM_ALIASES: Record<string, AffiliatePlatform> = {
  DIGISTORE: 'DIGISTORE24',
  DIGISTORE24: 'DIGISTORE24',
  CLICKBANK: 'CLICKBANK',
  AMAZON: 'AMAZON_ASSOCIATES',
  AMAZON_ASSOCIATES: 'AMAZON_ASSOCIATES',
  CJ: 'CJ_AFFILIATE',
  CJ_AFFILIATE: 'CJ_AFFILIATE',
  EBAY: 'EBAY_PARTNER_NETWORK',
  EBAY_PARTNER_NETWORK: 'EBAY_PARTNER_NETWORK',
};

function normalizeToken(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

export function normalizeAffiliateNiche(value: unknown): AffiliateNiche | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const token = normalizeToken(raw);
  const legacy = NICHE_ALIASES[raw.toUpperCase()] ?? NICHE_ALIASES[token.replace(/_/g, '-')];
  if (legacy) return legacy;
  return AFFILIATE_NICHES.includes(token as AffiliateNiche) ? (token as AffiliateNiche) : null;
}

export function normalizeAffiliatePlatform(value: unknown): AffiliatePlatform | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const token = normalizeToken(raw);
  const platform = PLATFORM_ALIASES[token] ?? (AFFILIATE_PLATFORMS.includes(token as AffiliatePlatform) ? (token as AffiliatePlatform) : null);
  return platform;
}

export function normalizeAffiliateNiches(values: unknown): AffiliateNiche[] {
  const input = Array.isArray(values) ? values : values == null ? [] : [values];
  return Array.from(new Set(input.map(normalizeAffiliateNiche).filter(Boolean) as AffiliateNiche[]));
}

export function normalizeAffiliatePlatforms(values: unknown): AffiliatePlatform[] {
  const input = Array.isArray(values) ? values : values == null ? [] : [values];
  return Array.from(new Set(input.map(normalizeAffiliatePlatform).filter(Boolean) as AffiliatePlatform[]));
}
