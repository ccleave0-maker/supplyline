// In-memory rate limits (per server process). Enough for one instance; when
// running several instances behind a load balancer, add a shared store.

import { tooMany } from './errors';

const buckets = new Map<string, number[]>();
let sweeps = 0;

/** Allow `max` hits per `windowMs` for this key; throws 429 beyond that. */
export function rateLimit(key: string, max: number, windowMs: number, message = 'Too many requests. Wait a minute and try again.') {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    throw tooMany(message);
  }
  hits.push(now);
  buckets.set(key, hits);
  if (++sweeps % 5000 === 0) for (const [k, v] of buckets) if (!v.some((t) => now - t < 10 * 60_000)) buckets.delete(k);
}

export const resetRateLimits = () => buckets.clear();

