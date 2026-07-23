export const CONTENT_PLATFORMS = [
  'YOUTUBE',
  'TIKTOK',
  'FACEBOOK',
  'INSTAGRAM',
] as const;

export type ContentPlatform = (typeof CONTENT_PLATFORMS)[number];

export const CONTENT_PLATFORM_LABELS: Record<ContentPlatform, string> = {
  YOUTUBE: 'YouTube',
  TIKTOK: 'TikTok',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
};

export const RECOMMENDED_VIDEO_DURATIONS_SECONDS = [
  15, 30, 45, 60, 90, 120, 180,
] as const;

export const MIN_VIDEO_DURATION_SECONDS = 15;
export const MAX_VIDEO_DURATION_SECONDS = 180;

export function normalizeContentPlatform(value: unknown): ContentPlatform | null {
  const normalized = String(value || '').trim().toUpperCase();
  return CONTENT_PLATFORMS.includes(normalized as ContentPlatform)
    ? (normalized as ContentPlatform)
    : null;
}
