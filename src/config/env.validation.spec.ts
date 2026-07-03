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
        FRONTEND_URL: 'https://joinjubily.com',
        API_URL: 'https://api.example.com',
        PUBLIC_API_BASE_URL: 'http://localhost:5000',
        YOUTUBE_REDIRECT_URI: 'https://api.joinjubily.com/api/auth/youtube/callback',
        YOUTUBE_CLIENT_ID: 'client',
        YOUTUBE_CLIENT_SECRET: 'secret',
        OPENAI_API_KEY: 'openai',
        SHOTSTACK_API_KEY: 'shotstack',
        SHOTSTACK_OWNER_ID: 'owner',
      }),
    ).toThrow('PUBLIC_API_BASE_URL must not use a local host in production');
  });

  it('requires global YouTube OAuth config in production when publishing is enabled', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: strongSecret,
        DATABASE_URL: 'postgresql://user:pass@db/app',
        ADMIN_EMAILS: 'admin@example.com',
        SETTINGS_MASTER_KEY_BASE64: key,
        FRONTEND_URL: 'https://joinjubily.com',
        API_URL: 'https://api.example.com',
        PUBLIC_API_BASE_URL: 'https://api.example.com',
        YOUTUBE_CLIENT_ID: 'client',
        YOUTUBE_CLIENT_SECRET: 'secret',
        OPENAI_API_KEY: 'openai',
        SHOTSTACK_API_KEY: 'shotstack',
        SHOTSTACK_OWNER_ID: 'owner',
        EMAIL_PROVIDER: 'log',
        EMAIL_FROM: 'Jubily <noreply@joinjubily.com>',
        SUPPORT_EMAIL: 'info@joinjubily.com',
      }),
    ).toThrow('YOUTUBE_REDIRECT_URI is required');

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: strongSecret,
        DATABASE_URL: 'postgresql://user:pass@db/app',
        ADMIN_EMAILS: 'admin@example.com',
        SETTINGS_MASTER_KEY_BASE64: key,
        FRONTEND_URL: 'https://joinjubily.com',
        API_URL: 'https://api.example.com',
        PUBLIC_API_BASE_URL: 'https://api.example.com',
        YOUTUBE_REDIRECT_URI: 'https://api.joinjubily.com/api/auth/youtube/callback',
        YOUTUBE_CLIENT_ID: 'client',
        YOUTUBE_CLIENT_SECRET: 'secret',
        OPENAI_API_KEY: 'openai',
        SHOTSTACK_API_KEY: 'shotstack',
        SHOTSTACK_OWNER_ID: 'owner',
        EMAIL_PROVIDER: 'log',
        EMAIL_FROM: 'Jubily <noreply@joinjubily.com>',
        SUPPORT_EMAIL: 'info@joinjubily.com',
      }),
    ).not.toThrow();
  });

  it('does not require YouTube OAuth config in production when publishing is disabled', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: strongSecret,
        DATABASE_URL: 'postgresql://user:pass@db/app',
        ADMIN_EMAILS: 'admin@example.com',
        SETTINGS_MASTER_KEY_BASE64: key,
        FRONTEND_URL: 'https://joinjubily.com',
        API_URL: 'https://api.example.com',
        PUBLIC_API_BASE_URL: 'https://api.example.com',
        YOUTUBE_PUBLISHING_ENABLED: 'false',
        OPENAI_API_KEY: 'openai',
        SHOTSTACK_API_KEY: 'shotstack',
        SHOTSTACK_OWNER_ID: 'owner',
        EMAIL_PROVIDER: 'log',
        EMAIL_FROM: 'Jubily <noreply@joinjubily.com>',
        SUPPORT_EMAIL: 'info@joinjubily.com',
      }),
    ).not.toThrow();
  });

  it('requires YouTube OAuth config outside production when publishing is explicitly enabled', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        JWT_SECRET: strongSecret,
        YOUTUBE_PUBLISHING_ENABLED: 'true',
      }),
    ).toThrow('YOUTUBE_CLIENT_ID is required');

    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        JWT_SECRET: strongSecret,
        YOUTUBE_PUBLISHING_ENABLED: 'true',
        YOUTUBE_CLIENT_ID: 'client',
        YOUTUBE_CLIENT_SECRET: 'secret',
        YOUTUBE_REDIRECT_URI: 'http://localhost:3000/api/auth/youtube/callback',
      }),
    ).not.toThrow();
  });

  it('requires public frontend and api URLs in hosted environments', () => {
    const hostedBase = {
      NODE_ENV: 'staging',
      JWT_SECRET: strongSecret,
      DATABASE_URL: 'postgresql://user:pass@db/app',
      ADMIN_EMAILS: 'admin@example.com',
      SETTINGS_MASTER_KEY_BASE64: key,
      PUBLIC_API_BASE_URL: 'https://api.example.com',
    };

    expect(() => validateEnv({ ...hostedBase, FRONTEND_URL: 'http://localhost:3000', API_URL: 'https://api.example.com' }))
      .toThrow('FRONTEND_URL must not use a local host');
    expect(() => validateEnv({ ...hostedBase, FRONTEND_URL: 'https://joinjubily.com' }))
      .toThrow('API_URL is required');
    expect(() =>
      validateEnv({
        ...hostedBase,
        FRONTEND_URL: 'https://joinjubily.com',
        API_URL: 'https://api.joinjubily.com',
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
    ).toThrow('PAYSTACK_PUBLIC_KEY is required');

    expect(() =>
      validateEnv({
        JWT_SECRET: strongSecret,
        PAYSTACK_ENABLED: 'true',
        PAYSTACK_SECRET_KEY: 'sk_test_key',
        PAYSTACK_PUBLIC_KEY: 'pk_test_key',
      }),
    ).toThrow('FRONTEND_URL is required');

    expect(() =>
      validateEnv({
        JWT_SECRET: strongSecret,
        PAYSTACK_ENABLED: 'true',
        PAYSTACK_SECRET_KEY: 'sk_test_key',
        PAYSTACK_PUBLIC_KEY: 'pk_test_key',
        FRONTEND_URL: 'https://joinjubily.com',
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
        EMAIL_FROM: 'Jubily <noreply@joinjubily.com>',
      }),
    ).toThrow('RESEND_API_KEY is required');

    expect(() =>
      validateEnv({
        JWT_SECRET: strongSecret,
        EMAIL_PROVIDER: 'resend',
        EMAIL_FROM: 'Jubily <noreply@joinjubily.com>',
        SUPPORT_EMAIL: 'info@joinjubily.com',
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
