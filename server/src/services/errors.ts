// Error log: unexpected errors from the server and the apps, grouped (the same
// error = one row with a count), for the platform owner. Works with no outside
// service; a hosted tool (e.g. Sentry) can be added later.

import { createHash } from 'node:crypto';
import type { ErrorEventView } from '@supplyline/core/models';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { notFound } from '../lib/errors';

/** Ids, numbers and file paths vary; strip them so the same error groups together. */
const normalize = (s: string) =>
  s
    .replace(/[a-z0-9]{20,}/gi, '#')
    .replace(/\d+/g, '0')
    .replace(/\(?[A-Za-z]:\\[^)\s]*|\(?\/[^\s)]*\)?/g, '')
    .slice(0, 300);

export async function recordError(e: { source: 'SERVER' | 'CLIENT'; message: string; stack?: string | null; path?: string | null; organizationId?: string | null; userId?: string | null; app?: string | null; version?: string | null }) {
  try {
    const firstFrame = (e.stack ?? '').split('\n').find((l) => /^\s+at /.test(l)) ?? '';
    const fingerprint = createHash('sha1').update([e.source, normalize(e.message), normalize(firstFrame), e.app ?? ''].join('|')).digest('hex');
    await db.errorEvent.upsert({
      where: { fingerprint },
      create: { fingerprint, source: e.source, message: e.message.slice(0, 2000), stack: e.stack?.slice(0, 8000) ?? null, path: e.path?.slice(0, 500) ?? null, organizationId: e.organizationId ?? null, userId: e.userId ?? null, app: e.app ?? null, version: e.version ?? null },
      update: { count: { increment: 1 }, lastAt: new Date(), resolvedAt: null, path: e.path?.slice(0, 500) ?? undefined, version: e.version ?? undefined },
    });
  } catch {
    // Logging an error must never cause another one.
  }
}

/** Simple per-key limit so one broken screen can't flood the log. */
const hits = new Map<string, { n: number; at: number }>();
export function allowClientReport(key: string, perMinute = 20) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.at > 60_000) {
    hits.set(key, { n: 1, at: now });
    if (hits.size > 5000) hits.clear();
    return true;
  }
  h.n++;
  return h.n <= perMinute;
}

export async function listErrors(auth: AuthContext, f: { includeResolved?: boolean } = {}): Promise<ErrorEventView[]> {
  requirePermission(auth, 'platform:manage');
  const rows = await db.errorEvent.findMany({ where: f.includeResolved ? {} : { resolvedAt: null }, orderBy: { lastAt: 'desc' }, take: 200 });
  const orgs = new Map((await db.organization.findMany({ where: { id: { in: rows.map((r) => r.organizationId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
  return rows.map((r) => ({
    id: r.id,
    source: r.source as ErrorEventView['source'],
    message: r.message,
    stack: r.stack,
    path: r.path,
    app: r.app,
    version: r.version,
    organizationName: r.organizationId ? (orgs.get(r.organizationId) ?? null) : null,
    count: r.count,
    firstAt: r.firstAt.toISOString(),
    lastAt: r.lastAt.toISOString(),
    resolved: !!r.resolvedAt,
  }));
}

export async function resolveError(auth: AuthContext, id: string) {
  requirePermission(auth, 'platform:manage');
  const r = await db.errorEvent.findUnique({ where: { id } });
  if (!r) throw notFound('Error');
  await db.errorEvent.update({ where: { id }, data: { resolvedAt: new Date() } });
  return { ok: true };
}
