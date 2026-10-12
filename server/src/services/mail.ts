// Company email templates (editable wording, send now or review first) and the
// review queue where held emails are checked, edited and sent.

import { EMAIL_TEMPLATES, renderTemplate, templateDef } from '@supplyline/core/domain';
import type { EmailTemplateInput, EmailTemplateView, OutboxEditInput, OutboxItem } from '@supplyline/core/models';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { deliverRecord, sendEmail, type EmailAttachment } from '../integrations/email';
import { accessibleCompanyIds, assertCompanyAccessible } from './access';
import { fileUrl, readFileAsset } from './files';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export async function listTemplates(auth: AuthContext, companyId: string): Promise<EmailTemplateView[]> {
  requirePermission(auth, 'email:review');
  await assertCompanyAccessible(auth, companyId);
  const custom = await db.emailTemplate.findMany({ where: { companyId } });
  return EMAIL_TEMPLATES.map((t) => {
    const c = custom.find((x) => x.key === t.key);
    return { key: t.key, label: t.label, audience: t.audience, vars: t.vars, subject: c?.subject ?? t.subject, body: c?.body ?? t.body, mode: c?.mode ?? t.mode, customized: !!c };
  });
}

export async function saveTemplate(auth: AuthContext, companyId: string, key: string, input: EmailTemplateInput) {
  requirePermission(auth, 'email:templates');
  await assertCompanyAccessible(auth, companyId);
  if (!templateDef(key)) throw notFound('Template');
  await db.emailTemplate.upsert({
    where: { companyId_key: { companyId, key } },
    create: { companyId, key, ...input, updatedById: auth.userId },
    update: { ...input, updatedById: auth.userId },
  });
  await audit(db, auth, 'email.template_save', 'Company', companyId, null, { key, mode: input.mode });
  return listTemplates(auth, companyId);
}

export async function resetTemplate(auth: AuthContext, companyId: string, key: string) {
  requirePermission(auth, 'email:templates');
  await assertCompanyAccessible(auth, companyId);
  await db.emailTemplate.deleteMany({ where: { companyId, key } });
  return listTemplates(auth, companyId);
}

async function templateFor(companyId: string, key: string) {
  const def = templateDef(key);
  if (!def) throw new Error(`Unknown email template ${key}`);
  const c = await db.emailTemplate.findUnique({ where: { companyId_key: { companyId, key } } });
  return { subject: c?.subject ?? def.subject, body: c?.body ?? def.body, mode: c?.mode ?? def.mode };
}

/** Attach stored files (base64) to an outgoing email. */
async function loadAttachments(fileIds: string[]): Promise<EmailAttachment[]> {
  const out: EmailAttachment[] = [];
  for (const id of fileIds) {
    const f = await readFileAsset(id);
    if (f) out.push({ fileName: f.file.fileName, contentType: f.file.mimeType, content: Buffer.from(f.bytes).toString('base64') });
  }
  return out;
}

/**
 * Send (or hold for review) an email from a company template.
 * Returns whether it went out now, was held, or failed.
 */
export async function sendTemplated(opts: {
  organizationId: string;
  companyId: string;
  key: string;
  vars: Record<string, string | number | null | undefined>;
  to: string[];
  cc?: string[];
  fromName: string;
  replyTo?: string | null;
  attachmentFileIds?: string[];
  relatedType?: string;
  relatedId?: string;
  /** Force review (e.g. the address might be wrong) */
  forceReview?: boolean;
}): Promise<{ state: 'SENT' | 'HELD' | 'FAILED' | 'SKIPPED'; outboxId?: string }> {
  const to = [...new Set(opts.to.map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (!to.length && !opts.forceReview) return { state: 'SKIPPED' };
  const t = await templateFor(opts.companyId, opts.key);
  const review = opts.forceReview || t.mode === 'REVIEW';
  const fileIds = opts.attachmentFileIds ?? [];
  const r = await sendEmail(
    {
      fromName: opts.fromName,
      replyTo: opts.replyTo ?? null,
      to,
      cc: opts.cc,
      subject: renderTemplate(t.subject, opts.vars).replace(/\s+/g, ' '),
      text: renderTemplate(t.body, opts.vars),
      attachments: review ? undefined : await loadAttachments(fileIds),
    },
    { organizationId: opts.organizationId, companyId: opts.companyId, templateKey: opts.key, relatedType: opts.relatedType, relatedId: opts.relatedId, attachmentFileIds: fileIds, review },
  );
  if (r.held) await notifyReviewers(opts.organizationId, opts.companyId, renderTemplate(t.subject, opts.vars));
  return { state: r.held ? 'HELD' : r.ok ? 'SENT' : 'FAILED', outboxId: r.outboxId };
}

/** Tell the people who review emails that one is waiting. */
async function notifyReviewers(organizationId: string, companyId: string, subject: string) {
  const people = await db.user.findMany({
    where: { organizationId, active: true, deletedAt: null, OR: [{ roles: { has: 'ADMIN' } }, { roles: { has: 'PROCUREMENT' }, companyId }] },
    select: { id: true },
  });
  if (people.length)
    await db.notification.createMany({
      data: people.map((p) => ({ userId: p.id, type: 'email_review', title: 'Email waiting for review', body: subject, link: '/emails/' })),
    });
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------
const RELATED_LINKS: Record<string, (id: string) => string> = {
  purchase_order: (id) => `/purchase-orders/view/?id=${encodeURIComponent(id)}`,
  order: (id) => `/orders/view/?id=${encodeURIComponent(id)}`,
  bol: (id) => `/bols/view/?id=${encodeURIComponent(id)}`,
};

async function toItem(r: Awaited<ReturnType<typeof db.emailOutbox.findFirstOrThrow>>): Promise<OutboxItem> {
  const files = r.attachmentFileIds.length ? await db.fileAsset.findMany({ where: { id: { in: r.attachmentFileIds } }, select: { id: true, fileName: true } }) : [];
  const company = r.companyId ? await db.company.findUnique({ where: { id: r.companyId }, select: { name: true } }) : null;
  return {
    id: r.id,
    status: r.status,
    companyName: company?.name ?? null,
    templateLabel: r.templateKey ? (templateDef(r.templateKey)?.label ?? null) : null,
    to: r.to,
    cc: r.cc,
    replyTo: r.replyTo,
    subject: r.subject,
    body: r.bodyText ?? '',
    attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, url: fileUrl(f.id)! })),
    relatedType: r.relatedType,
    relatedId: r.relatedId,
    relatedLink: r.relatedType && r.relatedId && RELATED_LINKS[r.relatedType] ? RELATED_LINKS[r.relatedType]!(r.relatedId) : null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
  };
}

async function outboxWhere(auth: AuthContext) {
  const companies = await accessibleCompanyIds(auth);
  return { organizationId: auth.orgId, OR: [{ companyId: { in: companies } }, { companyId: null }] };
}

export async function listOutbox(auth: AuthContext, show: 'review' | 'failed' | 'sent' = 'review'): Promise<OutboxItem[]> {
  requirePermission(auth, 'email:review');
  const status = show === 'review' ? 'REVIEW' : show === 'failed' ? 'FAILED' : 'SENT';
  const rows = await db.emailOutbox.findMany({ where: { AND: [await outboxWhere(auth), { status }] }, orderBy: { createdAt: 'desc' }, take: 100 });
  return Promise.all(rows.map(toItem));
}

export async function countReview(auth: AuthContext): Promise<number> {
  if (!auth.roles.some((r) => r === 'ADMIN' || r === 'PROCUREMENT')) return 0;
  return db.emailOutbox.count({ where: { AND: [await outboxWhere(auth), { status: 'REVIEW' }] } });
}

async function loadOutbox(auth: AuthContext, id: string) {
  requirePermission(auth, 'email:review');
  const r = await db.emailOutbox.findFirst({ where: { AND: [{ id }, await outboxWhere(auth)] } });
  if (!r) throw notFound('Email');
  return r;
}

export async function editOutbox(auth: AuthContext, id: string, input: OutboxEditInput) {
  const r = await loadOutbox(auth, id);
  if (r.status !== 'REVIEW' && r.status !== 'FAILED') throw conflict('This email has already gone.');
  const updated = await db.emailOutbox.update({ where: { id }, data: { to: input.to, cc: input.cc, subject: input.subject, bodyText: input.body } });
  return toItem(updated);
}

/** Send a held (or failed) email now, as it stands. */
export async function sendOutbox(auth: AuthContext, id: string, edits?: OutboxEditInput) {
  if (edits) await editOutbox(auth, id, edits);
  const r = await loadOutbox(auth, id);
  if (r.status !== 'REVIEW' && r.status !== 'FAILED') throw conflict('This email has already gone.');
  if (!r.to.length) throw badRequest('Add a recipient first.');
  await db.emailOutbox.update({ where: { id }, data: { status: 'QUEUED', reviewedById: auth.userId, error: null } });
  const ok = await deliverRecord(id, {
    fromName: r.fromName,
    replyTo: r.replyTo,
    to: r.to,
    cc: r.cc,
    subject: r.subject,
    text: r.bodyText ?? '',
    attachments: await loadAttachments(r.attachmentFileIds),
  });
  await audit(db, auth, 'email.send_reviewed', 'EmailOutbox', id, null, { ok, subject: r.subject });
  // Sending a PO to the vendor marks it as sent.
  if (ok && r.templateKey === 'PO_TO_VENDOR' && r.relatedId) await db.purchaseOrder.updateMany({ where: { id: r.relatedId }, data: { vendorSentAt: new Date() } });
  return toItem(await db.emailOutbox.findUniqueOrThrow({ where: { id } }));
}

export async function discardOutbox(auth: AuthContext, id: string) {
  const r = await loadOutbox(auth, id);
  if (r.status !== 'REVIEW' && r.status !== 'FAILED') throw conflict('This email has already gone.');
  await db.emailOutbox.update({ where: { id }, data: { status: 'DISCARDED', reviewedById: auth.userId } });
  await audit(db, auth, 'email.discard', 'EmailOutbox', id, null, { subject: r.subject });
  return { ok: true };
}
