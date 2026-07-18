const WEAK_VALUES = new Set([
  'secret',
  'changeme',
  'change-me',
  'password',
  'your-secret-key',
  'development',
  'jwt_secret',
]);

function requireValue(env: Record<string, unknown>, name: string) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertStrongSecret(
  env: Record<string, unknown>,
  name: string,
  minLength = 32,
) {
  const value = requireValue(env, name);
  if (value.length < minLength)
    throw new Error(`${name} must be at least ${minLength} characters`);
  if (WEAK_VALUES.has(value.toLowerCase()))
    throw new Error(`${name} is too weak`);
  if (/^(.)\1+$/.test(value))
    throw new Error(`${name} must not be a repeated character`);
}

function assertUrl(
  env: Record<string, unknown>,
  name: string,
  options: { publicHost?: boolean } = {},
) {
  const value = requireValue(env, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error(`${name} must use http or https`);
  if (
    options.publicHost &&
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)
  ) {
    throw new Error(`${name} must not use a local host in production`);
  }
}

function assertEmail(env: Record<string, unknown>, name: string) {
  const value = requireValue(env, name);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new Error(`${name} must be a valid email address`);
}

function emailFromAddress(env: Record<string, unknown>) {
  const emailFrom = String(env.EMAIL_FROM || '').trim();
  const parsed = /^(.+?)\s*<([^<>]+)>$/.exec(emailFrom);
  return parsed ? parsed[2].trim() : emailFrom;
}

function assertEmailFrom(env: Record<string, unknown>) {
  const address = emailFromAddress(env);
  if (address) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      throw new Error('EMAIL_FROM must contain a valid email address');
    return;
  }
  assertEmail(env, 'FROM_EMAIL');
  requireValue(env, 'FROM_NAME');
}

function assertPort(env: Record<string, unknown>, name: string) {
  const raw = requireValue(env, name);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`${name} must be a valid TCP port`);
}

function assertBooleanString(env: Record<string, unknown>, name: string) {
  const value = requireValue(env, name).toLowerCase();
  if (!['true', 'false'].includes(value))
    throw new Error(`${name} must be true or false`);
}

function requireSmtp(env: Record<string, unknown>) {
  requireValue(env, 'SMTP_HOST');
  assertPort(env, 'SMTP_PORT');
  assertBooleanString(env, 'SMTP_SECURE');
  requireValue(env, 'SMTP_USER');
  requireValue(env, 'SMTP_PASSWORD');
  assertEmailFrom(env);
}

function emailProvider(env: Record<string, unknown>) {
  const configured = String(env.EMAIL_PROVIDER || '')
    .trim()
    .toLowerCase();
  const provider = configured || (env.SMTP_HOST ? 'smtp' : 'log');
  if (!['log', 'smtp', 'resend'].includes(provider)) {
    throw new Error('EMAIL_PROVIDER must be log, smtp, or resend');
  }
  return provider as 'log' | 'smtp' | 'resend';
}

function requireEmailProvider(
  env: Record<string, unknown>,
  requireExplicit: boolean,
) {
  if (requireExplicit) requireValue(env, 'EMAIL_PROVIDER');
  const provider = emailProvider(env);
  if (provider === 'smtp') {
    requireSmtp(env);
    return;
  }
  assertEmailFrom(env);
  if (provider === 'resend') {
    requireValue(env, 'RESEND_API_KEY');
  }
  if (env.SUPPORT_EMAIL) assertEmail(env, 'SUPPORT_EMAIL');
}

function assertBase64Key(env: Record<string, unknown>, name: string) {
  const value = requireValue(env, name);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
}

function isEnabled(env: Record<string, unknown>, name: string) {
  return String(env[name] || 'false').toLowerCase() === 'true';
}

function isDisabled(env: Record<string, unknown>, name: string) {
  return String(env[name] || '').toLowerCase() === 'false';
}

function requireYoutubeOAuth(
  env: Record<string, unknown>,
  options: { publicHost?: boolean } = {},
) {
  requireValue(env, 'YOUTUBE_CLIENT_ID');
  requireValue(env, 'YOUTUBE_CLIENT_SECRET');
  const redirect = String(
    env.YOUTUBE_REDIRECT_URI || env.YOUTUBE_CUSTOMER_REDIRECT_URI || '',
  ).trim();
  if (!redirect) throw new Error('YOUTUBE_REDIRECT_URI is required');
  assertUrl(
    { YOUTUBE_REDIRECT_URI: redirect },
    'YOUTUBE_REDIRECT_URI',
    options,
  );
}

function requireTikTokOAuth(
  env: Record<string, unknown>,
  options: { publicHost?: boolean } = {},
) {
  requireValue(env, 'TIKTOK_CLIENT_KEY');
  requireValue(env, 'TIKTOK_CLIENT_SECRET');
  assertUrl(env, 'TIKTOK_REDIRECT_URI', options);
}

function requireFacebookOAuth(
  env: Record<string, unknown>,
  options: { publicHost?: boolean } = {},
) {
  requireValue(env, 'FACEBOOK_APP_ID');
  requireValue(env, 'FACEBOOK_APP_SECRET');
  assertUrl(env, 'FACEBOOK_REDIRECT_URI', options);
}

function requireProviderPricing(
  env: Record<string, unknown>,
  provider: 'STRIPE' | 'PAYSTACK',
) {
  const suffixes = [
    'PRO_MONTHLY',
    'PRO_YEARLY',
    'PREMIUM_MONTHLY',
    'PREMIUM_YEARLY',
  ];
  const tail = provider === 'STRIPE' ? 'PRICE_ID' : 'PLAN_CODE';
  for (const suffix of suffixes) {
    requireValue(env, `${provider}_${suffix}_${tail}`);
  }
}

function assertShotstackConfig(
  env: Record<string, unknown>,
  options: { production?: boolean } = {},
) {
  requireValue(env, 'SHOTSTACK_API_KEY');
  const baseUrl = String(env.SHOTSTACK_BASE_URL || '').trim();
  if (!baseUrl) return;

  assertUrl({ SHOTSTACK_BASE_URL: baseUrl }, 'SHOTSTACK_BASE_URL', {
    publicHost: options.production,
  });
  const normalized = baseUrl.replace(/\/+$/, '').toLowerCase();
  if (
    options.production &&
    /\/(?:edit|serve)\/stage(?:\/|$)/.test(normalized)
  ) {
    throw new Error(
      'SHOTSTACK_BASE_URL must use the production v1 API in production',
    );
  }
  if (!/\/edit\/(?:v1|stage)(?:\/render)?$/.test(normalized)) {
    throw new Error(
      'SHOTSTACK_BASE_URL must be a Shotstack edit API base URL ending in /edit/v1',
    );
  }
}

export function validateEnv(config: Record<string, unknown>) {
  const env = { ...config };
  const nodeEnv = String(env.NODE_ENV || '').toLowerCase();
  const isProduction = nodeEnv === 'production';
  const isHosted = isProduction || nodeEnv === 'staging';

  assertStrongSecret(env, 'JWT_SECRET');

  if (
    env.JWT_EXPIRES_IN &&
    !/^\d+(\.\d+)?\s*(ms|s|m|h|d|w|y)?$/i.test(String(env.JWT_EXPIRES_IN))
  ) {
    throw new Error('JWT_EXPIRES_IN must be a duration like 15m, 1h, or 1d');
  }

  if (isHosted) {
    requireValue(env, 'DATABASE_URL');
    requireValue(env, 'ADMIN_EMAILS');
    assertBase64Key(env, 'SETTINGS_MASTER_KEY_BASE64');
    assertUrl(env, 'FRONTEND_URL', { publicHost: true });
    assertUrl(env, 'API_URL', { publicHost: true });
    assertUrl(env, 'PUBLIC_API_BASE_URL', { publicHost: true });
  }

  const youtubePublishingEnabled = isProduction
    ? !isDisabled(env, 'YOUTUBE_PUBLISHING_ENABLED')
    : isEnabled(env, 'YOUTUBE_PUBLISHING_ENABLED');

  if (youtubePublishingEnabled) {
    requireYoutubeOAuth(env, { publicHost: isHosted });
  }

  if (
    isEnabled(env, 'TIKTOK_OAUTH_ENABLED') ||
    env.TIKTOK_CLIENT_KEY ||
    env.TIKTOK_CLIENT_SECRET ||
    env.TIKTOK_REDIRECT_URI
  ) {
    requireTikTokOAuth(env, { publicHost: isHosted });
  }

  if (
    isEnabled(env, 'FACEBOOK_OAUTH_ENABLED') ||
    env.FACEBOOK_APP_ID ||
    env.FACEBOOK_APP_SECRET ||
    env.FACEBOOK_REDIRECT_URI
  ) {
    requireFacebookOAuth(env, { publicHost: isHosted });
  }

  if (isProduction) {
    requireValue(env, 'OPENAI_API_KEY');
    assertShotstackConfig(env, { production: true });
    requireValue(env, 'SHOTSTACK_OWNER_ID');
    requireEmailProvider(env, true);
  }

  if (!isProduction && (env.SHOTSTACK_API_KEY || env.SHOTSTACK_BASE_URL)) {
    assertShotstackConfig(env);
  }

  if (env.EMAIL_PROVIDER || env.RESEND_API_KEY || env.SMTP_HOST) {
    requireEmailProvider(env, false);
  }
  if (env.EMAIL_FROM) assertEmailFrom(env);
  if (env.SUPPORT_EMAIL) assertEmail(env, 'SUPPORT_EMAIL');

  if (isEnabled(env, 'STRIPE_ENABLED')) {
    requireValue(env, 'STRIPE_SECRET_KEY');
    requireValue(env, 'STRIPE_WEBHOOK_SECRET');
    requireProviderPricing(env, 'STRIPE');
  }

  if (isEnabled(env, 'PAYSTACK_ENABLED')) {
    requireValue(env, 'PAYSTACK_SECRET_KEY');
    requireValue(env, 'PAYSTACK_PUBLIC_KEY');
    assertUrl(env, 'FRONTEND_URL', { publicHost: isHosted });
    requireProviderPricing(env, 'PAYSTACK');
  }

  if (env.PUBLIC_API_BASE_URL)
    assertUrl(env, 'PUBLIC_API_BASE_URL', { publicHost: isHosted });
  if (env.JUBILY_API_BASE_URL)
    assertUrl(env, 'JUBILY_API_BASE_URL', { publicHost: isHosted });
  if (env.FRONTEND_URL)
    assertUrl(env, 'FRONTEND_URL', { publicHost: isHosted });
  if (env.API_URL) assertUrl(env, 'API_URL', { publicHost: isHosted });
  if (env.APP_WEB_URL) assertUrl(env, 'APP_WEB_URL', { publicHost: isHosted });
  if (env.PUBLIC_APP_URL)
    assertUrl(env, 'PUBLIC_APP_URL', { publicHost: isHosted });
  if (env.YOUTUBE_REDIRECT)
    assertUrl(env, 'YOUTUBE_REDIRECT', { publicHost: isHosted });
  if (env.YOUTUBE_REDIRECT_URI)
    assertUrl(env, 'YOUTUBE_REDIRECT_URI', { publicHost: isHosted });
  if (env.YOUTUBE_ADMIN_REDIRECT_URI)
    assertUrl(env, 'YOUTUBE_ADMIN_REDIRECT_URI', { publicHost: isHosted });
  if (env.YOUTUBE_CUSTOMER_REDIRECT_URI)
    assertUrl(env, 'YOUTUBE_CUSTOMER_REDIRECT_URI', { publicHost: isHosted });
  if (env.TIKTOK_REDIRECT_URI)
    assertUrl(env, 'TIKTOK_REDIRECT_URI', { publicHost: isHosted });
  if (env.FACEBOOK_REDIRECT_URI)
    assertUrl(env, 'FACEBOOK_REDIRECT_URI', { publicHost: isHosted });

  return env;
}
