// Procurement: what still needs buying, RFQs, assigning PO numbers / vendors /
// ETAs / costs to lines, vendors, and company-wide custom columns.

import { extendedCost, formatListLabel, qtyToProcure, type LineStatus } from '@supplyline/core/domain';
import type {
  AssignPoInput,
  CustomColumn,
  CustomColumnInput,
  CustomValue,
  PoLineUpdate,
  ProcurementLine,
  ProcurementOrder,
  ProcurementOrderSummary,
} from '@supplyline/core/models';
import type { Prisma } from '../generated/prisma/client';
import { db } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { publish } from '../lib/events';
import { assertCompanyAccessible, assertSiteVisible, siteWhereFor, yardsFor } from './access';
import { lineFacts, lineFactsInclude, recomputeLines } from './line-status';
import { issueFromBuying, purchasingOf } from './purchasing';
import { moveToTrash } from './trash';

const n = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d));
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const lineInclude = {
  ...lineFactsInclude,
  poLines: {
    where: { purchaseOrder: { status: { not: 'CANCELLED' } } },
    include: {
      purchaseOrder: { include: { vendor: true } },
      yardReceiptLines: { select: { qtyReceived: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  customValues: true,
} satisfies Prisma.OrderLineInclude;
type LineFull = Prisma.OrderLineGetPayload<{ include: typeof lineInclude }>;

function toColumn(c: { id: string; name: string; dataType: string; sharedWithSite: boolean; sortOrder: number }): CustomColumn {
  return { id: c.id, name: c.name, dataType: c.dataType as CustomColumn['dataType'], sharedWithSite: c.sharedWithSite, sortOrder: c.sortOrder };
}

/** Weighted unit cost across a line's POs (falls back to the line's own cost). */
export function lineUnitCost(l: { unitCost: unknown; poLines: { qty: unknown; unitCost: unknown }[] }): number | null {
  const priced = l.poLines.filter((p) => p.unitCost != null);
  if (priced.length) {
    const qty = priced.reduce((a, p) => a + Number(p.qty), 0);
    const total = priced.reduce((a, p) => a + Number(p.qty) * Number(p.unitCost), 0);
    return qty > 0 ? Math.round((total / qty) * 10000) / 10000 : null;
  }
  return l.unitCost == null ? null : Number(l.unitCost);
}

function toLine(l: LineFull, columnIds: Set<string>): ProcurementLine {
  // Only POs that have gone out count as bought (drafts / waiting approval don't).
  const live = l.poLines.filter((p) => p.purchaseOrder.status === 'ISSUED' || p.purchaseOrder.status === 'CLOSED');
  const facts = lineFacts({ ...l, poLines: live } as unknown as Parameters<typeof lineFacts>[0]);
  const unit = lineUnitCost(l);
  const custom: Record<string, CustomValue> = {};
  for (const v of l.customValues) if (columnIds.has(v.columnId)) custom[v.columnId] = v.value as CustomValue;
  return {
    id: l.id,
    lineNo: l.lineNo,
    description: l.description,
    quantity: n(l.quantity),
    uom: l.uom,
    costCode: l.costCode,
    orderedByInitials: l.orderedByInitials,
    requiredOnSite: dateOnly(l.requiredOnSite),
    status: l.status as LineStatus,
    rfqSent: l.rfqSentAt != null,
    yardChecked: l.yardCheckedAt != null,
    yardStock: facts.yardStock,
    qtyToBuy: qtyToProcure(facts),
    unitCost: unit,
    extendedCost: extendedCost(n(l.quantity), unit),
    pos: l.poLines.map((p) => ({
      poLineId: p.id,
      purchaseOrderId: p.purchaseOrderId,
      poNumber: p.purchaseOrder.poNumber,
      poStatus: p.purchaseOrder.status,
      vendorName: p.purchaseOrder.vendor.name,
      qty: n(p.qty),
      unitCost: p.unitCost == null ? null : n(p.unitCost),
      vendorEta: dateOnly(p.vendorEta),
      received: p.yardReceiptLines.reduce((a, r) => a + n(r.qtyReceived), 0),
    })),
    custom,
  };
}

async function loadOrder(auth: AuthContext, orderId: string) {
  const o = await db.orderForm.findFirst({ where: { id: orderId, organizationId: auth.orgId } });
  if (!o) throw notFound('Order list');
  await assertSiteVisible(auth, o.siteId);
  if (o.status === 'DRAFT') throw badRequest('This list has not been submitted yet.');
  return o;
}

// ---------------------------------------------------------------------------
// Queue + order view
// ---------------------------------------------------------------------------
export async function procurementQueue(
  auth: AuthContext,
  filter: { show?: 'todo' | 'onorder' | 'all'; companyId?: string },
): Promise<ProcurementOrderSummary[]> {
  requirePermission(auth, 'procurement:work');
  const show = filter.show ?? 'todo';
  const orders = await db.orderForm.findMany({
    where: {
      organizationId: auth.orgId,
      status: show === 'all' ? { not: 'DRAFT' } : { in: ['SUBMITTED', 'IN_PROGRESS'] },
      site: await siteWhereFor(auth),
      ...(filter.companyId ? { companyId: filter.companyId } : {}),
    },
    include: {
      site: { select: { jobNumber: true, name: true } },
      company: { select: { name: true } },
      lines: { include: lineFactsInclude },
    },
    orderBy: { submittedAt: show === 'todo' ? 'asc' : 'desc' },
    take: 300,
  });
  return orders
    .map((o) => {
      let toBuy = 0, awaiting = 0, onOrder = 0, live = 0;
      for (const l of o.lines) {
        const f = lineFacts(l);
        if (f.cancelled) continue;
        live++;
        if (qtyToProcure(f) > 0) toBuy++;
        if (!l.yardCheckedAt) awaiting++;
        if (l.status === 'ON_ORDER') onOrder++;
      }
      return {
        orderId: o.id,
        label: formatListLabel(o.site.jobNumber, o.listNo),
        siteName: o.site.name,
        companyId: o.companyId,
        companyName: o.company.name,
        status: o.status,
        submittedAt: o.submittedAt?.toISOString() ?? null,
        lineCount: live,
        toBuy,
        awaitingYardCheck: awaiting,
        onOrder,
      } satisfies ProcurementOrderSummary;
    })
    .filter((s) => (show === 'todo' ? s.toBuy > 0 : show === 'onorder' ? s.onOrder > 0 : true));
}

export async function getProcurementOrder(auth: AuthContext, orderId: string): Promise<ProcurementOrder> {
  requirePermission(auth, 'procurement:work');
  const o = await loadOrder(auth, orderId);
  const full = await db.orderForm.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      site: { select: { jobNumber: true, name: true } },
      company: { select: { name: true } },
      submittedBy: { select: { name: true } },
      lines: { include: lineInclude, orderBy: { lineNo: 'asc' } },
    },
  });
  const columns = (await db.customColumn.findMany({ where: { companyId: o.companyId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })).map(toColumn);
  const vendors = await db.vendor.findMany({ where: { companyId: o.companyId }, select: { name: true }, orderBy: { name: 'asc' } });
  const ids = new Set(columns.map((c) => c.id));
  return {
    orderId: o.id,
    label: formatListLabel(full.site.jobNumber, o.listNo),
    siteName: full.site.name,
    companyId: o.companyId,
    companyName: full.company.name,
    status: o.status,
    submittedAt: o.submittedAt?.toISOString() ?? null,
    submittedByName: full.submittedBy?.name ?? null,
    notes: o.notes,
    lines: full.lines.map((l) => toLine(l, ids)),
    columns,
    vendors: vendors.map((v) => v.name),
    yards: await yardsFor(auth, o.companyId),
  };
}

// ---------------------------------------------------------------------------
// RFQs and POs
// ---------------------------------------------------------------------------
async function orderLines(orderId: string, lineIds: string[]) {
  const lines = await db.orderLine.findMany({ where: { id: { in: lineIds }, orderFormId: orderId } });
  if (lines.length !== new Set(lineIds).size) throw badRequest('One of the lines is not on this list.');
  if (lines.some((l) => l.cancelledAt)) throw badRequest('Cancelled lines can’t be changed.');
  return lines;
}

export async function markRfq(auth: AuthContext, orderId: string, lineIds: string[], sent: boolean) {
  requirePermission(auth, 'procurement:work');
  const o = await loadOrder(auth, orderId);
  await orderLines(orderId, lineIds);
  await db.$transaction(async (tx) => {
    await tx.orderLine.updateMany({ where: { id: { in: lineIds } }, data: { rfqSentAt: sent ? new Date() : null } });
    await recomputeLines(tx, lineIds);
    await audit(tx, auth, sent ? 'procurement.rfq_sent' : 'procurement.rfq_cleared', 'OrderForm', orderId, null, { lineIds });
  });
  publish(auth.orgId, { type: 'order.changed', orderId, siteId: o.siteId, companyId: o.companyId });
  return getProcurementOrder(auth, orderId);
}

export async function assignPo(auth: AuthContext, orderId: string, input: AssignPoInput) {
  requirePermission(auth, 'procurement:work');
  const o = await loadOrder(auth, orderId);
  await orderLines(orderId, input.lines.map((l) => l.lineId));
  if (input.yardId && !(await yardsFor(auth, o.companyId)).some((y) => y.id === input.yardId)) throw badRequest('That yard does not serve this company.');

  let createdPoId: string | null = null;
  const company = await db.company.findUniqueOrThrow({ where: { id: o.companyId } });
  await db.$transaction(async (tx) => {
    // Vendors are matched by name (case-insensitive) within the company.
    let vendor = await tx.vendor.findFirst({ where: { companyId: o.companyId, name: { equals: input.vendorName, mode: 'insensitive' } } });
    vendor ??= await tx.vendor.create({ data: { companyId: o.companyId, name: input.vendorName } });

    let po = await tx.purchaseOrder.findFirst({ where: { companyId: o.companyId, poNumber: { equals: input.poNumber, mode: 'insensitive' } } });
    if (po && po.vendorId !== vendor.id) {
      const other = await tx.vendor.findUniqueOrThrow({ where: { id: po.vendorId } });
      throw conflict(`PO ${po.poNumber} is already used for ${other.name}.`);
    }
    if (!po) {
      po = await tx.purchaseOrder.create({
        data: {
          organizationId: auth.orgId,
          companyId: o.companyId,
          poNumber: input.poNumber,
          vendorId: vendor.id,
          deliverToYardId: input.yardId ?? (await yardsFor(auth, o.companyId))[0]?.id ?? null,
          createdById: auth.userId,
          // A new PO is issued straight after (approval, PDFs and emails happen there).
          status: 'DRAFT',
          siteId: o.siteId,
          expectedDate: input.vendorEta ? new Date(`${input.vendorEta}T00:00:00Z`) : null,
          emailVendor: purchasingOf(company.settings).emailVendorDefault,
        },
      });
      createdPoId = po.id;
    } else if (input.yardId) {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { deliverToYardId: input.yardId } });
    }
    let lineNo = await tx.purchaseOrderLine.count({ where: { purchaseOrderId: po.id } });
    for (const l of input.lines) {
      const ol = await tx.orderLine.findUniqueOrThrow({ where: { id: l.lineId }, select: { description: true, uom: true } });
      await tx.purchaseOrderLine.create({
        data: {
          purchaseOrderId: po.id,
          lineNo: ++lineNo,
          description: ol.description,
          uom: ol.uom,
          orderLineId: l.lineId,
          qty: l.qty,
          unitCost: l.unitCost ?? null,
          vendorEta: input.vendorEta ? new Date(`${input.vendorEta}T00:00:00Z`) : null,
        },
      });
      if (l.unitCost != null) await tx.orderLine.update({ where: { id: l.lineId }, data: { unitCost: l.unitCost } });
    }
    await recomputeLines(tx, input.lines.map((l) => l.lineId));
    await audit(tx, auth, 'procurement.assign_po', 'PurchaseOrder', po.id, null, input);
  });
  if (createdPoId) await issueFromBuying(auth, createdPoId);
  publish(auth.orgId, { type: 'order.changed', orderId, siteId: o.siteId, companyId: o.companyId });
  return getProcurementOrder(auth, orderId);
}

async function loadPoLine(auth: AuthContext, poLineId: string) {
  const pl = await db.purchaseOrderLine.findFirst({
    where: { id: poLineId, purchaseOrder: { organizationId: auth.orgId } },
    include: { orderLine: true, yardReceiptLines: { select: { id: true } }, bolLines: { select: { id: true } } },
  });
  if (!pl) throw notFound('PO line');
  if (!pl.orderLine || !pl.orderLineId) throw badRequest('This line is on an equipment PO. Change it on the PO page.');
  await assertSiteVisible(auth, pl.orderLine.siteId);
  return { ...pl, orderLine: pl.orderLine, orderLineId: pl.orderLineId };
}

export async function updatePoLine(auth: AuthContext, poLineId: string, input: PoLineUpdate) {
  requirePermission(auth, 'procurement:work');
  const pl = await loadPoLine(auth, poLineId);
  await db.$transaction(async (tx) => {
    await tx.purchaseOrderLine.update({
      where: { id: poLineId },
      data: {
        ...(input.qty !== undefined ? { qty: input.qty } : {}),
        ...(input.unitCost !== undefined ? { unitCost: input.unitCost } : {}),
        ...(input.vendorEta !== undefined ? { vendorEta: input.vendorEta ? new Date(`${input.vendorEta}T00:00:00Z`) : null } : {}),
      },
    });
    if (input.unitCost != null) await tx.orderLine.update({ where: { id: pl.orderLineId }, data: { unitCost: input.unitCost } });
    await recomputeLines(tx, [pl.orderLineId]);
    await audit(tx, auth, 'procurement.update_po_line', 'PurchaseOrderLine', poLineId, null, input);
  });
  publish(auth.orgId, { type: 'order.changed', orderId: pl.orderLine.orderFormId, siteId: pl.orderLine.siteId, companyId: pl.orderLine.companyId });
  return getProcurementOrder(auth, pl.orderLine.orderFormId);
}

export async function removePoLine(auth: AuthContext, poLineId: string) {
  requirePermission(auth, 'procurement:work');
  const pl = await loadPoLine(auth, poLineId);
  if (pl.yardReceiptLines.length || pl.bolLines.length) throw conflict('Something has already been received against this PO line, so it can’t be removed.');
  const raw = await db.purchaseOrderLine.findUniqueOrThrow({ where: { id: poLineId } });
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: pl.purchaseOrderId }, select: { poNumber: true } });
  await db.$transaction(async (tx) => {
    await moveToTrash(tx, auth, 'PO_LINE', poLineId, `PO ${po.poNumber} – ${pl.orderLine.description}`, raw);
    await tx.purchaseOrderLine.delete({ where: { id: poLineId } });
    await recomputeLines(tx, [pl.orderLineId]);
  });
  publish(auth.orgId, { type: 'order.changed', orderId: pl.orderLine.orderFormId, siteId: pl.orderLine.siteId, companyId: pl.orderLine.companyId });
  return getProcurementOrder(auth, pl.orderLine.orderFormId);
}

// ---------------------------------------------------------------------------
// Custom columns (company-wide)
// ---------------------------------------------------------------------------
export async function listCustomColumns(auth: AuthContext, companyId: string): Promise<CustomColumn[]> {
  requirePermission(auth, 'procurement:work');
  await assertCompanyAccessible(auth, companyId);
  return (await db.customColumn.findMany({ where: { companyId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })).map(toColumn);
}

export async function createCustomColumn(auth: AuthContext, companyId: string, input: CustomColumnInput) {
  requirePermission(auth, 'procurement:work');
  await assertCompanyAccessible(auth, companyId);
  const count = await db.customColumn.count({ where: { companyId } });
  if (count >= 20) throw badRequest('A company can have up to 20 custom columns.');
  const c = await db.customColumn.create({
    data: { companyId, name: input.name, dataType: input.dataType, sharedWithSite: input.sharedWithSite, sortOrder: count, createdById: auth.userId },
  });
  await audit(db, auth, 'procurement.column_create', 'CustomColumn', c.id, null, input);
  return toColumn(c);
}

export async function updateCustomColumn(auth: AuthContext, companyId: string, id: string, input: Partial<CustomColumnInput> & { sortOrder?: number }) {
  requirePermission(auth, 'procurement:work');
  await assertCompanyAccessible(auth, companyId);
  const c = await db.customColumn.findFirst({ where: { id, companyId } });
  if (!c) throw notFound('Column');
  const u = await db.customColumn.update({ where: { id }, data: input });
  await audit(db, auth, 'procurement.column_update', 'CustomColumn', id, toColumn(c) as unknown as Record<string, unknown>, input);
  return toColumn(u);
}

export async function deleteCustomColumn(auth: AuthContext, companyId: string, id: string) {
  requirePermission(auth, 'procurement:work');
  await assertCompanyAccessible(auth, companyId);
  const c = await db.customColumn.findFirst({ where: { id, companyId } });
  if (!c) throw notFound('Column');
  const values = await db.customValue.findMany({ where: { columnId: id } });
  await db.$transaction(async (tx) => {
    await moveToTrash(tx, auth, 'CUSTOM_COLUMN', id, `Column "${c.name}"`, { ...c, values });
    await tx.customColumn.delete({ where: { id } });  // values cascade
  });
}

/** Checks a cell value against its column type; empty becomes null. */
export function cleanCustomValue(type: string, value: CustomValue): CustomValue {
  if (value === null || value === '') return null;
  switch (type) {
    case 'NUMBER': {
      const v = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
      if (!Number.isFinite(v)) throw badRequest('Enter a number.');
      return v;
    }
    case 'BOOLEAN':
      if (typeof value === 'boolean') return value;
      throw badRequest('Use yes or no.');
    case 'DATE':
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      throw badRequest('Use a date like 2026-10-20.');
    default:
      return String(value).slice(0, 500);
  }
}

export async function setCustomValue(auth: AuthContext, lineId: string, columnId: string, value: CustomValue) {
  requirePermission(auth, 'procurement:work');
  const line = await db.orderLine.findFirst({ where: { id: lineId, organizationId: auth.orgId } });
  if (!line) throw notFound('Line');
  await assertSiteVisible(auth, line.siteId);
  const col = await db.customColumn.findFirst({ where: { id: columnId, companyId: line.companyId } });
  if (!col) throw notFound('Column');
  const clean = cleanCustomValue(col.dataType, value);
  if (clean === null) await db.customValue.deleteMany({ where: { columnId, orderLineId: lineId } });
  else
    await db.customValue.upsert({
      where: { columnId_orderLineId: { columnId, orderLineId: lineId } },
      create: { columnId, orderLineId: lineId, value: clean },
      update: { value: clean },
    });
  await audit(db, auth, 'procurement.custom_value', 'OrderLine', lineId, null, { column: col.name, value: clean });
  if (col.sharedWithSite) publish(auth.orgId, { type: 'order.changed', orderId: line.orderFormId, siteId: line.siteId, companyId: line.companyId });
  return { value: clean };
}

export async function listVendors(auth: AuthContext, companyId: string) {
  requirePermission(auth, 'procurement:work');
  await assertCompanyAccessible(auth, companyId);
  return db.vendor.findMany({ where: { companyId }, select: { id: true, name: true, contactId: true }, orderBy: { name: 'asc' } });
}
