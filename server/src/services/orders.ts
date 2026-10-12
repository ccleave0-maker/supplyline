import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import { Prisma } from '../generated/prisma/client';
import {
  canCancelLine,
  checkDraftRows,
  counterKeys,
  deriveOrderStatus,
  extendedCost,
  formatListLabel,
  siteInventoryView,
  type LineStatus,
  qrPayload,
} from '@supplyline/core/domain';
import {
  draftRowSchema,
  isBlankRow,
  type DraftRow,
  type OrderDetail,
  type OrderEmailStatus,
  type OrderSummary,
  type SaveDraftInput,
  type SiteInventoryRow,
  type SubmitResult,
} from '@supplyline/core/models';
import { can } from '@supplyline/core/permissions';
import { db } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { nextCounter } from '../lib/counters';
import { env } from '../lib/env';
import { ApiError, badRequest, conflict, notFound } from '../lib/errors';
import { publish } from '../lib/events';
import { sendEmail, viaName } from '../integrations/email';
import { renderOrderPdf } from '../pdf/order-pdf';
import { assertSiteVisible, siteWhereFor } from './access';
import { shipmentInclude, toShipments } from './shipments';
import { costCodesFor } from './cost-codes';
import { readFileAsset, saveUpload } from './files';
import { fileDocument, jobLabel } from './filing';
import { filingOf } from './filing';
import { recomputeLines } from './line-status';
import { moveToTrash } from './trash';
import { priceRolesOf } from './companies';
import { lineUnitCost } from './procurement';
import { sendTemplated } from './mail';
import { notifyJob } from './notify';

const orderInclude = {
  site: true,
  company: true,
  createdBy: { select: { name: true } },
  submittedBy: { select: { name: true, email: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: { poLines: { include: { purchaseOrder: { include: { vendor: true } } } }, customValues: true, bolLines: shipmentInclude },
  },
} satisfies Prisma.OrderFormInclude;

type OrderWithAll = Prisma.OrderFormGetPayload<{ include: typeof orderInclude }>;

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function parseDraftRows(json: unknown): DraftRow[] {
  const parsed = draftRowSchema.array().safeParse(json ?? []);
  return parsed.success ? parsed.data : [];
}

function toSummary(o: {
  id: string;
  siteId: string;
  companyId: string;
  listNo: number | null;
  companySeq: number | null;
  status: OrderSummary['status'];
  createdAt: Date;
  submittedAt: Date | null;
  draftRows: unknown;
  site: { jobNumber: string; name: string };
  company: { name: string };
  createdBy: { name: string };
  submittedBy: { name: string } | null;
  _lineCount: number;
}): OrderSummary {
  return {
    id: o.id,
    siteId: o.siteId,
    jobNumber: o.site.jobNumber,
    siteName: o.site.name,
    companyId: o.companyId,
    companyName: o.company.name,
    listNo: o.listNo,
    companySeq: o.companySeq,
    label: formatListLabel(o.site.jobNumber, o.listNo),
    status: o.status,
    lineCount: o.status === 'DRAFT' ? parseDraftRows(o.draftRows).filter((r) => !isBlankRow(r)).length : o._lineCount,
    createdAt: o.createdAt.toISOString(),
    createdByName: o.createdBy.name,
    submittedAt: o.submittedAt?.toISOString() ?? null,
    submittedByName: o.submittedBy?.name ?? null,
  };
}

async function emailStatusFor(orderId: string): Promise<OrderEmailStatus | null> {
  const rows = await db.emailOutbox.groupBy({
    by: ['status'],
    where: { relatedType: 'order', relatedId: orderId },
    _count: { _all: true },
  });
  if (rows.length === 0) return null;
  const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  const failed = n('FAILED');
  return { sent: n('SENT'), failed, warnings: failed ? [`${failed} email(s) could not be sent. An admin can check the email settings.`] : [] };
}

async function toDetail(auth: AuthContext, o: OrderWithAll): Promise<OrderDetail> {
  // Prices only for the roles the company allows, and the job's project manager.
  const showPrices = auth.roles.some((r) => priceRolesOf(o.company.settings).includes(r)) || o.site.projectManagerId === auth.userId;
  // Each line's PO (view / download): the job's project manager and people who can see POs.
  const openPos = can(auth, 'po:view') || o.site.projectManagerId === auth.userId;
  const codes = await costCodesFor(o.companyId, o.siteId);
  // Procurement columns the site is allowed to see.
  const shared = await db.customColumn.findMany({
    where: { companyId: o.companyId, sharedWithSite: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const sharedIds = new Set(shared.map((c) => c.id));
  const draft = o.status === 'DRAFT';
  // The next load bringing anything on this list.
  const upcoming = o.lines
    .flatMap((l) => toShipments(l.bolLines))
    .filter((x) => x.state !== 'DELIVERED' && x.date)
    .sort((a, b) => (a.date! + (a.time ?? '')).localeCompare(b.date! + (b.time ?? '')))[0];
  return {
    ...toSummary({ ...o, _lineCount: o.lines.length }),
    nextDelivery: upcoming ? { date: upcoming.date!, time: upcoming.time, bolId: upcoming.bolId, bolLabel: upcoming.bolLabel } : null,
    notes: o.notes,
    draftRows: draft ? parseDraftRows(o.draftRows) : [],
    lines: o.lines.map((l) => {
      const qty = Number(l.quantity);
      const unitCost = lineUnitCost(l);
      // ETA: the line's own, else its PO's expected delivery date (committed POs).
      const etas = l.poLines.filter((p) => p.purchaseOrder.status !== 'CANCELLED').map((p) => p.vendorEta ?? p.purchaseOrder.expectedDate).filter((d): d is Date => !!d);
      return {
        id: l.id,
        lineNo: l.lineNo,
        description: l.description,
        quantity: qty,
        uom: l.uom,
        costCode: l.costCode,
        orderedByInitials: l.orderedByInitials,
        requiredOnSite: dateOnly(l.requiredOnSite),
        status: l.status as LineStatus,
        poNumbers: [...new Set(l.poLines.map((p) => p.purchaseOrder.poNumber))],
        poLinks: openPos ? [...new Map(l.poLines.filter((p) => p.purchaseOrder.status !== 'DRAFT').map((p) => [p.purchaseOrder.id, { id: p.purchaseOrder.id, poNumber: p.purchaseOrder.poNumber }])).values()] : null,
        offListReason: l.offListReason,
        vendorNames: [...new Set(l.poLines.map((p) => p.purchaseOrder.vendor.name))],
        vendorEta: etas.length ? dateOnly(new Date(Math.max(...etas.map((d) => d.getTime())))) : null,
        unitCost: showPrices ? unitCost : null,
        extendedCost: showPrices ? extendedCost(qty, unitCost) : null,
        shipments: toShipments(l.bolLines),
        custom: Object.fromEntries(
          l.customValues.filter((v) => sharedIds.has(v.columnId)).map((v) => [v.columnId, v.value as string | number | boolean | null]),
        ),
      };
    }),
    canEdit: draft && can(auth, 'order:create'),
    canSubmit: draft && can(auth, 'order:create'),
    canCancelLines: !draft && can(auth, 'order:cancel-line'),
    customColumns: shared.map((c) => ({ id: c.id, name: c.name, dataType: c.dataType })),
    costCodes: codes.map((c) => ({ code: c.code, description: c.description })),
    email: draft ? null : await emailStatusFor(o.id),
  };
}

async function loadOrder(auth: AuthContext, id: string): Promise<OrderWithAll> {
  const o = await db.orderForm.findFirst({ where: { id, organizationId: auth.orgId }, include: orderInclude });
  if (!o) throw notFound('Order list');
  await assertSiteVisible(auth, o.siteId);
  return o;
}

export async function listOrders(
  auth: AuthContext,
  filter: { siteId?: string; companyId?: string; status?: OrderSummary['status'] },
): Promise<OrderSummary[]> {
  requirePermission(auth, 'order:view');
  const where: Prisma.OrderFormWhereInput = {
    organizationId: auth.orgId,
    site: await siteWhereFor(auth),
    ...(filter.siteId ? { siteId: filter.siteId } : {}),
    ...(filter.companyId ? { companyId: filter.companyId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
  };
  const rows = await db.orderForm.findMany({
    where,
    include: {
      site: { select: { jobNumber: true, name: true } },
      company: { select: { name: true } },
      createdBy: { select: { name: true } },
      submittedBy: { select: { name: true } },
      _count: { select: { lines: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 300,
  });
  return rows.map((o) => toSummary({ ...o, _lineCount: o._count.lines }));
}

export async function getOrder(auth: AuthContext, id: string): Promise<OrderDetail> {
  requirePermission(auth, 'order:view');
  return toDetail(auth, await loadOrder(auth, id));
}

export async function createDraft(auth: AuthContext, siteId: string): Promise<{ id: string }> {
  requirePermission(auth, 'order:create');
  const site = await assertSiteVisible(auth, siteId);
  if (site.type !== 'JOB' || !site.companyId) throw badRequest('Order lists are created for jobs, not yards.');
  if (!site.active) throw badRequest('This job is inactive.');
  const o = await db.orderForm.create({
    data: {
      organizationId: auth.orgId,
      companyId: site.companyId,
      siteId,
      createdById: auth.userId,
      draftRows: [],
    },
  });
  await audit(db, auth, 'order.create_draft', 'OrderForm', o.id, null, { siteId });
  publish(auth.orgId, { type: 'order.changed', orderId: o.id, siteId, companyId: site.companyId });
  return { id: o.id };
}

export async function saveDraft(auth: AuthContext, id: string, input: SaveDraftInput): Promise<{ ok: true; savedAt: string }> {
  requirePermission(auth, 'order:create');
  const o = await loadOrder(auth, id);
  if (o.status !== 'DRAFT') throw conflict('This list has already been submitted and can no longer be edited.');
  const updated = await db.orderForm.update({
    where: { id },
    data: { draftRows: input.rows, notes: input.notes ?? null },
  });
  // Drafts autosave often; audit only the fact, not every keystroke.
  publish(auth.orgId, { type: 'order.changed', orderId: id, siteId: o.siteId, companyId: o.companyId });
  return { ok: true, savedAt: updated.updatedAt.toISOString() };
}

export async function deleteDraft(auth: AuthContext, id: string) {
  requirePermission(auth, 'order:create');
  const o = await loadOrder(auth, id);
  if (o.status !== 'DRAFT') throw conflict('Submitted lists can’t be deleted. Cancel the lines instead.');
  const raw = await db.orderForm.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await moveToTrash(tx, auth, 'ORDER_DRAFT', id, `${formatListLabel(o.site.jobNumber, null)} – ${o.site.name}`, raw);
    await tx.orderForm.delete({ where: { id } });
  });
  publish(auth.orgId, { type: 'order.changed', orderId: id, siteId: o.siteId, companyId: o.companyId });
}

export async function recipientsFor(companyId: string, siteId: string, kind: 'PROCUREMENT' | 'YARD' | 'CC'): Promise<string[]> {
  const [company, site] = await Promise.all([
    db.companyEmailRecipient.findMany({ where: { companyId, kind }, select: { email: true } }),
    db.siteEmailRoute.findMany({ where: { siteId, kind }, select: { email: true } }),
  ]);
  return [...new Set([...company, ...site].map((r) => r.email.toLowerCase()))];
}

export async function buildOrderPdf(o: OrderWithAll): Promise<Buffer> {
  let logo: { data: Buffer; format: 'png' | 'jpg' } | null = null;
  if (o.company.logoFileId) {
    const f = await readFileAsset(o.company.logoFileId).catch(() => null);
    if (f && (f.file.mimeType === 'image/png' || f.file.mimeType === 'image/jpeg')) {
      logo = { data: Buffer.from(f.bytes), format: f.file.mimeType === 'image/png' ? 'png' : 'jpg' };
    }
  }
  const s = o.site;
  return renderOrderPdf({
    companyName: o.company.name,
    companyCode: o.company.code,
    themeColor: o.company.themeColor,
    logo,
    label: formatListLabel(s.jobNumber, o.listNo),
    qr: o.status === 'DRAFT' ? null : await QRCode.toBuffer(qrPayload({ kind: 'ORDER', id: o.id, label: formatListLabel(s.jobNumber, o.listNo) }), { type: 'png', margin: 1, width: 240 }),
    jobNumber: s.jobNumber,
    siteName: s.name,
    siteAddress: [s.address, s.city, s.province, s.postalCode].filter(Boolean).join(', ') || null,
    submittedAt: o.submittedAt,
    submittedBy: o.submittedBy?.name ?? null,
    notes: o.notes,
    lines:
      o.status === 'DRAFT'
        ? checkDraftRows(parseDraftRows(o.draftRows), []).lines.map((l, i) => ({ ...l, lineNo: i + 1, costCode: l.costCode ?? null, requiredOnSite: l.requiredOnSite ?? null }))
        : o.lines.map((l) => ({
            lineNo: l.lineNo,
            description: l.description,
            quantity: Number(l.quantity),
            uom: l.uom,
            costCode: l.costCode,
            orderedByInitials: l.orderedByInitials,
            requiredOnSite: dateOnly(l.requiredOnSite),
          })),
  });
}

export const pdfFileName = (jobNumber: string, listNo: number | null) =>
  `JOB${jobNumber.replace(/[^A-Za-z0-9-]/g, '')}-${listNo == null ? 'DRAFT' : `LIST${listNo}`}.pdf`;

export async function getOrderPdf(auth: AuthContext, id: string) {
  requirePermission(auth, 'order:view');
  const o = await loadOrder(auth, id);
  return { bytes: await buildOrderPdf(o), fileName: pdfFileName(o.site.jobNumber, o.listNo) };
}

async function sendOrderEmails(auth: AuthContext, o: OrderWithAll): Promise<OrderEmailStatus> {
  const label = formatListLabel(o.site.jobNumber, o.listNo);
  const [procurement, yard, cc] = await Promise.all([
    recipientsFor(o.companyId, o.siteId, 'PROCUREMENT'),
    recipientsFor(o.companyId, o.siteId, 'YARD'),
    recipientsFor(o.companyId, o.siteId, 'CC'),
  ]);
  const status: OrderEmailStatus = { sent: 0, failed: 0, warnings: [] };
  if (!procurement.length) status.warnings.push(`No procurement email is set up for ${o.company.name}. Add one under Companies or on the job profile.`);
  if (!yard.length) status.warnings.push(`No yard email is set up for ${o.company.name}, so the yard wasn't asked to check stock.`);
  if (!procurement.length && !yard.length) return status;

  let pdf: Buffer | null = null;
  try {
    pdf = await buildOrderPdf(o);
  } catch (e) {
    console.error('[orders] PDF failed', e);
    status.warnings.push('The PDF could not be created, so the emails were sent without it.');
  }
  // The PDF is filed so it stays attached even if an email waits for review.
  const fileIds: string[] = [];
  if (pdf) {
    const asset = await saveUpload({
      organizationId: auth.orgId,
      companyId: o.companyId,
      uploadedById: auth.userId,
      kind: 'ORDER_PDF',
      file: new File([new Uint8Array(pdf)], pdfFileName(o.site.jobNumber, o.listNo), { type: 'application/pdf' }),
      maxBytes: 20 * 1_048_576,
    }).catch(() => null);
    if (asset) {
      fileIds.push(asset.id);
      await fileDocument({ companyId: o.companyId, docType: 'ORDER_PDF', fileId: asset.id, vars: { job: await jobLabel(o.siteId) } });
    }
  }
  // Plain white Excel copy of the list for the network folder.
  if (filingOf(o.company.settings).enabled && filingOf(o.company.settings).types.includes('ORDER_XLSX')) {
    try {
      const xlsx = await orderXlsx(o);
      const asset = await saveUpload({
        organizationId: auth.orgId,
        companyId: o.companyId,
        uploadedById: auth.userId,
        kind: 'ORDER_XLSX',
        file: new File([new Uint8Array(xlsx)], pdfFileName(o.site.jobNumber, o.listNo).replace(/\.pdf$/i, '.xlsx'), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        maxBytes: 20 * 1_048_576,
      });
      await fileDocument({ companyId: o.companyId, docType: 'ORDER_XLSX', fileId: asset.id, vars: { job: await jobLabel(o.siteId) } });
    } catch (e) {
      console.error('[orders] excel copy failed', e);
    }
  }
  const common = {
    organizationId: auth.orgId,
    companyId: o.companyId,
    fromName: viaName(auth.name),
    replyTo: auth.email,
    cc,
    attachmentFileIds: fileIds,
    relatedType: 'order',
    relatedId: o.id,
    vars: {
      orderLabel: label,
      siteName: o.site.name,
      lineCount: o.lines.length,
      senderName: `${auth.name} (${auth.email})`,
      companyName: o.company.name,
      link: `${env().APP_URL.replace(/\/$/, '')}/orders/view/?id=${o.id}`,
    },
  };
  const results = await Promise.all([
    procurement.length ? sendTemplated({ ...common, key: 'ORDER_TO_PROCUREMENT', to: procurement }) : null,
    yard.length ? sendTemplated({ ...common, key: 'ORDER_TO_YARD', to: yard }) : null,
  ]);
  for (const r of results) if (r) r.state === 'FAILED' ? status.failed++ : status.sent++;
  if (status.failed) status.warnings.push(`${status.failed} email(s) could not be sent. They're saved and can be retried.`);
  return status;
}

/**
 * Finalize/Submit: numbers the list (per job + per company), turns draft rows
 * into lines, adds every line to the job's site inventory, then emails
 * procurement and the yard.
 */
export async function submitOrder(auth: AuthContext, id: string): Promise<SubmitResult> {
  requirePermission(auth, 'order:create');
  const draft = await loadOrder(auth, id);
  if (draft.status !== 'DRAFT') throw conflict('This list has already been submitted.');
  const codes = (await costCodesFor(draft.companyId, draft.siteId)).map((c) => c.code);
  const check = checkDraftRows(parseDraftRows(draft.draftRows), codes);
  if (!check.ok) throw new ApiError(400, 'invalid_rows', check.message!, { rows: check.errors });

  await db.$transaction(async (tx) => {
    // Lock the draft row so two people pressing Submit at once can't both submit it.
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text FROM "OrderForm" WHERE "id" = ${id} FOR UPDATE`;
    if (locked[0]?.status !== 'DRAFT') throw conflict('This list has already been submitted.');
    const listNo = await nextCounter(tx, counterKeys.jobList(draft.siteId));
    const companySeq = await nextCounter(tx, counterKeys.companyOrder(draft.companyId));
    const now = new Date();
    await tx.orderForm.update({
      where: { id },
      data: { listNo, companySeq, status: 'SUBMITTED', submittedById: auth.userId, submittedAt: now, draftRows: Prisma.DbNull },
    });
    for (const [i, l] of check.lines.entries()) {
      await tx.orderLine.create({
        data: {
          organizationId: auth.orgId,
          companyId: draft.companyId,
          siteId: draft.siteId,
          orderFormId: id,
          lineNo: i + 1,
          description: l.description,
          quantity: l.quantity,
          uom: l.uom,
          costCode: l.costCode ?? null,
          orderedByInitials: l.orderedByInitials,
          requiredOnSite: l.requiredOnSite ? new Date(`${l.requiredOnSite}T00:00:00Z`) : null,
          status: 'SUBMITTED',
          statusChangedAt: now,
          siteInventory: { create: { siteId: draft.siteId, qtyOrdered: l.quantity } },
        },
      });
    }
    await audit(tx, auth, 'order.submit', 'OrderForm', id, null, { listNo, companySeq, lines: check.lines.length });
  });

  const submitted = await loadOrder(auth, id);
  const email = await sendOrderEmails(auth, submitted);
  await notifyJob({
    organizationId: auth.orgId,
    siteId: submitted.siteId,
    event: 'ORDER_SUBMITTED',
    title: `${formatListLabel(submitted.site.jobNumber, submitted.listNo)} submitted`,
    subject: `${formatListLabel(submitted.site.jobNumber, submitted.listNo)} submitted – ${submitted.site.name}`,
    text: `${auth.name} submitted ${formatListLabel(submitted.site.jobNumber, submitted.listNo)} (${submitted.lines.length} line(s)) for ${submitted.site.name}.\n\nOpen in SupplyLine: ${env().APP_URL.replace(/\/$/, '')}/orders/view/?id=${id}`,
    link: `/orders/view/?id=${id}`,
    fromName: viaName(auth.name),
    replyTo: auth.email,
    relatedType: 'order',
    relatedId: id,
    exceptUserId: auth.userId,
  });
  publish(auth.orgId, { type: 'order.changed', orderId: id, siteId: submitted.siteId, companyId: submitted.companyId });
  const order = await toDetail(auth, submitted);
  order.email = { ...email, warnings: email.warnings };
  return { order, email };
}

export async function cancelLine(auth: AuthContext, orderId: string, lineId: string, reason: string | null) {
  requirePermission(auth, 'order:cancel-line');
  const o = await loadOrder(auth, orderId);
  const line = o.lines.find((l) => l.id === lineId);
  if (!line) throw notFound('Line');
  if (!canCancelLine(line.status as LineStatus)) {
    throw conflict(`L${line.lineNo} can't be cancelled because it is already ${line.status.toLowerCase().replace(/_/g, ' ')}.`);
  }
  await db.$transaction(async (tx) => {
    await tx.orderLine.update({ where: { id: lineId }, data: { cancelledAt: new Date() } });
    await recomputeLines(tx, [lineId]);
    await audit(tx, auth, 'order.line_cancel', 'OrderLine', lineId, { status: line.status }, { status: 'CANCELLED', reason });
  });

  const label = formatListLabel(o.site.jobNumber, o.listNo);
  const procurement = await recipientsFor(o.companyId, o.siteId, 'PROCUREMENT');
  if (procurement.length) {
    await sendEmail(
      {
        fromName: viaName(auth.name),
        replyTo: auth.email,
        to: procurement,
        subject: `${label} – L${line.lineNo} cancelled`,
        text:
          `${auth.name} cancelled L${line.lineNo} on ${label} (${o.site.name}).\n\n` +
          `${line.description} – ${Number(line.quantity)} ${line.uom}` +
          (reason ? `\nReason: ${reason}` : ''),
      },
      { organizationId: auth.orgId, relatedType: 'order', relatedId: orderId },
    );
  }
  publish(auth.orgId, { type: 'order.changed', orderId, siteId: o.siteId, companyId: o.companyId });
  return getOrder(auth, orderId);
}

export async function siteInventory(auth: AuthContext, siteId: string): Promise<SiteInventoryRow[]> {
  requirePermission(auth, 'order:view');
  await assertSiteVisible(auth, siteId);
  const rows = await db.siteInventoryItem.findMany({
    where: { siteId },
    include: {
      orderLine: {
        include: {
          orderForm: { select: { id: true, listNo: true, site: { select: { jobNumber: true } } } },
          poLines: { include: { purchaseOrder: { select: { id: true, poNumber: true } } } },
          bolLines: shipmentInclude,
          inventoryLots: { where: { qtyAvailable: { gt: 0 } }, select: { status: true, qtyAvailable: true, locationId: true } },
        },
      },
    },
  });
  const siteLocation = await db.shippingLocation.findUnique({ where: { siteId }, select: { id: true } });
  const sum = (xs: number[]) => Math.round(xs.reduce((a, x) => a + x, 0) * 1000) / 1000;
  return rows
    .map((r) => {
      const l = r.orderLine;
      const cancelled = l.status === 'CANCELLED';
      const v = siteInventoryView({
        qtyOrdered: cancelled ? 0 : Number(r.qtyOrdered),
        qtyShipped: Number(r.qtyShipped),
        qtyReceived: Number(r.qtyReceived),
        qtyReturned: Number(r.qtyReturned),
      });
      const pos = new Map(l.poLines.map((p) => [p.purchaseOrder.id, p.purchaseOrder.poNumber]));
      // On a truck right now: outbound BOLs that have left but not been received yet.
      const inTransit = sum(
        l.bolLines
          .filter((b) => b.bol.direction === 'OUTBOUND' && (b.bol.status === 'ISSUED' || b.bol.status === 'PARTIALLY_RECEIVED') && b.siteReceiptLines.length === 0)
          .map((b) => Number(b.qty)),
      );
      const staged = sum(l.inventoryLots.filter((x) => x.status === 'STAGED').map((x) => Number(x.qtyAvailable)));
      const onSite = sum(l.inventoryLots.filter((x) => x.locationId === siteLocation?.id).map((x) => Number(x.qtyAvailable)));
      return {
        orderLineId: l.id,
        orderId: l.orderForm.id,
        orderLabel: formatListLabel(l.orderForm.site.jobNumber, l.orderForm.listNo),
        lineNo: l.lineNo,
        description: l.description,
        uom: l.uom,
        status: l.status as LineStatus,
        qtyOrdered: Number(r.qtyOrdered),
        qtyShipped: v.qtyShipped,
        leftToShip: v.leftToShip,
        qtyReceived: v.qtyReceived,
        partiallyShipped: v.partiallyShipped,
        inTransit,
        staged,
        onSite,
        qtyReturned: v.qtyReturned,
        bolNumbers: [
          ...new Set(
            l.bolLines
              .filter((b) => b.bol.direction === 'OUTBOUND' && b.bol.bolNumber != null && b.bol.status !== 'CANCELLED')
              .map((b) => b.bol.bolNumber as number),
          ),
        ].sort((a, b) => a - b),
        poNumbers: [...pos].map(([purchaseOrderId, poNumber]) => ({ purchaseOrderId, poNumber })),
        shipments: toShipments(l.bolLines),
        _sort: [l.orderForm.listNo ?? 0, l.lineNo] as const,
      };
    })
    .sort((a, b) => a._sort[0] - b._sort[0] || a._sort[1] - b._sort[1])
    .map(({ _sort, ...row }) => row);
}

/** The order list as a plain white Excel sheet (no fills or colours), for the network copy. */
async function orderXlsx(o: OrderWithAll): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const label = formatListLabel(o.site.jobNumber, o.listNo);
  const ws = wb.addWorksheet(label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  ws.addRow([label]).font = { bold: true, size: 14 };
  ws.addRow([`${o.company.name} · JOB#${o.site.jobNumber} ${o.site.name}`]);
  ws.addRow([`Submitted ${o.submittedAt ? o.submittedAt.toISOString().slice(0, 10) : ''}${o.submittedBy ? ` by ${o.submittedBy.name}` : ''}`]);
  ws.addRow([]);
  const head = ws.addRow(['L#', 'Description', 'Qty', 'Unit', 'Cost code', 'Ordered by', 'Required on site', 'Status']);
  head.font = { bold: true };
  head.eachCell((c) => (c.border = { bottom: { style: 'thin' } }));
  for (const l of o.lines) ws.addRow([`L${l.lineNo}`, l.description, Number(l.quantity), l.uom, l.costCode ?? '', l.orderedByInitials, l.requiredOnSite ? l.requiredOnSite.toISOString().slice(0, 10) : '', l.status]);
  [6, 50, 10, 8, 12, 10, 16, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
