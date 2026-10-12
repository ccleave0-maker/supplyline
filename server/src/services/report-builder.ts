// Custom reports: sections from any data in SupplyLine (one job or all), the
// fields you pick, as Excel or PDF — saved, and sent on a schedule if you like.
// Also: export mappings on a schedule (e.g. Sage every week) and the Sunday
// update to each job's project manager.

import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_PM_WEEKLY, EXPORT_DATASETS, pmWeeklyInput, REPORT_SOURCES, type ExportDataset, type PmWeeklySettings, type ReportSchedule, type ReportSource, type SavedReportInput, type SavedReportView } from '@supplyline/core/models';
import { Prisma } from '../generated/prisma/client';
import { sendEmail } from '../integrations/email';
import { audit } from '../lib/audit';
import { can } from '@supplyline/core/permissions';
import { isAdmin, requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { renderTablePdf } from '../pdf/table-pdf';
import { accessibleCompanyIds, siteWhereFor } from './access';
import { systemAuth } from './ap-folders';
import { datasetRows } from './export-mappings';
import { logoForPdf, saveUpload } from './files';
import { fileDocument } from './filing';
import { jobMaterials } from './planning';

type Cell = string | number | boolean | Date | null;
type Row = Record<string, Cell>;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(new Date(`${s}T12:00:00Z`).getTime() + n * 86_400_000));

// ---------------------------------------------------------------------------
// Dates, in the company's time zone
// ---------------------------------------------------------------------------
function local(now = new Date()) {
  const tz = env().SCHEDULE_TIMEZONE;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday!);
  return { date, weekday, hour: Number(parts.hour), monthDay: Number(parts.day) };
}

export function periodRange(period: string, from?: string | null, to?: string | null, now = new Date()): { from: string; to: string } {
  const t = local(now);
  const monday = addDays(t.date, -((t.weekday + 6) % 7));
  switch (period) {
    case 'THIS_WEEK':
      return { from: monday, to: addDays(monday, 6) };
    case 'LAST_WEEK':
      return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case 'LAST_7':
      return { from: addDays(t.date, -6), to: t.date };
    case 'THIS_MONTH':
      return { from: `${t.date.slice(0, 8)}01`, to: t.date };
    case 'LAST_MONTH': {
      const first = `${t.date.slice(0, 8)}01`;
      const lastPrev = addDays(first, -1);
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
    }
    case 'NEXT_14':
      return { from: t.date, to: addDays(t.date, 13) };
    case 'ALL':
      return { from: '2000-01-01', to: addDays(t.date, 365) };
    case 'CUSTOM':
      if (!from || !to) throw badRequest('Pick the from and to dates.');
      return { from, to };
    default:
      return { from: addDays(t.date, -29), to: t.date };
  }
}

// ---------------------------------------------------------------------------
// Rows for each source
// ---------------------------------------------------------------------------
async function sourceRows(auth: AuthContext, source: ReportSource, range: { from: string; to: string }, f: { siteIds: string[]; companyId?: string | null }): Promise<Row[]> {
  const visible = await db.site.findMany({ where: { AND: [await siteWhereFor(auth), f.siteIds.length ? { id: { in: f.siteIds } } : {}] }, select: { id: true, jobNumber: true } });
  const jobNumbers = new Set(visible.map((s) => s.jobNumber));
  const companies = f.companyId ? [f.companyId] : await accessibleCompanyIds(auth);
  const onlyJobs = (rows: Row[]) => (f.siteIds.length ? rows.filter((r) => r.jobNumber != null && jobNumbers.has(String(r.jobNumber))) : rows);
  const codes = new Map((await db.company.findMany({ where: { id: { in: companies } }, select: { id: true, code: true } })).map((c) => [c.id, c.code]));
  const dateRange = { gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${range.to}T23:59:59Z`) };

  if (source in EXPORT_DATASETS) return onlyJobs(await datasetRows(auth, source as ExportDataset, range.from, range.to, f.companyId ?? null));

  if (source === 'JOB_MATERIALS') {
    const jobs = await jobMaterials(auth, { openOnly: false });
    const wanted = f.siteIds.length ? jobs.filter((j) => f.siteIds.includes(j.siteId)) : jobs;
    const lineIds = wanted.flatMap((j) => j.rows.map((r) => r.orderLineId));
    const extra = await db.orderLine.findMany({
      where: { id: { in: lineIds } },
      select: { id: true, poLines: { where: { purchaseOrder: { status: { in: ['ISSUED', 'CLOSED'] } } }, select: { vendorEta: true, purchaseOrder: { select: { poNumber: true, expectedDate: true } } } }, bolLines: { where: { bol: { status: { in: ['DRAFT', 'ISSUED'] } } }, select: { dropStop: { select: { plannedDate: true } } } } },
    });
    const ex = new Map(extra.map((x) => [x.id, x]));
    return wanted.flatMap((j) =>
      j.rows
        .filter((r) => r.receivedAtSite + 1e-6 < r.ordered)
        .map((r) => {
          const e = ex.get(r.orderLineId);
          const dates = [...(e?.bolLines.map((b) => b.dropStop.plannedDate) ?? []), ...(e?.poLines.map((p) => p.vendorEta ?? p.purchaseOrder.expectedDate) ?? [])].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
          return {
            jobNumber: j.siteLabel.replace(/^JOB#(\S+).*$/, '$1'),
            jobName: j.siteLabel.replace(/^JOB#\S+\s*/, ''),
            ref: r.ref,
            description: r.description,
            uom: r.uom,
            ordered: r.ordered,
            outstanding: r.outstanding,
            inYard: r.inYard,
            stagedToShip: r.stagedToShip,
            inTransit: r.inTransit,
            receivedAtSite: r.receivedAtSite,
            requiredOnSite: r.requiredOnSite,
            eta: dates[0] ? iso(dates[0]) : null,
            poNumbers: [...new Set(e?.poLines.map((p) => p.purchaseOrder.poNumber) ?? [])].join(', '),
          };
        }),
    );
  }

  if (source === 'LOADS') {
    const bols = await db.billOfLading.findMany({
      where: { companyId: { in: companies }, status: { not: 'CANCELLED' }, stops: { some: { plannedDate: dateRange } } },
      include: { site: { select: { jobNumber: true } }, carrier: { select: { name: true, businessName: true } }, trailer: { select: { name: true } }, stops: { orderBy: { seq: 'asc' }, include: { location: { select: { businessName: true } } } }, _count: { select: { lines: true } } },
      orderBy: { scheduledDate: 'asc' },
    });
    return onlyJobs(
      bols.map((b) => ({
        company: codes.get(b.companyId) ?? '',
        label: b.bolNumber ? `BOL #${b.bolNumber}` : 'Planned load',
        title: b.title,
        status: b.status,
        priority: b.priority,
        jobNumber: b.site?.jobNumber ?? null,
        pickup: b.stops.filter((s) => s.kind === 'PICKUP').map((s) => s.location.businessName).join(', '),
        drop: b.stops.filter((s) => s.kind === 'DROP').map((s) => s.location.businessName).join(', '),
        pickupDate: b.stops.find((s) => s.kind === 'PICKUP')?.plannedDate ?? null,
        deliveryDate: b.stops.filter((s) => s.kind === 'DROP').at(-1)?.plannedDate ?? null,
        carrier: b.carrier ? (b.carrier.businessName ?? b.carrier.name) : null,
        trailer: b.trailer?.name ?? null,
        items: b._count.lines,
      })),
    );
  }

  if (source === 'RECEIPTS') {
    const lines = await db.yardReceiptLine.findMany({
      where: { yardReceipt: { companyId: { in: companies }, receivedAt: dateRange } },
      include: { yardReceipt: { include: { yard: { select: { name: true } }, receivedBy: { select: { name: true } }, purchaseOrder: { select: { poNumber: true, site: { select: { jobNumber: true } }, vendor: { select: { name: true } } } } } }, poLine: { select: { description: true } }, orderLine: { select: { description: true } } },
      orderBy: { yardReceipt: { receivedAt: 'asc' } },
    });
    return onlyJobs(
      lines.map((l) => ({
        company: codes.get(l.yardReceipt.companyId) ?? '',
        receivedAt: l.yardReceipt.receivedAt,
        yard: l.yardReceipt.yard.name,
        poNumber: l.yardReceipt.purchaseOrder?.poNumber ?? null,
        vendor: l.yardReceipt.purchaseOrder?.vendor.name ?? null,
        jobNumber: l.yardReceipt.purchaseOrder?.site?.jobNumber ?? null,
        description: l.poLine?.description ?? l.orderLine?.description ?? '',
        expected: Number(l.qtyExpected),
        received: Number(l.qtyReceived),
        problem: l.problem ? (l.problemNote ?? 'Yes') : null,
        receivedBy: l.yardReceipt.receivedBy.name,
      })),
    );
  }

  if (source === 'EQUIPMENT') {
    const units = await db.equipment.findMany({ where: { companyId: { in: companies }, active: true }, include: { currentLocation: { select: { businessName: true } } }, orderBy: { unitNumber: 'asc' } });
    return units.map((u) => ({ company: codes.get(u.companyId) ?? '', unitNumber: u.unitNumber, description: u.description, category: u.category, make: u.make, model: u.model, year: u.year, location: u.currentLocation?.businessName ?? u.currentLocationText, pstExempt: u.pstExempt }));
  }

  if (source === 'ACTION_ITEMS') {
    const today = local().date;
    const items = await db.meetingActionItem.findMany({ where: { organizationId: auth.orgId, createdAt: dateRange, ...(f.siteIds.length ? { siteId: { in: f.siteIds } } : { OR: [{ siteId: null }, { siteId: { in: visible.map((s) => s.id) } }] }) }, include: { meeting: { select: { title: true } } }, orderBy: { dueDate: 'asc' } });
    const sites = new Map(visible.map((s) => [s.id, s.jobNumber]));
    return items.map((a) => ({ jobNumber: a.siteId ? (sites.get(a.siteId) ?? null) : null, meeting: a.meeting?.title ?? null, text: a.text, who: a.assigneeName, dueDate: a.dueDate, status: a.status, overdue: a.status === 'OPEN' && !!a.dueDate && iso(a.dueDate) < today }));
  }

  // JOBS
  const sites = await db.site.findMany({ where: { AND: [await siteWhereFor(auth), { type: 'JOB' }, f.siteIds.length ? { id: { in: f.siteIds } } : {}] }, orderBy: { jobNumber: 'asc' } });
  const pms = new Map((await db.user.findMany({ where: { id: { in: sites.map((s) => s.projectManagerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return sites.map((s) => ({ company: s.companyId ? (codes.get(s.companyId) ?? '') : '', jobNumber: s.jobNumber, name: s.name, client: s.clientName, city: s.city, province: s.province, startDate: s.startDate, pm: s.projectManagerId ? (pms.get(s.projectManagerId) ?? null) : null, active: s.active }));
}

// ---------------------------------------------------------------------------
// Building and rendering
// ---------------------------------------------------------------------------
export interface BuiltReport {
  name: string;
  period: { from: string; to: string };
  sections: { title: string; columns: { key: string; label: string }[]; rows: Record<string, string | number | null>[] }[];
}

const show = (v: Cell): string | number | null => (v == null ? null : v instanceof Date ? iso(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v);

/** Job-level sources anyone can report on (scoped to the jobs they can see); money and Sage data need reports access. */
const OPEN_SOURCES = new Set<ReportSource>(['JOB_MATERIALS', 'LOADS', 'RECEIPTS', 'ACTION_ITEMS', 'JOBS']);
const canSeeAll = (auth: AuthContext) => can(auth, 'reports:view');

export async function buildReport(auth: AuthContext, input: SavedReportInput): Promise<BuiltReport> {
  if (!canSeeAll(auth) && input.sections.some((s) => !OPEN_SOURCES.has(s.dataset))) throw forbidden('Money and Sage reports need reports access — ask an admin.');
  const period = periodRange(input.filters.period, input.filters.from, input.filters.to);
  const sections = [];
  for (const sec of input.sections) {
    const src = REPORT_SOURCES[sec.dataset] as { label: string; fields: readonly (readonly [string, string])[] };
    const known = new Map(src.fields.map(([k, l]) => [k, l]));
    const cols = sec.columns.filter((c) => known.has(c)).map((c) => ({ key: c, label: known.get(c)! }));
    if (!cols.length) throw badRequest(`Pick fields for “${sec.title || src.label}”.`);
    const rows = await sourceRows(auth, sec.dataset, period, { siteIds: input.filters.siteIds ?? [], companyId: input.filters.companyId ?? null });
    sections.push({ title: sec.title || src.label, columns: cols, rows: rows.map((r) => Object.fromEntries(cols.map((c) => [c.key, show(r[c.key] ?? null)]))) });
  }
  return { name: input.name, period, sections };
}

export async function renderReport(auth: AuthContext, input: SavedReportInput): Promise<{ bytes: Uint8Array; fileName: string; contentType: string; rows: number }> {
  const r = await buildReport(auth, input);
  const base = `${input.name.replace(/[^\w\- ]+/g, ' ').trim().replace(/\s+/g, '-') || 'report'}-${r.period.from}-to-${r.period.to}`;
  const rows = r.sections.reduce((t, s) => t + s.rows.length, 0);
  if (input.format === 'pdf') {
    const company = input.filters.companyId ? await db.company.findUnique({ where: { id: input.filters.companyId } }) : null;
    const out = await PDFDocument.create();
    for (const s of r.sections) {
      const bytes = await renderTablePdf({ title: `${input.name} — ${s.title}`, subtitle: `${r.period.from} to ${r.period.to}`, companyName: company?.name ?? null, companyCode: company?.code ?? null, themeColor: company?.themeColor ?? '#334155', logo: company ? await logoForPdf(company.logoFileId) : null, columns: s.columns, rows: s.rows });
      const doc = await PDFDocument.load(bytes);
      for (const p of await out.copyPages(doc, doc.getPageIndices())) out.addPage(p);
    }
    return { bytes: await out.save(), fileName: `${base}.pdf`, contentType: 'application/pdf', rows };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SupplyLine';
  for (const [i, s] of r.sections.entries()) {
    const ws = wb.addWorksheet(`${i + 1} ${s.title}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    ws.addRow([`${input.name} — ${s.title}`]).font = { bold: true, size: 13 };
    ws.addRow([`${r.period.from} to ${r.period.to}`]);
    ws.addRow([]);
    ws.addRow(s.columns.map((c) => c.label)).font = { bold: true };
    for (const row of s.rows) ws.addRow(s.columns.map((c) => row[c.key]));
    s.columns.forEach((c, j) => (ws.getColumn(j + 1).width = Math.min(45, Math.max(10, c.label.length + 2))));
  }
  return { bytes: new Uint8Array(await wb.xlsx.writeBuffer()), fileName: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', rows };
}

// ---------------------------------------------------------------------------
// Saved reports
// ---------------------------------------------------------------------------
type SavedRow = Prisma.SavedReportGetPayload<object>;
function view(r: SavedRow, auth: AuthContext, names: Map<string, string>): SavedReportView {
  return {
    id: r.id,
    name: r.name,
    sections: r.sections as SavedReportView['sections'],
    filters: r.filters as SavedReportView['filters'],
    format: r.format as 'xlsx',
    schedule: (r.schedule as ReportSchedule | null) ?? null,
    recipients: r.recipients,
    createdByName: names.get(r.createdById) ?? null,
    lastSentAt: r.lastSentAt?.toISOString() ?? null,
    canEdit: isAdmin(auth) || r.createdById === auth.userId,
  };
}

export async function listSavedReports(auth: AuthContext): Promise<SavedReportView[]> {
  const rows = await db.savedReport.findMany({ where: { organizationId: auth.orgId, ...(canSeeAll(auth) ? {} : { createdById: auth.userId }) }, orderBy: { name: 'asc' } });
  const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.createdById) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => view(r, auth, names));
}

export async function saveReport(auth: AuthContext, id: string | null, input: SavedReportInput) {
  if (!canSeeAll(auth) && input.sections.some((s) => !OPEN_SOURCES.has(s.dataset))) throw forbidden('Money and Sage reports need reports access — ask an admin.');
  if (input.schedule && !input.recipients.length) throw badRequest('Add who gets it, or turn the schedule off.');
  const data = { name: input.name, sections: input.sections as unknown as Prisma.InputJsonValue, filters: input.filters as unknown as Prisma.InputJsonValue, format: input.format, schedule: input.schedule ?? Prisma.DbNull, recipients: input.recipients };
  let row;
  if (id) {
    const r = await db.savedReport.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!r) throw notFound('Report');
    if (!isAdmin(auth) && r.createdById !== auth.userId) throw forbidden('Only the person who made it (or an admin) can change it.');
    row = await db.savedReport.update({ where: { id }, data });
  } else row = await db.savedReport.create({ data: { organizationId: auth.orgId, createdById: auth.userId, ...data } });
  await audit(db, auth, id ? 'report.update' : 'report.create', 'SavedReport', row.id, null, { name: input.name });
  return { id: row.id };
}

export async function deleteReport(auth: AuthContext, id: string) {
  const r = await db.savedReport.findFirst({ where: { id, organizationId: auth.orgId } });
  if (!r) throw notFound('Report');
  if (!isAdmin(auth) && r.createdById !== auth.userId) throw forbidden();
  await db.savedReport.delete({ where: { id } });
  return { ok: true };
}

export async function runSavedReport(auth: AuthContext, id: string) {
  const r = await db.savedReport.findFirst({ where: { id, organizationId: auth.orgId, ...(canSeeAll(auth) ? {} : { createdById: auth.userId }) } });
  if (!r) throw notFound('Report');
  return renderReport(auth, view(r, auth, new Map()));
}

// ---------------------------------------------------------------------------
// On a schedule
// ---------------------------------------------------------------------------
/** Is a schedule due now (and not already sent for this slot)? */
export function isDue(schedule: ReportSchedule | null, lastSentAt: Date | null, now = new Date()): boolean {
  if (!schedule) return false;
  const t = local(now);
  if (t.hour < schedule.hour) return false;
  if (schedule.frequency === 'WEEKLY' && t.weekday !== schedule.weekday) return false;
  if (schedule.frequency === 'MONTHLY' && t.monthDay !== schedule.monthDay) return false;
  return !lastSentAt || local(lastSentAt).date !== t.date;
}

async function mailFile(orgId: string, to: string[], subject: string, text: string, file: { bytes: Uint8Array; fileName: string; contentType: string }, related: { type: string; id: string }) {
  return sendEmail(
    { fromName: 'SupplyLine reports', to, subject, text, attachments: [{ fileName: file.fileName, contentType: file.contentType, content: Buffer.from(file.bytes).toString('base64') }] },
    { organizationId: orgId, relatedType: related.type, relatedId: related.id },
  );
}

/** Timer: saved reports and export mappings that are due go out. Returns how many were sent. */
export async function runScheduledReports(now = new Date()): Promise<number> {
  let sent = 0;
  for (const r of await db.savedReport.findMany({ where: { schedule: { not: Prisma.DbNull } } })) {
    const schedule = r.schedule as ReportSchedule | null;
    if (!isDue(schedule, r.lastSentAt, now) || !r.recipients.length) continue;
    try {
      const owner = await db.user.findFirst({ where: { id: r.createdById, active: true, deletedAt: null } });
      const auth = owner ? { sessionId: 'report', userId: owner.id, orgId: owner.organizationId, companyId: owner.companyId, email: owner.email, name: owner.name, roles: owner.roles as AuthContext['roles'], isPlatformOwner: owner.isPlatformOwner, clientApp: 'server', clientVersion: '0', extraCompanyIds: owner.extraCompanyIds } : await systemAuth(r.organizationId);
      if (!auth) continue;
      const file = await renderReport(auth, view(r, auth, new Map()));
      await mailFile(r.organizationId, r.recipients, `${r.name} (${file.fileName.match(/\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}/)?.[0]?.replace('-to-', ' to ') ?? ''})`, `Your scheduled SupplyLine report "${r.name}" is attached (${file.rows} rows).`, file, { type: 'saved_report', id: r.id });
      await db.savedReport.update({ where: { id: r.id }, data: { lastSentAt: now } });
      sent++;
    } catch (e) {
      console.error('[reports] scheduled report failed', r.id, e);
    }
  }
  // Export mappings (e.g. Sage weekly): last week / last month, to the recipients and the network folder.
  const { runExportMapping } = await import('./export-mappings');
  for (const m of await db.exportMapping.findMany({ where: { schedule: { not: Prisma.DbNull } } })) {
    const schedule = m.schedule as ReportSchedule | null;
    if (!isDue(schedule, m.lastSentAt, now) || (!m.recipients.length && !m.fileToNetwork)) continue;
    try {
      const auth = await systemAuth(m.organizationId);
      if (!auth) continue;
      const range = periodRange(schedule!.frequency === 'MONTHLY' ? 'LAST_MONTH' : schedule!.frequency === 'DAILY' ? 'LAST_7' : 'LAST_WEEK', null, null, now);
      const file = await runExportMapping(auth, m.id, range.from, range.to);
      if (m.recipients.length) await mailFile(m.organizationId, m.recipients, `${m.name} ${range.from} to ${range.to}`, `"${m.name}" for ${range.from} to ${range.to} is attached (${file.rows} rows).`, file, { type: 'export_mapping', id: m.id });
      if (m.fileToNetwork) {
        const companyId = m.companyId ?? (await db.company.findFirst({ where: { organizationId: m.organizationId }, select: { id: true } }))?.id;
        if (companyId) {
          const asset = await saveUpload({ organizationId: m.organizationId, companyId, uploadedById: auth.userId, kind: 'EXPORT', file: new File([Buffer.from(file.bytes)], file.fileName, { type: file.contentType }), maxBytes: 50 * 1_048_576 });
          await fileDocument({ companyId, docType: 'EXPORTS', fileId: asset.id });
        }
      }
      await db.exportMapping.update({ where: { id: m.id }, data: { lastSentAt: now } });
      sent++;
    } catch (e) {
      console.error('[reports] scheduled export failed', m.id, e);
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// The Sunday update to each project manager
// ---------------------------------------------------------------------------
export function pmWeeklyOf(settings: unknown): PmWeeklySettings {
  const parsed = pmWeeklyInput.partial().safeParse((settings as { pmWeekly?: unknown } | null)?.pmWeekly ?? {});
  return { ...DEFAULT_PM_WEEKLY, ...(parsed.success ? parsed.data : {}) };
}

export async function savePmWeekly(auth: AuthContext, input: PmWeeklySettings) {
  requirePermission(auth, 'org:manage');
  const o = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: auth.orgId }, data: { settings: { ...((o.settings as Record<string, unknown>) ?? {}), pmWeekly: input } as Prisma.InputJsonValue } });
  return input;
}

export async function getPmWeekly(auth: AuthContext) {
  requirePermission(auth, 'reports:view');
  const o = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { settings: true } });
  return pmWeeklyOf(o.settings);
}

/** One job's update for its PM: what's still outstanding, what's arriving this week, what came last week. */
export async function pmUpdateText(auth: AuthContext, siteId: string, now = new Date()): Promise<{ subject: string; text: string } | null> {
  const [job] = await jobMaterials(auth, { siteId });
  if (!job) return null;
  const t = local(now);
  const weekEnd = addDays(t.date, 7);
  const loads = await db.billOfLading.findMany({
    where: { status: { in: ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'] }, stops: { some: { kind: 'DROP', location: { siteId }, plannedDate: { gte: new Date(`${t.date}T00:00:00Z`), lte: new Date(`${weekEnd}T23:59:59Z`) } } } },
    include: { stops: { where: { kind: 'DROP', location: { siteId } }, select: { plannedDate: true } }, _count: { select: { lines: true } } },
  });
  const open = job.rows.filter((r) => r.receivedAtSite + 1e-6 < r.ordered);
  const lines = [
    `${job.siteLabel} — week of ${t.date}`,
    '',
    `Order lines: ${job.totals.lines} · fully on site: ${job.totals.complete} · still to come: ${open.length}`,
    '',
    'ARRIVING THIS WEEK',
    ...(loads.length ? loads.map((b) => `  - ${b.bolNumber ? `BOL #${b.bolNumber}` : 'Planned load'}${b.title ? ` (${b.title})` : ''}: ${b._count.lines} item(s), ${b.stops[0]?.plannedDate ? iso(b.stops[0].plannedDate) : 'date to be set'}`) : ['  Nothing booked yet.']),
    '',
    'STILL OUTSTANDING',
    ...(open.length
      ? open.slice(0, 60).map((r) => `  - ${r.ref} ${r.description}: ${r.ordered} ${r.uom} ordered · ${r.outstanding ? `${r.outstanding} not arrived` : ''}${r.inYard ? ` ${r.inYard} in yard` : ''}${r.inTransit ? ` ${r.inTransit} on the way` : ''}${r.requiredOnSite ? ` · needed ${r.requiredOnSite}` : ''}`.replace(/ · $/, ''))
      : ['  Everything ordered is on site.']),
    ...(open.length > 60 ? [`  …and ${open.length - 60} more (open the job in SupplyLine).`] : []),
  ];
  return { subject: `Weekly update: ${job.siteLabel}`, text: lines.join('\n') };
}

/** Timer: on the set day and hour, each active job's PM gets their job's update (once a week). */
export async function runPmWeekly(now = new Date()): Promise<number> {
  let sent = 0;
  const t = local(now);
  for (const org of await db.organization.findMany({ where: { status: 'ACTIVE' }, select: { id: true, settings: true } })) {
    const s = pmWeeklyOf(org.settings);
    if (!s.enabled || t.weekday !== s.weekday || t.hour < s.hour) continue;
    const key = `pmWeekly:${org.id}`;
    const last = await db.platformSetting.findUnique({ where: { key } });
    if ((last?.value as { date?: string } | null)?.date === t.date) continue;
    await db.platformSetting.upsert({ where: { key }, create: { key, value: { date: t.date } }, update: { value: { date: t.date } } });
    const jobs = await db.site.findMany({ where: { organizationId: org.id, type: 'JOB', active: true, projectManagerId: { not: null } }, select: { id: true, projectManagerId: true } });
    for (const j of jobs) {
      const pm = await db.user.findFirst({ where: { id: j.projectManagerId!, active: true, deletedAt: null } });
      if (!pm) continue;
      const auth: AuthContext = { sessionId: 'pm-weekly', userId: pm.id, orgId: org.id, companyId: pm.companyId, email: pm.email, name: pm.name, roles: pm.roles as AuthContext['roles'], isPlatformOwner: pm.isPlatformOwner, clientApp: 'server', clientVersion: '0', extraCompanyIds: pm.extraCompanyIds };
      try {
        const u = await pmUpdateText(auth, j.id, now);
        if (!u) continue;
        await sendEmail({ fromName: 'SupplyLine', to: [pm.email], subject: u.subject, text: `${u.text}\n\nOpen in SupplyLine: ${env().APP_URL.replace(/\/$/, '')}/yard/by-job/?siteId=${j.id}` }, { organizationId: org.id, relatedType: 'pm_weekly', relatedId: j.id });
        sent++;
      } catch (e) {
        console.error('[reports] PM weekly failed', j.id, e);
      }
    }
  }
  return sent;
}
