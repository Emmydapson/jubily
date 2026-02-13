/* eslint-disable prettier/prettier */
import crypto from 'crypto';

const ALG = 'aes-256-gcm';

function getMasterKey(): Buffer {
  const raw = process.env.SETTINGS_MASTER_KEY_BASE64;
  if (!raw) throw new Error('SETTINGS_MASTER_KEY_BASE64 missing');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('SETTINGS_MASTER_KEY_BASE64 must be 32 bytes base64');
  return key;
}

export function encryptString(plain: string): { encrypted: string; last4: string } {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);

  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // store as base64(iv):base64(tag):base64(ciphertext)
  const packed = `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;

  const trimmed = plain.trim();
  const last4 = trimmed.length >= 4 ? trimmed.slice(-4) : trimmed;

  return { encrypted: packed, last4 };
}

export function decryptString(packed: string): string {
  const key = getMasterKey();
  const [ivB64, tagB64, encB64] = packed.split(':');
  if (!ivB64 || !tagB64 || !encB64) throw new Error('Invalid encrypted format');

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');

  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  return plain.toString('utf8');
}

export function maskLast4(last4: string) {
  return last4 ? `••••••••${last4}` : '••••••••';
}
