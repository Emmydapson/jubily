export enum VideoGenerationMode {
  STANDARD = 'STANDARD',
  AI_MOTION = 'AI_MOTION',
}

export enum MotionPlanningStatus {
  NOT_REQUIRED = 'NOT_REQUIRED',
  PENDING = 'PENDING',
  PLANNED = 'PLANNED',
  FAILED = 'FAILED',
}

export enum MotionFallbackPolicy {
  FALLBACK_TO_STANDARD = 'FALLBACK_TO_STANDARD',
  FAIL_JOB = 'FAIL_JOB',
}

export const VIDEO_GENERATION_MODES = [
  VideoGenerationMode.STANDARD,
  VideoGenerationMode.AI_MOTION,
] as const;

export function resolveVideoGenerationMode(
  mode?: string | null,
): VideoGenerationMode {
  const normalized = String(mode || VideoGenerationMode.STANDARD)
    .trim()
    .toUpperCase();
  return normalized === 'AI_MOTION'
    ? VideoGenerationMode.AI_MOTION
    : VideoGenerationMode.STANDARD;
}
