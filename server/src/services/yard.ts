// Yard work: stock checks on new orders, the incoming-shipments list, receiving
// deliveries (with photos and problem flags), and what's sitting in the yard.

import { formatListLabel, parseListLabel } from '@supplyline/core/domain';
import type {
  IncomingLine,
  ReceiptDetail,
  ReceiptInput,
  ReceiptSummary,
  ReceivableLine,
  ReceivingLookup,
  StockCheckInput,
  StockCheckOrder,
  YardInventoryRow,
} from '@supplyline/core/models';
import type { LineStatus } from '@supplyline/core/domain';
import type { Prisma } from '../generated/prisma/client';
import { db } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { env } from '../lib/env';
import { badRequest, conflict, notFound } from '../lib/errors';
import { publish } from '../lib/events';
import { sendEmail, viaName } from '../integrations/email';
import { accessibleCompanyIds, assertSiteVisible, siteWhereFor, yardsFor } from './access';
import { fileUrl, saveUpload } from './files';
import { makeYardReceiptReport } from './receiving-report';
import { fileDocument, jobLabel } from './filing';
import { recomputeLines } from './line-status';
import { locationIdForSite } from './inventory';
import { recipientsFor } from './orders';

const n = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d));
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const appLink = (path: string) => `${env().APP_URL.replace(/\/$/, '')}${path}`;

async function notifyProcurement(
  auth: AuthContext,
  companyId: string,
  siteIds: string[],
  subject: string,
  text: string,
  link: string,
  relatedType: string,
  relatedId: string,
) {
  const to = new Set<string>();
  for (const siteId of [...new Set(siteIds)]) for (const e of await recipientsFor(companyId, siteId, 'PROCUREMENT')) to.add(e);
  if (to.size)
    await sendEmail(
      { fromName: viaName(auth.name), replyTo: auth.email, to: [...to], subject, text: `${text}\n\nOpen in SupplyLine: ${appLink(link)}` },
      { organizationId: auth.orgId, relatedType, relatedId },
    );
  // In-app notifications for the company's procurement people.
  const people = await db.user.findMany({
    where: { organizationId: auth.orgId, active: true, deletedAt: null, roles: { has: 'PROCUREMENT' }, OR: [{ companyId }, { companyId: null }] },
    select: { id: true },
  });
  if (people.length)
    await db.notification.createMany({ data: people.map((p) => ({ userId: p.id, type: relatedType, title: subject, body: text, link })) });
}

// ---------------------------------------------------------------------------
// Stock check
// ---------------------------------------------------------------------------
const stockLineWhere: Prisma.OrderLineWhereInput = {
  cancelledAt: null,
  status: { in: ['SUBMITTED', 'SENT_FOR_RFQ', 'ON_ORDER', 'YARD_STOCK'] },
};

async function toStockCheckOrder(auth: AuthContext, orderId: string, onlyUnchecked: boolean): Promise<StockCheckOrder | null> {
  const o = await db.orderForm.findUnique({
    where: { id: orderId },
    include: {
      site: { select: { jobNumber: true, name: true } },
      company: { select: { name: true } },
      lines: { where: { ...stockLineWhere, ...(onlyUnchecked ? { yardCheckedAt: null } : {}) }, orderBy: { lineNo: 'asc' } },
    },
  });
  if (!o || o.lines.length === 0) return null;
  const yards = await yardsFor(auth, o.companyId);
  if (yards.length === 0) return null;
  return {
    orderId: o.id,
    label: formatListLabel(o.site.jobNumber, o.listNo),
    siteName: o.site.name,
    companyId: o.companyId,
    companyName: o.company.name,
    submittedAt: o.submittedAt?.toISOString() ?? null,
    lines: o.lines.map((l) => ({
      lineId: l.id,
      lineNo: l.lineNo,
      description: l.description,
      quantity: n(l.quantity),
      uom: l.uom,
      status: l.status as LineStatus,
      yardQtyAvailable: l.yardCheckedAt ? n(l.yardQtyAvailable) : null,
    })),
    yards,
  };
}

/** Order lists with lines the yard hasn't checked yet. */
export async function stockCheckQueue(auth: AuthContext): Promise<StockCheckOrder[]> {
  requirePermission(auth, 'yard:work');
  const orders = await db.orderForm.findMany({
    where: {
      organizationId: auth.orgId,
      status: { in: ['SUBMITTED', 'IN_PROGRESS'] },
      site: await siteWhereFor(auth),
      lines: { some: { ...stockLineWhere, yardCheckedAt: null } },
    },
    select: { id: true },
    orderBy: { submittedAt: 'asc' },
    take: 100,
  });
  const out: StockCheckOrder[] = [];
  for (const o of orders) {
    const s = await toStockCheckOrder(auth, o.id, true);
    if (s) out.push(s);
  }
  return out;
}

export async function getStockCheck(auth: AuthContext, orderId: string): Promise<StockCheckOrder> {
  requirePermission(auth, 'yard:work');
  const o = await db.orderForm.findFirst({ where: { id: orderId, organizationId: auth.orgId } });
  if (!o) throw notFound('Order list');
  await assertSiteVisible(auth, o.siteId);
  const s = await toStockCheckOrder(auth, orderId, false);
  if (!s) throw badRequest('Nothing on this list needs a stock check (or no yard serves this company).');
  return s;
}

export async function saveStockCheck(auth: AuthContext, orderId: string, input: StockCheckInput) {
  requirePermission(auth, 'yard:work');
  const o = await db.orderForm.findFirst({
    where: { id: orderId, organizationId: auth.orgId },
    include: { site: true, lines: { where: { id: { in: input.lines.map((l) => l.lineId) } }, include: { inventoryLots: true } } },
  });
  if (!o) throw notFound('Order list');
  await assertSiteVisible(auth, o.siteId);
  const yards = await yardsFor(auth, o.companyId);
  if (!yards.some((y) => y.id === input.yardId)) throw badRequest("You can't check stock for this company at that yard.");
  if (o.lines.length !== new Set(input.lines.map((l) => l.lineId)).size) throw badRequest('One of the lines is not on this list.');

  let full = 0, part = 0, none = 0;
  await db.$transaction(async (tx) => {
    const yardLocationId = await locationIdForSite(tx, input.yardId);
    for (const entry of input.lines) {
      const line = o.lines.find((l) => l.id === entry.lineId)!;
      if (line.cancelledAt) continue;
      const qty = Math.min(entry.qtyAvailable, n(line.quantity));
      const lot = line.inventoryLots.find((i) => i.source === 'YARD_STOCK');
      if (lot) {
        // Never take back stock that has already been shipped.
        const shipped = n(lot.qtyIn) - n(lot.qtyAvailable);
        const qtyIn = Math.max(qty, shipped);
        if (qtyIn <= 0) await tx.inventoryLot.delete({ where: { id: lot.id } });
        else await tx.inventoryLot.update({ where: { id: lot.id }, data: { qtyIn, qtyAvailable: qtyIn - shipped, locationId: yardLocationId } });
      } else if (qty > 0) {
        await tx.inventoryLot.create({
          data: {
            organizationId: auth.orgId,
            companyId: o.companyId,
            locationId: yardLocationId,
            finalSiteId: line.siteId,
            status: 'IN_STOCK',
            orderLineId: line.id,
            source: 'YARD_STOCK',
            description: line.description,
            uom: line.uom,
            qtyIn: qty,
            qtyAvailable: qty,
          },
        });
      }
      await tx.orderLine.update({
        where: { id: line.id },
        data: { yardQtyAvailable: qty, yardCheckedById: auth.userId, yardCheckedAt: new Date() },
      });
      if (qty >= n(line.quantity) - 1e-6) full++;
      else if (qty > 0) part++;
      else none++;
    }
    await recomputeLines(tx, o.lines.map((l) => l.id));
    await audit(tx, auth, 'yard.stock_check', 'OrderForm', orderId, null, input);
  });

  const label = formatListLabel(o.site.jobNumber, o.listNo);
  await notifyProcurement(
    auth,
    o.companyId,
    [o.siteId],
    `${label} – yard stock check done`,
    `The yard checked ${label} (${o.site.name}).\n` +
      `${full} line(s) fully from yard stock, ${part} partly, ${none} need buying.`,
    `/procurement/order/?id=${orderId}`,
    'yard_check',
    orderId,
  );
  publish(auth.orgId, { type: 'order.changed', orderId, siteId: o.siteId, companyId: o.companyId });
  return { full, part, none };
}

// ---------------------------------------------------------------------------
// Incoming shipments
// ---------------------------------------------------------------------------
const poLineInclude = {
  purchaseOrder: { include: { vendor: true, deliverTo: { select: { id: true, name: true } }, equipment: { select: { unitNumber: true, description: true } } } },
  orderLine: { include: { orderForm: { include: { site: { select: { jobNumber: true, name: true } } } } } },
  yardReceiptLines: { select: { qtyReceived: true } },
} satisfies Prisma.PurchaseOrderLineInclude;
type PoLineFull = Prisma.PurchaseOrderLineGetPayload<{ include: typeof poLineInclude }>;

/** What a PO line is for: a line on an order list, or (equipment POs) the unit itself. */
function lineInfo(pl: PoLineFull) {
  if (pl.orderLine) {
    const o = pl.orderLine.orderForm;
    return { orderId: o.id as string | null, orderLabel: formatListLabel(o.site.jobNumber, o.listNo), siteName: o.site.name, lineNo: pl.orderLine.lineNo, description: pl.orderLine.description, uom: pl.orderLine.uom };
  }
  const e = pl.purchaseOrder.equipment;
  return {
    orderId: null as string | null,
    orderLabel: e ? `Unit ${e.unitNumber}` : `PO ${pl.purchaseOrder.poNumber}`,
    siteName: e?.description ?? '',
    lineNo: pl.lineNo ?? 0,
    description: pl.description ?? '',
    uom: pl.uom ?? 'EA',
  };
}
const liveLine = { OR: [{ orderLineId: null }, { orderLine: { cancelledAt: null } }] };

function received(pl: PoLineFull) {
  return pl.yardReceiptLines.reduce((a, r) => a + n(r.qtyReceived), 0);
}

export async function incomingShipments(auth: AuthContext, yardId?: string): Promise<IncomingLine[]> {
  requirePermission(auth, 'yard:view');
  const companies = await accessibleCompanyIds(auth);
  const rows = await db.purchaseOrderLine.findMany({
    where: {
      purchaseOrder: {
        organizationId: auth.orgId,
        companyId: { in: companies },
        status: 'ISSUED',
        ...(yardId ? { OR: [{ deliverToYardId: yardId }, { deliverToYardId: null }] } : {}),
      },
      ...liveLine,
    },
    include: poLineInclude,
    take: 1000,
  });
  return rows
    .map((pl) => {
      const got = received(pl);
      const qty = n(pl.qty);
      const info = lineInfo(pl);
      return {
        poLineId: pl.id,
        purchaseOrderId: pl.purchaseOrderId,
        poNumber: pl.purchaseOrder.poNumber,
        vendorName: pl.purchaseOrder.vendor.name,
        vendorEta: dateOnly(pl.vendorEta),
        yardId: pl.purchaseOrder.deliverTo?.id ?? null,
        yardName: pl.purchaseOrder.deliverTo?.name ?? null,
        orderId: info.orderId,
        orderLabel: info.orderLabel,
        siteName: info.siteName,
        lineNo: info.lineNo,
        description: info.description,
        uom: info.uom,
        qtyOnPo: qty,
        qtyReceived: got,
        qtyRemaining: Math.max(0, Math.round((qty - got) * 1000) / 1000),
      } satisfies IncomingLine;
    })
    .filter((r) => r.qtyRemaining > 0)
    .sort((a, b) => (a.vendorEta ?? '9999').localeCompare(b.vendorEta ?? '9999') || a.poNumber.localeCompare(b.poNumber));
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------
function toReceivable(pl: PoLineFull): ReceivableLine {
  const qty = n(pl.qty), got = received(pl);
  const info = lineInfo(pl);
  return {
    poLineId: pl.id,
    orderLineId: pl.orderLineId,
    orderId: info.orderId,
    orderLabel: info.orderLabel,
    lineNo: info.lineNo,
    description: info.description,
    uom: info.uom,
    qtyOnPo: qty,
    qtyReceived: got,
    qtyRemaining: Math.max(0, Math.round((qty - got) * 1000) / 1000),
  };
}

/** Find what to receive from an order number ("JOB#2249 LIST#1", "2249-1") or a PO number. */
export async function lookupForReceiving(auth: AuthContext, query: string): Promise<ReceivingLookup> {
  requirePermission(auth, 'yard:work');
  const q = query.trim();
  if (!q) throw badRequest('Enter an order number or PO number.');
  const companies = await accessibleCompanyIds(auth);

  const po = await db.purchaseOrder.findFirst({
    where: {
      organizationId: auth.orgId,
      companyId: { in: companies },
      // Exactly as typed ("PO-1042"), or without a leading "PO " / "PO#" ("PO 1042" → "1042").
      OR: [q, q.replace(/^PO(\s+|\s*#\s*)/i, '')].map((v) => ({ poNumber: { equals: v, mode: 'insensitive' as const } })),
    },
    include: { vendor: true, lines: { where: liveLine, include: poLineInclude } },
  });
  if (po) {
    if (po.status === 'DRAFT' || po.status === 'PENDING_APPROVAL') throw conflict(`PO ${po.poNumber} hasn't been issued yet${po.status === 'PENDING_APPROVAL' ? ' (it is waiting for approval)' : ''}.`);
    if (po.status === 'CANCELLED') throw conflict(`PO ${po.poNumber} was cancelled.`);
    const yards = await yardsFor(auth, po.companyId);
    return {
      kind: 'PO',
      label: `PO ${po.poNumber}`,
      purchaseOrderId: po.id,
      orderId: null,
      vendorName: po.vendor.name,
      companyId: po.companyId,
      lines: po.lines.map(toReceivable).sort((a, b) => a.orderLabel.localeCompare(b.orderLabel) || a.lineNo - b.lineNo),
      yards,
      defaultYardId: yards.some((y) => y.id === po.deliverToYardId) ? po.deliverToYardId : (yards[0]?.id ?? null),
    };
  }

  // Order list: "JOB#2249 LIST#1", "2249 1", "2249-1", or the company running number.
  let parsed = parseListLabel(q);
  if (!parsed) {
    const m = /^#?\s*([A-Za-z0-9-]+?)\s*[-\s/#]\s*(?:LIST\s*#?\s*)?(\d+)$/i.exec(q.replace(/^JOB\s*#?\s*/i, ''));
    if (m) parsed = { jobNumber: m[1]!, listNo: Number(m[2]) };
  }
  let order = parsed
    ? await db.orderForm.findFirst({
        where: {
          organizationId: auth.orgId,
          companyId: { in: companies },
          listNo: parsed.listNo,
          site: { jobNumber: { equals: parsed.jobNumber, mode: 'insensitive' } },
        },
      })
    : null;
  if (!order && /^\d+$/.test(q))
    order = await db.orderForm.findFirst({ where: { organizationId: auth.orgId, companyId: { in: companies }, companySeq: Number(q) } });
  if (!order) throw notFound('Order or PO');
  await assertSiteVisible(auth, order.siteId);

  const lines = await db.purchaseOrderLine.findMany({
    where: { orderLine: { orderFormId: order.id, cancelledAt: null }, purchaseOrder: { status: 'ISSUED' } },
    include: poLineInclude,
  });
  const site = await db.site.findUniqueOrThrow({ where: { id: order.siteId } });
  const yards = await yardsFor(auth, order.companyId);
  return {
    kind: 'ORDER',
    label: formatListLabel(site.jobNumber, order.listNo),
    purchaseOrderId: null,
    orderId: order.id,
    vendorName: null,
    companyId: order.companyId,
    lines: lines.map(toReceivable).sort((a, b) => a.lineNo - b.lineNo),
    yards,
    defaultYardId: yards[0]?.id ?? null,
  };
}

export async function createReceipt(auth: AuthContext, input: ReceiptInput): Promise<{ id: string; problems: number }> {
  requirePermission(auth, 'yard:work');
  const companies = await accessibleCompanyIds(auth);
  const poLines = await db.purchaseOrderLine.findMany({
    where: { id: { in: input.lines.map((l) => l.poLineId) }, purchaseOrder: { organizationId: auth.orgId, companyId: { in: companies } } },
    include: poLineInclude,
  });
  if (poLines.length !== new Set(input.lines.map((l) => l.poLineId)).size) throw badRequest('One of the lines was not found.');
  const companyIds = new Set(poLines.map((p) => p.purchaseOrder.companyId));
  if (companyIds.size !== 1) throw badRequest('Receive one company’s delivery at a time.');
  const companyId = [...companyIds][0]!;
  if (!(await yardsFor(auth, companyId)).some((y) => y.id === input.yardId)) throw badRequest("You can't receive for this company at that yard.");
  const poIds = new Set(poLines.map((p) => p.purchaseOrderId));

  const receipt = await db.$transaction(async (tx) => {
    const yardLocationId = await locationIdForSite(tx, input.yardId);
    const r = await tx.yardReceipt.create({
      data: {
        organizationId: auth.orgId,
        companyId,
        yardId: input.yardId,
        purchaseOrderId: input.purchaseOrderId ?? (poIds.size === 1 ? [...poIds][0]! : null),
        orderFormId: input.orderId ?? null,
        receivedById: auth.userId,
        notes: input.notes ?? null,
      },
    });
    for (const entry of input.lines) {
      const pl = poLines.find((p) => p.id === entry.poLineId)!;
      const remaining = Math.max(0, n(pl.qty) - received(pl));
      const rl = await tx.yardReceiptLine.create({
        data: {
          yardReceiptId: r.id,
          orderLineId: pl.orderLineId,
          purchaseOrderLineId: pl.id,
          qtyExpected: remaining,
          qtyReceived: entry.qtyReceived,
          problem: entry.problem,
          problemNote: entry.problemNote ?? null,
        },
      });
      // What arrived is now in the yard, ready to ship to site.
      if (entry.qtyReceived > 0 && pl.orderLine && pl.orderLineId)
        await tx.inventoryLot.create({
          data: {
            organizationId: auth.orgId,
            companyId,
            locationId: yardLocationId,
            finalSiteId: pl.orderLine.siteId,
            status: 'IN_STOCK',
            orderLineId: pl.orderLineId,
            source: 'PO_RECEIPT',
            yardReceiptLineId: rl.id,
            description: pl.orderLine.description,
            uom: pl.orderLine.uom,
            qtyIn: entry.qtyReceived,
            qtyAvailable: entry.qtyReceived,
          },
        });
      // Equipment POs (oil, filters, parts): the stock is the unit's, ready to ship to wherever it is.
      else if (entry.qtyReceived > 0 && pl.purchaseOrder.equipmentId)
        await tx.inventoryLot.create({
          data: {
            organizationId: auth.orgId,
            companyId,
            locationId: yardLocationId,
            equipmentId: pl.purchaseOrder.equipmentId,
            purchaseOrderLineId: pl.id,
            status: 'IN_STOCK',
            source: 'PO_RECEIPT',
            yardReceiptLineId: rl.id,
            description: pl.description ?? 'Equipment item',
            uom: pl.uom ?? 'EA',
            qtyIn: entry.qtyReceived,
            qtyAvailable: entry.qtyReceived,
          },
        });
    }
    await recomputeLines(tx, poLines.map((p) => p.orderLineId).filter((x): x is string => !!x));
    await audit(tx, auth, 'yard.receive', 'YardReceipt', r.id, null, input);
    return r;
  });

  // Tell procurement about shortages, overages and flagged problems.
  const issues: string[] = [];
  for (const entry of input.lines) {
    const pl = poLines.find((p) => p.id === entry.poLineId)!;
    const remaining = Math.max(0, n(pl.qty) - received(pl));
    const info = lineInfo(pl);
    const label = `${info.orderLabel} L${info.lineNo}`;
    const what = `${label} (PO ${pl.purchaseOrder.poNumber}) ${info.description}`;
    if (entry.problem) issues.push(`PROBLEM – ${what}: got ${entry.qtyReceived} of ${remaining} ${info.uom}${entry.problemNote ? ` – ${entry.problemNote}` : ''}`);
    else if (entry.qtyReceived < remaining - 1e-6) issues.push(`SHORT – ${what}: got ${entry.qtyReceived} of ${remaining} ${info.uom}`);
    else if (entry.qtyReceived > remaining + 1e-6) issues.push(`OVER – ${what}: got ${entry.qtyReceived}, expected ${remaining} ${info.uom}`);
  }
  if (issues.length) {
    const sites = poLines.map((p) => p.orderLine?.siteId ?? p.purchaseOrder.siteId).filter((x): x is string => !!x);
    await notifyProcurement(
      auth,
      companyId,
      sites,
      `Delivery issue at the yard – ${[...new Set(poLines.map((p) => `PO ${p.purchaseOrder.poNumber}`))].join(', ')}`,
      `${auth.name} received a delivery with ${issues.length} issue(s):\n\n${issues.join('\n')}` + (input.notes ? `\n\nNotes: ${input.notes}` : ''),
      `/yard/receipts/view/?id=${receipt.id}`,
      'yard_problem',
      receipt.id,
    );
  }
  for (const pl of poLines) {
    if (pl.orderLine) publish(auth.orgId, { type: 'order.changed', orderId: pl.orderLine.orderFormId, siteId: pl.orderLine.siteId, companyId });
  }
  await makeYardReceiptReport(receipt.id, auth.userId);
  return { id: receipt.id, problems: issues.length };
}

async function loadReceipt(auth: AuthContext, id: string) {
  const companies = await accessibleCompanyIds(auth);
  const r = await db.yardReceipt.findFirst({
    where: { id, organizationId: auth.orgId, companyId: { in: companies } },
    include: {
      yard: { select: { name: true } },
      receivedBy: { select: { name: true } },
      photos: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      lines: {
        include: {
          poLine: { include: { purchaseOrder: { select: { poNumber: true, equipment: { select: { unitNumber: true } } } } } },
          orderLine: { include: { orderForm: { include: { site: { select: { jobNumber: true } } } } } },
        },
      },
    },
  });
  if (!r) throw notFound('Receipt');
  return r;
}

export async function addReceiptPhoto(auth: AuthContext, receiptId: string, file: File) {
  requirePermission(auth, 'yard:work');
  const r = await loadReceipt(auth, receiptId);
  const asset = await saveUpload({
    organizationId: auth.orgId,
    companyId: r.companyId,
    uploadedById: auth.userId,
    kind: 'PHOTO',
    file,
    maxBytes: 15 * 1_048_576,
    imagesOnly: true,
  });
  await db.fileAsset.update({ where: { id: asset.id }, data: { yardReceiptId: receiptId } });
  await fileDocument({ companyId: r.companyId, docType: 'RECEIPT_PHOTO', fileId: asset.id, vars: { job: r.yard.name } });
  await audit(db, auth, 'yard.receipt_photo', 'YardReceipt', receiptId, null, { fileId: asset.id });
  return { id: asset.id, url: fileUrl(asset.id)! };
}

type ReceiptLineRow = Awaited<ReturnType<typeof loadReceipt>>['lines'][number];
const receiptLineLabel = (l: ReceiptLineRow) =>
  l.orderLine
    ? formatListLabel(l.orderLine.orderForm.site.jobNumber, l.orderLine.orderForm.listNo)
    : l.poLine?.purchaseOrder.equipment
      ? `Unit ${l.poLine.purchaseOrder.equipment.unitNumber}`
      : `PO ${l.poLine?.purchaseOrder.poNumber ?? ''}`;

function summarize(r: Awaited<ReturnType<typeof loadReceipt>>): ReceiptSummary {
  return {
    id: r.id,
    receivedAt: r.receivedAt.toISOString(),
    receivedByName: r.receivedBy.name,
    yardName: r.yard.name,
    poNumbers: [...new Set(r.lines.map((l) => l.poLine?.purchaseOrder.poNumber).filter((x): x is string => !!x))],
    orderLabels: [...new Set(r.lines.map((l) => receiptLineLabel(l)))],
    lineCount: r.lines.length,
    problemCount: r.lines.filter((l) => l.problem || n(l.qtyReceived) < n(l.qtyExpected) - 1e-6).length,
    photoCount: r.photos.length,
  };
}

export async function listReceipts(auth: AuthContext, yardId?: string): Promise<ReceiptSummary[]> {
  requirePermission(auth, 'yard:view');
  const companies = await accessibleCompanyIds(auth);
  const ids = await db.yardReceipt.findMany({
    where: { organizationId: auth.orgId, companyId: { in: companies }, returnBolId: null, ...(yardId ? { yardId } : {}) },
    select: { id: true },
    orderBy: { receivedAt: 'desc' },
    take: 30,
  });
  return Promise.all(ids.map(async ({ id }) => summarize(await loadReceipt(auth, id))));
}

export async function getReceipt(auth: AuthContext, id: string): Promise<ReceiptDetail> {
  requirePermission(auth, 'yard:view');
  const r = await loadReceipt(auth, id);
  return {
    ...summarize(r),
    notes: r.notes,
    lines: r.lines
      .map((l) => ({
        lineNo: l.orderLine?.lineNo ?? l.poLine?.lineNo ?? 0,
        orderLabel: receiptLineLabel(l),
        description: l.orderLine?.description ?? l.poLine?.description ?? '',
        uom: l.orderLine?.uom ?? l.poLine?.uom ?? 'EA',
        poNumber: l.poLine?.purchaseOrder.poNumber ?? null,
        qtyExpected: n(l.qtyExpected),
        qtyReceived: n(l.qtyReceived),
        problem: l.problem,
        problemNote: l.problemNote,
      }))
      .sort((a, b) => a.orderLabel.localeCompare(b.orderLabel) || a.lineNo - b.lineNo),
    photos: r.photos.map((p) => ({ id: p.id, url: fileUrl(p.id)!, fileName: p.fileName })),
  };
}

// ---------------------------------------------------------------------------
// Yard inventory
// ---------------------------------------------------------------------------
export async function yardInventory(auth: AuthContext, yardId?: string): Promise<YardInventoryRow[]> {
  requirePermission(auth, 'yard:view');
  const companies = await accessibleCompanyIds(auth);
  const rows = await db.inventoryLot.findMany({
    where: {
      organizationId: auth.orgId,
      companyId: { in: companies },
      qtyAvailable: { gt: 0 },
      status: 'IN_STOCK',
      location: { site: { type: 'YARD', ...(yardId ? { id: yardId } : {}) } },
    },
    include: {
      location: { select: { businessName: true, siteId: true, site: { select: { name: true } } } },
      orderLine: { include: { orderForm: { include: { site: { select: { jobNumber: true, name: true } }, company: { select: { name: true } } } } } },
      yardReceiptLine: { include: { poLine: { include: { purchaseOrder: { select: { poNumber: true } } } } } },
      equipment: { select: { unitNumber: true, description: true } },
      company: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
  return rows.map((r) => ({
    id: r.id,
    yardId: r.location.siteId ?? '',
    yardName: r.location.site?.name ?? r.location.businessName,
    companyName: r.company.name,
    source: r.source,
    description: r.description,
    uom: r.uom,
    qtyAvailable: n(r.qtyAvailable),
    qtyIn: n(r.qtyIn),
    orderId: r.orderLine?.orderFormId ?? null,
    orderLabel: r.orderLine ? formatListLabel(r.orderLine.orderForm.site.jobNumber, r.orderLine.orderForm.listNo) : null,
    siteName: r.orderLine?.orderForm.site.name ?? null,
    lineNo: r.orderLine?.lineNo ?? null,
    equipmentLabel: r.equipment ? `Unit ${r.equipment.unitNumber} · ${r.equipment.description}` : null,
    poNumber: r.yardReceiptLine?.poLine?.purchaseOrder.poNumber ?? null,
    receivedAt: r.createdAt.toISOString(),
  }));
}
