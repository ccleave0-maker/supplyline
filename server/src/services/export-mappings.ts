// Export mappings: the columns, names and order another system (Sage Intacct or
// anything else) wants, saved once and run for any date range as Excel or CSV.

import ExcelJS from 'exceljs';
import { EXPORT_DATASETS, type ExportDataset, type ExportMappingInput, type ExportMappingView } from '@supplyline/core/models';
import { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { accessibleCompanyIds, assertCompanyAccessible } from './access';

const view = (m: { id: string; name: string; target: string; dataset: string; companyId: string | null; format: string; dateFormat: string; mapping: unknown; updatedAt: Date; schedule: unknown; recipients: string[]; fileToNetwork: boolean; lastSentAt: Date | null }): ExportMappingView => ({
  id: m.id,
  name: m.name,
  target: m.target,
  dataset: m.dataset as ExportDataset,
  companyId: m.companyId,
  format: m.format as ExportMappingView['format'],
  dateFormat: m.dateFormat as ExportMappingView['dateFormat'],
  columns: Array.isArray(m.mapping) ? (m.mapping as ExportMappingView['columns']) : [],
  updatedAt: m.updatedAt.toISOString(),
  schedule: (m.schedule as ExportMappingView['schedule']) ?? null,
  recipients: m.recipients,
  fileToNetwork: m.fileToNetwork,
  lastSentAt: m.lastSentAt?.toISOString() ?? null,
});

export async function listExportMappings(auth: AuthContext): Promise<ExportMappingView[]> {
  requirePermission(auth, 'export:run');
  const rows = await db.exportMapping.findMany({ where: { organizationId: auth.orgId }, orderBy: { name: 'asc' } });
  return rows.map(view);
}

export async function saveExportMapping(auth: AuthContext, id: string | null, input: Omit<ExportMappingInput, 'recipients' | 'fileToNetwork'> & Partial<Pick<ExportMappingInput, 'recipients' | 'fileToNetwork'>>) {
  requirePermission(auth, 'integrations:manage');
  if (input.companyId) await assertCompanyAccessible(auth, input.companyId);
  const known = new Set<string>(EXPORT_DATASETS[input.dataset].fields.map((f) => f[0]));
  for (const c of input.columns) if (c.field !== 'fixed' && !known.has(c.field)) throw badRequest(`Unknown column "${c.field}".`);
  const data = { name: input.name, target: input.target, dataset: input.dataset, companyId: input.companyId ?? null, format: input.format, dateFormat: input.dateFormat, mapping: input.columns, schedule: input.schedule ?? Prisma.DbNull, recipients: input.recipients ?? [], fileToNetwork: input.fileToNetwork ?? false };
  if (input.schedule && !input.recipients?.length && !input.fileToNetwork) throw badRequest('Add who gets it (or file it to the network folder), or turn the schedule off.');
  let m;
  if (id) {
    const existing = await db.exportMapping.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!existing) throw notFound('Export mapping');
    m = await db.exportMapping.update({ where: { id }, data });
  } else m = await db.exportMapping.create({ data: { organizationId: auth.orgId, ...data } });
  await audit(db, auth, id ? 'export_mapping.update' : 'export_mapping.create', 'ExportMapping', m.id, null, { name: input.name, dataset: input.dataset });
  return view(m);
}

export async function deleteExportMapping(auth: AuthContext, id: string) {
  requirePermission(auth, 'integrations:manage');
  const m = await db.exportMapping.findFirst({ where: { id, organizationId: auth.orgId } });
  if (!m) throw notFound('Export mapping');
  await db.exportMapping.delete({ where: { id } });
  await audit(db, auth, 'export_mapping.delete', 'ExportMapping', id, { name: m.name, dataset: m.dataset }, null);
  return { ok: true };
}

type Cell = string | number | boolean | Date | null;
type Row = Record<string, Cell>;

const num = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d));
const day = (start: string, end: string) => ({ gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T23:59:59Z`) });

/** All the rows for a dataset in the date range (fields named as in EXPORT_DATASETS). */
export async function datasetRows(auth: AuthContext, dataset: ExportDataset, from: string, to: string, companyId: string | null): Promise<Row[]> {
  const companyIds = companyId ? [companyId] : await accessibleCompanyIds(auth);
  const companies = new Map((await db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, code: true } })).map((c) => [c.id, c.code]));
  const range = day(from, to);

  if (dataset === 'ORDER_LINES') {
    const lines = await db.orderLine.findMany({
      where: { companyId: { in: companyIds }, orderForm: { submittedAt: range }, status: { not: 'DRAFT' } },
      include: {
        site: { select: { jobNumber: true, name: true } },
        orderForm: { select: { listNo: true, companySeq: true, submittedAt: true } },
        poLines: { where: { purchaseOrder: { status: { in: ['ISSUED', 'CLOSED'] } } }, include: { purchaseOrder: { select: { poNumber: true, vendor: { select: { name: true } } } } } },
      },
      orderBy: [{ orderForm: { submittedAt: 'asc' } }, { lineNo: 'asc' }],
    });
    return lines.map((l) => {
      const unitCost = num(l.unitCost) ?? num(l.poLines[0]?.unitCost);
      return {
        company: companies.get(l.companyId) ?? '',
        jobNumber: l.site.jobNumber,
        jobName: l.site.name,
        orderLabel: `JOB#${l.site.jobNumber} LIST#${l.orderForm.listNo ?? ''}`,
        companySeq: l.orderForm.companySeq,
        lineNo: l.lineNo,
        description: l.description,
        quantity: Number(l.quantity),
        uom: l.uom,
        costCode: l.costCode,
        orderedBy: l.orderedByInitials,
        requiredOnSite: l.requiredOnSite,
        submittedAt: l.orderForm.submittedAt,
        status: l.status,
        poNumbers: [...new Set(l.poLines.map((p) => p.purchaseOrder.poNumber))].join(', '),
        vendors: [...new Set(l.poLines.map((p) => p.purchaseOrder.vendor.name))].join(', '),
        unitCost,
        extendedCost: unitCost == null ? null : Math.round(unitCost * Number(l.quantity) * 100) / 100,
      };
    });
  }

  if (dataset === 'PO_LINES') {
    const lines = await db.purchaseOrderLine.findMany({
      where: { purchaseOrder: { companyId: { in: companyIds }, status: { notIn: ['DRAFT', 'CANCELLED'] }, OR: [{ orderedDate: range }, { orderedDate: null, createdAt: range }] } },
      include: {
        orderLine: { select: { lineNo: true, description: true, uom: true, costCode: true } },
        yardReceiptLines: { select: { qtyReceived: true } },
        purchaseOrder: { include: { vendor: { select: { name: true } }, site: { select: { jobNumber: true } }, equipment: { select: { unitNumber: true } } } },
      },
      orderBy: [{ purchaseOrder: { poNumber: 'asc' } }, { lineNo: 'asc' }],
    });
    return lines.map((l, i) => {
      const po = l.purchaseOrder;
      const qty = Number(l.qty);
      const unitCost = num(l.unitCost);
      return {
        company: companies.get(po.companyId) ?? '',
        poNumber: po.poNumber,
        vendor: po.vendor.name,
        status: po.status,
        orderedDate: po.orderedDate ?? po.createdAt,
        expectedDate: po.expectedDate,
        jobNumber: po.site?.jobNumber ?? null,
        unit: po.equipment?.unitNumber ?? null,
        lineNo: l.lineNo ?? l.orderLine?.lineNo ?? i + 1,
        description: l.description ?? l.orderLine?.description ?? '',
        qty,
        uom: l.uom ?? l.orderLine?.uom ?? '',
        unitCost,
        amount: unitCost == null ? null : Math.round(unitCost * qty * 100) / 100,
        costCode: l.costCode ?? l.orderLine?.costCode ?? null,
        pstExempt: po.pstExempt,
        received: l.yardReceiptLines.reduce((s, r) => s + Number(r.qtyReceived), 0),
      };
    });
  }

  if (dataset === 'AP_INVOICES') {
    const rows = await db.apInvoice.findMany({
      where: { companyId: { in: companyIds }, status: { notIn: ['REJECTED', 'REPLACED'] }, OR: [{ invoiceDate: range }, { invoiceDate: null, createdAt: range }] },
      include: { vendor: { select: { name: true } }, purchaseOrder: { select: { poNumber: true } }, site: { select: { jobNumber: true } } },
      orderBy: { invoiceDate: 'asc' },
    });
    return rows.map((a) => ({
      company: companies.get(a.companyId) ?? '',
      vendor: a.vendor?.name ?? a.vendorName ?? '',
      invoiceNumber: a.invoiceNumber,
      type: a.kind,
      invoiceDate: a.invoiceDate,
      dueDate: a.dueDate,
      poNumber: a.purchaseOrder?.poNumber ?? a.poNumberText,
      jobNumber: a.site?.jobNumber ?? null,
      costCode: a.costCode,
      subtotal: num(a.subtotal),
      gst: num(a.gst),
      pst: num(a.pst),
      total: num(a.total),
      holdback: num(a.holdbackAmount),
      status: a.status,
      paidDate: a.paidAt,
      paymentRef: a.paymentRef,
    }));
  }

  if (dataset === 'SAGE_COMMITMENTS') {
    const lines = await db.purchaseOrderLine.findMany({
      where: { purchaseOrder: { companyId: { in: companyIds }, status: { in: ['ISSUED', 'CLOSED'] }, issuedAt: range } },
      include: { orderLine: { select: { costCode: true, lineNo: true } }, purchaseOrder: { include: { vendor: { select: { name: true, externalId: true } }, site: { select: { jobNumber: true } }, equipment: { select: { unitNumber: true } } } } },
      orderBy: [{ purchaseOrder: { poNumber: 'asc' } }, { lineNo: 'asc' }],
    });
    return lines.map((l, i) => {
      const po = l.purchaseOrder;
      const unitCost = num(l.unitCost);
      return {
        company: companies.get(po.companyId) ?? '',
        poNumber: po.poNumber,
        orderedDate: po.orderedDate ?? po.issuedAt,
        vendor: po.vendor.name,
        vendorId: po.vendor.externalId,
        jobNumber: po.site?.jobNumber ?? (po.equipment ? `EQ-${po.equipment.unitNumber}` : null),
        costCode: l.costCode ?? l.orderLine?.costCode ?? null,
        lineNo: l.lineNo ?? i + 1,
        description: l.description ?? '',
        qty: Number(l.qty),
        uom: l.uom ?? '',
        unitCost,
        amount: unitCost == null ? null : Math.round(unitCost * Number(l.qty) * 100) / 100,
        currency: 'CAD',
      };
    });
  }

  if (dataset === 'SAGE_DRAWDOWN') {
    const lines = await db.apInvoiceLine.findMany({
      where: { poLineId: { not: null }, invoice: { companyId: { in: companyIds }, status: { in: ['APPROVED', 'PAID'] }, OR: [{ approvedAt: range }, { approvedAt: null, invoiceDate: range }] } },
      include: {
        invoice: { include: { vendor: { select: { name: true, externalId: true } } } },
        poLine: { include: { orderLine: { select: { costCode: true } }, purchaseOrder: { select: { poNumber: true, companyId: true, site: { select: { jobNumber: true } }, equipment: { select: { unitNumber: true } } } } } },
      },
      orderBy: [{ invoice: { invoiceDate: 'asc' } }, { lineNo: 'asc' }],
    });
    return lines.map((l) => {
      const po = l.poLine!.purchaseOrder;
      const amount = num(l.amount) ?? (num(l.unitPrice) != null && num(l.qty) != null ? Math.round(num(l.unitPrice)! * num(l.qty)! * 100) / 100 : null);
      return {
        company: companies.get(po.companyId) ?? '',
        poNumber: po.poNumber,
        poLineNo: l.poLine!.lineNo,
        invoiceNumber: l.invoice.invoiceNumber,
        invoiceDate: l.invoice.invoiceDate,
        vendor: l.invoice.vendor?.name ?? l.invoice.vendorName ?? '',
        vendorId: l.invoice.vendor?.externalId ?? null,
        jobNumber: po.site?.jobNumber ?? (po.equipment ? `EQ-${po.equipment.unitNumber}` : null),
        costCode: l.poLine!.costCode ?? l.poLine!.orderLine?.costCode ?? null,
        description: l.description,
        qty: num(l.qty) == null ? null : -num(l.qty)!,
        amount: amount == null ? null : -amount,
        currency: 'CAD',
      };
    });
  }

  const rows = await db.arInvoice.findMany({
    where: { companyId: { in: companyIds }, status: { not: 'VOID' }, invoiceDate: range },
    include: { customer: { select: { name: true } }, site: { select: { jobNumber: true } } },
    orderBy: { invoiceDate: 'asc' },
  });
  return rows.map((a) => ({
    company: companies.get(a.companyId) ?? '',
    customer: a.customer.name,
    invoiceNumber: a.invoiceNumber,
    invoiceDate: a.invoiceDate,
    dueDate: a.dueDate,
    jobNumber: a.site?.jobNumber ?? null,
    subtotal: num(a.subtotal),
    gst: num(a.gst),
    pst: num(a.pst),
    total: num(a.total),
    holdback: num(a.holdbackAmount),
    paid: num(a.amountPaid),
    balance: Math.round((Number(a.total) - Number(a.amountPaid)) * 100) / 100,
    status: a.status,
  }));
}

function fmtDate(d: Date, f: ExportMappingInput['dateFormat']) {
  const [y, m, dd] = d.toISOString().slice(0, 10).split('-');
  return f === 'MM/DD/YYYY' ? `${m}/${dd}/${y}` : f === 'DD/MM/YYYY' ? `${dd}/${m}/${y}` : `${y}-${m}-${dd}`;
}

/** Text that would start a spreadsheet formula (=, +, -, @) gets a leading ' — plain numbers like -100 stay as they are. */
export const formulaSafe = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^[+-]?\d+(\.\d+)?$/.test(v) ? `'${v}` : v);
const csvCell = (raw: string) => {
  const v = formulaSafe(raw);
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export async function runExportMapping(auth: AuthContext, id: string, from: string, to: string): Promise<{ bytes: Uint8Array; fileName: string; contentType: string; rows: number }> {
  requirePermission(auth, 'export:run');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest('Pick a from and to date.');
  const m = await db.exportMapping.findFirst({ where: { id, organizationId: auth.orgId } });
  if (!m) throw notFound('Export mapping');
  const map = view(m);
  if (map.companyId) await assertCompanyAccessible(auth, map.companyId);
  const data = await datasetRows(auth, map.dataset, from, to, map.companyId ?? null);
  const table = data.map((r) =>
    map.columns.map((c) => {
      const v = c.fixed !== undefined && (c.field === 'fixed' || !(c.field in r)) ? c.fixed : r[c.field];
      if (v == null) return '';
      if (v instanceof Date) return fmtDate(v, map.dateFormat);
      if (typeof v === 'boolean') return v ? 'Y' : 'N';
      return v;
    }),
  );
  const base = `${map.name.replace(/[^\w\- ]+/g, ' ').trim().replace(/\s+/g, '-') || 'export'}-${from}-to-${to}`;
  await audit(db, auth, 'export_mapping.run', 'ExportMapping', id, null, { from, to, rows: table.length });
  if (map.format === 'csv') {
    const text = [map.columns.map((c) => csvCell(c.header)), ...table.map((r) => r.map((v) => csvCell(String(v))))].map((r) => r.join(',')).join('\r\n') + '\r\n';
    return { bytes: new TextEncoder().encode(text), fileName: `${base}.csv`, contentType: 'text/csv; charset=utf-8', rows: table.length };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bowron';
  const ws = wb.addWorksheet('Export');
  const head = ws.addRow(map.columns.map((c) => c.header));
  head.font = { bold: true };
  for (const r of table) ws.addRow(r);
  map.columns.forEach((c, i) => (ws.getColumn(i + 1).width = Math.min(40, Math.max(10, c.header.length + 2))));
  return { bytes: new Uint8Array(await wb.xlsx.writeBuffer()), fileName: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', rows: table.length };
}
