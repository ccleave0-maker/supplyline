// Job notifications: who hears about what on a job. Set on the job page; until
// it's set, the job's own people get the delivery notices.

import { DEFAULT_NOTIFY_EVENTS, isNotifyEvent, NOTIFY_EVENTS, type NotifyEvent } from '@supplyline/core/domain';
import type { NotifyRulesInput, NotifySetup } from '@supplyline/core/models';
import { can } from '@supplyline/core/permissions';
import { audit } from '../lib/audit';
import type { AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, forbidden } from '../lib/errors';
import { sendEmail, type EmailAttachment } from '../integrations/email';
import { assertSiteVisible } from './access';

/** People (and plain emails) to tell about this event on this job. */
export async function jobRecipients(siteId: string, event: NotifyEvent): Promise<{ userIds: string[]; emails: string[] }> {
  const rules = await db.siteNotifyRule.findMany({ where: { siteId }, include: { user: { select: { id: true, email: true, active: true, deletedAt: true } } } });
  if (rules.length) {
    const hit = rules.filter((r) => r.events.includes(event));
    const users = hit.filter((r) => r.user && r.user.active && !r.user.deletedAt).map((r) => r.user!);
    return {
      userIds: users.map((u) => u.id),
      emails: [...new Set([...users.map((u) => u.email), ...hit.filter((r) => !r.userId && r.email).map((r) => r.email!)].map((e) => e.toLowerCase()))],
    };
  }
  if (!DEFAULT_NOTIFY_EVENTS.includes(event)) return { userIds: [], emails: [] };
  const members = await db.user.findMany({ where: { active: true, deletedAt: null, memberships: { some: { siteId } } }, select: { id: true, email: true } });
  return { userIds: members.map((m) => m.id), emails: [...new Set(members.map((m) => m.email.toLowerCase()))] };
}

/** Tell a job: an in-app notice for its people and an email to everyone on the list. */
export async function notifyJob(opts: {
  organizationId: string;
  siteId: string;
  event: NotifyEvent;
  title: string;
  subject: string;
  text: string;
  link: string;
  fromName: string;
  replyTo?: string | null;
  attachments?: EmailAttachment[];
  attachmentFileIds?: string[];
  relatedType?: string;
  relatedId?: string;
  /** Don't tell the person who did it */
  exceptUserId?: string;
}) {
  const r = await jobRecipients(opts.siteId, opts.event);
  let userIds = r.userIds.filter((id) => id !== opts.exceptUserId);
  let emails = r.emails;
  if (opts.exceptUserId) {
    const me = await db.user.findUnique({ where: { id: opts.exceptUserId }, select: { email: true } });
    if (me) emails = emails.filter((e) => e !== me.email.toLowerCase());
  }
  userIds = [...new Set(userIds)];
  if (userIds.length) {
    await db.notification.createMany({ data: userIds.map((userId) => ({ userId, type: opts.event.toLowerCase(), title: opts.title, body: opts.text.split('\n')[0]!.slice(0, 300), link: opts.link })) });
  }
  if (emails.length) {
    await sendEmail(
      { fromName: opts.fromName, replyTo: opts.replyTo ?? null, to: emails, subject: opts.subject, text: opts.text, attachments: opts.attachments },
      { organizationId: opts.organizationId, relatedType: opts.relatedType, relatedId: opts.relatedId, attachmentFileIds: opts.attachmentFileIds },
    );
  }
  return { people: userIds.length, emails: emails.length };
}

// ---------------------------------------------------------------------------
// Setup on the job page
// ---------------------------------------------------------------------------
async function canEditNotify(auth: AuthContext, siteId: string) {
  const site = await assertSiteVisible(auth, siteId);
  return { site, editable: can(auth, 'site:edit') || site.projectManagerId === auth.userId };
}

export async function getNotifySetup(auth: AuthContext, siteId: string): Promise<NotifySetup> {
  const { editable } = await canEditNotify(auth, siteId);
  const [rules, members] = await Promise.all([
    db.siteNotifyRule.findMany({ where: { siteId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
    db.user.findMany({ where: { active: true, deletedAt: null, memberships: { some: { siteId } } }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
  ]);
  const usingDefaults = rules.length === 0;
  const rows: NotifySetup['rows'] = members.map((m) => {
    const rule = rules.find((r) => r.userId === m.id);
    return { userId: m.id, email: m.email, name: m.name, isMember: true, events: usingDefaults ? [...DEFAULT_NOTIFY_EVENTS] : (rule?.events ?? []) };
  });
  for (const r of rules) {
    if (r.userId && members.some((m) => m.id === r.userId)) continue;
    rows.push({ userId: r.userId, email: r.user?.email ?? r.email ?? '', name: r.user?.name ?? r.name ?? r.email ?? '', isMember: false, events: r.events });
  }
  return { usingDefaults, rows, canEdit: editable };
}

export async function saveNotifySetup(auth: AuthContext, siteId: string, input: NotifyRulesInput): Promise<NotifySetup> {
  const { site, editable } = await canEditNotify(auth, siteId);
  if (!editable) throw forbidden('Only admins, procurement and the job’s project manager can change who is notified.');
  if (site.type !== 'JOB') throw badRequest('Notifications are set per job / project.');
  for (const r of input.rows) {
    if (!r.userId && !r.email) throw badRequest('Each row needs a person or an email address.');
    for (const e of r.events) if (!isNotifyEvent(e)) throw badRequest(`Unknown notification: ${e}`);
  }
  const userIds = input.rows.map((r) => r.userId).filter((x): x is string => !!x);
  if (userIds.length) {
    const ok = await db.user.count({ where: { id: { in: userIds }, organizationId: auth.orgId } });
    if (ok !== new Set(userIds).size) throw badRequest('One of the people was not found.');
  }
  await db.$transaction(async (tx) => {
    await tx.siteNotifyRule.deleteMany({ where: { siteId } });
    const seen = new Set<string>();
    for (const r of input.rows) {
      const key = r.userId ?? `email:${r.email}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await tx.siteNotifyRule.create({
        data: { siteId, userId: r.userId ?? null, email: r.userId ? null : (r.email ?? null), name: r.userId ? null : (r.name ?? null), events: [...new Set(r.events)] },
      });
    }
    await audit(tx, auth, 'site.notify_rules', 'Site', siteId, null, input);
  });
  return getNotifySetup(auth, siteId);
}

export const NOTIFY_EVENT_LIST = NOTIFY_EVENTS;
