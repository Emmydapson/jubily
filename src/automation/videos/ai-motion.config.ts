export type AiMotionProviderName = 'fake';

export type AiMotionConfig = {
  enabled: boolean;
  provider: AiMotionProviderName;
  fakeProviderEnabled: boolean;
  fakeCreditsPerSecond: number;
  fakeBaseCredits: number;
  maxAttempts: number;
  requestTimeoutMs: number;
  pollIntervalMs: number;
  maxPollDurationMs: number;
};

function bool(name: string, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return String(raw).trim().toLowerCase() === 'true';
}

function numberValue(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function aiMotionConfig(): AiMotionConfig {
  const provider = String(process.env.AI_MOTION_PROVIDER || 'fake')
    .trim()
    .toLowerCase();
  if (provider !== 'fake') {
    throw new Error('AI_MOTION_PROVIDER must be fake');
  }
  return {
    enabled: bool('AI_MOTION_ENABLED', false),
    provider,
    fakeProviderEnabled: bool('AI_MOTION_FAKE_PROVIDER_ENABLED', false),
    fakeCreditsPerSecond: numberValue('AI_MOTION_FAKE_CREDITS_PER_SECOND', 1),
    fakeBaseCredits: numberValue('AI_MOTION_FAKE_BASE_CREDITS', 0),
    maxAttempts: Math.max(1, numberValue('AI_MOTION_MAX_ATTEMPTS', 2)),
    requestTimeoutMs: numberValue('AI_MOTION_REQUEST_TIMEOUT_MS', 60_000),
    pollIntervalMs: numberValue('AI_MOTION_POLL_INTERVAL_MS', 5_000),
    maxPollDurationMs: numberValue('AI_MOTION_MAX_POLL_DURATION_MS', 600_000),
  };
}
