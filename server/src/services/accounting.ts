// Customers and our invoices to them (AR), subcontractor holdback set on the
// project, job budgets vs committed vs actual, and clean AP / AR / tax exports
// for the accountant (no year-end posting).

import { taxProfile } from '@supplyline/core/domain';
import { FILING_DOC_TYPES } from '@supplyline/core/models';
import type {
  AccountingExportRow,
  ArInvoiceDetail,
  ArInvoiceInput,
  ArInvoiceSummary,
  ArState,
  BudgetRow,
  CustomerInput,
  CustomerItem,
  JobBudgetInput,
  SubHoldbackInput,
  SubHoldbackView,
} from '@supplyline/core/models';
import { can } from '@supplyline/core/permissions';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { viaName } from '../integrations/email';
import { renderArInvoicePdf } from '../pdf/ar-invoice-pdf';
import { accessibleCompanyIds, assertCompanyAccessible, assertSiteVisible } from './access';
import { accountingOf } from './ap';
import { fileUrl, logoForPdf, saveUpload } from './files';
import { fileDocument, filingOf, jobLabel } from './filing';
import { sendTemplated } from './mail';
import { todayLocal } from './project';

const n0 = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (v: string) => new Date(`${v}T00:00:00Z`);
const cents = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => x.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });

// ---------------------------------------------------------------------------
// Subcontractor holdback (project area)
// ---------------------------------------------------------------------------
async function jobGuard(auth: AuthContext, siteId: string, edit: boolean) {
  const site = await assertSiteVisible(auth, siteId);
  if (site.type !== 'JOB') throw badRequest('This is for jobs / projects.');
  const allowed = edit ? can(auth, 'budget:edit') || can(auth, 'ap:work') || site.projectManagerId === auth.userId : can(auth, 'po:view') || can(auth, 'ap:work') || site.projectManagerId === auth.userId;
  if (!allowed) throw forbidden('This is for admins, procurement, AP and the job’s project manager.');
  return site;
}

export async function getSubHoldback(auth: AuthContext, siteId: string): Promise<SubHoldbackView> {
  const site = await jobGuard(auth, siteId, false);
  const overrides = await db.subHoldback.findMany({ where: { siteId }, include: { contact: { select: { name: true, businessName: true } } } });
  const invs = await db.apInvoice.findMany({ where: { siteId, kind: 'INVOICE', holdbackAmount: { gt: 0 }, status: { notIn: ['REJECTED', 'REPLACED'] } }, include: { vendor: { select: { name: true, contactId: true } } } });
  const owing = new Map<string, SubHoldbackView['owing'][number]>();
  for (const i of invs) {
    const name = i.vendor?.name ?? i.vendorName ?? 'Unknown';
    const row = owing.get(name) ?? { contactId: i.vendor?.contactId ?? null, name, invoiced: 0, held: 0, released: 0, owing: 0 };
    row.invoiced = cents(row.invoiced + n0(i.subtotal));
    row.held = cents(row.held + n0(i.holdbackAmount));
    if (i.holdbackReleasedAt) row.released = cents(row.released + n0(i.holdbackAmount));
    row.owing = cents(row.held - row.released);
    owing.set(name, row);
  }
  return {
    defaultPct: site.subHoldbackPct == null ? null : n0(site.subHoldbackPct),
    overrides: overrides.map((o) => ({ contactId: o.contactId, name: o.contact.businessName ?? o.contact.name, pct: n0(o.pct) })),
    owing: [...owing.values()],
  };
}

export async function saveSubHoldback(auth: AuthContext, siteId: string, input: SubHoldbackInput) {
  await jobGuard(auth, siteId, true);
  const ok = await db.contact.count({ where: { id: { in: input.overrides.map((o) => o.contactId) }, organizationId: auth.orgId } });
  if (ok !== new Set(input.overrides.map((o) => o.contactId)).size) throw badRequest('One of the subcontractors was not found.');
  await db.$transaction(async (tx) => {
    await tx.site.update({ where: { id: siteId }, data: { subHoldbackPct: input.defaultPct } });
    await tx.subHoldback.deleteMany({ where: { siteId } });
    if (input.overrides.length) await tx.subHoldback.createMany({ data: input.overrides.map((o) => ({ siteId, contactId: o.contactId, pct: o.pct })) });
    await audit(tx, auth, 'site.sub_holdback', 'Site', siteId, null, input);
  });
  return getSubHoldback(auth, siteId);
}

// ---------------------------------------------------------------------------
// Job budgets: budget vs committed (issued POs) vs actual (approved invoices)
// ---------------------------------------------------------------------------
export async function getBudget(auth: AuthContext, siteId: string): Promise<{ rows: BudgetRow[]; canEdit: boolean; totals: { budget: number; committed: number; actual: number } }> {
  const site = await jobGuard(auth, siteId, false);
  const [budgets, codes, poLines, apInvs] = await Promise.all([
    db.jobBudget.findMany({ where: { siteId } }),
    db.costCode.findMany({ where: { companyId: site.companyId!, OR: [{ siteId: null }, { siteId }] }, select: { code: true, description: true } }),
    db.purchaseOrderLine.findMany({
      where: { purchaseOrder: { siteId, status: { in: ['ISSUED', 'CLOSED'] } } },
      select: { qty: true, unitCost: true, costCode: true, orderLine: { select: { costCode: true } } },
    }),
    db.apInvoice.findMany({
      where: { siteId, status: { in: ['APPROVED', 'PAID'] } },
      select: { kind: true, subtotal: true, costCode: true, lines: { select: { amount: true, qty: true, unitPrice: true, poLine: { select: { costCode: true, orderLine: { select: { costCode: true } } } } } } },
    }),
  ]);
  const UNCODED = 'Uncoded';
  const committed = new Map<string, number>();
  for (const l of poLines) {
    const code = l.costCode ?? l.orderLine?.costCode ?? UNCODED;
    committed.set(code, (committed.get(code) ?? 0) + n0(l.qty) * n0(l.unitCost));
  }
  const actual = new Map<string, number>();
  for (const i of apInvs) {
    const sign = i.kind === 'CREDIT' ? -1 : 1;
    if (!i.lines.length) {
      const code = i.costCode ?? UNCODED;
      actual.set(code, (actual.get(code) ?? 0) + sign * Math.abs(n0(i.subtotal)));
      continue;
    }
    for (const l of i.lines) {
      const code = l.poLine?.costCode ?? l.poLine?.orderLine?.costCode ?? i.costCode ?? UNCODED;
      const amt = l.amount != null ? n0(l.amount) : n0(l.qty) * n0(l.unitPrice);
      actual.set(code, (actual.get(code) ?? 0) + sign * Math.abs(amt));
    }
  }
  const all = new Set<string>([...budgets.map((b) => b.costCode), ...committed.keys(), ...actual.keys()]);
  const rows = [...all]
    .map((code) => {
      const budget = n0(budgets.find((b) => b.costCode === code)?.amount);
      const c = cents(committed.get(code) ?? 0);
      const a = cents(actual.get(code) ?? 0);
      return { costCode: code, description: codes.find((x) => x.code === code)?.description ?? null, budget, committed: c, actual: a, remaining: cents(budget - Math.max(c, a)), over: budget > 0 ? Math.max(c, a) > budget + 0.005 : c + a > 0 };
    })
    .sort((x, y) => (x.costCode === UNCODED ? 1 : y.costCode === UNCODED ? -1 : x.costCode.localeCompare(y.costCode)));
  return {
    rows,
    canEdit: can(auth, 'budget:edit') || site.projectManagerId === auth.userId,
    totals: { budget: cents(rows.reduce((s, r) => s + r.budget, 0)), committed: cents(rows.reduce((s, r) => s + r.committed, 0)), actual: cents(rows.reduce((s, r) => s + r.actual, 0)) },
  };
}

export async function saveBudget(auth: AuthContext, siteId: string, input: JobBudgetInput) {
  const site = await jobGuard(auth, siteId, true);
  if (!(can(auth, 'budget:edit') || site.projectManagerId === auth.userId)) throw forbidden('Only admins, procurement and the job’s PM can change the budget.');
  await db.$transaction(async (tx) => {
    await tx.jobBudget.deleteMany({ where: { siteId } });
    const seen = new Set<string>();
    for (const r of input.rows) {
      if (seen.has(r.costCode.toUpperCase())) continue;
      seen.add(r.costCode.toUpperCase());
      await tx.jobBudget.create({ data: { siteId, costCode: r.costCode, amount: r.amount, notes: r.notes ?? null } });
    }
    await audit(tx, auth, 'site.budget', 'Site', siteId, null, { rows: input.rows.length });
  });
  return getBudget(auth, siteId);
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export async function listCustomers(auth: AuthContext, f: { q?: string; companyId?: string; includeInactive?: boolean }): Promise<CustomerItem[]> {
  requirePermission(auth, 'ar:work');
  const companies = await accessibleCompanyIds(auth);
  const rows = await db.customer.findMany({
    where: {
      organizationId: auth.orgId,
      companyId: f.companyId ? (companies.includes(f.companyId) ? f.companyId : '__none__') : { in: companies },
      ...(f.includeInactive ? {} : { active: true }),
      ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { contactName: { contains: f.q, mode: 'insensitive' } }, { email: { contains: f.q, mode: 'insensitive' } }] } : {}),
    },
    include: { company: { select: { name: true } }, invoices: { where: { status: { in: ['SENT'] } }, select: { total: true, amountPaid: true, holdbackAmount: true } } },
    orderBy: { name: 'asc' },
  });
  return rows.map(({ invoices, company, createdAt: _c, updatedAt: _u, organizationId: _o, ...c }) => ({
    ...c,
    companyName: company.name,
    outstanding: cents(invoices.reduce((a, i) => a + n0(i.total) - n0(i.amountPaid), 0)),
  }));
}

export async function saveCustomer(auth: AuthContext, id: string | null, input: CustomerInput) {
  requirePermission(auth, 'ar:work');
  await assertCompanyAccessible(auth, input.companyId);
  const clash = await db.customer.findFirst({ where: { companyId: input.companyId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw conflict(`There is already a customer called ${input.name}.`);
  const c = id
    ? await db.customer.update({ where: { id, organizationId: auth.orgId } as never, data: input })
    : await db.customer.create({ data: { ...input, organizationId: auth.orgId } });
  await audit(db, auth, id ? 'customer.update' : 'customer.create', 'Customer', c.id, null, input);
  return { id: c.id };
}

// ---------------------------------------------------------------------------
// Customer invoices
// ---------------------------------------------------------------------------
const arInclude = {
  customer: true,
  site: { select: { id: true, jobNumber: true, name: true } },
  lines: { orderBy: { lineNo: 'asc' as const } },
  payments: { orderBy: { paidOn: 'asc' as const } },
} satisfies Prisma.ArInvoiceInclude;
type Ar = Prisma.ArInvoiceGetPayload<{ include: typeof arInclude }>;

function stateOf(i: Pick<Ar, 'status' | 'total' | 'amountPaid' | 'holdbackAmount' | 'dueDate'>): ArState {
  if (i.status === 'DRAFT' || i.status === 'VOID') return i.status;
  const balance = n0(i.total) - n0(i.amountPaid);
  if (balance <= 0.005) return 'PAID';
  // Only the holdback left: not overdue (it's released later).
  const dueNow = balance - n0(i.holdbackAmount);
  if (dueNow > 0.005 && day(i.dueDate)! < todayLocal()) return 'OVERDUE';
  return n0(i.amountPaid) > 0 ? 'PARTIAL' : 'SENT';
}

function toArSummary(i: Ar): ArInvoiceSummary {
  return {
    id: i.id,
    companyId: i.companyId,
    invoiceNumber: i.invoiceNumber,
    customerName: i.customer.name,
    customerId: i.customerId,
    siteId: i.siteId,
    siteLabel: i.site ? `JOB#${i.site.jobNumber} ${i.site.name}` : null,
    invoiceDate: day(i.invoiceDate)!,
    dueDate: day(i.dueDate)!,
    state: stateOf(i),
    total: n0(i.total),
    holdbackAmount: n0(i.holdbackAmount),
    amountPaid: n0(i.amountPaid),
    balance: cents(n0(i.total) - n0(i.amountPaid)),
  };
}

async function loadAr(auth: AuthContext, id: string) {
  requirePermission(auth, 'ar:work');
  const i = await db.arInvoice.findFirst({ where: { id, organizationId: auth.orgId, companyId: { in: await accessibleCompanyIds(auth) } }, include: arInclude });
  if (!i) throw notFound('Invoice');
  return i;
}

export async function getArInvoice(auth: AuthContext, id: string): Promise<ArInvoiceDetail> {
  const i = await loadAr(auth, id);
  const backups = await db.fileAsset.findMany({ where: { arInvoiceId: id, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, fileName: true, sizeBytes: true } });
  return {
    ...toArSummary(i),
    backups: backups.map((b) => ({ ...b, url: fileUrl(b.id)! })),
    backupFolder: await backupFolderFor(i.companyId, i.invoiceNumber, i.siteId),
    description: i.description,
    subtotal: n0(i.subtotal),
    gstRate: n0(i.gstRate),
    pstRate: n0(i.pstRate),
    gst: n0(i.gst),
    pst: n0(i.pst),
    holdbackPct: i.holdbackPct == null ? null : n0(i.holdbackPct),
    lines: i.lines.map((l) => ({ description: l.description, qty: n0(l.qty), uom: l.uom, unitPrice: n0(l.unitPrice), amount: n0(l.amount), costCode: l.costCode })),
    payments: i.payments.map((p) => ({ id: p.id, paidOn: day(p.paidOn)!, amount: n0(p.amount), reference: p.reference, holdbackRelease: p.holdbackRelease })),
    customer: { name: i.customer.name, contactName: i.customer.contactName, email: i.customer.email },
    sentAt: i.sentAt?.toISOString() ?? null,
  };
}

export async function listArInvoices(auth: AuthContext, f: { state?: ArState | 'OPEN'; customerId?: string; siteId?: string; companyId?: string }): Promise<ArInvoiceSummary[]> {
  requirePermission(auth, 'ar:work');
  const companies = await accessibleCompanyIds(auth);
  const rows = await db.arInvoice.findMany({
    where: {
      organizationId: auth.orgId,
      companyId: f.companyId ? (companies.includes(f.companyId) ? f.companyId : '__none__') : { in: companies },
      ...(f.customerId ? { customerId: f.customerId } : {}),
      ...(f.siteId ? { siteId: f.siteId } : {}),
    },
    include: arInclude,
    orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
    take: 500,
  });
  const list = rows.map(toArSummary);
  if (!f.state) return list;
  if (f.state === 'OPEN') return list.filter((x) => ['SENT', 'PARTIAL', 'OVERDUE'].includes(x.state));
  return list.filter((x) => x.state === f.state);
}

export async function nextArNumber(auth: AuthContext, companyId: string) {
  requirePermission(auth, 'ar:work');
  const c = await assertCompanyAccessible(auth, companyId);
  const s = accountingOf(c.settings);
  let k = s.arNextNumber;
  const counter = await db.counter.findUnique({ where: { key: `ar:${companyId}` } });
  if (counter) k = Math.max(k, counter.value + 1);
  for (let i = 0; i < 50; i++) {
    if (!(await db.arInvoice.findFirst({ where: { companyId, invoiceNumber: `${s.arPrefix}${k}` } }))) break;
    k++;
  }
  return { invoiceNumber: `${s.arPrefix}${k}` };
}

function totalsFor(input: ArInvoiceInput) {
  const lines = input.lines.map((l) => ({ ...l, amount: cents(l.qty * l.unitPrice) }));
  const subtotal = cents(lines.reduce((a, l) => a + l.amount, 0));
  const gst = cents(subtotal * input.gstRate);
  const pst = cents(subtotal * input.pstRate);
  const total = cents(subtotal + gst + pst);
  const holdbackAmount = input.holdbackPct ? cents((subtotal * input.holdbackPct) / 100) : 0;
  return { lines, subtotal, gst, pst, total, holdbackAmount };
}

export async function saveArInvoice(auth: AuthContext, id: string | null, input: ArInvoiceInput) {
  requirePermission(auth, 'ar:work');
  const company = await assertCompanyAccessible(auth, input.companyId);
  const customer = await db.customer.findFirst({ where: { id: input.customerId, companyId: input.companyId } });
  if (!customer) throw badRequest('Pick a customer of this company.');
  if (input.siteId) {
    const site = await db.site.findFirst({ where: { id: input.siteId, companyId: input.companyId, type: 'JOB' } });
    if (!site) throw badRequest('Pick a job / project of this company.');
  }
  if (id) {
    const before = await loadAr(auth, id);
    if (before.status !== 'DRAFT') throw conflict('Sent invoices can’t be changed. Void it and make a new one, or issue a credit.');
  }
  const t = totalsFor(input);
  const data = {
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: toDate(input.invoiceDate),
    dueDate: toDate(input.dueDate),
    description: input.description ?? null,
    gstRate: input.gstRate,
    pstRate: input.pstRate,
    holdbackPct: input.holdbackPct ?? null,
    subtotal: t.subtotal,
    gst: t.gst,
    pst: t.pst,
    total: t.total,
    holdbackAmount: t.holdbackAmount,
  };
  const saved = await db.$transaction(async (tx) => {
    const clash = await tx.arInvoice.findFirst({ where: { companyId: input.companyId, invoiceNumber: input.invoiceNumber, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw conflict(`Invoice ${input.invoiceNumber} already exists.`);
    const inv = id ? await tx.arInvoice.update({ where: { id }, data }) : await tx.arInvoice.create({ data: { ...data, organizationId: auth.orgId, createdById: auth.userId } });
    await tx.arInvoiceLine.deleteMany({ where: { invoiceId: inv.id } });
    for (const [i, l] of t.lines.entries()) await tx.arInvoiceLine.create({ data: { invoiceId: inv.id, lineNo: i + 1, description: l.description, qty: l.qty, uom: l.uom, unitPrice: l.unitPrice, amount: l.amount, costCode: l.costCode ?? null } });
    // Keep the number counter past what's used.
    const s = accountingOf(company.settings);
    const rest = s.arPrefix && input.invoiceNumber.startsWith(s.arPrefix) ? input.invoiceNumber.slice(s.arPrefix.length) : input.invoiceNumber;
    if (/^\d{1,9}$/.test(rest)) await tx.$executeRaw`INSERT INTO "Counter" ("key", "value") VALUES (${`ar:${input.companyId}`}, ${Number(rest)}) ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Counter"."value", ${Number(rest)})`;
    await audit(tx, auth, id ? 'ar.update' : 'ar.create', 'ArInvoice', inv.id, null, input);
    return inv;
  });
  return getArInvoice(auth, saved.id);
}

async function arPdfData(i: Ar) {
  const company = await db.company.findUniqueOrThrow({ where: { id: i.companyId } });
  const c = i.customer;
  return {
    invoiceNumber: i.invoiceNumber,
    invoiceDate: day(i.invoiceDate)!,
    dueDate: day(i.dueDate)!,
    companyName: company.name,
    companyCode: company.code,
    themeColor: company.themeColor,
    logo: await logoForPdf(company.logoFileId),
    customer: { name: c.name, contactName: c.contactName, address: [c.address, c.city, c.province, c.postalCode].filter(Boolean).join(', ') || null },
    project: i.site ? `JOB#${i.site.jobNumber} ${i.site.name}` : null,
    description: i.description,
    lines: i.lines.map((l) => ({ description: l.description, qty: n0(l.qty), uom: l.uom, unitPrice: n0(l.unitPrice), amount: n0(l.amount) })),
    subtotal: n0(i.subtotal),
    gst: n0(i.gst),
    gstRate: n0(i.gstRate),
    pst: n0(i.pst),
    pstRate: n0(i.pstRate),
    holdbackPct: i.holdbackPct == null ? null : n0(i.holdbackPct),
    holdbackAmount: n0(i.holdbackAmount),
    total: n0(i.total),
    amountDue: cents(n0(i.total) - n0(i.holdbackAmount)),
    gstNumber: (company.settings as { gstNumber?: string } | null)?.gstNumber ?? null,
  };
}

export async function getArPdf(auth: AuthContext, id: string) {
  const i = await loadAr(auth, id);
  return { bytes: await renderArInvoicePdf(await arPdfData(i)), fileName: `Invoice-${i.invoiceNumber.replace(/[^\w-]+/g, '-')}.pdf` };
}

/** Mark sent and email the customer (held for review by default). */
export async function sendArInvoice(auth: AuthContext, id: string, opts: { email: boolean }) {
  const i = await loadAr(auth, id);
  if (i.status === 'VOID') throw conflict('This invoice was voided.');
  const bytes = await renderArInvoicePdf(await arPdfData(i));
  const asset = await saveUpload({ organizationId: auth.orgId, companyId: i.companyId, uploadedById: auth.userId, kind: 'AR_INVOICE', file: new File([new Uint8Array(bytes)], `Invoice-${i.invoiceNumber}.pdf`, { type: 'application/pdf' }), maxBytes: 20 * 1_048_576 });
  await db.arInvoice.update({ where: { id }, data: { status: i.status === 'DRAFT' ? 'SENT' : i.status, sentAt: new Date(), fileId: asset.id } });
  await fileDocument({ companyId: i.companyId, docType: 'AR_INVOICE', fileId: asset.id, vars: { job: await jobLabel(i.siteId) } });
  let state = 'SKIPPED';
  if (opts.email) {
    if (!i.customer.email) throw badRequest('This customer has no email address. Add one, or untick “Email it”.');
    const company = await db.company.findUniqueOrThrow({ where: { id: i.companyId } });
    const r = await sendTemplated({
      organizationId: auth.orgId,
      companyId: i.companyId,
      key: 'AR_INVOICE',
      vars: { invoiceNumber: i.invoiceNumber, project: i.site ? `JOB#${i.site.jobNumber} ${i.site.name}` : (i.description ?? 'our work'), amountDue: money(n0(i.total) - n0(i.holdbackAmount)), dueDate: day(i.dueDate)!, customerContact: i.customer.contactName ?? i.customer.name, senderName: auth.name, companyName: company.name },
      to: [i.customer.email],
      fromName: viaName(auth.name),
      replyTo: auth.email,
      // The backup documents go with the invoice (up to ~15 MB in all).
      attachmentFileIds: [asset.id, ...(await backupsToAttach(id))],
      relatedType: 'ar_invoice',
      relatedId: id,
    });
    state = r.state;
  }
  await audit(db, auth, 'ar.send', 'ArInvoice', id, null, { email: opts.email, state });
  return { state, invoice: await getArInvoice(auth, id) };
}

export async function voidArInvoice(auth: AuthContext, id: string) {
  const i = await loadAr(auth, id);
  if (n0(i.amountPaid) > 0) throw conflict('A payment has been recorded on this invoice.');
  await db.arInvoice.update({ where: { id }, data: { status: 'VOID' } });
  await audit(db, auth, 'ar.void', 'ArInvoice', id, null, null);
  return getArInvoice(auth, id);
}

export async function recordArPayment(auth: AuthContext, id: string, input: { paidOn: string; amount: number; reference?: string | null; holdbackRelease?: boolean }) {
  const i = await loadAr(auth, id);
  if (i.status === 'DRAFT' || i.status === 'VOID') throw conflict('Send the invoice first.');
  const balance = n0(i.total) - n0(i.amountPaid);
  if (input.amount > balance + 0.005) throw badRequest(`That's more than the ${money(balance)} still owing.`);
  await db.$transaction(async (tx) => {
    await tx.arPayment.create({ data: { invoiceId: id, paidOn: toDate(input.paidOn), amount: input.amount, reference: input.reference ?? null, holdbackRelease: !!input.holdbackRelease, createdById: auth.userId } });
    const paid = cents(n0(i.amountPaid) + input.amount);
    await tx.arInvoice.update({ where: { id }, data: { amountPaid: paid, ...(paid >= n0(i.total) - 0.005 ? { status: 'PAID', paidAt: toDate(input.paidOn) } : {}) } });
    await audit(tx, auth, 'ar.payment', 'ArInvoice', id, null, input);
  });
  return getArInvoice(auth, id);
}

/** GST / PST for a new invoice on this project (GST by province; PST off by default — the accountant decides). */
export function arTaxFor(province: string | null) {
  const t = taxProfile(province);
  return { gstRate: t.hstRate || t.gstRate, pstRate: 0 };
}

// ---------------------------------------------------------------------------
// Exports for the accountant (AP, AR, tax) — no year-end posting
// ---------------------------------------------------------------------------
export async function accountingExport(auth: AuthContext, kind: 'ap' | 'ar' | 'tax', from: string, to: string, companyId?: string): Promise<AccountingExportRow[]> {
  if (!can(auth, 'ap:work')) throw forbidden('This is for admins, procurement and AP.');
  const companies = (await accessibleCompanyIds(auth)).filter((c) => !companyId || c === companyId);
  const range = { gte: toDate(from), lte: toDate(to) };
  if (kind === 'ap' || kind === 'tax') {
    const ap = await db.apInvoice.findMany({
      where: { organizationId: auth.orgId, companyId: { in: companies }, invoiceDate: range, status: { notIn: ['REPLACED'] } },
      include: { vendor: { select: { name: true } }, purchaseOrder: { select: { poNumber: true } }, site: { select: { jobNumber: true } } },
      orderBy: { invoiceDate: 'asc' },
    });
    if (kind === 'ap')
      return ap.map((i) => {
        const sign = i.kind === 'CREDIT' ? -1 : 1;
        return {
          type: i.kind === 'CREDIT' ? 'Credit' : 'Invoice',
          vendor: i.vendor?.name ?? i.vendorName,
          invoice: i.invoiceNumber,
          date: day(i.invoiceDate),
          due: day(i.dueDate),
          po: i.purchaseOrder?.poNumber ?? i.poNumberText,
          job: i.site?.jobNumber ?? null,
          costCode: i.costCode,
          subtotal: sign * Math.abs(n0(i.subtotal)),
          gst: sign * Math.abs(n0(i.gst)),
          pst: sign * Math.abs(n0(i.pst)),
          total: sign * Math.abs(n0(i.total)),
          holdback: n0(i.holdbackAmount),
          status: i.status,
          paid: day(i.paidAt),
          paymentRef: i.paymentRef,
        };
      });
    const ar = await db.arInvoice.findMany({ where: { organizationId: auth.orgId, companyId: { in: companies }, invoiceDate: range, status: { notIn: ['DRAFT', 'VOID'] } } });
    const byMonth = new Map<string, { gstPaid: number; pstPaid: number; gstCollected: number; pstCollected: number; purchases: number; sales: number }>();
    const bump = (m: string) => byMonth.get(m) ?? { gstPaid: 0, pstPaid: 0, gstCollected: 0, pstCollected: 0, purchases: 0, sales: 0 };
    for (const i of ap) {
      if (['REJECTED', 'RECEIVED'].includes(i.status) || !i.invoiceDate) continue;
      const m = day(i.invoiceDate)!.slice(0, 7);
      const r = bump(m);
      const sign = i.kind === 'CREDIT' ? -1 : 1;
      r.gstPaid += sign * Math.abs(n0(i.gst));
      r.pstPaid += sign * Math.abs(n0(i.pst));
      r.purchases += sign * Math.abs(n0(i.subtotal));
      byMonth.set(m, r);
    }
    for (const i of ar) {
      const m = day(i.invoiceDate)!.slice(0, 7);
      const r = bump(m);
      r.gstCollected += n0(i.gst);
      r.pstCollected += n0(i.pst);
      r.sales += n0(i.subtotal);
      byMonth.set(m, r);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, r]) => ({
        month,
        sales: cents(r.sales),
        gstCollected: cents(r.gstCollected),
        purchases: cents(r.purchases),
        gstPaidItc: cents(r.gstPaid),
        netGst: cents(r.gstCollected - r.gstPaid),
        pstPaid: cents(r.pstPaid),
        pstCollected: cents(r.pstCollected),
      }));
  }
  const ar = await db.arInvoice.findMany({ where: { organizationId: auth.orgId, companyId: { in: companies }, invoiceDate: range, status: { not: 'DRAFT' } }, include: arInclude, orderBy: { invoiceDate: 'asc' } });
  return ar.map((i) => ({
    invoice: i.invoiceNumber,
    customer: i.customer.name,
    job: i.site?.jobNumber ?? null,
    date: day(i.invoiceDate),
    due: day(i.dueDate),
    subtotal: n0(i.subtotal),
    gst: n0(i.gst),
    pst: n0(i.pst),
    total: n0(i.total),
    holdback: n0(i.holdbackAmount),
    paid: n0(i.amountPaid),
    balance: cents(n0(i.total) - n0(i.amountPaid)),
    status: i.status === 'VOID' ? 'VOID' : stateOf(i),
  }));
}

// ---------------------------------------------------------------------------
// Backup documents for customer invoices
// ---------------------------------------------------------------------------
async function backupsToAttach(invoiceId: string) {
  const files = await db.fileAsset.findMany({ where: { arInvoiceId: invoiceId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, sizeBytes: true } });
  const out: string[] = [];
  let total = 0;
  for (const f of files) {
    if (total + f.sizeBytes > 15 * 1_048_576) break;
    total += f.sizeBytes;
    out.push(f.id);
  }
  return out;
}

/** The network folder backup documents go to (from Admin › Network filing), for showing on screen. */
async function backupFolderFor(companyId: string, invoiceNumber: string, siteId: string | null) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { code: true, settings: true } });
  const f = filingOf(c?.settings);
  if (!f.enabled || !f.root || !f.types.includes('AR_BACKUP')) return null;
  const now = new Date();
  const vars: Record<string, string> = { company: c!.code, job: (await jobLabel(siteId)) ?? 'No job', year: String(now.getFullYear()), month: String(now.getMonth() + 1).padStart(2, '0'), vendor: 'Vendor', invoice: invoiceNumber };
  const pattern = f.folders.AR_BACKUP || FILING_DOC_TYPES.find((d) => d.key === 'AR_BACKUP')!.folder;
  return [f.root.replace(/[\\/]+$/, ''), pattern.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')].join('\\');
}

export async function addArBackup(auth: AuthContext, id: string, file: File) {
  const i = await loadAr(auth, id);
  const asset = await saveUpload({ organizationId: auth.orgId, companyId: i.companyId, uploadedById: auth.userId, kind: 'OTHER', file, maxBytes: 25 * 1_048_576 });
  await db.fileAsset.update({ where: { id: asset.id }, data: { arInvoiceId: id } });
  // Straight into the network folder chosen for backup documents.
  await fileDocument({ companyId: i.companyId, docType: 'AR_BACKUP', fileId: asset.id, vars: { job: await jobLabel(i.siteId), invoice: i.invoiceNumber } });
  await audit(db, auth, 'ar.backup_add', 'ArInvoice', id, null, { fileName: file.name });
  return getArInvoice(auth, id);
}

export async function removeArBackup(auth: AuthContext, id: string, fileId: string) {
  await loadAr(auth, id);
  const f = await db.fileAsset.findFirst({ where: { id: fileId, arInvoiceId: id, deletedAt: null } });
  if (!f) throw notFound('Backup document');
  await db.fileAsset.update({ where: { id: fileId }, data: { arInvoiceId: null } });
  await audit(db, auth, 'ar.backup_remove', 'ArInvoice', id, { fileName: f.fileName }, null);
  return getArInvoice(auth, id);
}
