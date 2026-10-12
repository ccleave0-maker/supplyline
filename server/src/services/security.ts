// Security: the authenticator-app check (two-step sign-in), Admin › Security
// settings, and alerts to admins built from the audit trail.

import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import type { MfaSetup, SecurityEvent, SecuritySettings } from '@supplyline/core/models';
import type { Prisma } from '../generated/prisma/client';
import { sendEmail } from '../integrations/email';
import { audit } from '../lib/audit';
import { mfaStatusOf, requirePermission, securityOf, type AuthContext } from '../lib/auth';

export { mfaStatusOf, securityOf };
import { decrypt, encrypt, randomToken, safeEqual } from '../lib/crypto';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors';
import { rateLimit } from '../lib/rate-limit';
import { newTotpSecret, otpauthUri, verifyTotp } from '../lib/totp';

const MAX_MFA_FAILURES = 5;
const hashCode = (c: string) => createHash('sha256').update(`supplyline-recovery:${c.toUpperCase().replace(/[^A-Z0-9]/g, '')}`).digest('hex');

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function getSecuritySettings(auth: AuthContext) {
  requirePermission(auth, 'org:manage');
  return securityOf((await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { settings: true } })).settings);
}

export async function saveSecuritySettings(auth: AuthContext, input: SecuritySettings) {
  requirePermission(auth, 'org:manage');
  if (!input.mfaEveryone && !input.mfaRequiredRoles.includes('ADMIN')) throw badRequest('Admins must always use an authenticator app.');
  const o = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { settings: true } });
  const before = securityOf(o.settings);
  await db.organization.update({ where: { id: auth.orgId }, data: { settings: { ...((o.settings as Record<string, unknown>) ?? {}), security: input } as Prisma.InputJsonValue } });
  await audit(db, auth, 'security.settings', 'Organization', auth.orgId, before, input);
  return input;
}

// ---------------------------------------------------------------------------
// Authenticator app
// ---------------------------------------------------------------------------
export async function startMfaSetup(auth: AuthContext): Promise<MfaSetup> {
  const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId } });
  if (user.mfaEnabledAt) throw conflict('Your authenticator app is already set up.');
  const secret = newTotpSecret();
  await db.user.update({ where: { id: user.id }, data: { mfaPendingSecretEnc: encrypt(secret) } });
  const uri = otpauthUri(secret, user.email);
  return { secret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => randomToken(8).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase().replace(/(.{5})/, '$1-'));
  return { codes, hashes: codes.map(hashCode) };
}

/** First code from the app turns it on; gives recovery codes once. */
export async function enableMfa(auth: AuthContext, code: string): Promise<{ recoveryCodes: string[] }> {
  rateLimit(`mfa:${auth.sessionId}`, 10, 5 * 60_000, 'Too many tries. Wait a few minutes.');
  const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId } });
  if (!user.mfaPendingSecretEnc) throw badRequest('Start the setup first.');
  const secret = decrypt(user.mfaPendingSecretEnc);
  const step = verifyTotp(secret, code);
  if (step == null) throw badRequest('That code isn’t right. Check the time on your phone and try the newest code.');
  const { codes, hashes } = newRecoveryCodes();
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encrypt(secret), mfaPendingSecretEnc: null, mfaEnabledAt: new Date(), mfaRecoveryHashes: hashes, mfaLastStep: step } }),
    db.session.update({ where: { id: auth.sessionId }, data: { mfaVerifiedAt: new Date(), mfaFailures: 0 } }),
  ]);
  await audit(db, auth, 'mfa.enabled', 'User', user.id);
  return { recoveryCodes: codes };
}

/** The code at sign-in (or a one-time recovery code). */
export async function verifyMfa(auth: AuthContext, code: string): Promise<{ ok: true; recoveryCodesLeft: number }> {
  rateLimit(`mfa:${auth.sessionId}`, 10, 5 * 60_000, 'Too many tries. Wait a few minutes.');
  const [user, session] = await Promise.all([db.user.findUniqueOrThrow({ where: { id: auth.userId } }), db.session.findUniqueOrThrow({ where: { id: auth.sessionId } })]);
  if (!user.mfaEnabledAt || !user.mfaSecretEnc) throw badRequest('No authenticator app is set up.');
  if (session.mfaVerifiedAt) return { ok: true, recoveryCodesLeft: user.mfaRecoveryHashes.length };
  const step = verifyTotp(decrypt(user.mfaSecretEnc), code);
  if (step != null && step > (user.mfaLastStep ?? -1)) {
    await db.$transaction([db.user.update({ where: { id: user.id }, data: { mfaLastStep: step } }), db.session.update({ where: { id: session.id }, data: { mfaVerifiedAt: new Date(), mfaFailures: 0 } })]);
    return { ok: true, recoveryCodesLeft: user.mfaRecoveryHashes.length };
  }
  const h = hashCode(code);
  const hit = user.mfaRecoveryHashes.find((x) => safeEqual(x, h));
  if (hit) {
    const left = user.mfaRecoveryHashes.filter((x) => x !== hit);
    await db.$transaction([db.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: left } }), db.session.update({ where: { id: session.id }, data: { mfaVerifiedAt: new Date(), mfaFailures: 0 } })]);
    await audit(db, auth, 'mfa.recovery_used', 'User', user.id, null, { left: left.length });
    return { ok: true, recoveryCodesLeft: left.length };
  }
  const failures = session.mfaFailures + 1;
  await audit(db, auth, 'mfa.failed', 'User', user.id, null, { failures });
  if (failures >= MAX_MFA_FAILURES) {
    await db.session.update({ where: { id: session.id }, data: { mfaFailures: failures, revokedAt: new Date() } });
    await audit(db, auth, 'mfa.locked', 'User', user.id);
    throw unauthorized('Too many wrong codes. You’ve been signed out — sign in again.');
  }
  await db.session.update({ where: { id: session.id }, data: { mfaFailures: failures } });
  throw badRequest(step != null ? 'That code was already used. Wait for the next one.' : 'That code isn’t right. Try the newest code in your app.');
}

export async function disableMfa(auth: AuthContext, code: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId }, include: { organization: { select: { settings: true } } } });
  if (mfaStatusOf(user, null, user.organization.settings).required) throw conflict('Your role must use an authenticator app, so it can’t be turned off.');
  if (!user.mfaSecretEnc || verifyTotp(decrypt(user.mfaSecretEnc), code) == null) throw badRequest('That code isn’t right.');
  await db.user.update({ where: { id: user.id }, data: { mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaRecoveryHashes: [], mfaLastStep: null } });
  await audit(db, auth, 'mfa.disabled', 'User', user.id);
  return { ok: true };
}

/** Admin: someone lost their phone. They set it up again at their next sign-in. */
export async function resetUserMfa(auth: AuthContext, userId: string) {
  requirePermission(auth, 'org:manage');
  const u = await db.user.findFirst({ where: { id: userId, organizationId: auth.orgId } });
  if (!u) throw notFound('Person');
  await db.$transaction([
    db.user.update({ where: { id: u.id }, data: { mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaRecoveryHashes: [], mfaLastStep: null } }),
    db.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(db, auth, 'mfa.reset', 'User', u.id, null, { email: u.email });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Alerts from the audit trail
// ---------------------------------------------------------------------------
const WATCH: Record<string, { label: string; severity: SecurityEvent['severity'] }> = {
  'mfa.disabled': { label: 'Turned off their authenticator app', severity: 'warning' },
  'mfa.reset': { label: 'Reset someone’s authenticator app', severity: 'warning' },
  'mfa.locked': { label: 'Signed out after too many wrong authenticator codes', severity: 'alert' },
  'mfa.recovery_used': { label: 'Signed in with a recovery code', severity: 'warning' },
  'auth.code_locked': { label: 'Too many wrong email sign-in codes', severity: 'alert' },
  'security.settings': { label: 'Changed security settings', severity: 'warning' },
  'org.access_settings': { label: 'Changed access rules', severity: 'info' },
  'org.data_export': { label: 'Downloaded a full data export', severity: 'warning' },
  'ai.settings': { label: 'Changed AI settings / key', severity: 'info' },
  'admin.granted': { label: 'Made someone an admin', severity: 'alert' },
};

/** Audit rows → security events (role changes to ADMIN are spotted from user.update / invite.create). */
function toEvent(r: { id: bigint; action: string; before: unknown; after: unknown; at: Date }, who: string | null): SecurityEvent | null {
  let action = r.action;
  if (action === 'user.update' || action === 'invite.create') {
    const before = ((r.before as { roles?: string[] } | null)?.roles ?? []) as string[];
    const after = ((r.after as { roles?: string[] } | null)?.roles ?? []) as string[];
    if (!after.includes('ADMIN') || before.includes('ADMIN')) return null;
    action = 'admin.granted';
  }
  const w = WATCH[action];
  return w ? { id: String(r.id), at: r.at.toISOString(), action, label: w.label, who, severity: w.severity } : null;
}

export async function securityEvents(auth: AuthContext, days = 30): Promise<SecurityEvent[]> {
  requirePermission(auth, 'org:manage');
  return eventsFor(auth.orgId, new Date(Date.now() - days * 86_400_000));
}

async function eventsFor(orgId: string, since: Date, afterId?: bigint) {
  const rows = await db.auditLog.findMany({
    where: { organizationId: orgId, at: { gte: since }, ...(afterId ? { id: { gt: afterId } } : {}), action: { in: [...Object.keys(WATCH), 'user.update', 'invite.create'] } },
    orderBy: { id: 'desc' },
    take: 300,
  });
  const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => toEvent(r, r.userId ? (names.get(r.userId) ?? null) : null)).filter((e): e is SecurityEvent => !!e);
}

/**
 * Timer: tell admins about new warnings and alerts (in the app, and by email when on).
 * One cursor over the audit trail, so it only looks at what's new — however many organizations there are.
 */
export async function runSecurityAlerts(_now = new Date()): Promise<number> {
  const key = 'securityAlerts:cursor';
  const cursor = await db.platformSetting.findUnique({ where: { key } });
  const top = await db.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  if (!top) return 0;
  const lastId = (cursor?.value as { lastId?: string } | null)?.lastId;
  if (!lastId) {
    // First run: start from now, don't replay history.
    await db.platformSetting.upsert({ where: { key }, create: { key, value: { lastId: String(top.id) } }, update: { value: { lastId: String(top.id) } } });
    return 0;
  }
  const rows = await db.auditLog.findMany({
    where: { id: { gt: BigInt(lastId), lte: top.id }, organizationId: { not: null }, action: { in: [...Object.keys(WATCH), 'user.update', 'invite.create'] } },
    orderBy: { id: 'asc' },
    take: 2000,
  });
  const newest = rows.length === 2000 ? rows[rows.length - 1]!.id : top.id;
  await db.platformSetting.update({ where: { key }, data: { value: { lastId: String(newest) } } });
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const byOrg = new Map<string, SecurityEvent[]>();
  for (const r of rows) {
    const e = toEvent(r, r.userId ? (names.get(r.userId) ?? null) : null);
    if (!e || e.severity === 'info') continue;
    byOrg.set(r.organizationId!, [...(byOrg.get(r.organizationId!) ?? []), e]);
  }
  let sent = 0;
  for (const [orgId, events] of byOrg) {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { status: true, settings: true } });
    if (!org || org.status !== 'ACTIVE') continue;
    const admins = await db.user.findMany({ where: { organizationId: orgId, active: true, deletedAt: null, roles: { has: 'ADMIN' } }, select: { id: true, email: true } });
    const lines = events.map((e) => `- ${new Date(e.at).toLocaleString('en-CA', { timeZone: env().SCHEDULE_TIMEZONE })}: ${e.who ?? 'Someone'} — ${e.label}`);
    for (const a of admins)
      await db.notification.create({ data: { userId: a.id, type: 'SECURITY', title: `Security: ${events.length} event(s) to review`, body: events.slice(0, 3).map((e) => `${e.who ?? 'Someone'}: ${e.label}`).join('\n'), link: '/admin/security/' } });
    if (securityOf(org.settings).alertAdmins && admins.length)
      await sendEmail({ fromName: env().EMAIL_FROM_NAME, to: admins.map((a) => a.email), subject: `SupplyLine security: ${events.length} event(s) to review`, text: `${lines.join('\n')}\n\nReview them under Admin › Security.` }, { organizationId: orgId, relatedType: 'security_alert' });
    sent += events.length;
  }
  return sent;
}
