import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/** Keyed hash used for login codes and session tokens (never stored in plain text). */
export function hashSecret(value: string): string {
  return createHmac('sha256', env().AUTH_SECRET).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function encryptionKey(): Buffer {
  const key = Buffer.from(env().ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

/** AES-256-GCM for API keys and connector credentials stored in the database. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognized encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** Signed, expiring file URLs so <img> tags work without sending the login token. */
export function signFilePath(fileId: string, ttlSeconds = 60 * 60 * 24 * 7): string {
  // Round expiry to the hour so URLs are stable (and cacheable) for a while.
  const exp = Math.ceil((Date.now() / 1000 + ttlSeconds) / 3600) * 3600;
  const sig = createHmac('sha256', env().AUTH_SECRET).update(`file:${fileId}:${exp}`).digest('base64url');
  return `/api/v1/files/${fileId}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(fileId: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
  const expected = createHmac('sha256', env().AUTH_SECRET).update(`file:${fileId}:${exp}`).digest('base64url');
  return safeEqual(expected, sig);
}
