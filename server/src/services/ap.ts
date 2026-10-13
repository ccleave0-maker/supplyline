// Accounts payable: vendor invoices in (upload or network folder), read by the
// AI, matched to the PO, subcontractor holdback, the company's approval chain
// (procurement first, extra steps, side reviews), rejections back to the
// vendor's accounts contact, holds, credits / revised invoices, paying, and
// the pay-run forecast. The invoice file follows along in the network folders.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { matchInvoice, sameVendor, taxProfile } from '@supplyline/core/domain';
import {
  APPROVER_LABELS,
  DEFAULT_ACCOUNTING,
  accountingSettingsInput,
  type AccountingSettings,
  type ApActionInput,
  type ApDashboard,
  type ApDecisionInput,
  type ApInvoiceDetail,
  type ApInvoiceEditInput,
  type ApInvoiceSummary,
  type ApStatus,
  type ApproverType,
  type PayRunRow,
} from '@supplyline/core/models';
import { can } from '@supplyline/core/permissions';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { isAdmin, requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { fileNameOf, isFullPath, joinIn } from '../lib/folder-path';
import { viaName } from '../integrations/email';
import { accessibleCompanyIds, assertCompanyAccessible } from './access';
import { completeIfConsumed } from './purchasing';
import { readInvoice } from './ai';
import { fileUrl, saveUpload } from './files';
import { invoiceWithReports, reportsForPo } from './receiving-report';
import { fileDocument, jobLabel } from './filing';
import { sendTemplated } from './mail';
import { todayLocal } from './project';

const n = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d));
const n0 = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : null);
const addDays = (v: string, k: number) => day(new Date(toDate(v)!.getTime() + k * 86_400_000))!;
const cents = (x: number) => Math.round(x * 100) / 100;
const money = (x: number | null) => (x == null ? '—' : x.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' }));
const appLink = (p: string) => `${env().APP_URL.replace(/\/$/, '')}${p}`;
const apLink = (id: string) => `/ap/view/?id=${id}`;

// ---------------------------------------------------------------------------
// Settings (Company.settings.accounting)
// ---------------------------------------------------------------------------
export function accountingOf(settings: unknown): AccountingSettings {
  const raw = (settings as { accounting?: unknown } | null)?.accounting;
  const parsed = accountingSettingsInput.partial().safeParse(raw ?? {});
  const v = parsed.success ? parsed.data : {};
  return { ...DEFAULT_ACCOUNTING, ...v, folders: { ...DEFAULT_ACCOUNTING.folders, ...(v.folders ?? {}) } } as AccountingSettings;
}

export async function getAccountingSettings(auth: AuthContext, companyId: string) {
  requirePermission(auth, 'ap:work');
  const c = await assertCompanyAccessible(auth, companyId);
  return accountingOf(c.settings);
}

export async function saveAccountingSettings(auth: AuthContext, companyId: string, input: AccountingSettings) {
  requirePermission(auth, 'company:edit');
  const c = await assertCompanyAccessible(auth, companyId);
  for (const [k, v] of Object.entries(input.folders)) {
    if (v && !isFullPath(v)) throw badRequest(`The ${k} folder must be a full path, e.g. P:\\AP\\Inbox or \\\\server\\share\\AP\\Inbox.`);
  }
  const settings = { ...((c.settings as Record<string, unknown>) ?? {}), accounting: input };
  await db.company.update({ where: { id: companyId }, data: { settings } });
  await audit(db, auth, 'company.accounting', 'Company', companyId, null, input);
  return input;
}

// ---------------------------------------------------------------------------
// Loading and views
// ---------------------------------------------------------------------------
const include = {
  vendor: { include: { contact: true } },
  purchaseOrder: {
    select: {
      id: true,
      poNumber: true,
      status: true,
      pstExempt: true,
      gstRate: true,
      pstRate: true,
      hstRate: true,
      siteId: true,
      equipmentId: true,
      vendor: { select: { name: true } },
      lines: { select: { id: true, lineNo: true, description: true, qty: true, unitCost: true, apLines: { select: { qty: true, invoice: { select: { id: true, status: true } } } } } },
    },
  },
  site: { select: { id: true, jobNumber: true, name: true, projectManagerId: true, province: true, pstExempt: true, subHoldbackPct: true } },
  lines: { orderBy: { lineNo: 'asc' as const } },
  approvals: { orderBy: [{ kind: 'asc' as const }, { step: 'asc' as const }] },
} satisfies Prisma.ApInvoiceInclude;
type Inv = Prisma.ApInvoiceGetPayload<{ include: typeof include }>;

async function where(auth: AuthContext): Promise<Prisma.ApInvoiceWhereInput> {
  // AP staff see their companies' invoices; approvers see invoices waiting on them.
  const or: Prisma.ApInvoiceWhereInput[] = [{ approvals: { some: { userId: auth.userId } } }, { site: { projectManagerId: auth.userId } }];
  if (can(auth, 'ap:work')) or.push({ companyId: { in: await accessibleCompanyIds(auth) } });
  // Operations managers see invoices with an operations-manager step or review.
  const companies = await db.company.findMany({ where: { organizationId: auth.orgId }, select: { id: true, settings: true } });
  const opsFor = companies.filter((c) => accountingOf(c.settings).opsManagerIds.includes(auth.userId)).map((c) => c.id);
  if (opsFor.length) or.push({ companyId: { in: opsFor }, approvals: { some: { approverType: 'OPS' } } });
  // Procurement sees invoices with a procurement step for their company.
  if (auth.roles.includes('PROCUREMENT')) or.push({ companyId: { in: await accessibleCompanyIds(auth) }, approvals: { some: { approverType: 'PROCUREMENT' } } });
  return { organizationId: auth.orgId, OR: or };
}

async function load(auth: AuthContext, id: string): Promise<Inv> {
  const inv = await db.apInvoice.findFirst({ where: { AND: [{ id }, await where(auth)] }, include });
  if (!inv) throw notFound('Invoice');
  return inv;
}
const loadRaw = (id: string) => db.apInvoice.findUniqueOrThrow({ where: { id }, include });

const target = (inv: Inv) => (inv.site ? `JOB#${inv.site.jobNumber} ${inv.site.name}` : inv.purchaseOrder ? `PO ${inv.purchaseOrder.poNumber}` : null);
const payable = (inv: Pick<Inv, 'total' | 'holdbackAmount'>) => (inv.total == null ? null : cents(n0(inv.total) - n0(inv.holdbackAmount)));

/** People who can act on an approval row. */
async function approverIds(inv: Inv, a: { approverType: string; userId: string | null }, settings: AccountingSettings): Promise<string[]> {
  const t = a.approverType as ApproverType;
  if (t === 'USER') return a.userId ? [a.userId] : [];
  if (t === 'PM') return inv.site?.projectManagerId ? [inv.site.projectManagerId] : [];
  if (t === 'OPS') return settings.opsManagerIds;
  if (t === 'PROCUREMENT') {
    const p = await db.user.findMany({ where: { organizationId: inv.organizationId, active: true, deletedAt: null, roles: { has: 'PROCUREMENT' }, OR: [{ companyId: inv.companyId }, { companyId: null }] }, select: { id: true } });
    return p.map((u) => u.id);
  }
  const admins = await db.user.findMany({ where: { organizationId: inv.organizationId, active: true, deletedAt: null, roles: { has: 'ADMIN' } }, select: { id: true } });
  return admins.map((u) => u.id);
}

function currentMain(inv: Inv) {
  return inv.approvals.filter((a) => a.kind === 'MAIN' && a.decision === 'PENDING').sort((a, b) => a.step - b.step)[0] ?? null;
}

async function settingsFor(companyId: string) {
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  return { company: c, s: accountingOf(c.settings) };
}

async function whoLabel(a: { approverType: string; userId: string | null }, inv: Inv, names: Map<string, string>) {
  const t = a.approverType as ApproverType;
  if (t === 'USER' && a.userId) return names.get(a.userId) ?? 'A named person';
  if (t === 'PM') return inv.site?.projectManagerId ? `${names.get(inv.site.projectManagerId) ?? 'PM'} (PM)` : 'Project manager (none set — an admin)';
  return APPROVER_LABELS[t] ?? t;
}

async function canAct(auth: AuthContext, inv: Inv, a: { approverType: string; userId: string | null }) {
  if (isAdmin(auth)) return true;
  const { s } = await settingsFor(inv.companyId);
  return (await approverIds(inv, a, s)).includes(auth.userId);
}

async function toSummary(auth: AuthContext, inv: Inv, names: Map<string, string>): Promise<ApInvoiceSummary> {
  const cur = inv.status === 'IN_APPROVAL' ? currentMain(inv) : null;
  return {
    id: inv.id,
    companyId: inv.companyId,
    kind: inv.kind,
    status: inv.status,
    vendorName: inv.vendor?.name ?? inv.vendorName,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: day(inv.invoiceDate),
    dueDate: day(inv.dueDate),
    poNumber: inv.purchaseOrder?.poNumber ?? inv.poNumberText,
    purchaseOrderId: inv.purchaseOrderId,
    target: target(inv),
    total: n(inv.total),
    holdbackAmount: n(inv.holdbackAmount),
    payable: payable(inv),
    issueCount: inv.matchIssues.length,
    waitingOn: cur ? await whoLabel(cur, inv, names) : null,
    waitingOnMe: !!cur && (await canAct(auth, inv, cur)),
    receivedVia: inv.receivedVia,
    createdAt: inv.createdAt.toISOString(),
  };
}

async function nameMap(invs: Inv[], extra: string[] = []) {
  const ids = new Set<string>(extra);
  for (const i of invs) {
    for (const a of i.approvals) {
      if (a.userId) ids.add(a.userId);
      if (a.decidedById) ids.add(a.decidedById);
    }
    if (i.site?.projectManagerId) ids.add(i.site.projectManagerId);
  }
  const users = await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function apContactFor(inv: Inv) {
  const contacts = await db.contact.findMany({ where: { organizationId: inv.organizationId, active: true, isApContact: true }, select: { id: true, name: true, businessName: true, email: true } });
  const name = inv.vendor?.name ?? inv.vendorName;
  return contacts.find((c) => (inv.vendor?.contactId && c.id === inv.vendor.contactId) || sameVendor(c.businessName ?? c.name, name)) ?? null;
}

async function toDetail(auth: AuthContext, inv: Inv): Promise<ApInvoiceDetail> {
  const names = await nameMap([inv]);
  const ap = can(auth, 'ap:work') && (await accessibleCompanyIds(auth)).includes(inv.companyId);
  const [file, replaces, replacedBy, apContact] = await Promise.all([
    inv.fileId ? db.fileAsset.findUnique({ where: { id: inv.fileId }, select: { id: true, fileName: true } }) : null,
    inv.replacesId ? db.apInvoice.findUnique({ where: { id: inv.replacesId }, select: { id: true, invoiceNumber: true } }) : null,
    db.apInvoice.findFirst({ where: { replacesId: inv.id }, select: { id: true, invoiceNumber: true } }),
    apContactFor(inv),
  ]);
  const approvals = [];
  for (const a of inv.approvals) {
    approvals.push({
      id: a.id,
      kind: a.kind as 'MAIN' | 'SIDE',
      step: a.step,
      approverType: a.approverType as ApproverType,
      who: await whoLabel(a, inv, names),
      decision: a.decision,
      note: a.note,
      decidedByName: a.decidedById ? (names.get(a.decidedById) ?? null) : null,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      mine: a.decision === 'PENDING' && (a.kind === 'SIDE' || (inv.status === 'IN_APPROVAL' && currentMain(inv)?.id === a.id)) && (await canAct(auth, inv, a)),
    });
  }
  const poLines = new Map((inv.purchaseOrder?.lines ?? []).map((l) => [l.id, `L${l.lineNo ?? ''} ${l.description ?? ''}`.trim()]));
  return {
    ...(await toSummary(auth, inv, names)),
    receivingReports: inv.purchaseOrderId ? await reportsForPo(inv.purchaseOrderId) : [],
    siteId: inv.siteId,
    equipmentId: inv.equipmentId,
    costCode: inv.costCode,
    subtotal: n(inv.subtotal),
    gst: n(inv.gst),
    pst: n(inv.pst),
    holdbackPct: n(inv.holdbackPct),
    holdbackReleasedAt: inv.holdbackReleasedAt?.toISOString() ?? null,
    issues: inv.matchIssues,
    refInvoiceNumber: inv.refInvoiceNumber,
    replaces,
    replacedBy,
    file: file ? { id: file.id, fileName: file.fileName, url: fileUrl(file.id)! } : null,
    lines: inv.lines.map((l) => ({ id: l.id, lineNo: l.lineNo, description: l.description, qty: n(l.qty), uom: l.uom, unitPrice: n(l.unitPrice), amount: n(l.amount), poLineId: l.poLineId, poLineLabel: l.poLineId ? (poLines.get(l.poLineId) ?? null) : null })),
    approvals,
    rejectedReason: inv.rejectedReason,
    rejectionSentTo: inv.rejectionSentTo,
    rejectionSentAt: inv.rejectionSentAt?.toISOString() ?? null,
    vendorApContact: apContact ? { id: apContact.id, name: apContact.businessName ? `${apContact.name} (${apContact.businessName})` : apContact.name, email: apContact.email } : null,
    holdReason: inv.holdReason,
    paidAt: day(inv.paidAt),
    paymentRef: inv.paymentRef,
    notes: inv.notes,
    folderState: inv.folderState,
    can: {
      edit: ap && ['RECEIVED', 'NEEDS_REVIEW', 'ON_HOLD'].includes(inv.status),
      sendToApproval: ap && ['RECEIVED', 'NEEDS_REVIEW', 'ON_HOLD'].includes(inv.status),
      reject: ap && ['RECEIVED', 'NEEDS_REVIEW', 'ON_HOLD', 'IN_APPROVAL', 'APPROVED'].includes(inv.status),
      hold: ap && ['RECEIVED', 'NEEDS_REVIEW', 'IN_APPROVAL', 'APPROVED'].includes(inv.status),
      markPaid: ap && inv.status === 'APPROVED',
      sendRejection: ap && inv.status === 'REJECTED',
      releaseHoldback: ap && n0(inv.holdbackAmount) > 0 && !inv.holdbackReleasedAt && inv.status === 'PAID',
    },
  };
}

export async function getApInvoice(auth: AuthContext, id: string) {
  return toDetail(auth, await load(auth, id));
}

export async function listApInvoices(
  auth: AuthContext,
  f: { show?: 'inbox' | 'approval' | 'mine' | 'approved' | 'paid' | 'rejected' | 'hold' | 'all'; q?: string; siteId?: string; companyId?: string },
): Promise<ApInvoiceSummary[]> {
  const statuses: Record<string, ApStatus[] | undefined> = {
    inbox: ['RECEIVED', 'NEEDS_REVIEW'],
    approval: ['IN_APPROVAL'],
    mine: ['IN_APPROVAL'],
    approved: ['APPROVED'],
    paid: ['PAID'],
    rejected: ['REJECTED'],
    hold: ['ON_HOLD'],
    all: undefined,
  };
  const st = statuses[f.show ?? 'inbox'];
  const q = f.q?.trim();
  const rows = await db.apInvoice.findMany({
    where: {
      AND: [
        await where(auth),
        st ? { status: { in: st } } : {},
        f.siteId ? { siteId: f.siteId } : {},
        f.companyId ? { companyId: f.companyId } : {},
        q ? { OR: [{ invoiceNumber: { contains: q, mode: 'insensitive' } }, { vendorName: { contains: q, mode: 'insensitive' } }, { poNumberText: { contains: q, mode: 'insensitive' } }] } : {},
      ],
    },
    include,
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const names = await nameMap(rows);
  const list = await Promise.all(rows.map((r) => toSummary(auth, r, names)));
  return f.show === 'mine' ? list.filter((x) => x.waitingOnMe) : list;
}

// ---------------------------------------------------------------------------
// In: upload / network folder → read → match → approval or review
// ---------------------------------------------------------------------------
export async function receiveInvoice(auth: AuthContext, companyId: string, file: File, opts: { via?: 'UPLOAD' | 'FOLDER' | 'SYNC'; sourcePath?: string } = {}) {
  requirePermission(auth, 'ap:work');
  await assertCompanyAccessible(auth, companyId);
  const asset = await saveUpload({ organizationId: auth.orgId, companyId, uploadedById: auth.userId, kind: 'AP_INVOICE', file, maxBytes: 30 * 1_048_576 });
  const inv = await db.apInvoice.create({
    data: { organizationId: auth.orgId, companyId, fileId: asset.id, receivedVia: opts.via ?? 'UPLOAD', sourcePath: opts.sourcePath ?? null, folderState: opts.sourcePath ? 'INBOX' : null, createdById: auth.userId, matchIssues: [] },
  });
  await audit(db, auth, 'ap.receive', 'ApInvoice', inv.id, null, { fileName: file.name, via: opts.via ?? 'UPLOAD' });
  // Read it with the AI if that's on; otherwise someone types the details in.
  try {
    const r = await readInvoice(auth, file, companyId);
    await db.$transaction(async (tx) => {
      await tx.apInvoice.update({
        where: { id: inv.id },
        data: {
          kind: r.documentType === 'CREDIT' ? 'CREDIT' : 'INVOICE',
          vendorName: r.vendorName,
          invoiceNumber: r.invoiceNumber,
          invoiceDate: toDate(r.invoiceDate),
          dueDate: toDate(r.dueDate),
          poNumberText: r.poNumber?.replace(/^P\.?O\.?\s*#?\s*/i, '') ?? null,
          subtotal: r.subtotal,
          gst: r.gst,
          pst: r.pst,
          total: r.total,
          refInvoiceNumber: r.documentType !== 'INVOICE' ? r.refInvoiceNumber : null,
          readByAi: true,
          aiRaw: r as unknown as object,
        },
      });
      for (const [i, l] of (r.lines ?? []).entries())
        await tx.apInvoiceLine.create({ data: { invoiceId: inv.id, lineNo: i + 1, description: String(l.description ?? '').slice(0, 500) || `Line ${i + 1}`, qty: l.qty, uom: l.uom, unitPrice: l.unitPrice, amount: l.amount } });
    });
  } catch (e) {
    await db.apInvoice.update({ where: { id: inv.id }, data: { matchIssues: [`Not read automatically (${(e as Error).message.slice(0, 120)}). Type in the details.`], status: 'NEEDS_REVIEW' } });
    return getApInvoice(auth, inv.id);
  }
  await linkRevision(auth, inv.id);
  await rematch(auth, inv.id);
  return getApInvoice(auth, inv.id);
}

/** A credit / revised invoice that refers to a rejected one: take it out of the Rejection Area. */
async function linkRevision(auth: AuthContext, id: string) {
  const inv = await loadRaw(id);
  if (!inv.refInvoiceNumber) return;
  const candidates = await db.apInvoice.findMany({
    where: { companyId: inv.companyId, id: { not: id }, invoiceNumber: { equals: inv.refInvoiceNumber, mode: 'insensitive' }, status: { in: ['REJECTED', 'ON_HOLD', 'NEEDS_REVIEW'] } },
    include: { vendor: true },
  });
  const original = candidates.find((c) => !inv.vendorName || sameVendor(c.vendor?.name ?? c.vendorName, inv.vendorName));
  if (!original) {
    await db.apInvoice.update({ where: { id }, data: { matchIssues: { push: `Refers to invoice ${inv.refInvoiceNumber}, which wasn't found — match it by hand.` } } });
    return;
  }
  await db.$transaction(async (tx) => {
    await tx.apInvoice.update({ where: { id: original.id }, data: { status: 'REPLACED' } });
    await tx.apInvoice.update({ where: { id }, data: { replacesId: original.id, purchaseOrderId: original.purchaseOrderId, poNumberText: inv.poNumberText ?? original.poNumberText } });
    await audit(tx, auth, 'ap.replaced', 'ApInvoice', original.id, null, { by: id });
  });
  await moveFile(original.id, 'REPLACED');
  await notifyAp(inv.organizationId, inv.companyId, `${inv.kind === 'CREDIT' ? 'Credit' : 'Revised invoice'} received for invoice ${inv.refInvoiceNumber}`, `It has been matched to the rejected invoice and sent on for approval.`, apLink(id));
}

async function notifyAp(orgId: string, companyId: string, title: string, body: string, link: string) {
  const people = await db.user.findMany({ where: { organizationId: orgId, active: true, deletedAt: null, OR: [{ roles: { has: 'AP' } }, { roles: { has: 'ADMIN' } }], AND: [{ OR: [{ companyId }, { companyId: null }] }] }, select: { id: true } });
  if (people.length) await db.notification.createMany({ data: people.map((p) => ({ userId: p.id, type: 'ap', title, body, link })) });
}

/** Work out vendor, PO, job, holdback and what doesn't match; then approval or review. */
export async function rematch(auth: AuthContext, id: string) {
  const inv = await loadRaw(id);
  const { s } = await settingsFor(inv.companyId);
  // Vendor and PO
  const poNumber = inv.poNumberText?.trim() || null;
  const po = poNumber
    ? await db.purchaseOrder.findFirst({ where: { companyId: inv.companyId, poNumber: { equals: poNumber, mode: 'insensitive' } }, select: { id: true, vendorId: true } })
    : inv.purchaseOrderId
      ? { id: inv.purchaseOrderId, vendorId: null }
      : null;
  let vendorId = inv.vendorId;
  if (!vendorId && inv.vendorName) {
    const vendors = await db.vendor.findMany({ where: { companyId: inv.companyId }, select: { id: true, name: true } });
    vendorId = vendors.find((v) => sameVendor(v.name, inv.vendorName))?.id ?? null;
  }
  if (!vendorId && po?.vendorId) vendorId = po.vendorId;
  await db.apInvoice.update({ where: { id }, data: { purchaseOrderId: po?.id ?? null, vendorId } });
  const fresh = await loadRaw(id);
  const p = fresh.purchaseOrder;
  // A complete PO is locked: credits still post, but a new invoice goes to the rejection area to be investigated.
  if (p?.status === 'CLOSED' && fresh.kind !== 'CREDIT' && ['RECEIVED', 'NEEDS_REVIEW'].includes(fresh.status)) {
    const reason = `PO ${p.poNumber} is complete (invoiced in full). A new invoice against it needs investigating — an admin can reopen the PO if it’s genuine.`;
    await db.apInvoice.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: reason, rejectedAt: new Date() } });
    await audit(db, auth, 'ap.complete_po_invoice', 'ApInvoice', id, null, { poNumber: p.poNumber });
    await moveFile(id, 'REJECTED');
    await notifyAp(fresh.organizationId, fresh.companyId, `Invoice against complete PO ${p.poNumber}`, reason, apLink(id));
    return;
  }
  const dup = fresh.invoiceNumber
    ? await db.apInvoice.count({ where: { companyId: fresh.companyId, id: { not: id }, invoiceNumber: { equals: fresh.invoiceNumber, mode: 'insensitive' }, status: { notIn: ['REPLACED'] }, ...(fresh.vendorId ? { vendorId: fresh.vendorId } : { vendorName: fresh.vendorName }) } })
    : 0;
  const result = matchInvoice(
    {
      vendorName: fresh.vendor?.name ?? fresh.vendorName,
      invoiceNumber: fresh.invoiceNumber,
      poNumber: fresh.poNumberText ?? p?.poNumber ?? null,
      subtotal: n(fresh.subtotal),
      gst: n(fresh.gst),
      pst: n(fresh.pst),
      total: n(fresh.total),
      lines: fresh.kind === 'CREDIT' ? [] : fresh.lines.map((l) => ({ description: l.description, qty: n(l.qty), unitPrice: n(l.unitPrice), amount: n(l.amount) })),
    },
    p
      ? {
          poNumber: p.poNumber,
          vendorName: p.vendor.name,
          status: p.status,
          pstExempt: p.pstExempt,
          gstRate: n0(p.gstRate),
          pstRate: n0(p.pstRate),
          hstRate: n0(p.hstRate),
          lines: p.lines.map((l) => ({
            id: l.id,
            description: l.description ?? '',
            qty: n0(l.qty),
            unitCost: n(l.unitCost),
            alreadyInvoiced: l.apLines.filter((x) => x.invoice.id !== id && !['REJECTED', 'REPLACED'].includes(x.invoice.status)).reduce((a, x) => a + n0(x.qty), 0),
          })),
        }
      : null,
    { tolerancePct: s.priceTolerancePct, duplicate: dup > 0 },
  );
  // Subcontractor holdback, set on the project.
  const siteId = p?.siteId ?? fresh.siteId;
  let holdbackPct: number | null = null;
  if (siteId && fresh.kind === 'INVOICE') {
    const site = await db.site.findUnique({ where: { id: siteId }, select: { subHoldbackPct: true } });
    const vendorName = fresh.vendor?.name ?? fresh.vendorName;
    const subs = await db.contact.findMany({ where: { organizationId: fresh.organizationId, type: 'SUBCONTRACTOR', active: true }, select: { id: true, name: true, businessName: true } });
    const sub = subs.find((c) => (fresh.vendor?.contactId && c.id === fresh.vendor.contactId) || sameVendor(c.businessName ?? c.name, vendorName));
    if (sub) {
      const override = await db.subHoldback.findUnique({ where: { siteId_contactId: { siteId, contactId: sub.id } } });
      holdbackPct = override ? n0(override.pct) : site?.subHoldbackPct != null ? n0(site.subHoldbackPct) : null;
    }
  }
  const sub = n(fresh.subtotal) ?? (fresh.total != null ? n0(fresh.total) - n0(fresh.gst) - n0(fresh.pst) : null);
  const holdbackAmount = holdbackPct && sub != null ? cents((sub * holdbackPct) / 100) : null;
  const terms = s.defaultTermsDays;
  await db.$transaction(async (tx) => {
    await tx.apInvoice.update({
      where: { id },
      data: {
        siteId,
        equipmentId: p?.equipmentId ?? fresh.equipmentId,
        matchIssues: result.issues,
        holdbackPct,
        holdbackAmount,
        dueDate: fresh.dueDate ?? (fresh.invoiceDate ? toDate(addDays(day(fresh.invoiceDate)!, terms)) : null),
      },
    });
    for (const [i, l] of fresh.lines.entries()) await tx.apInvoiceLine.update({ where: { id: l.id }, data: { poLineId: result.lineMatches[i] ?? l.poLineId } });
  });
  if (['RECEIVED', 'NEEDS_REVIEW'].includes(fresh.status)) {
    if (result.issues.length) await db.apInvoice.update({ where: { id }, data: { status: 'NEEDS_REVIEW' } });
    else await startApproval(auth, id);
  }
}

/** Build the approval chain from the company settings and tell the first approver. */
async function startApproval(auth: AuthContext, id: string, note?: string | null) {
  const inv = await loadRaw(id);
  const { s, company } = await settingsFor(inv.companyId);
  await db.$transaction(async (tx) => {
    await tx.apApproval.deleteMany({ where: { invoiceId: id } });
    const steps: { approverType: string; userId: string | null }[] = [];
    if (s.procurementStep) steps.push({ approverType: 'PROCUREMENT', userId: null });
    for (const e of s.extraSteps) steps.push({ approverType: e.type, userId: e.userId ?? null });
    for (const [i, st] of steps.entries()) await tx.apApproval.create({ data: { invoiceId: id, kind: 'MAIN', step: i + 1, ...st } });
    for (const [i, r] of s.sideReviews.entries()) await tx.apApproval.create({ data: { invoiceId: id, kind: 'SIDE', step: i + 1, approverType: r.type, userId: r.userId ?? null } });
    await tx.apInvoice.update({ where: { id }, data: { status: steps.length ? 'IN_APPROVAL' : 'APPROVED', approvedAt: steps.length ? null : new Date(), holdReason: null, ...(note ? { notes: [inv.notes, `Sent to approval: ${note}`].filter(Boolean).join('\n') } : {}) } });
    await audit(tx, auth, 'ap.to_approval', 'ApInvoice', id, null, { steps: steps.length, note });
  });
  const after = await loadRaw(id);
  if (after.status === 'APPROVED') {
    await moveFile(id, 'APPROVED');
    await fileApproved(id);
    if (after.purchaseOrderId) await completeIfConsumed(after.purchaseOrderId);
    return;
  }
  await moveFile(id, 'IN_REVIEW');
  await askNext(after, company);
  // Side reviewers: a heads-up.
  for (const a of after.approvals.filter((x) => x.kind === 'SIDE')) await tellApprovers(after, a, company, true);
}

async function tellApprovers(inv: Inv, a: { approverType: string; userId: string | null }, company: { name: string; settings: unknown }, side = false) {
  const ids = await approverIds(inv, a, accountingOf(company.settings));
  const people = ids.length
    ? await db.user.findMany({ where: { id: { in: ids }, active: true, deletedAt: null }, select: { id: true, email: true } })
    : await db.user.findMany({ where: { organizationId: inv.organizationId, active: true, deletedAt: null, roles: { has: 'ADMIN' } }, select: { id: true, email: true } });
  if (!people.length) return;
  const title = side ? `Review invoice ${inv.invoiceNumber ?? ''} (FYI)` : `Approve invoice ${inv.invoiceNumber ?? ''}`;
  await db.notification.createMany({ data: people.map((p) => ({ userId: p.id, type: 'ap_approval', title, body: `${inv.vendor?.name ?? inv.vendorName ?? 'Vendor'} · ${money(n(inv.total))}`, link: apLink(inv.id) })) });
  if (!side)
    await sendTemplated({
      organizationId: inv.organizationId,
      companyId: inv.companyId,
      key: 'AP_APPROVAL_REQUEST',
      vars: {
        invoiceNumber: inv.invoiceNumber ?? '(no number)',
        vendorName: inv.vendor?.name ?? inv.vendorName ?? 'the vendor',
        total: money(n(inv.total)),
        target: target(inv) ?? '—',
        poNumber: inv.purchaseOrder?.poNumber ?? inv.poNumberText ?? '',
        matchNote: inv.matchIssues.length ? `Note: ${inv.matchIssues.join(' ')}` : `Matches PO ${inv.purchaseOrder?.poNumber ?? ''}.`,
        link: appLink(apLink(inv.id)),
        companyName: company.name,
      },
      to: people.map((p) => p.email),
      fromName: viaName(company.name),
      relatedType: 'ap_invoice',
      relatedId: inv.id,
    });
}

async function askNext(inv: Inv, company: { name: string; settings: unknown }) {
  const cur = currentMain(inv);
  if (cur) await tellApprovers(inv, cur, company);
}

// ---------------------------------------------------------------------------
// Approve / pass / reject / hold (main steps) and review / flag (side)
// ---------------------------------------------------------------------------
export async function decide(auth: AuthContext, id: string, input: ApDecisionInput) {
  const inv = await load(auth, id);
  const a = inv.approvals.find((x) => x.id === input.approvalId);
  if (!a || a.decision !== 'PENDING') throw conflict('That step has already been done.');
  if (!(await canAct(auth, inv, a))) throw forbidden('This step is for someone else.');
  const { company } = await settingsFor(inv.companyId);
  if (a.kind === 'SIDE') {
    if (!['REVIEWED', 'FLAGGED'].includes(input.decision)) throw badRequest('Side reviews are “Looks OK” or “Flag a concern”.');
    await db.apApproval.update({ where: { id: a.id }, data: { decision: input.decision, note: input.note ?? null, decidedById: auth.userId, decidedAt: new Date() } });
    if (input.decision === 'FLAGGED') await notifyAp(inv.organizationId, inv.companyId, `Concern flagged on invoice ${inv.invoiceNumber ?? ''}`, `${auth.name}: ${input.note ?? '(no note)'}`, apLink(id));
    await audit(db, auth, 'ap.side_review', 'ApInvoice', id, null, input);
    return getApInvoice(auth, id);
  }
  if (inv.status !== 'IN_APPROVAL' || currentMain(inv)?.id !== a.id) throw conflict('It isn’t this step’s turn yet.');
  if (!['APPROVED', 'PASSED', 'REJECTED', 'HOLD'].includes(input.decision)) throw badRequest('Choose approve, pass, reject or hold.');
  if (input.decision === 'PASSED' && a.approverType !== 'PROCUREMENT') throw badRequest('Only procurement can pass on an invoice.');
  if ((input.decision === 'REJECTED' || input.decision === 'HOLD') && !input.note) throw badRequest('Say why, so AP / the vendor know what to fix.');
  await db.apApproval.update({ where: { id: a.id }, data: { decision: input.decision, note: input.note ?? null, decidedById: auth.userId, decidedAt: new Date() } });
  await audit(db, auth, 'ap.decide', 'ApInvoice', id, null, input);
  if (input.decision === 'REJECTED') return reject(auth, id, input.note!);
  if (input.decision === 'HOLD') return hold(auth, id, input.note!);
  const after = await loadRaw(id);
  if (!currentMain(after)) {
    await db.apInvoice.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    await moveFile(id, 'APPROVED');
    await fileApproved(id);
    if (inv.purchaseOrderId) await completeIfConsumed(inv.purchaseOrderId);
    await notifyAp(inv.organizationId, inv.companyId, `Invoice ${inv.invoiceNumber ?? ''} approved`, `${inv.vendor?.name ?? inv.vendorName ?? ''} · ${money(payable(inv))} to pay`, apLink(id));
  } else await askNext(after, company);
  return getApInvoice(auth, id);
}

async function reject(auth: AuthContext, id: string, reason: string) {
  const inv = await loadRaw(id);
  await db.$transaction(async (tx) => {
    await tx.apInvoice.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: reason, rejectedAt: new Date() } });
    await tx.apApproval.updateMany({ where: { invoiceId: id, decision: 'PENDING', kind: 'MAIN' }, data: { decision: 'SKIPPED' } });
    await audit(tx, auth, 'ap.reject', 'ApInvoice', id, null, { reason });
  });
  await moveFile(id, 'REJECTED');
  // Route the rejection to the vendor's accounts contact (held for review), or ask AP to set one up.
  const contact = await apContactFor(inv);
  if (contact?.email) await queueRejection(auth, id, contact.email, contact.name);
  else await notifyAp(inv.organizationId, inv.companyId, `Who gets rejections at ${inv.vendor?.name ?? inv.vendorName ?? 'this vendor'}?`, `Invoice ${inv.invoiceNumber ?? ''} was rejected but the vendor has no accounts contact. Add one in Contacts (tick “Send invoice rejections to this person”), or send it from the invoice.`, apLink(id));
  return getApInvoice(auth, id);
}

async function queueRejection(auth: AuthContext, id: string, email: string, contactName: string | null) {
  const inv = await loadRaw(id);
  const { company } = await settingsFor(inv.companyId);
  const r = await sendTemplated({
    organizationId: inv.organizationId,
    companyId: inv.companyId,
    key: 'AP_REJECTION',
    vars: {
      invoiceNumber: inv.invoiceNumber ?? '',
      total: money(n(inv.total)),
      poRef: inv.purchaseOrder ? ` against PO ${inv.purchaseOrder.poNumber}` : '',
      reason: inv.rejectedReason ?? '',
      vendorContact: contactName ?? inv.vendor?.name ?? inv.vendorName ?? '',
      senderName: auth.name,
      companyName: company.name,
    },
    to: [email],
    fromName: viaName(auth.name),
    replyTo: auth.email,
    attachmentFileIds: inv.fileId ? [inv.fileId] : [],
    relatedType: 'ap_invoice',
    relatedId: id,
  });
  await db.apInvoice.update({ where: { id }, data: { rejectionSentTo: email, rejectionSentAt: r.state === 'SENT' ? new Date() : null } });
  return r.state;
}

export async function sendRejection(auth: AuthContext, id: string, input: { to?: string | null; handledManually?: boolean }) {
  requirePermission(auth, 'ap:work');
  const inv = await load(auth, id);
  if (inv.status !== 'REJECTED') throw conflict('Only rejected invoices.');
  if (input.handledManually) {
    await db.apInvoice.update({ where: { id }, data: { rejectionSentTo: 'Sent by mail / handled outside SupplyLine', rejectionSentAt: new Date() } });
    await audit(db, auth, 'ap.rejection_manual', 'ApInvoice', id, null, null);
    return getApInvoice(auth, id);
  }
  const contact = await apContactFor(inv);
  const to = input.to ?? contact?.email;
  if (!to) throw badRequest('Add the vendor’s accounts contact in Contacts, or type an email address.');
  const state = await queueRejection(auth, id, to, contact?.name ?? null);
  await audit(db, auth, 'ap.rejection_send', 'ApInvoice', id, null, { to, state });
  return getApInvoice(auth, id);
}

async function hold(auth: AuthContext, id: string, reason: string) {
  await db.apInvoice.update({ where: { id }, data: { status: 'ON_HOLD', holdReason: reason } });
  await audit(db, auth, 'ap.hold', 'ApInvoice', id, null, { reason });
  await moveFile(id, 'ON_HOLD');
  return getApInvoice(auth, id);
}

/** AP actions from the invoice page. */
export async function apAction(auth: AuthContext, id: string, input: ApActionInput) {
  requirePermission(auth, 'ap:work');
  const inv = await load(auth, id);
  switch (input.action) {
    case 'REMATCH':
      if (!['RECEIVED', 'NEEDS_REVIEW'].includes(inv.status)) throw conflict('Only invoices waiting for review can be re-checked.');
      await rematch(auth, id);
      break;
    case 'SEND_TO_APPROVAL':
      if (!['RECEIVED', 'NEEDS_REVIEW', 'ON_HOLD'].includes(inv.status)) throw conflict('This invoice is already past review.');
      if (inv.matchIssues.length && !input.note) throw badRequest('It doesn’t match the PO — add a note saying why it can go ahead anyway.');
      await startApproval(auth, id, input.note);
      break;
    case 'REJECT':
      if (!input.note) throw badRequest('Say why it’s rejected (this goes to the vendor).');
      return reject(auth, id, input.note);
    case 'HOLD':
      if (!input.note) throw badRequest('Say what information is needed.');
      return hold(auth, id, input.note);
    case 'RELEASE_HOLD':
      if (inv.status !== 'ON_HOLD') throw conflict('This invoice isn’t on hold.');
      await db.apInvoice.update({ where: { id }, data: { status: 'NEEDS_REVIEW', holdReason: null } });
      await rematch(auth, id);
      break;
    case 'MARK_PAID':
      if (inv.status !== 'APPROVED') throw conflict('Only approved invoices can be paid.');
      await db.apInvoice.update({ where: { id }, data: { status: 'PAID', paidAt: toDate(input.paidOn) ?? toDate(todayLocal()), paymentRef: input.paymentRef ?? null } });
      break;
    case 'RELEASE_HOLDBACK':
      if (!n0(inv.holdbackAmount) || inv.holdbackReleasedAt) throw conflict('No holdback to release on this invoice.');
      await db.apInvoice.update({ where: { id }, data: { holdbackReleasedAt: new Date(), notes: [inv.notes, `Holdback ${money(n(inv.holdbackAmount))} released${input.paymentRef ? ` (${input.paymentRef})` : ''}`].filter(Boolean).join('\n') } });
      break;
  }
  await audit(db, auth, `ap.${input.action.toLowerCase()}`, 'ApInvoice', id, null, input);
  return getApInvoice(auth, id);
}

/** AP fixes the details (after a bad read, or before re-checking). */
export async function editApInvoice(auth: AuthContext, id: string, input: ApInvoiceEditInput) {
  requirePermission(auth, 'ap:work');
  const inv = await load(auth, id);
  if (!['RECEIVED', 'NEEDS_REVIEW', 'ON_HOLD'].includes(inv.status)) throw conflict('This invoice is already in approval or done.');
  const { lines, invoiceDate, dueDate, ...rest } = input;
  await db.$transaction(async (tx) => {
    await tx.apInvoice.update({
      where: { id },
      data: {
        ...rest,
        ...(invoiceDate !== undefined ? { invoiceDate: toDate(invoiceDate) } : {}),
        ...(dueDate !== undefined ? { dueDate: toDate(dueDate) } : {}),
        ...(rest.vendorName !== undefined ? { vendorId: null } : {}),
      },
    });
    if (lines) {
      await tx.apInvoiceLine.deleteMany({ where: { invoiceId: id } });
      for (const [i, l] of lines.entries()) await tx.apInvoiceLine.create({ data: { invoiceId: id, lineNo: i + 1, description: l.description, qty: l.qty ?? null, uom: l.uom ?? null, unitPrice: l.unitPrice ?? null, amount: l.amount ?? null, poLineId: l.poLineId ?? null } });
    }
    await audit(tx, auth, 'ap.edit', 'ApInvoice', id, null, input);
  });
  if (input.refInvoiceNumber) await linkRevision(auth, id);
  if (inv.status !== 'ON_HOLD') await rematch(auth, id);
  return getApInvoice(auth, id);
}

// ---------------------------------------------------------------------------
// Dashboard and pay runs
// ---------------------------------------------------------------------------
export async function apDashboard(auth: AuthContext): Promise<ApDashboard> {
  const w = await where(auth);
  const today = todayLocal();
  const [needsReview, inApproval, approved, rejected, onHold, overdue] = await Promise.all([
    db.apInvoice.count({ where: { AND: [w, { status: { in: ['RECEIVED', 'NEEDS_REVIEW'] } }] } }),
    db.apInvoice.count({ where: { AND: [w, { status: 'IN_APPROVAL' }] } }),
    db.apInvoice.findMany({ where: { AND: [w, { status: 'APPROVED' }] }, select: { total: true, holdbackAmount: true } }),
    db.apInvoice.count({ where: { AND: [w, { status: 'REJECTED' }] } }),
    db.apInvoice.count({ where: { AND: [w, { status: 'ON_HOLD' }] } }),
    db.apInvoice.count({ where: { AND: [w, { status: { in: ['APPROVED', 'IN_APPROVAL', 'NEEDS_REVIEW'] } }, { dueDate: { lt: toDate(today)! } }] } }),
  ]);
  const mine = (await listApInvoices(auth, { show: 'mine' })).length;
  const { folderStatus } = await import('./ap-folders');
  return {
    needsReview,
    inApproval,
    waitingOnMe: mine,
    approvedUnpaid: approved.length,
    approvedUnpaidTotal: cents(approved.reduce((a, x) => a + n0(x.total) - n0(x.holdbackAmount), 0)),
    rejected,
    onHold,
    overdue,
    folderProblem: can(auth, 'ap:work') ? folderStatus(auth.orgId) : null,
  };
}

/** Next pay runs (company pay days): approved and due, still in approval, and expected from open POs. */
export async function payRuns(auth: AuthContext, companyId: string, count = 6): Promise<PayRunRow[]> {
  requirePermission(auth, 'ap:work');
  const c = await assertCompanyAccessible(auth, companyId);
  const s = accountingOf(c.settings);
  const today = todayLocal();
  // Pay dates from the start of last month onward.
  const dates: string[] = [];
  const [y, m] = today.split('-').map(Number) as [number, number];
  for (let k = -1; dates.filter((d) => d >= today).length < count && k < 24; k++) {
    const yy = y + Math.floor((m - 1 + k) / 12);
    const mm = ((m - 1 + k) % 12 + 12) % 12;
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    for (const d of [...new Set(s.payDays.map((x) => Math.min(x, last)))].sort((a, b) => a - b)) dates.push(`${yy}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  const runs = dates.filter((d, i) => d >= today || (dates[i + 1] ?? '9999') >= today);
  const invs = await db.apInvoice.findMany({ where: { companyId, status: { in: ['NEEDS_REVIEW', 'IN_APPROVAL', 'APPROVED', 'PAID', 'ON_HOLD'] } }, select: { status: true, total: true, holdbackAmount: true, dueDate: true, invoiceDate: true, paidAt: true, purchaseOrderId: true } });
  // Open POs not fully invoiced yet: expected date + terms.
  const pos = await db.purchaseOrder.findMany({
    where: { companyId, status: 'ISSUED' },
    select: { id: true, expectedDate: true, gstRate: true, pstRate: true, hstRate: true, lines: { select: { qty: true, unitCost: true } }, apInvoices: { where: { status: { notIn: ['REJECTED', 'REPLACED'] } }, select: { subtotal: true } } },
  });
  const forecasts = pos
    .map((p) => {
      const value = p.lines.reduce((a, l) => a + n0(l.qty) * n0(l.unitCost), 0);
      const invoiced = p.apInvoices.reduce((a, i) => a + n0(i.subtotal), 0);
      const left = Math.max(0, value - invoiced) * (1 + n0(p.gstRate) + n0(p.pstRate) + n0(p.hstRate));
      const due = addDays(day(p.expectedDate) ?? today, s.defaultTermsDays);
      return { due, amount: cents(left) };
    })
    .filter((x) => x.amount > 0.009);
  const rows: PayRunRow[] = [];
  let prev = '0000-00-00';
  for (const d of runs) {
    const inWindow = (x: string | null) => !!x && x > prev && x <= d;
    const due = (i: (typeof invs)[number]) => day(i.dueDate) ?? addDays(day(i.invoiceDate) ?? today, s.defaultTermsDays);
    const approved = invs.filter((i) => i.status === 'APPROVED' && (inWindow(due(i)) || (rows.length === 0 && due(i) <= d)));
    const pending = invs.filter((i) => ['NEEDS_REVIEW', 'IN_APPROVAL', 'ON_HOLD'].includes(i.status) && (inWindow(due(i)) || (rows.length === 0 && due(i) <= d)));
    const fc = forecasts.filter((f) => inWindow(f.due) || (rows.length === 0 && f.due <= d));
    const pay = (i: (typeof invs)[number]) => n0(i.total) - n0(i.holdbackAmount);
    const paid = invs.filter((i) => i.status === 'PAID' && inWindow(day(i.paidAt))).reduce((a, i) => a + pay(i), 0);
    const row = {
      date: d,
      approvedDue: cents(approved.reduce((a, i) => a + pay(i), 0)),
      approvedCount: approved.length,
      pending: cents(pending.reduce((a, i) => a + pay(i), 0)),
      pendingCount: pending.length,
      forecast: cents(fc.reduce((a, f) => a + f.amount, 0)),
      forecastCount: fc.length,
      total: 0,
      paid: cents(paid),
    };
    row.total = cents(row.approvedDue + row.pending + row.forecast);
    rows.push(row);
    prev = d;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The invoice file follows the invoice through the network folders
// ---------------------------------------------------------------------------
export const FOLDER_FOR: Record<string, keyof AccountingSettings['folders'] | null> = {
  IN_REVIEW: 'inReview',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ON_HOLD: 'held',
  REPLACED: 'rejected',
};

export async function moveFile(id: string, state: 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'ON_HOLD' | 'REPLACED') {
  const inv = await db.apInvoice.findUnique({ where: { id }, select: { sourcePath: true, companyId: true, folderState: true, receivedVia: true } });
  if (!inv?.sourcePath || inv.folderState === state) return;
  if (inv.receivedVia === 'SYNC') return; // the Sync app on your network moves these (it asks for /sync/ap/moves)
  const { s } = await settingsFor(inv.companyId);
  const key = FOLDER_FOR[state];
  const dir = key ? s.folders[key] : '';
  if (!dir) return;
  try {
    await fs.mkdir(dir, { recursive: true });
    let dest = joinIn(dir, fileNameOf(inv.sourcePath));
    for (let i = 1; i < 50; i++) {
      try {
        await fs.access(dest);
        const ext = path.extname(inv.sourcePath);
        dest = joinIn(dir, `${fileNameOf(inv.sourcePath, ext)} (${i})${ext}`);
      } catch {
        break;
      }
    }
    try {
      await fs.rename(inv.sourcePath, dest);
    } catch {
      await fs.copyFile(inv.sourcePath, dest); // different drive / share
      await fs.unlink(inv.sourcePath);
    }
    await db.apInvoice.update({ where: { id }, data: { sourcePath: dest, folderState: state } });
  } catch (e) {
    console.error('[ap] could not move invoice file', inv.sourcePath, (e as Error).message);
  }
}

export const taxNote = (province: string | null, exempt: boolean) => taxProfile(province, exempt).label;

/** Approved invoices go into the network folder too (if the company files them). */
async function fileApproved(id: string) {
  const inv = await db.apInvoice.findUnique({ where: { id }, include: { vendor: { select: { name: true } } } });
  if (!inv?.fileId) return;
  const vendor = inv.vendor?.name ?? inv.vendorName ?? 'Vendor';
  // With its receiving reports added at the back, when there are any.
  const reports = inv.purchaseOrderId ? (await reportsForPo(inv.purchaseOrderId)).map((r) => r.id) : [];
  const pack = await invoiceWithReports(inv.fileId, reports).catch(() => null);
  if (pack) {
    const asset = await saveUpload({ organizationId: inv.organizationId, companyId: inv.companyId, uploadedById: inv.createdById ?? (await db.user.findFirstOrThrow({ where: { organizationId: inv.organizationId }, select: { id: true } })).id, kind: 'AP_INVOICE', file: new File([Buffer.from(pack)], `${vendor} - ${inv.invoiceNumber ?? 'invoice'} (with receiving reports).pdf`, { type: 'application/pdf' }), maxBytes: 60 * 1_048_576 });
    await fileDocument({ companyId: inv.companyId, docType: 'AP_INVOICE', fileId: asset.id, vars: { job: await jobLabel(inv.siteId), vendor } });
    return;
  }
  await fileDocument({ companyId: inv.companyId, docType: 'AP_INVOICE', fileId: inv.fileId, vars: { job: await jobLabel(inv.siteId), vendor }, fileName: `${vendor} - ${inv.invoiceNumber ?? 'invoice'}${(await db.fileAsset.findUnique({ where: { id: inv.fileId }, select: { fileName: true } }))?.fileName.match(/\.[^.]+$/)?.[0] ?? '.pdf'}` });
}

/** Which network folder an invoice's file belongs in for its status. */
export function folderStateFor(status: string): 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'ON_HOLD' | 'REPLACED' {
  if (status === 'APPROVED' || status === 'PAID') return 'APPROVED';
  if (status === 'REJECTED') return 'REJECTED';
  if (status === 'ON_HOLD') return 'ON_HOLD';
  if (status === 'REPLACED') return 'REPLACED';
  return 'IN_REVIEW';
}

/** The invoice with its receiving reports at the back, for download. */
export async function invoicePack(auth: AuthContext, id: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const inv = await load(auth, id);
  if (!inv.fileId) throw notFound('Invoice file');
  const reports = inv.purchaseOrderId ? (await reportsForPo(inv.purchaseOrderId)).map((r) => r.id) : [];
  const pack = await invoiceWithReports(inv.fileId, reports);
  if (!pack) throw badRequest('There are no receiving reports for this invoice’s PO yet.');
  return { bytes: pack, fileName: `Invoice-${(inv.invoiceNumber ?? 'invoice').replace(/[^\w-]+/g, '-')}-with-receiving-reports.pdf` };
}
