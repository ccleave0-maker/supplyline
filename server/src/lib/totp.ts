// Authenticator-app codes (TOTP, RFC 6238): 6 digits, 30-second steps, SHA-1 —
// what Google Authenticator, Microsoft Authenticator, 1Password, Authy etc. use.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));
export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP);

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const off = h[h.length - 1]! & 15;
  const n = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

/** The step the code matches (allowing one step of clock drift either way), or null. */
export function verifyTotp(secret: string, code: string, ms = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = stepAt(ms);
  for (const step of [now, now - 1, now + 1]) {
    const want = Buffer.from(totpAt(secret, step));
    if (timingSafeEqual(want, Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = 'SupplyLine') {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}
