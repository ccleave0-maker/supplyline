// Purchase orders against a job / project or a piece of equipment: drafts,
// numbering, tax (PST from the job's province or exemption), approval over the
// company limit, issuing (priced + packing-list PDFs and emails), cancelling,
// closing, and supplier follow-ups / yard "has it arrived?" prompts.

import QRCode from 'qrcode';
import { counterKeys, poTotals, qrPayload, taxProfile } from '@supplyline/core/domain';
import { formatListLabel } from '@supplyline/core/domain';
import {
  DEFAULT_PURCHASING,
  purchasingSettingsInput,
  type PoApprovalInput,
  type PoDashboard,
  type PoDetail,
  type PoInput,
  type PoStatus,
  type PoSummary,
  type PurchasingSettings,
} from '@supplyline/core/models';
import { can } from '@supplyline/core/permissions';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { isAdmin, requirePermission, type AuthContext } from '../lib/auth';
import { nextCounter } from '../lib/counters';
import { db, type Tx } from '../lib/db';
import { env } from '../lib/env';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { publish } from '../lib/events';
import { viaName } from '../integrations/email';
import { renderPoPdf, type PoPdfData } from '../pdf/po-pdf';
import { accessibleCompanyIds, assertCompanyAccessible } from './access';
import { priceRolesOf } from './companies';
import { fileUrl, logoForPdf, saveUpload } from './files';
import { fileDocument, jobLabel } from './filing';
import { recomputeLines } from './line-status';
import { appendPoDocuments, poDocuments, setPoDocuments } from './project-docs';
import { countReview, sendTemplated } from './mail';
import { recipientsFor } from './orders';
import { notifyJob } from './notify';
import { todayLocal } from './project';

const n = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : null);
const addDays = (v: string, k: number) => day(new Date(toDate(v)!.getTime() + k * 86_400_000))!;
const money = (x: number) => x.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
const appLink = (path: string) => `${env().APP_URL.replace(/\/$/, '')}${path}`;
const poLink = (id: string) => `/purchase-orders/view/?id=${id}`;

// ---------------------------------------------------------------------------
// Company purchasing settings (kept in Company.settings.purchasing)
// ---------------------------------------------------------------------------
export function purchasingOf(settings: unknown): PurchasingSettings {
  const raw = (settings as { purchasing?: unknown } | null)?.purchasing;
  const parsed = purchasingSettingsInput.partial().safeParse(raw ?? {});
  return { ...DEFAULT_PURCHASING, ...(parsed.success ? parsed.data : {}) } as PurchasingSettings;
}

export async function getPurchasingSettings(auth: AuthContext, companyId: string) {
  const c = await assertCompanyAccessible(auth, companyId);
  return purchasingOf(c.settings);
}

export async function savePurchasingSettings(auth: AuthContext, companyId: string, input: PurchasingSettings) {
  requirePermission(auth, 'company:edit');
  const c = await assertCompanyAccessible(auth, companyId);
  const settings = { ...((c.settings as Record<string, unknown>) ?? {}), purchasing: input };
  await db.company.update({ where: { id: companyId }, data: { settings } });
  await audit(db, auth, 'company.purchasing', 'Company', companyId, { purchasing: purchasingOf(c.settings) }, input);
  return input;
}

// ---------------------------------------------------------------------------
// PO numbers: suggested from a per-company counter; typing over it is fine
// ---------------------------------------------------------------------------
const poCounterKey = (companyId: string) => `po:${companyId}`;

export async function suggestPoNumber(auth: AuthContext, companyId: string): Promise<{ poNumber: string }> {
  requirePermission(auth, 'procurement:work');
  const c = await assertCompanyAccessible(auth, companyId);
  const s = purchasingOf(c.settings);
  const counter = await db.counter.findUnique({ where: { key: poCounterKey(companyId) } });
  let next = Math.max(s.poNextNumber, (counter?.value ?? 0) + 1);
  // Skip numbers already used (typed by hand).
  for (let i = 0; i < 50; i++) {
    const clash = await db.purchaseOrder.findFirst({ where: { companyId, poNumber: { equals: `${s.poPrefix}${next}`, mode: 'insensitive' } } });
    if (!clash) break;
    next++;
  }
  return { poNumber: `${s.poPrefix}${next}` };
}

/** If the number used looks like ours (prefix + digits), move the counter past it. */
async function recordPoNumber(tx: Tx, companyId: string, settings: PurchasingSettings, poNumber: string) {
  const rest = settings.poPrefix && poNumber.toLowerCase().startsWith(settings.poPrefix.toLowerCase()) ? poNumber.slice(settings.poPrefix.length) : poNumber;
  if (!/^\d{1,9}$/.test(rest)) return;
  const value = Number(rest);
  await tx.$executeRaw`INSERT INTO "Counter" ("key", "value") VALUES (${poCounterKey(companyId)}, ${value})
    ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Counter"."value", ${value})`;
}

// ---------------------------------------------------------------------------
// Loading and views
// ---------------------------------------------------------------------------
const poInclude = {
  company: true,
  vendor: { include: { contact: true } },
  site: {
    select: { id: true, jobNumber: true, name: true, province: true, address: true, city: true, pstExempt: true, pstExemptNumber: true, pstExemptionFileId: true, projectManagerId: true, companyId: true, pstExemptionFile: { select: { id: true, fileName: true } } },
  },
  equipment: { select: { id: true, unitNumber: true, description: true, pstExempt: true, pstExemptNumber: true, pstExemptionFileId: true, pstExemptionFile: { select: { id: true, fileName: true } } } },
  deliverTo: { select: { id: true, name: true, address: true, city: true, province: true } },
  lines: {
    orderBy: [{ lineNo: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
      orderLine: { select: { id: true, lineNo: true, orderFormId: true, siteId: true, orderForm: { select: { listNo: true, site: { select: { jobNumber: true } } } } } },
      yardReceiptLines: { select: { qtyReceived: true } },
    },
  },
  orderForm: { select: { id: true } },
} satisfies Prisma.PurchaseOrderInclude;
type PoFull = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>;

async function poWhere(auth: AuthContext): Promise<Prisma.PurchaseOrderWhereInput> {
  const or: Prisma.PurchaseOrderWhereInput[] = [{ site: { projectManagerId: auth.userId } }];
  if (can(auth, 'po:view')) or.push({ companyId: { in: await accessibleCompanyIds(auth) } });
  return { organizationId: auth.orgId, OR: or };
}

async function loadPo(auth: AuthContext, id: string): Promise<PoFull> {
  const po = await db.purchaseOrder.findFirst({ where: { AND: [{ id }, await poWhere(auth)] }, include: poInclude });
  if (!po) throw notFound('PO');
  return po;
}

const targetLabel = (po: Pick<PoFull, 'site' | 'equipment'>) =>
  po.site ? `JOB#${po.site.jobNumber} ${po.site.name}` : po.equipment ? `Unit ${po.equipment.unitNumber} · ${po.equipment.description}` : '—';

/** Tax: the job's province and exemption; equipment uses its own exemption and the delivery province. */
function liveTax(po: Pick<PoFull, 'site' | 'equipment' | 'deliverTo'>) {
  if (po.site) return { ...taxProfile(po.site.province, po.site.pstExempt), pstExempt: po.site.pstExempt };
  const exempt = po.equipment?.pstExempt ?? false;
  return { ...taxProfile(po.deliverTo?.province ?? 'BC', exempt), pstExempt: exempt };
}

function rates(po: PoFull) {
  if (po.status === 'DRAFT' || po.status === 'PENDING_APPROVAL' || po.gstRate == null) {
    const t = liveTax(po);
    return { province: t.province, gstRate: t.gstRate, pstRate: t.pstRate, hstRate: t.hstRate, pstExempt: t.pstExempt, label: t.label };
  }
  const t = taxProfile(po.taxProvince, po.pstExempt);
  return { province: po.taxProvince, gstRate: n(po.gstRate), pstRate: n(po.pstRate), hstRate: n(po.hstRate), pstExempt: po.pstExempt, label: t.label };
}

const lineReceived = (l: PoFull['lines'][number]) => l.yardReceiptLines.reduce((a, r) => a + n(r.qtyReceived), 0);

function receivedState(po: PoFull): PoSummary['received'] {
  const got = po.lines.map((l) => [lineReceived(l), n(l.qty)] as const);
  if (got.every(([r, q]) => r >= q - 1e-6)) return po.lines.length ? 'FULL' : 'NONE';
  return got.some(([r]) => r > 0) ? 'PART' : 'NONE';
}

function canSeePrices(auth: AuthContext, po: Pick<PoFull, 'company' | 'site'>) {
  return can(auth, 'procurement:work') || auth.roles.some((r) => priceRolesOf(po.company.settings).includes(r)) || po.site?.projectManagerId === auth.userId;
}
function canApprove(auth: AuthContext, po: Pick<PoFull, 'site'>) {
  return isAdmin(auth) || (!!po.site && po.site.projectManagerId === auth.userId);
}

function totalsOf(po: PoFull) {
  const r = rates(po);
  return poTotals(po.lines.map((l) => ({ qty: n(l.qty), unitCost: l.unitCost == null ? null : n(l.unitCost) })), r);
}

function toSummary(auth: AuthContext, po: PoFull): PoSummary {
  const today = todayLocal();
  const received = receivedState(po);
  return {
    id: po.id,
    poNumber: po.poNumber,
    companyId: po.companyId,
    companyName: po.company.name,
    vendorName: po.vendor.name,
    status: po.status,
    target: targetLabel(po),
    siteId: po.siteId,
    equipmentId: po.equipmentId,
    orderedDate: day(po.orderedDate),
    expectedDate: day(po.expectedDate),
    lineCount: po.lines.length,
    totals: canSeePrices(auth, po) ? totalsOf(po) : null,
    received,
    overdue: po.status === 'ISSUED' && !!po.expectedDate && day(po.expectedDate)! < today && received !== 'FULL',
    awaitingMyApproval: po.status === 'PENDING_APPROVAL' && canApprove(auth, po),
  };
}

async function toDetail(auth: AuthContext, po: PoFull): Promise<PoDetail> {
  const show = canSeePrices(auth, po);
  const r = rates(po);
  const settings = purchasingOf(po.company.settings);
  const subtotal = totalsOf(po).subtotal;
  const people = await db.user.findMany({ where: { id: { in: [po.approvedById, po.issuedById].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const exemption = po.site ?? po.equipment;
  const work = can(auth, 'procurement:work');
  const nothingReceived = po.lines.every((l) => l.yardReceiptLines.length === 0);
  return {
    ...toSummary(auth, po),
    vendor: {
      id: po.vendor.id,
      name: po.vendor.name,
      contactId: po.vendor.contactId,
      contactName: po.vendor.contact?.name ?? null,
      email: po.vendor.contact?.email ?? null,
      phone: po.vendor.contact?.cell ?? po.vendor.contact?.phone ?? null,
    },
    deliverTo: po.deliverTo ? { id: po.deliverTo.id, name: po.deliverTo.name } : null,
    shipToText: po.shipToText,
    notes: po.notes,
    lines: po.lines.map((l, i) => {
      const unit = l.unitCost == null ? null : n(l.unitCost);
      return {
        id: l.id,
        lineNo: l.lineNo ?? i + 1,
        orderLineId: l.orderLineId,
        orderLabel: l.orderLine ? `${formatListLabel(l.orderLine.orderForm.site.jobNumber, l.orderLine.orderForm.listNo)} L${l.orderLine.lineNo}` : null,
        orderId: l.orderLine?.orderFormId ?? null,
        description: l.description ?? '',
        qty: n(l.qty),
        uom: l.uom ?? 'EA',
        unitCost: show ? unit : null,
        extended: show && unit != null ? Math.round(n(l.qty) * unit * 100) / 100 : null,
        received: lineReceived(l),
        offListReason: l.offListReason,
      };
    }),
    tax: {
      ...r,
      exemptionNumber: r.pstExempt ? (exemption?.pstExemptNumber ?? null) : null,
      exemptionFile: r.pstExempt && exemption?.pstExemptionFile ? { id: exemption.pstExemptionFile.id, fileName: exemption.pstExemptionFile.fileName, url: fileUrl(exemption.pstExemptionFile.id)! } : null,
    },
    approval: {
      limit: show ? settings.approvalLimit : null,
      required: settings.approvalLimit != null && subtotal > settings.approvalLimit,
      approvedByName: name(po.approvedById),
      approvedAt: po.approvedAt?.toISOString() ?? null,
      note: po.approvalNote,
    },
    emailVendor: po.emailVendor,
    vendorSentAt: po.vendorSentAt?.toISOString() ?? null,
    issuedAt: po.issuedAt?.toISOString() ?? null,
    issuedByName: name(po.issuedById),
    followUpQueuedAt: po.followUpQueuedAt?.toISOString() ?? null,
    madeListId: po.orderForm?.id ?? null,
    ...(await poExtras(po)),
    showPrices: show,
    revision: po.revision,
    documents: (await poDocuments(po.id)).map((d) => ({ id: d.id, linkName: d.linkName, url: d.url })),
    shipping: await (await import('./po-bol')).poShipping(auth, po.id),
    completedAt: po.completedAt?.toISOString() ?? null,
    can: {
      edit: work && ['DRAFT', 'PENDING_APPROVAL', 'ISSUED'].includes(po.status),
      changeEta: work && ['DRAFT', 'PENDING_APPROVAL', 'ISSUED'].includes(po.status),
      reopen: isAdmin(auth) && po.status === 'CLOSED',
      issue: work && po.status === 'DRAFT' && po.lines.length > 0,
      approve: po.status === 'PENDING_APPROVAL' && canApprove(auth, po),
      cancel: work && (po.status === 'DRAFT' || po.status === 'PENDING_APPROVAL' || (po.status === 'ISSUED' && nothingReceived)),
      close: isAdmin(auth) && po.status === 'ISSUED',
      sendToVendor: work && po.status === 'ISSUED',
    },
  };
}

export async function getPo(auth: AuthContext, id: string) {
  return toDetail(auth, await loadPo(auth, id));
}

export async function listPos(
  auth: AuthContext,
  f: { show?: 'open' | 'drafts' | 'approval' | 'overdue' | 'all'; q?: string; siteId?: string; equipmentId?: string; companyId?: string },
): Promise<PoSummary[]> {
  const status: PoStatus[] | undefined =
    f.show === 'drafts' ? ['DRAFT'] : f.show === 'approval' ? ['PENDING_APPROVAL'] : f.show === 'all' ? undefined : f.show === 'overdue' ? ['ISSUED'] : ['DRAFT', 'PENDING_APPROVAL', 'ISSUED'];
  const q = f.q?.trim();
  const rows = await db.purchaseOrder.findMany({
    where: {
      AND: [
        await poWhere(auth),
        status ? { status: { in: status } } : {},
        f.siteId ? { siteId: f.siteId } : {},
        f.equipmentId ? { equipmentId: f.equipmentId } : {},
        f.companyId ? { companyId: f.companyId } : {},
        q ? { OR: [{ poNumber: { contains: q, mode: 'insensitive' } }, { vendor: { name: { contains: q, mode: 'insensitive' } } }, { lines: { some: { description: { contains: q, mode: 'insensitive' } } } }] } : {},
      ],
    },
    include: poInclude,
    orderBy: [{ createdAt: 'desc' }],
    take: 300,
  });
  let list = rows.map((po) => toSummary(auth, po));
  if (f.show === 'overdue') list = list.filter((p) => p.overdue);
  if (!f.show || f.show === 'open') list = list.filter((p) => !(p.status === 'ISSUED' && p.received === 'FULL'));
  return list;
}

export async function poDashboard(auth: AuthContext): Promise<PoDashboard> {
  const open = await listPos(auth, { show: 'open' });
  const today = todayLocal();
  const week = addDays(today, 7);
  return {
    overdue: open.filter((p) => p.overdue).length,
    dueThisWeek: open.filter((p) => p.status === 'ISSUED' && p.expectedDate && p.expectedDate >= today && p.expectedDate <= week && p.received !== 'FULL').length,
    waitingApproval: open.filter((p) => p.status === 'PENDING_APPROVAL').length,
    awaitingMyApproval: open.filter((p) => p.awaitingMyApproval).length,
    drafts: open.filter((p) => p.status === 'DRAFT').length,
    emailsToReview: await countReview(auth),
  };
}

// ---------------------------------------------------------------------------
// Create / edit drafts
// ---------------------------------------------------------------------------
async function resolveVendor(tx: Tx, auth: AuthContext, companyId: string, name: string, contactId: string | null | undefined) {
  if (contactId && !(await tx.contact.findFirst({ where: { id: contactId, organizationId: auth.orgId } }))) throw badRequest('Vendor contact not found.');
  let vendor = await tx.vendor.findFirst({ where: { companyId, name: { equals: name, mode: 'insensitive' } } });
  vendor ??= await tx.vendor.create({ data: { companyId, name, contactId: contactId ?? null } });
  if (contactId && vendor.contactId !== contactId) vendor = await tx.vendor.update({ where: { id: vendor.id }, data: { contactId } });
  return vendor;
}

async function checkTarget(auth: AuthContext, input: PoInput) {
  // "Procurement is king", within what the admin set (Admin › Access & menu, and each person's scope).
  if (!isAdmin(auth)) {
    if (auth.access?.poOwnUnitOnly && auth.activeCompanyId && input.companyId !== auth.activeCompanyId) {
      const other = await db.company.findUnique({ where: { id: input.companyId }, select: { name: true } });
      throw forbidden(`You're working in another business unit. Switch to ${other?.name ?? 'that company'} (top of the screen) to cut a PO for it.`);
    }
    if (auth.procurementScope === 'EQUIPMENT' && !input.equipmentId) throw forbidden('You can only buy for equipment. Ask an admin to change what you can order.');
    if (auth.procurementScope === 'JOBS' && !input.siteId) throw forbidden('You can only buy for jobs / projects. Ask an admin to change what you can order.');
  }
  if (input.siteId) {
    const site = await db.site.findFirst({ where: { id: input.siteId, organizationId: auth.orgId } });
    if (!site || site.type !== 'JOB' || site.companyId !== input.companyId) throw badRequest('Pick a job / project of this company.');
  }
  if (input.equipmentId) {
    const e = await db.equipment.findFirst({ where: { id: input.equipmentId, organizationId: auth.orgId } });
    if (!e || e.companyId !== input.companyId) throw badRequest('Pick a unit of this company.');
  }
  if (input.deliverToYardId) {
    const y = await db.site.findFirst({ where: { id: input.deliverToYardId, organizationId: auth.orgId, type: 'YARD', yardCompanies: { some: { companyId: input.companyId } } } });
    if (!y) throw badRequest('That yard does not serve this company.');
  }
  if (input.shipViaId && !(await db.shipVia.findFirst({ where: { id: input.shipViaId, organizationId: auth.orgId } }))) throw badRequest('Pick a carrier from the Ship via list.');
  if (input.shipToLocationId && !(await db.shippingLocation.findFirst({ where: { id: input.shipToLocationId, organizationId: auth.orgId } }))) throw badRequest('Pick a ship-to location.');
  const contactIds = [input.siteContact1Id, input.siteContact2Id, input.supplierContactId].filter((x): x is string => !!x);
  if (contactIds.length && (await db.contact.count({ where: { id: { in: contactIds }, organizationId: auth.orgId } })) !== new Set(contactIds).size) throw badRequest('One of the contacts is not in Contacts.');
  if (input.shipDirect && !input.siteId) throw badRequest('Ship direct is for job POs (the vendor delivers to the job).');
  const linked = input.lines.map((l) => l.orderLineId).filter((x): x is string => !!x);
  if (linked.length) {
    if (!input.siteId) throw badRequest('Order-list lines can only go on a job PO.');
    const ok = await db.orderLine.count({ where: { id: { in: linked }, siteId: input.siteId, cancelledAt: null } });
    if (ok !== new Set(linked).size) throw badRequest('Some order-list lines are not open lines on this job.');
  }
}

function poData(input: PoInput) {
  return {
    siteId: input.siteId ?? null,
    equipmentId: input.equipmentId ?? null,
    orderedDate: toDate(input.orderedDate),
    expectedDate: toDate(input.expectedDate),
    deliverToYardId: input.deliverToYardId ?? null,
    shipToText: input.shipToText ?? null,
    shipViaId: input.shipViaId ?? null,
    shipToLocationId: input.shipToLocationId ?? null,
    siteContact1Id: input.siteContact1Id ?? null,
    siteContact2Id: input.siteContact2Id ?? null,
    supplierContactId: input.supplierContactId ?? null,
    shipDirect: !!input.shipDirect && !!input.siteId,
    notes: input.notes ?? null,
  };
}

/**
 * Save the PO's lines. Lines keep their identity (by id), so a committed PO can be
 * edited without losing what's been received or invoiced against it.
 */
async function writeLines(tx: Tx, poId: string, input: PoInput, oldExpected: Date | null = null) {
  const existing = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: poId }, include: { yardReceiptLines: { select: { qtyReceived: true } }, _count: { select: { apLines: true } } } });
  const keep = new Set(input.lines.map((l) => l.id).filter((x): x is string => !!x));
  for (const e of existing) {
    if (keep.has(e.id)) continue;
    const used = e.yardReceiptLines.length > 0 || e._count.apLines > 0 || (await tx.inventoryLot.count({ where: { purchaseOrderLineId: e.id } })) > 0;
    if (used) throw conflict(`Line ${e.lineNo} (${e.description}) has been received or invoiced, so it can’t be removed. Change its quantity instead.`);
    await tx.purchaseOrderLine.delete({ where: { id: e.id } });
  }
  // Move kept lines out of the way while renumbering.
  await tx.purchaseOrderLine.updateMany({ where: { purchaseOrderId: poId }, data: { lineNo: { increment: 10000 } } });
  const eta = toDate(input.expectedDate);
  for (const [i, l] of input.lines.entries()) {
    const data = {
      lineNo: i + 1,
      orderLineId: l.orderLineId ?? null,
      description: l.description,
      qty: l.qty,
      uom: l.uom,
      unitCost: l.unitCost ?? null,
      offListReason: l.orderLineId ? null : (l.offListReason ?? null),
      costCode: l.costCode || null,
    };
    const e = l.id ? existing.find((x) => x.id === l.id) : undefined;
    if (e) {
      const received = e.yardReceiptLines.reduce((t, r) => t + Number(r.qtyReceived), 0);
      if (l.qty + 1e-6 < received) throw conflict(`Line ${i + 1}: ${received} already received — the quantity can’t go below that.`);
      // A line's own ETA follows the PO's unless someone set it separately.
      const follows = !e.vendorEta || (oldExpected && e.vendorEta.getTime() === oldExpected.getTime());
      await tx.purchaseOrderLine.update({ where: { id: e.id }, data: { ...data, ...(follows ? { vendorEta: eta } : {}) } });
    } else await tx.purchaseOrderLine.create({ data: { ...data, purchaseOrderId: poId, vendorEta: eta } });
  }
}

export async function createPo(auth: AuthContext, input: PoInput) {
  requirePermission(auth, 'procurement:work');
  const company = await assertCompanyAccessible(auth, input.companyId);
  await checkTarget(auth, input);
  const settings = purchasingOf(company.settings);
  const id = await db.$transaction(async (tx) => {
    const clash = await tx.purchaseOrder.findFirst({ where: { companyId: input.companyId, poNumber: { equals: input.poNumber, mode: 'insensitive' } } });
    if (clash) throw conflict(`PO ${input.poNumber} already exists. Use the next number or open that PO.`);
    const vendor = await resolveVendor(tx, auth, input.companyId, input.vendorName, input.vendorContactId);
    const po = await tx.purchaseOrder.create({
      data: {
        ...poData(input),
        organizationId: auth.orgId,
        companyId: input.companyId,
        poNumber: input.poNumber,
        vendorId: vendor.id,
        status: 'DRAFT',
        emailVendor: input.emailVendor ?? settings.emailVendorDefault,
        createdById: auth.userId,
      },
    });
    await writeLines(tx, po.id, input);
    await recordPoNumber(tx, input.companyId, settings, input.poNumber);
    await audit(tx, auth, 'po.create', 'PurchaseOrder', po.id, null, input);
    return po.id;
  });
  if (input.documentIds?.length) await setPoDocuments(id, input.siteId ?? null, input.documentIds);
  return getPo(auth, id);
}

/** Full edit — before it's committed, and after (each edit after committing is a new revision). */
export async function updatePo(auth: AuthContext, id: string, input: PoInput) {
  requirePermission(auth, 'procurement:work');
  const po = await loadPo(auth, id);
  if (!['DRAFT', 'PENDING_APPROVAL', 'ISSUED'].includes(po.status)) throw conflict(`A ${po.status === 'CLOSED' ? 'complete' : 'cancelled'} PO can’t be edited.${po.status === 'CLOSED' ? ' An admin can reopen it.' : ''}`);
  if (input.companyId !== po.companyId) throw badRequest("A PO's company can't be changed.");
  await checkTarget(auth, input);
  const settings = purchasingOf(po.company.settings);
  const committed = po.status === 'ISSUED';
  if (committed && settings.approvalLimit != null) {
    const newSub = poTotals(input.lines.map((l) => ({ qty: l.qty, unitCost: l.unitCost ?? null })), rates(po)).subtotal;
    const oldSub = totalsOf(po).subtotal;
    if (newSub > settings.approvalLimit && newSub > oldSub + 0.005 && !canApprove(auth, po))
      throw conflict(`This change takes the PO over the approval limit ($${settings.approvalLimit.toLocaleString('en-CA')}). Ask an admin or the job’s PM to make it.`);
  }
  const oldEta = day(po.expectedDate);
  const newEta = input.expectedDate ?? null;
  await db.$transaction(async (tx) => {
    if (input.poNumber.toLowerCase() !== po.poNumber.toLowerCase()) {
      const clash = await tx.purchaseOrder.findFirst({ where: { companyId: po.companyId, poNumber: { equals: input.poNumber, mode: 'insensitive' }, id: { not: id } } });
      if (clash) throw conflict(`PO ${input.poNumber} already exists.`);
      await recordPoNumber(tx, po.companyId, settings, input.poNumber);
    }
    const vendor = await resolveVendor(tx, auth, po.companyId, input.vendorName, input.vendorContactId);
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        ...poData(input),
        poNumber: input.poNumber,
        vendorId: vendor.id,
        emailVendor: input.emailVendor ?? po.emailVendor,
        approvalNote: null,
        // Edited while waiting for approval: back to Pending, to be sent again.
        ...(po.status === 'PENDING_APPROVAL' ? { status: 'DRAFT' as const } : {}),
        ...(committed ? { revision: { increment: 1 } } : {}),
        ...(oldEta !== newEta ? { overdueNotifiedAt: null } : {}),
      },
    });
    await writeLines(tx, id, input, po.expectedDate);
    await audit(tx, auth, committed ? 'po.revise' : 'po.update', 'PurchaseOrder', id, committed ? { revision: po.revision, expectedDate: oldEta, lines: po.lines.map((l) => ({ id: l.id, description: l.description, qty: Number(l.qty), unitCost: l.unitCost == null ? null : Number(l.unitCost) })) } : null, input);
    if (oldEta !== newEta) await audit(tx, auth, 'po.eta_change', 'PurchaseOrder', id, { expectedDate: oldEta }, { expectedDate: newEta });
    if (committed) await recomputeLines(tx, [...po.lines.map((l) => l.orderLineId), ...input.lines.map((l) => l.orderLineId)].filter((x): x is string => !!x));
  });
  if (input.documentIds !== undefined) await setPoDocuments(id, input.siteId ?? null, input.documentIds);
  if (po.site) publish(auth.orgId, { type: 'order.changed', orderId: po.orderForm?.id ?? '', siteId: po.site.id, companyId: po.companyId });
  return getPo(auth, id);
}

/** Change just the expected delivery date (any time before the PO is complete). Re-arms the chase-up. */
export async function setPoEta(auth: AuthContext, id: string, expectedDate: string | null) {
  requirePermission(auth, 'procurement:work');
  const po = await loadPo(auth, id);
  if (!['DRAFT', 'PENDING_APPROVAL', 'ISSUED'].includes(po.status)) throw conflict('This PO is finished — its ETA can’t change.');
  const oldEta = day(po.expectedDate);
  if (oldEta === expectedDate) return getPo(auth, id);
  const eta = toDate(expectedDate);
  await db.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id }, data: { expectedDate: eta, overdueNotifiedAt: null } });
    // Lines that followed the PO's ETA follow the new one.
    await tx.purchaseOrderLine.updateMany({ where: { purchaseOrderId: id, OR: [{ vendorEta: null }, ...(po.expectedDate ? [{ vendorEta: po.expectedDate }] : [])] }, data: { vendorEta: eta } });
    await audit(tx, auth, 'po.eta_change', 'PurchaseOrder', id, { expectedDate: oldEta }, { expectedDate });
  });
  if (po.site) publish(auth.orgId, { type: 'order.changed', orderId: po.orderForm?.id ?? '', siteId: po.site.id, companyId: po.companyId });
  return getPo(auth, id);
}

export async function deleteDraftPo(auth: AuthContext, id: string) {
  requirePermission(auth, 'procurement:work');
  const po = await loadPo(auth, id);
  if (po.status !== 'DRAFT') throw conflict('Only drafts can be deleted. Cancel an issued PO instead.');
  await db.$transaction(async (tx) => {
    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
    await tx.purchaseOrder.delete({ where: { id } });
    await audit(tx, auth, 'po.delete_draft', 'PurchaseOrder', id, { poNumber: po.poNumber }, null);
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Issue (with approval over the limit)
// ---------------------------------------------------------------------------
export async function issuePo(auth: AuthContext, id: string, opts: { emailVendor?: boolean; fromBuying?: boolean } = {}) {
  requirePermission(auth, 'procurement:work');
  const po = await loadPo(auth, id);
  if (po.status !== 'DRAFT') throw conflict('This PO has already been issued.');
  if (!po.lines.length) throw badRequest('Add at least one line.');
  if (!opts.fromBuying && po.lines.some((l) => l.unitCost == null) && purchasingOf(po.company.settings).approvalLimit != null) {
    // Without prices the approval limit can't be checked.
    throw badRequest('Enter a unit price on every line before issuing (needed for the approval limit).');
  }
  if (opts.emailVendor !== undefined) await db.purchaseOrder.update({ where: { id }, data: { emailVendor: opts.emailVendor } });
  const limit = purchasingOf(po.company.settings).approvalLimit;
  const subtotal = totalsOf(po).subtotal;
  if (limit != null && subtotal > limit && !canApprove(auth, po)) {
    await db.purchaseOrder.update({ where: { id }, data: { status: 'PENDING_APPROVAL', issuedById: auth.userId } });
    await audit(db, auth, 'po.approval_requested', 'PurchaseOrder', id, null, { subtotal, limit });
    await requestApproval(auth, await loadPo(auth, id), subtotal, limit);
    return getPo(auth, id);
  }
  const selfApproved = limit != null && subtotal > limit;
  await finalizeIssue(auth, id, selfApproved ? { approvedById: auth.userId, approvedAt: new Date() } : {});
  return getPo(auth, id);
}

async function approvers(po: PoFull) {
  const admins = await db.user.findMany({ where: { organizationId: po.organizationId, active: true, deletedAt: null, roles: { has: 'ADMIN' } }, select: { id: true, email: true } });
  const pm = po.site?.projectManagerId ? await db.user.findUnique({ where: { id: po.site.projectManagerId }, select: { id: true, email: true, active: true } }) : null;
  return [...admins, ...(pm?.active ? [pm] : [])].filter((u, i, all) => all.findIndex((x) => x.id === u.id) === i);
}

function vars(po: PoFull, senderName: string, extra: Record<string, string> = {}) {
  const t = rates(po);
  const exemption = po.site ?? po.equipment;
  return {
    poNumber: po.poNumber,
    companyName: po.company.name,
    vendorName: po.vendor.name,
    vendorContact: po.vendor.contact?.name ?? po.vendor.name,
    target: targetLabel(po),
    orderedDate: day(po.orderedDate) ?? 'today',
    expectedDate: day(po.expectedDate) ?? 'as soon as possible',
    deliverTo: deliverToLabel(po),
    pstNote: t.pstExempt ? `PST exempt${exemption?.pstExemptNumber ? ` – exemption # ${exemption.pstExemptNumber}` : ''}${exemption?.pstExemptionFileId ? ' (exemption form attached)' : ''}.` : '',
    total: money(totalsOf(po).total),
    senderName,
    link: appLink(poLink(po.id)),
    ...extra,
  };
}

function deliverToLabel(po: Pick<PoFull, 'deliverTo' | 'site' | 'equipment'>) {
  if (po.deliverTo) return [po.deliverTo.name, po.deliverTo.address, po.deliverTo.city].filter(Boolean).join(', ');
  if (po.site) return [`JOB#${po.site.jobNumber} ${po.site.name}`, po.site.address, po.site.city].filter(Boolean).join(', ');
  return 'See notes';
}

async function requestApproval(auth: AuthContext, po: PoFull, subtotal: number, limit: number) {
  const people = await approvers(po);
  if (!people.length) return;
  await db.notification.createMany({
    data: people.map((p) => ({ userId: p.id, type: 'po_approval', title: `Approve PO ${po.poNumber}?`, body: `${po.vendor.name} · ${targetLabel(po)} · ${money(subtotal)} before tax`, link: poLink(po.id) })),
  });
  await sendTemplated({
    organizationId: po.organizationId,
    companyId: po.companyId,
    key: 'PO_APPROVAL_REQUEST',
    vars: vars(po, auth.name, { limit: money(limit), total: `${money(subtotal)} before tax` }),
    to: people.map((p) => p.email),
    fromName: viaName(auth.name),
    replyTo: auth.email,
    relatedType: 'purchase_order',
    relatedId: po.id,
  });
}

export async function decideApproval(auth: AuthContext, id: string, input: PoApprovalInput) {
  const po = await loadPo(auth, id);
  if (po.status !== 'PENDING_APPROVAL') throw conflict('This PO is not waiting for approval.');
  if (!canApprove(auth, po)) throw forbidden('Only an admin or the job’s project manager can approve this PO.');
  if (input.approve) {
    await audit(db, auth, 'po.approve', 'PurchaseOrder', id, null, input);
    const issuer = po.issuedById ? await db.user.findUnique({ where: { id: po.issuedById } }) : null;
    await finalizeIssue(issuer ? { ...auth, userId: issuer.id, name: issuer.name, email: issuer.email } : auth, id, { approvedById: auth.userId, approvedAt: new Date(), approvalNote: input.note ?? null });
  } else {
    await db.purchaseOrder.update({ where: { id }, data: { status: 'DRAFT', approvalNote: input.note ?? 'Sent back without a note.' } });
    await audit(db, auth, 'po.reject', 'PurchaseOrder', id, null, input);
    const who = po.issuedById ?? po.createdById;
    if (who)
      await db.notification.create({
        data: { userId: who, type: 'po_rejected', title: `PO ${po.poNumber} sent back`, body: input.note ?? `${auth.name} didn't approve it.`, link: poLink(id) },
      });
  }
  return getPo(auth, id);
}

/** Make the PO real: tax snapshot, order lines for typed job lines, status ISSUED, PDFs filed, emails out. */
async function finalizeIssue(auth: AuthContext, id: string, approval: { approvedById?: string; approvedAt?: Date; approvalNote?: string | null }) {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id }, include: poInclude });
  const t = liveTax(po);
  const orderLineIds: string[] = [];
  let madeOrderId: string | null = null;
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text FROM "PurchaseOrder" WHERE "id" = ${id} FOR UPDATE`;
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(locked[0]?.status ?? '')) throw conflict('This PO has already been issued.');
    // Lines typed straight onto a job PO become an order list on that job, so they show on
    // site inventory and flow through the yard, BOLs and site receiving like everything else.
    const typed = po.lines.filter((l) => !l.orderLineId);
    if (po.site && typed.length) {
      const now = new Date();
      // Off-list buys tag onto the most recent list the job submitted (reason shown on the list);
      // a job with no list yet gets one made from this PO.
      const latest = await tx.orderForm.findFirst({ where: { siteId: po.site.id, status: { notIn: ['DRAFT', 'CANCELLED'] }, sourcePurchaseOrderId: null }, orderBy: { submittedAt: 'desc' } });
      const form =
        latest ??
        (await tx.orderForm.create({
        data: {
          organizationId: po.organizationId,
          companyId: po.companyId,
          siteId: po.site.id,
          listNo: await nextCounter(tx, counterKeys.jobList(po.site.id)),
          companySeq: await nextCounter(tx, counterKeys.companyOrder(po.companyId)),
          status: 'SUBMITTED',
          createdById: auth.userId,
          submittedById: auth.userId,
          submittedAt: now,
          notes: `From PO ${po.poNumber} (${po.vendor.name})`,
          sourcePurchaseOrderId: po.id,
        },
      }));
      if (!latest) madeOrderId = form.id;
      const startAt = latest ? ((await tx.orderLine.aggregate({ where: { orderFormId: form.id }, _max: { lineNo: true } }))._max.lineNo ?? 0) : 0;
      const initials = auth.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || 'PO';
      for (const [i, l] of typed.entries()) {
        const ol = await tx.orderLine.create({
          data: {
            organizationId: po.organizationId,
            companyId: po.companyId,
            siteId: po.site.id,
            orderFormId: form.id,
            lineNo: startAt + i + 1,
            addedFromPoId: po.id,
            offListReason: l.offListReason ?? `Bought off-list on PO ${po.poNumber}`,
            description: l.description ?? '',
            quantity: l.qty,
            uom: l.uom ?? 'EA',
            orderedByInitials: initials,
            requiredOnSite: po.expectedDate,
            unitCost: l.unitCost,
            status: 'SUBMITTED',
            statusChangedAt: now,
            siteInventory: { create: { siteId: po.site.id, qtyOrdered: l.qty } },
          },
        });
        await tx.purchaseOrderLine.update({ where: { id: l.id }, data: { orderLineId: ol.id } });
        orderLineIds.push(ol.id);
      }
    }
    for (const l of po.lines) if (l.orderLineId) {
      orderLineIds.push(l.orderLineId);
      if (l.unitCost != null) await tx.orderLine.update({ where: { id: l.orderLineId }, data: { unitCost: l.unitCost } });
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: 'ISSUED',
        issuedAt: new Date(),
        issuedById: auth.userId,
        orderedDate: po.orderedDate ?? toDate(todayLocal()),
        pstExempt: t.pstExempt,
        taxProvince: t.province,
        gstRate: t.gstRate,
        pstRate: t.pstRate,
        hstRate: t.hstRate,
        ...approval,
      },
    });
    await recomputeLines(tx, orderLineIds);
    await audit(tx, auth, 'po.issue', 'PurchaseOrder', id, null, { madeOrderId, approval });
  });
  // Ship direct: the vendor delivers to the job — make the BOL (with the ETA) and tell the site.
  if (po.shipDirect && po.siteId) {
    try {
      const { shipDirectFromPo } = await import('./po-bol');
      await shipDirectFromPo(auth, id);
    } catch (e) {
      console.error('[po] ship-direct BOL failed', e);
    }
  }
  if (po.site) publish(auth.orgId, { type: 'order.changed', orderId: madeOrderId ?? '', siteId: po.site.id, companyId: po.companyId });
  await sendIssueEmails(auth, id);
}

// ---------------------------------------------------------------------------
// PDFs and the "PO cut" emails
// ---------------------------------------------------------------------------
async function pdfData(po: PoFull): Promise<PoPdfData> {
  const t = rates(po);
  const exemption = po.site ?? po.equipment;
  const issuer = po.issuedById ? await db.user.findUnique({ where: { id: po.issuedById }, select: { name: true } }) : null;
  return {
    poNumber: po.poNumber,
    qr: await QRCode.toBuffer(qrPayload({ kind: 'PO', id: po.id, label: `PO ${po.poNumber}` }), { type: 'png', margin: 1, width: 260 }),
    status: po.status,
    companyName: po.company.name,
    companyCode: po.company.code,
    themeColor: po.company.themeColor,
    logo: await logoForPdf(po.company.logoFileId),
    vendor: { name: po.vendor.name, contactName: po.vendor.contact?.name ?? null, email: po.vendor.contact?.email ?? null, phone: po.vendor.contact?.phone ?? po.vendor.contact?.cell ?? null },
    target: targetLabel(po),
    orderedDate: day(po.orderedDate),
    expectedDate: day(po.expectedDate),
    deliverTo: deliverToLabel(po),
    shipToText: po.shipToText,
    ...(await pdfExtras(po)),
    notes: po.notes,
    issuedByName: issuer?.name ?? null,
    lines: po.lines.map((l, i) => {
      const unit = l.unitCost == null ? null : n(l.unitCost);
      return {
        lineNo: l.lineNo ?? i + 1,
        ref: l.orderLine ? `${formatListLabel(l.orderLine.orderForm.site.jobNumber, l.orderLine.orderForm.listNo)} L${l.orderLine.lineNo}` : null,
        description: l.description ?? '',
        qty: n(l.qty),
        uom: l.uom ?? 'EA',
        unitCost: unit,
        extended: unit == null ? null : Math.round(n(l.qty) * unit * 100) / 100,
      };
    }),
    totals: totalsOf(po),
    rates: { gst: t.gstRate, pst: t.pstRate, hst: t.hstRate },
    taxNote: t.pstExempt ? `PST EXEMPT${exemption?.pstExemptNumber ? ` – exemption # ${exemption.pstExemptNumber}` : ''}${exemption?.pstExemptionFileId ? ' – exemption form attached' : ''}` : null,
  };
}

export async function getPoPdf(auth: AuthContext, id: string, packing: boolean) {
  const po = await loadPo(auth, id);
  if (!packing && !canSeePrices(auth, po)) throw forbidden('You can see the packing list for this PO, but not the prices.');
  const bytes = await withDocuments(await renderPoPdf(await pdfData(po), packing), po.id, packing);
  return { bytes, fileName: `${packing ? 'Packing-list' : 'PO'}-${po.poNumber.replace(/[^\w-]+/g, '-')}.pdf` };
}

/** The priced PO (supplier and internal copies) carries its project documents at the end. */
const withDocuments = async (bytes: Uint8Array | Buffer, poId: string, packing: boolean) => (packing ? new Uint8Array(bytes) : appendPoDocuments(new Uint8Array(bytes), poId));

async function filePdf(po: PoFull, userId: string, packing: boolean) {
  const bytes = await withDocuments(await renderPoPdf(await pdfData(po), packing), po.id, packing);
  const asset = await saveUpload({
    organizationId: po.organizationId,
    companyId: po.companyId,
    uploadedById: userId,
    kind: 'PO_PDF',
    file: new File([new Uint8Array(bytes)], `${packing ? 'Packing-list' : 'PO'}-${po.poNumber.replace(/[^\w-]+/g, '-')}.pdf`, { type: 'application/pdf' }),
    maxBytes: 20 * 1_048_576,
  });
  return asset.id;
}

async function receiversFor(po: PoFull) {
  if (po.deliverToYardId) return recipientsFor(po.companyId, po.deliverToYardId, 'YARD');
  if (po.site) {
    const members = await db.user.findMany({ where: { active: true, deletedAt: null, memberships: { some: { siteId: po.site.id } } }, select: { email: true } });
    return members.map((m) => m.email);
  }
  return [];
}

async function sendIssueEmails(auth: AuthContext, id: string) {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id }, include: poInclude });
  let priced: string | null = null;
  let packing: string | null = null;
  try {
    priced = await filePdf(po, auth.userId, false);
    packing = await filePdf(po, auth.userId, true);
    const vars = { job: po.site ? `${po.site.jobNumber} ${po.site.name}` : po.equipment ? `Unit ${po.equipment.unitNumber}` : null, vendor: po.vendor.name };
    await fileDocument({ companyId: po.companyId, docType: 'PO_PDF', fileId: priced, vars });
    await fileDocument({ companyId: po.companyId, docType: 'PACKING_PDF', fileId: packing, vars });
  } catch (e) {
    console.error('[po] PDF failed', e);
  }
  const common = { organizationId: po.organizationId, companyId: po.companyId, fromName: viaName(auth.name), replyTo: auth.email, relatedType: 'purchase_order', relatedId: po.id };
  const v = vars(po, auth.name);
  const settings = purchasingOf(po.company.settings);
  // Priced copy: the job's PM and the company's copy list.
  const pm = po.site?.projectManagerId ? await db.user.findUnique({ where: { id: po.site.projectManagerId }, select: { email: true, active: true } }) : null;
  await sendTemplated({ ...common, key: 'PO_PRICED_INTERNAL', vars: v, to: [...(pm?.active ? [pm.email] : []), ...settings.pricedCopyEmails], attachmentFileIds: priced ? [priced] : [] });
  // Packing list (no prices) to whoever receives it.
  await sendTemplated({ ...common, key: 'PO_PACKING_YARD', vars: v, to: await receiversFor(po), attachmentFileIds: packing ? [packing] : [] });
  // The job's notification list (no prices).
  if (po.site)
    await notifyJob({
      organizationId: po.organizationId,
      siteId: po.site.id,
      event: 'PO_ISSUED',
      title: `PO ${po.poNumber} issued`,
      subject: `PO ${po.poNumber} from ${po.vendor.name} – expected ${v.expectedDate}`,
      text: `${auth.name} issued PO ${po.poNumber} to ${po.vendor.name} for ${v.target}.\nExpected: ${v.expectedDate}\nDeliver to: ${v.deliverTo}\n\n${po.lines.map((l) => `  - ${l.description}: ${n(l.qty)} ${l.uom}`).join('\n')}\n\nOpen in Bowron: ${v.link}`,
      link: poLink(po.id),
      fromName: viaName(auth.name),
      replyTo: auth.email,
      attachmentFileIds: packing ? [packing] : [],
      relatedType: 'purchase_order',
      relatedId: po.id,
      exceptUserId: auth.userId,
    });
  // The vendor, if chosen.
  if (po.emailVendor) await queueVendorEmail(auth, po, priced);
}

async function queueVendorEmail(auth: AuthContext, po: PoFull, pricedFileId: string | null) {
  const exemption = po.site ?? po.equipment;
  const files = [pricedFileId, po.pstExempt || rates(po).pstExempt ? exemption?.pstExemptionFileId : null].filter((x): x is string => !!x);
  const email = po.vendor.contact?.email;
  const r = await sendTemplated({
    organizationId: po.organizationId,
    companyId: po.companyId,
    key: 'PO_TO_VENDOR',
    vars: vars(po, auth.name),
    to: email ? [email] : [],
    // No address on file: hold it so someone can add one.
    forceReview: !email,
    fromName: viaName(auth.name),
    replyTo: auth.email,
    attachmentFileIds: files,
    relatedType: 'purchase_order',
    relatedId: po.id,
  });
  if (r.state === 'SENT') await db.purchaseOrder.update({ where: { id: po.id }, data: { vendorSentAt: new Date() } });
  return r;
}

/** Send (or queue for review) the PO to the vendor again / for the first time. */
export async function sendPoToVendor(auth: AuthContext, id: string) {
  requirePermission(auth, 'procurement:work');
  const po = await loadPo(auth, id);
  if (po.status !== 'ISSUED') throw conflict('Issue the PO first.');
  const priced = await filePdf(po, auth.userId, false);
  await db.purchaseOrder.update({ where: { id }, data: { emailVendor: true } });
  const r = await queueVendorEmail(auth, po, priced);
  await audit(db, auth, 'po.send_vendor', 'PurchaseOrder', id, null, { state: r.state });
  return { state: r.state, po: await getPo(auth, id) };
}

// ---------------------------------------------------------------------------
// Cancel / close
// ---------------------------------------------------------------------------
export async function cancelPo(auth: AuthContext, id: string) {
  requirePermission(auth, 'procurement:work');
  const po = await loadPo(auth, id);
  if (po.status === 'CANCELLED' || po.status === 'CLOSED') throw conflict(`This PO is already ${po.status.toLowerCase()}.`);
  if (po.lines.some((l) => l.yardReceiptLines.length)) throw conflict('Something has been received on this PO, so it can’t be cancelled. Close it instead.');
  await db.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    // Lines that only existed because of this PO are cancelled with it.
    if (po.orderForm) await tx.orderLine.updateMany({ where: { orderFormId: po.orderForm.id }, data: { cancelledAt: new Date() } });
    await recomputeLines(tx, po.lines.map((l) => l.orderLineId).filter((x): x is string => !!x));
    await audit(tx, auth, 'po.cancel', 'PurchaseOrder', id, { status: po.status }, null);
  });
  if (po.site) publish(auth.orgId, { type: 'order.changed', orderId: po.orderForm?.id ?? '', siteId: po.site.id, companyId: po.companyId });
  return getPo(auth, id);
}

/** Admin override: mark it Complete by hand (normally it completes itself when invoiced in full). */
export async function closePo(auth: AuthContext, id: string) {
  if (!isAdmin(auth)) throw forbidden('POs complete themselves once they’re invoiced in full. Only an admin can mark one complete by hand.');
  const po = await loadPo(auth, id);
  if (po.status !== 'ISSUED') throw conflict('Only committed POs can be marked complete.');
  await db.purchaseOrder.update({ where: { id }, data: { status: 'CLOSED', completedAt: new Date() } });
  await audit(db, auth, 'po.close', 'PurchaseOrder', id, null, null);
  return getPo(auth, id);
}

/** Admin: reopen a complete PO (e.g. to take a new invoice that was sent to the rejection area). */
export async function reopenPo(auth: AuthContext, id: string) {
  if (!isAdmin(auth)) throw forbidden('Only an admin can reopen a complete PO.');
  const po = await loadPo(auth, id);
  if (po.status !== 'CLOSED') throw conflict('Only complete POs can be reopened.');
  await db.purchaseOrder.update({ where: { id }, data: { status: 'ISSUED', completedAt: null } });
  await audit(db, auth, 'po.reopen', 'PurchaseOrder', id, { status: 'CLOSED' }, { status: 'ISSUED' });
  return getPo(auth, id);
}

/**
 * A committed PO becomes Complete once approved invoices have drawn down every line
 * (by quantity, or by amount when priced). Then it's locked: only credits post against it.
 */
export async function completeIfConsumed(poId: string): Promise<boolean> {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    include: { lines: { include: { apLines: { where: { invoice: { status: { in: ['APPROVED', 'PAID'] } } }, select: { qty: true, amount: true, invoice: { select: { kind: true } } } } } } },
  });
  if (!po || po.status !== 'ISSUED' || !po.lines.length) return false;
  const consumed = po.lines.every((l) => {
    const sign = (k: string) => (k === 'CREDIT' ? -1 : 1);
    const qty = l.apLines.reduce((t, x) => t + sign(x.invoice.kind) * Number(x.qty ?? 0), 0);
    const amount = l.apLines.reduce((t, x) => t + sign(x.invoice.kind) * Number(x.amount ?? 0), 0);
    const want = Number(l.qty);
    const cost = l.unitCost == null ? null : Number(l.unitCost) * want;
    return qty >= want - 1e-6 || (cost != null && cost > 0 && amount >= cost - 0.01);
  });
  if (!consumed) return false;
  await db.purchaseOrder.update({ where: { id: poId }, data: { status: 'CLOSED', completedAt: new Date() } });
  await audit(db, null, 'po.complete', 'PurchaseOrder', poId, { status: 'ISSUED' }, { status: 'CLOSED' }, po.organizationId);
  const owner = po.issuedById ?? po.createdById;
  if (owner) await db.notification.create({ data: { userId: owner, type: 'po_complete', title: `PO ${po.poNumber} is complete`, body: 'Invoiced in full — it’s now locked.', link: poLink(po.id) } });
  return true;
}

/** Buying created a brand-new PO from order-list lines: run it through issuing (approval, emails). */
export async function issueFromBuying(auth: AuthContext, id: string) {
  return issuePo(auth, id, { fromBuying: true });
}

// ---------------------------------------------------------------------------
// Chase-up (the timer runs hourly; this fires at 1 PM company time on the ETA day)
// Only committed POs with an ETA, not yet received. Three touches: the yard (or site)
// is asked if it's arrived, the supplier is asked where it is, and the PO's owner is told.
// Changing the ETA re-arms it for the new date. The day after, the job is told it's overdue.
// ---------------------------------------------------------------------------
export const CHASE_HOUR = 13;

export async function runPoFollowUps(now = new Date()): Promise<{ followUps: number; prompts: number }> {
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: env().SCHEDULE_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const today = todayLocal(now);
  let followUps = 0;
  let prompts = 0;
  if (hour >= CHASE_HOUR) {
    // Today's ETAs (and the last 3 days, in case the server was down at 1 PM).
    const due = await db.purchaseOrder.findMany({ where: { status: 'ISSUED', expectedDate: { gte: toDate(addDays(today, -3))!, lte: toDate(today)! } }, include: poInclude });
    for (const po of due) {
      const eta = day(po.expectedDate)!;
      if (day(po.chasedForDate) === eta) continue;
      if (receivedState(po) === 'FULL') continue;
      const sender = po.issuedById ? await db.user.findUnique({ where: { id: po.issuedById }, select: { name: true, email: true } }) : null;
      const fromName = viaName(sender?.name ?? po.company.name);
      // a) the yard (or the site, for straight-to-job POs): has it arrived?
      await sendTemplated({
        organizationId: po.organizationId,
        companyId: po.companyId,
        key: 'PO_ARRIVAL_YARD',
        vars: vars(po, sender?.name ?? po.company.name, { link: appLink(`/yard/receive/?q=${encodeURIComponent(po.poNumber)}`) }),
        to: await receiversFor(po),
        fromName,
        replyTo: sender?.email ?? null,
        relatedType: 'purchase_order',
        relatedId: po.id,
      });
      if (po.deliverToYardId) {
        const yardPeople = await db.user.findMany({ where: { active: true, deletedAt: null, memberships: { some: { siteId: po.deliverToYardId } } }, select: { id: true } });
        if (yardPeople.length) await db.notification.createMany({ data: yardPeople.map((p) => ({ userId: p.id, type: 'po_arrival', title: `Has PO ${po.poNumber} arrived?`, body: `${po.vendor.name} · expected ${eta}`, link: `/yard/receive/?q=${encodeURIComponent(po.poNumber)}` })) });
      }
      prompts++;
      // b) the supplier: where is it? (the PO's supplier contact, else the vendor's contact)
      const supplier = po.supplierContactId ? await db.contact.findUnique({ where: { id: po.supplierContactId }, select: { email: true } }) : null;
      const email = supplier?.email ?? po.vendor.contact?.email ?? null;
      await sendTemplated({
        organizationId: po.organizationId,
        companyId: po.companyId,
        key: 'PO_FOLLOWUP_VENDOR',
        vars: vars(po, sender?.name ?? po.company.name),
        to: email ? [email] : [],
        forceReview: !email,
        fromName,
        replyTo: sender?.email ?? null,
        relatedType: 'purchase_order',
        relatedId: po.id,
      });
      followUps++;
      // c) the person responsible for the PO
      const owner = po.issuedById ?? po.createdById;
      if (owner) await db.notification.create({ data: { userId: owner, type: 'po_chase', title: `PO ${po.poNumber} was due today and isn’t received`, body: `${po.vendor.name} · ETA ${eta}. The yard and the supplier have been asked.`, link: poLink(po.id) } });
      await db.purchaseOrder.update({ where: { id: po.id }, data: { chasedForDate: po.expectedDate, followUpQueuedAt: now, arrivalPromptAt: now } });
    }
  }
  // The day after the ETA: tell the job it's overdue (once per ETA).
  const late = await db.purchaseOrder.findMany({ where: { status: 'ISSUED', overdueNotifiedAt: null, expectedDate: { lt: toDate(today)! } }, include: poInclude });
  for (const po of late) {
    if (receivedState(po) === 'FULL') continue;
    const expected = day(po.expectedDate)!;
    const sender = po.issuedById ? await db.user.findUnique({ where: { id: po.issuedById }, select: { name: true, email: true } }) : null;
    if (po.site)
      await notifyJob({
        organizationId: po.organizationId,
        siteId: po.site.id,
        event: 'PO_OVERDUE',
        title: `PO ${po.poNumber} is overdue`,
        subject: `Overdue: PO ${po.poNumber} from ${po.vendor.name} (expected ${expected})`,
        text: `PO ${po.poNumber} from ${po.vendor.name} for ${targetLabel(po)} was expected ${expected} and hasn't all arrived.\n\nOpen in Bowron: ${appLink(poLink(po.id))}`,
        link: poLink(po.id),
        fromName: viaName(sender?.name ?? po.company.name),
        replyTo: sender?.email ?? null,
        relatedType: 'purchase_order',
        relatedId: po.id,
      });
    await db.purchaseOrder.update({ where: { id: po.id }, data: { overdueNotifiedAt: now } });
  }
  return { followUps, prompts };
}

/** Ship via, ship-to and the PO's contacts (with phone and email). */
async function poExtras(po: { shipViaId: string | null; shipToLocationId: string | null; siteContact1Id: string | null; siteContact2Id: string | null; supplierContactId: string | null; shipDirect: boolean; directBolId: string | null }) {
  const [via, to] = await Promise.all([
    po.shipViaId ? db.shipVia.findUnique({ where: { id: po.shipViaId } }) : null,
    po.shipToLocationId ? db.shippingLocation.findUnique({ where: { id: po.shipToLocationId } }) : null,
  ]);
  const ids = [po.siteContact1Id, po.siteContact2Id, po.supplierContactId].filter((x): x is string => !!x);
  const people = ids.length ? await db.contact.findMany({ where: { id: { in: ids } } }) : [];
  const contact = (id: string | null, role: 'SITE_1' | 'SITE_2' | 'SUPPLIER') => {
    const c = people.find((x) => x.id === id);
    return c ? [{ role, id: c.id, name: c.name, businessName: c.businessName, phone: c.cell ?? c.phone, email: c.email }] : [];
  };
  return {
    shipVia: via ? { id: via.id, name: via.name, accountNumber: via.accountNumber, phone: via.phone, email: via.email } : null,
    shipTo: to ? { id: to.id, name: to.businessName, address: [to.address, to.city, to.province, to.postalCode].filter(Boolean).join(', ') || null, phone: to.cell ?? to.phone } : null,
    contacts: [...contact(po.siteContact1Id, 'SITE_1'), ...contact(po.siteContact2Id, 'SITE_2'), ...contact(po.supplierContactId, 'SUPPLIER')],
    shipDirect: po.shipDirect,
    directBolId: po.directBolId,
  };
}

/** Ship via / ship to / contacts for the PO PDF. */
async function pdfExtras(po: Parameters<typeof poExtras>[0]) {
  const x = await poExtras(po);
  const label = { SITE_1: 'Site contact', SITE_2: 'Site contact', SUPPLIER: 'Ordered with' } as const;
  return {
    shipVia: x.shipVia ? [x.shipVia.name, x.shipVia.accountNumber && `acct # ${x.shipVia.accountNumber}`].filter(Boolean).join(' · ') : null,
    shipTo: x.shipTo ? [x.shipTo.name, x.shipTo.address].filter(Boolean).join(', ') : null,
    contacts: x.contacts.map((c) => ({ label: label[c.role], name: c.businessName && c.role === 'SUPPLIER' ? `${c.name} (${c.businessName})` : c.name, phone: c.phone, email: c.email })),
    shipDirect: x.shipDirect,
  };
}
