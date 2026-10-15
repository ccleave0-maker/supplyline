// Health checks: database, email, file storage, AI setup, network folders, the
// Sync app, and stuck work. Run on a timer (interval set in Admin › Health);
// an alert email goes out only when the status changes (something broke, or it's fixed).

import { promises as fs } from 'node:fs';
import { DEFAULT_HEALTH, healthSettingsInput, type HealthResult, type HealthRunView, type HealthSettings } from '@supplyline/core/models';
import { sendEmail } from '../integrations/email';
import { defaultStorage } from '../integrations/storage';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { accountingOf } from './ap';
import { folderStatus } from './ap-folders';
import { filingOf } from './filing';

export function healthOf(settings: unknown): HealthSettings {
  const parsed = healthSettingsInput.partial().safeParse((settings as { health?: unknown } | null)?.health ?? {});
  return { ...DEFAULT_HEALTH, ...(parsed.success ? parsed.data : {}) };
}

export async function getHealthSettings(auth: AuthContext) {
  requirePermission(auth, 'health:view');
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
  return healthOf(org.settings);
}

export async function saveHealthSettings(auth: AuthContext, input: HealthSettings) {
  requirePermission(auth, 'health:view');
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
  await db.organization.update({ where: { id: auth.orgId }, data: { settings: { ...((org.settings as Record<string, unknown>) ?? {}), health: input } } });
  await audit(db, auth, 'org.health_settings', 'Organization', auth.orgId, null, input);
  return input;
}

async function timed(key: string, label: string, fn: () => Promise<{ ok: boolean; warn?: boolean; detail: string }>): Promise<HealthResult> {
  const t = Date.now();
  try {
    const r = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('No answer in 20 seconds')), 20_000))]);
    return { key, label, ...r, ms: Date.now() - t };
  } catch (e) {
    return { key, label, ok: false, detail: (e as Error).message.slice(0, 300), ms: Date.now() - t };
  }
}

const ago = (d: Date) => {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Every check for one organization. */
export async function runChecks(orgId: string): Promise<HealthResult[]> {
  const day = new Date(Date.now() - 86_400_000);
  const companies = await db.company.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, settings: true } });
  const checks: Promise<HealthResult>[] = [
    timed('database', 'Database', async () => {
      await db.$queryRaw`SELECT 1`;
      return { ok: true, detail: 'Answering.' };
    }),
    timed('email', 'Email sending', async () => {
      const e = env();
      const failed = await db.emailOutbox.count({ where: { organizationId: orgId, status: 'FAILED', createdAt: { gte: day } } });
      if (e.EMAIL_PROVIDER === 'console') return { ok: true, warn: true, detail: 'Emails are only printed on the server (EMAIL_PROVIDER=console). Fine for testing.' };
      if (e.EMAIL_PROVIDER === 'smtp' && (!e.SMTP_USER || !e.SMTP_PASSWORD)) return { ok: false, detail: 'SMTP is chosen but SMTP_USER / SMTP_PASSWORD are not set in the server settings.' };
      if (e.EMAIL_PROVIDER === 'resend' && !e.RESEND_API_KEY) return { ok: false, detail: 'Resend is chosen but RESEND_API_KEY is not set.' };
      if (failed) return { ok: false, detail: `${failed} email(s) failed to send in the last 24 hours (Emails to review shows them).` };
      return { ok: true, detail: `Sending with ${e.EMAIL_PROVIDER}. No failures in 24 hours.` };
    }),
    timed('storage', 'File storage', async () => {
      const s = defaultStorage();
      const key = `${orgId}/health/${Date.now()}.txt`;
      const bytes = new TextEncoder().encode('ok');
      await s.put(key, bytes, 'text/plain');
      const back = await s.get(key);
      await s.remove(key).catch(() => {});
      if (new TextDecoder().decode(back) !== 'ok') throw new Error('A test file came back different.');
      return { ok: true, detail: `Saving and reading files works (${s.kind.toLowerCase()}).` };
    }),
    timed('ai', 'AI (Claude)', async () => {
      const c = await db.aiConfig.findUnique({ where: { organizationId: orgId } });
      const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { aiFallbackEnabled: true } });
      if (!c?.enabled) return { ok: true, warn: true, detail: 'Turned off (Admin › AI).' };
      if (!c.apiKeyEncrypted && !org.aiFallbackEnabled) return { ok: false, detail: 'Turned on but there is no Claude key. Add one under Admin › AI.' };
      const used = await db.aiRequestLog.count({ where: { organizationId: orgId, createdAt: { gte: day } } });
      return { ok: true, detail: `Set up. ${used} request(s) in the last 24 hours.` };
    }),
    timed('filing', 'Network filing', async () => {
      const on = companies.map((c) => ({ c, f: filingOf(c.settings) })).filter((x) => x.f.enabled);
      if (!on.length) return { ok: true, warn: true, detail: 'Not turned on.' };
      const problems: string[] = [];
      for (const { c, f } of on) {
        if (f.mode === 'DIRECT') {
          try {
            await fs.access(f.root);
          } catch (e) {
            problems.push(`${c.name}: can't open ${f.root} (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
          }
        }
      }
      const failed = await db.filingJob.count({ where: { organizationId: orgId, status: 'FAILED' } });
      const stuck = await db.filingJob.count({ where: { organizationId: orgId, status: 'PENDING', createdAt: { lt: new Date(Date.now() - 60 * 60_000) } } });
      if (failed) problems.push(`${failed} cop${failed === 1 ? 'y' : 'ies'} failed (Admin › Network filing › Try again).`);
      if (stuck) problems.push(`${stuck} waiting over an hour.`);
      return problems.length ? { ok: false, detail: problems.join(' ') } : { ok: true, detail: 'Folders reachable; nothing stuck.' };
    }),
    timed('sync', 'Bowron Sync app', async () => {
      const needs = companies.some((c) => filingOf(c.settings).mode === 'SYNC' && (filingOf(c.settings).enabled || accountingOf(c.settings).folders.inbox));
      const devices = await db.syncDevice.findMany({ where: { organizationId: orgId, revokedAt: null } });
      if (!needs && !devices.length) return { ok: true, warn: true, detail: 'Not used.' };
      if (!devices.length) return { ok: false, detail: 'A company is set to use the Sync app but no PC has a key yet.' };
      const last = devices.map((d) => d.lastSeenAt).filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0];
      if (!last) return { ok: false, detail: 'The Sync app has never checked in.' };
      if (Date.now() - last.getTime() > 15 * 60_000) return { ok: false, detail: `The Sync app last checked in ${ago(last)}. Is that PC on?` };
      return { ok: true, detail: `Last checked in ${ago(last)}.` };
    }),
    timed('ap-folders', 'AP inbox folders', async () => {
      const set = companies.filter((c) => accountingOf(c.settings).folders.inbox && filingOf(c.settings).mode !== 'SYNC');
      if (!set.length) return { ok: true, warn: true, detail: 'Not used (or watched by the Sync app).' };
      const p = folderStatus(orgId);
      return p ? { ok: false, detail: p } : { ok: true, detail: 'Inbox folders reachable.' };
    }),
    timed('work', 'Stuck work', async () => {
      const held = await db.emailOutbox.count({ where: { organizationId: orgId, status: 'REVIEW', createdAt: { lt: new Date(Date.now() - 2 * 86_400_000) } } });
      const apOld = await db.apInvoice.count({ where: { organizationId: orgId, status: { in: ['RECEIVED', 'NEEDS_REVIEW'] }, createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
      const notes = [held && `${held} email(s) waiting for review over 2 days`, apOld && `${apOld} vendor invoice(s) not looked at in a week`].filter(Boolean);
      return notes.length ? { ok: true, warn: true, detail: `${notes.join('; ')}.` } : { ok: true, detail: 'Nothing waiting too long.' };
    }),
  ];
  return Promise.all(checks);
}

function view(r: { id: string; at: Date; ok: boolean; alerted: boolean; results: unknown }): HealthRunView {
  return { id: r.id, at: r.at.toISOString(), ok: r.ok, alerted: r.alerted, results: r.results as HealthResult[] };
}

/** Run now, store the result, and alert if the status changed. */
export async function runHealth(orgId: string): Promise<HealthRunView> {
  const results = await runChecks(orgId);
  const ok = results.every((r) => r.ok);
  const prev = await db.healthCheckRun.findFirst({ where: { organizationId: orgId }, orderBy: { at: 'desc' } });
  const changed = prev ? prev.ok !== ok || (!ok && failingKeys(prev.results) !== failingKeys(results)) : !ok;
  const run = await db.healthCheckRun.create({ data: { organizationId: orgId, ok, results: results as unknown as object } });
  if (changed) {
    const sent = await alert(orgId, ok, results).catch((e) => {
      console.error('[health] alert failed', e);
      return false;
    });
    if (sent) await db.healthCheckRun.update({ where: { id: run.id }, data: { alerted: true } });
    run.alerted = sent;
  }
  // Keep about a month of history.
  await db.healthCheckRun.deleteMany({ where: { organizationId: orgId, at: { lt: new Date(Date.now() - 31 * 86_400_000) } } });
  return view(run);
}

const failingKeys = (results: unknown) =>
  (results as HealthResult[])
    .filter((r) => !r.ok)
    .map((r) => r.key)
    .sort()
    .join(',');

async function alert(orgId: string, ok: boolean, results: HealthResult[]): Promise<boolean> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const s = healthOf(org.settings);
  let to = s.alertEmails;
  if (!to.length) {
    const people = await db.user.findMany({ where: { active: true, deletedAt: null, OR: [{ organizationId: orgId, roles: { has: 'ADMIN' } }, { isPlatformOwner: true }] }, select: { email: true } });
    to = [...new Set(people.map((p) => p.email))];
  }
  if (!to.length) return false;
  const bad = results.filter((r) => !r.ok);
  const text = ok
    ? `Good news: every Bowron health check for ${org.name} is passing again.\n\n${results.map((r) => `✔ ${r.label}: ${r.detail}`).join('\n')}`
    : `Something needs a look in Bowron for ${org.name}:\n\n${bad.map((r) => `✖ ${r.label}: ${r.detail}`).join('\n')}\n\nEverything else:\n${results.filter((r) => r.ok).map((r) => `✔ ${r.label}`).join('\n')}\n\nSee Admin › Health for details. You'll get another email when it's fixed.`;
  const r = await sendEmail(
    { fromName: 'Bowron health check', to, subject: ok ? `Bowron is healthy again (${org.name})` : `Bowron needs a look: ${bad.map((b) => b.label).join(', ')} (${org.name})`, text },
    { organizationId: orgId, relatedType: 'health', relatedId: orgId },
  );
  return r.ok;
}

export async function listHealthRuns(auth: AuthContext, limit = 50): Promise<HealthRunView[]> {
  requirePermission(auth, 'health:view');
  const rows = await db.healthCheckRun.findMany({ where: { organizationId: auth.orgId }, orderBy: { at: 'desc' }, take: Math.min(limit, 200) });
  return rows.map(view);
}

export async function runHealthNow(auth: AuthContext) {
  requirePermission(auth, 'health:view');
  return runHealth(auth.orgId);
}

/** Timer: run each organization's checks when its interval has passed. */
export async function runDueHealthChecks(): Promise<number> {
  const orgs = await db.organization.findMany({ where: { status: 'ACTIVE' }, select: { id: true, settings: true } });
  let ran = 0;
  for (const o of orgs) {
    const s = healthOf(o.settings);
    if (!s.enabled) continue;
    const last = await db.healthCheckRun.findFirst({ where: { organizationId: o.id }, orderBy: { at: 'desc' }, select: { at: true } });
    if (last && Date.now() - last.at.getTime() < s.intervalMinutes * 60_000 - 30_000) continue;
    await runHealth(o.id).catch((e) => console.error('[health] run failed', o.id, e));
    ran++;
  }
  return ran;
}
