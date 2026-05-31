/* eslint-disable prettier/prettier */
import type { StringValue } from 'ms';

const WEAK_SECRETS = new Set([
  'secret',
  'changeme',
  'change-me',
  'password',
  'jwt_secret',
  'your_jwt_secret',
  'your-secret-key',
  'development',
]);

export function getJwtSecret(): string {
  const secret = String(process.env.JWT_SECRET || '').trim();

  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }

  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }

  if (WEAK_SECRETS.has(secret.toLowerCase())) {
    throw new Error('JWT_SECRET is too weak');
  }

  if (/^(.)\1+$/.test(secret)) {
    throw new Error('JWT_SECRET must not be a repeated character');
  }

  return secret;
}

export function getJwtExpiresIn(): StringValue {
  const expires = String(process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRES || '1d').trim();

  if (!expires) {
    throw new Error('JWT_EXPIRES_IN must not be empty');
  }

  if (!/^\d+(\.\d+)?\s*(ms|s|m|h|d|w|y)?$/i.test(expires)) {
    throw new Error('JWT_EXPIRES_IN must be a duration like 15m, 1h, or 1d');
  }

  return expires as StringValue;
}
