import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const strongSecret = 'a'.repeat(32) + 'B1!';
  const key = Buffer.alloc(32, 1).toString('base64');

  it('requires a strong JWT secret', () => {
    expect(() => validateEnv({ JWT_SECRET: 'short' })).toThrow('JWT_SECRET must be at least');
    expect(() => validateEnv({ JWT_SECRET: strongSecret })).not.toThrow();
  });

  it('requires production encryption key and public URLs', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: strongSecret,
        DATABASE_URL: 'postgresql://user:pass@db/app',
        ADMIN_EMAILS: 'admin@example.com',
        SETTINGS_MASTER_KEY_BASE64: key,
        PUBLIC_API_BASE_URL: 'http://localhost:5000',
        YOUTUBE_ADMIN_REDIRECT_URI: 'https://api.example.com/admin/auth/youtube/callback',
        YOUTUBE_CUSTOMER_REDIRECT_URI: 'https://api.example.com/workspaces/youtube/callback',
        YOUTUBE_CLIENT_ID: 'client',
        YOUTUBE_CLIENT_SECRET: 'secret',
        OPENAI_API_KEY: 'openai',
        SHOTSTACK_API_KEY: 'shotstack',
        SHOTSTACK_OWNER_ID: 'owner',
      }),
    ).toThrow('PUBLIC_API_BASE_URL must not use a local host in production');
  });

  it('requires split YouTube redirect URIs in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: strongSecret,
        DATABASE_URL: 'postgresql://user:pass@db/app',
        ADMIN_EMAILS: 'admin@example.com',
        SETTINGS_MASTER_KEY_BASE64: key,
        PUBLIC_API_BASE_URL: 'https://api.example.com',
        YOUTUBE_REDIRECT: 'https://api.example.com/auth/youtube/callback',
        YOUTUBE_CLIENT_ID: 'client',
        YOUTUBE_CLIENT_SECRET: 'secret',
        OPENAI_API_KEY: 'openai',
        SHOTSTACK_API_KEY: 'shotstack',
        SHOTSTACK_OWNER_ID: 'owner',
        EMAIL_PROVIDER: 'log',
        FROM_EMAIL: 'hello@example.com',
        FROM_NAME: 'Jubily',
      }),
    ).toThrow('YOUTUBE_ADMIN_REDIRECT_URI is required');

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: strongSecret,
        DATABASE_URL: 'postgresql://user:pass@db/app',
        ADMIN_EMAILS: 'admin@example.com',
        SETTINGS_MASTER_KEY_BASE64: key,
        PUBLIC_API_BASE_URL: 'https://api.example.com',
        YOUTUBE_ADMIN_REDIRECT_URI: 'https://api.example.com/admin/auth/youtube/callback',
        YOUTUBE_CUSTOMER_REDIRECT_URI: 'https://api.example.com/workspaces/youtube/callback',
        YOUTUBE_CLIENT_ID: 'client',
        YOUTUBE_CLIENT_SECRET: 'secret',
        OPENAI_API_KEY: 'openai',
        SHOTSTACK_API_KEY: 'shotstack',
        SHOTSTACK_OWNER_ID: 'owner',
        EMAIL_PROVIDER: 'log',
        FROM_EMAIL: 'hello@example.com',
        FROM_NAME: 'Jubily',
      }),
    ).not.toThrow();
  });

  it('requires Stripe pricing only when Stripe is enabled', () => {
    expect(() =>
      validateEnv({
        JWT_SECRET: strongSecret,
        STRIPE_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_key',
        STRIPE_WEBHOOK_SECRET: 'whsec_test_key',
      }),
    ).toThrow('STRIPE_PRO_MONTHLY_PRICE_ID is required');

    expect(() =>
      validateEnv({
        JWT_SECRET: strongSecret,
        STRIPE_ENABLED: 'false',
      }),
    ).not.toThrow();
  });

  it('requires Paystack plan codes only when Paystack is enabled', () => {
    expect(() =>
      validateEnv({
        JWT_SECRET: strongSecret,
        PAYSTACK_ENABLED: 'true',
        PAYSTACK_SECRET_KEY: 'sk_test_key',
      }),
    ).toThrow('PAYSTACK_PRO_MONTHLY_PLAN_CODE is required');

    expect(() =>
      validateEnv({
        JWT_SECRET: strongSecret,
        PAYSTACK_ENABLED: 'false',
      }),
    ).not.toThrow();
  });

  it('validates email provider-specific configuration', () => {
    expect(() =>
      validateEnv({
        JWT_SECRET: strongSecret,
        EMAIL_PROVIDER: 'resend',
        FROM_EMAIL: 'hello@example.com',
        FROM_NAME: 'Jubily',
      }),
    ).toThrow('RESEND_API_KEY is required');

    expect(() =>
      validateEnv({
        JWT_SECRET: strongSecret,
        EMAIL_PROVIDER: 'resend',
        FROM_EMAIL: 'hello@example.com',
        FROM_NAME: 'Jubily',
        RESEND_API_KEY: 're_test',
      }),
    ).not.toThrow();

    expect(() =>
      validateEnv({
        JWT_SECRET: strongSecret,
        EMAIL_PROVIDER: 'bad',
      }),
    ).toThrow('EMAIL_PROVIDER must be log, smtp, or resend');
  });
});
