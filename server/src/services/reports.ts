// Ready-made reports. Each returns columns + rows, so the screen can show it and
// the usual Excel / PDF buttons can export it.

import { REPORTS, type ReportKey, type ReportResult } from '@supplyline/core/models';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest } from '../lib/errors';
import { accessibleCompanyIds } from './access';

const money = (n: number) => Math.round(n * 100) / 100;
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

export async function runReport(auth: AuthContext, key: ReportKey, f: { from: string; to: string; companyId?: string }): Promise<ReportResult> {
  requirePermission(auth, key === 'action-items' ? 'meeting:run' : 'reports:view');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from) || !/^\d{4}-\d{2}-\d{2}$/.test(f.to)) throw badRequest('Pick a from and to date.');
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw badRequest('Unknown report.');
  const all = await accessibleCompanyIds(auth);
  const companies = f.companyId ? all.filter((c) => c === f.companyId) : all;
  const range = { gte: day(f.from), lte: new Date(`${f.to}T23:59:59Z`) };
  const title = `${def.label} — ${f.from} to ${f.to}`;

  if (key === 'spend-by-job') {
    const pos = await db.purchaseOrder.findMany({
      where: { companyId: { in: companies }, status: { in: ['ISSUED', 'CLOSED'] }, OR: [{ orderedDate: range }, { orderedDate: null, createdAt: range }] },
      include: { site: { select: { jobNumber: true, name: true } }, lines: { include: { yardReceiptLines: { select: { qtyReceived: true } } } }, apInvoices: { where: { status: { in: ['APPROVED', 'PAID', 'IN_APPROVAL'] } }, select: { subtotal: true } } },
    });
    const by = new Map<string, { job: string; pos: number; committed: number; received: number; invoiced: number }>();
    for (const po of pos) {
      const k = po.site ? `${po.site.jobNumber} ${po.site.name}` : 'Not for a job (equipment / stock)';
      const r = by.get(k) ?? { job: k, pos: 0, committed: 0, received: 0, invoiced: 0 };
      r.pos++;
      for (const l of po.lines) {
        const cost = Number(l.unitCost ?? 0);
        r.committed += cost * Number(l.qty);
        r.received += cost * l.yardReceiptLines.reduce((s, x) => s + Number(x.qtyReceived), 0);
      }
      r.invoiced += po.apInvoices.reduce((s, i) => s + Number(i.subtotal ?? 0), 0);
      by.set(k, r);
    }
    return {
      key,
      title,
      columns: [
        { key: 'job', label: 'Job' },
        { key: 'pos', label: 'POs', align: 'right' },
        { key: 'committed', label: 'Committed ($)', align: 'right' },
        { key: 'received', label: 'Received ($)', align: 'right' },
        { key: 'invoiced', label: 'Invoiced ($)', align: 'right' },
      ],
      rows: [...by.values()].sort((a, b) => b.committed - a.committed).map((r) => ({ ...r, committed: money(r.committed), received: money(r.received), invoiced: money(r.invoiced) })),
    };
  }

  if (key === 'vendor-on-time') {
    const lines = await db.yardReceiptLine.findMany({
      where: { purchaseOrderLineId: { not: null }, yardReceipt: { companyId: { in: companies }, receivedAt: range } },
      include: { yardReceipt: { select: { receivedAt: true } }, poLine: { include: { purchaseOrder: { include: { vendor: { select: { name: true } } } } } } },
    });
    const by = new Map<string, { vendor: string; received: number; onTime: number; late: number; noDate: number; daysLate: number }>();
    for (const l of lines) {
      const po = l.poLine?.purchaseOrder;
      if (!po) continue;
      const r = by.get(po.vendor.name) ?? { vendor: po.vendor.name, received: 0, onTime: 0, late: 0, noDate: 0, daysLate: 0 };
      r.received++;
      const due = l.poLine!.vendorEta ?? po.expectedDate;
      if (!due) r.noDate++;
      else {
        const d = daysBetween(due, new Date(l.yardReceipt.receivedAt.toISOString().slice(0, 10)));
        if (d <= 0) r.onTime++;
        else {
          r.late++;
          r.daysLate += d;
        }
      }
      by.set(po.vendor.name, r);
    }
    return {
      key,
      title,
      columns: [
        { key: 'vendor', label: 'Vendor' },
        { key: 'received', label: 'Lines received', align: 'right' },
        { key: 'onTimePct', label: 'On time %', align: 'right' },
        { key: 'late', label: 'Late', align: 'right' },
        { key: 'avgLate', label: 'Avg days late', align: 'right' },
        { key: 'noDate', label: 'No date given', align: 'right' },
      ],
      rows: [...by.values()]
        .map((r) => ({ vendor: r.vendor, received: r.received, onTimePct: r.onTime + r.late ? Math.round((r.onTime / (r.onTime + r.late)) * 100) : null, late: r.late, avgLate: r.late ? Math.round((r.daysLate / r.late) * 10) / 10 : null, noDate: r.noDate }))
        .sort((a, b) => (a.onTimePct ?? 101) - (b.onTimePct ?? 101)),
    };
  }

  if (key === 'deliveries') {
    const bols = await db.billOfLading.findMany({
      where: { companyId: { in: companies }, direction: 'OUTBOUND', status: { in: ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'] }, issuedAt: range },
      include: { site: { select: { jobNumber: true, name: true } }, lines: { include: { orderLine: { select: { unitWeightKg: true } } } } },
    });
    const by = new Map<string, { job: string; loads: number; items: number; weightKg: number; received: number }>();
    for (const b of bols) {
      const k = b.site ? `${b.site.jobNumber} ${b.site.name}` : 'Other';
      const r = by.get(k) ?? { job: k, loads: 0, items: 0, weightKg: 0, received: 0 };
      r.loads++;
      r.items += b.lines.length;
      r.weightKg += b.lines.reduce((s, l) => s + Number(l.qty) * Number(l.orderLine?.unitWeightKg ?? 0), 0);
      if (b.status === 'RECEIVED') r.received++;
      by.set(k, r);
    }
    return {
      key,
      title,
      columns: [
        { key: 'job', label: 'Job' },
        { key: 'loads', label: 'BOLs', align: 'right' },
        { key: 'received', label: 'Fully received', align: 'right' },
        { key: 'items', label: 'Lines', align: 'right' },
        { key: 'weightKg', label: 'Est. weight (kg)', align: 'right' },
      ],
      rows: [...by.values()].sort((a, b) => b.loads - a.loads).map((r) => ({ ...r, weightKg: Math.round(r.weightKg) || null })),
    };
  }

  if (key === 'order-turnaround') {
    const lists = await db.orderForm.findMany({
      where: { companyId: { in: companies }, submittedAt: range, status: { not: 'DRAFT' } },
      include: { site: { select: { jobNumber: true, name: true } }, lines: { select: { status: true, statusChangedAt: true } } },
    });
    const by = new Map<string, { job: string; lists: number; lines: number; delivered: number; days: number[] }>();
    for (const o of lists) {
      const k = `${o.site.jobNumber} ${o.site.name}`;
      const r = by.get(k) ?? { job: k, lists: 0, lines: 0, delivered: 0, days: [] };
      r.lists++;
      for (const l of o.lines) {
        if (l.status === 'CANCELLED') continue;
        r.lines++;
        if (l.status === 'RECEIVED_ON_SITE' && l.statusChangedAt && o.submittedAt) {
          r.delivered++;
          r.days.push(Math.max(0, daysBetween(o.submittedAt, l.statusChangedAt)));
        }
      }
      by.set(k, r);
    }
    const median = (xs: number[]) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
    };
    return {
      key,
      title,
      columns: [
        { key: 'job', label: 'Job' },
        { key: 'lists', label: 'Lists', align: 'right' },
        { key: 'lines', label: 'Lines', align: 'right' },
        { key: 'deliveredPct', label: 'On site %', align: 'right' },
        { key: 'median', label: 'Median days to site', align: 'right' },
        { key: 'max', label: 'Longest (days)', align: 'right' },
      ],
      rows: [...by.values()].map((r) => ({ job: r.job, lists: r.lists, lines: r.lines, deliveredPct: r.lines ? Math.round((r.delivered / r.lines) * 100) : null, median: median(r.days), max: r.days.length ? Math.max(...r.days) : null })),
    };
  }

  if (key === 'action-items') {
    const items = await db.meetingActionItem.findMany({ where: { organizationId: auth.orgId, createdAt: range, meeting: { companyId: { in: companies } } } });
    const today = new Date(new Date().toISOString().slice(0, 10));
    const by = new Map<string, { who: string; open: number; overdue: number; done: number }>();
    for (const a of items) {
      const k = a.assigneeName ?? 'No one';
      const r = by.get(k) ?? { who: k, open: 0, overdue: 0, done: 0 };
      if (a.status === 'DONE') r.done++;
      else if (a.status === 'OPEN') {
        r.open++;
        if (a.dueDate && a.dueDate < today) r.overdue++;
      }
      by.set(k, r);
    }
    return {
      key,
      title,
      columns: [
        { key: 'who', label: 'Person' },
        { key: 'open', label: 'Open', align: 'right' },
        { key: 'overdue', label: 'Overdue', align: 'right' },
        { key: 'done', label: 'Done', align: 'right' },
      ],
      rows: [...by.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open),
    };
  }

  // ap-aging: approved, not paid, by age of the invoice date (as of "to")
  const asOf = day(f.to);
  const inv = await db.apInvoice.findMany({ where: { companyId: { in: companies }, status: 'APPROVED' }, include: { vendor: { select: { name: true } } } });
  const by = new Map<string, { vendor: string; current: number; d30: number; d60: number; d90: number; total: number }>();
  for (const a of inv) {
    const k = a.vendor?.name ?? a.vendorName ?? 'Vendor';
    const r = by.get(k) ?? { vendor: k, current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
    const amt = Number(a.total ?? 0) - Number(a.holdbackAmount ?? 0);
    const age = a.invoiceDate ? daysBetween(a.invoiceDate, asOf) : 0;
    if (age <= 30) r.current += amt;
    else if (age <= 60) r.d30 += amt;
    else if (age <= 90) r.d60 += amt;
    else r.d90 += amt;
    r.total += amt;
    by.set(k, r);
  }
  return {
    key,
    title: `${def.label} — as of ${f.to}`,
    columns: [
      { key: 'vendor', label: 'Vendor' },
      { key: 'current', label: '0–30 days', align: 'right' },
      { key: 'd30', label: '31–60', align: 'right' },
      { key: 'd60', label: '61–90', align: 'right' },
      { key: 'd90', label: 'Over 90', align: 'right' },
      { key: 'total', label: 'Total ($)', align: 'right' },
    ],
    rows: [...by.values()].sort((a, b) => b.total - a.total).map((r) => ({ vendor: r.vendor, current: money(r.current), d30: money(r.d30), d60: money(r.d60), d90: money(r.d90), total: money(r.total) })),
  };
}
