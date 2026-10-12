// Notification centre, status feed, global search, dashboard tiles and the
// company's look (background picture, fade, logo decal).

import { can } from '@supplyline/core/permissions';
import { formatListLabel } from '@supplyline/core/domain';
import { paths } from '@supplyline/core/routes';
import type { ActivityItem, AppearanceInput, DashboardTile, NotificationView, SearchHit } from '@supplyline/core/models';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest } from '../lib/errors';
import { accessibleCompanyIds, assertCompanyAccessible, siteWhereFor } from './access';
import { saveUpload } from './files';

// ---------------------------------------------------------------------------
// Notification centre
// ---------------------------------------------------------------------------
export async function listNotifications(auth: AuthContext, f: { unread?: boolean } = {}): Promise<{ items: NotificationView[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: auth.userId, ...(f.unread ? { readAt: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.notification.count({ where: { userId: auth.userId, readAt: null } }),
  ]);
  return { items: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: !!n.readAt, createdAt: n.createdAt.toISOString() })), unread };
}

export async function unreadCount(auth: AuthContext) {
  return { unread: await db.notification.count({ where: { userId: auth.userId, readAt: null } }) };
}

export async function markNotificationsRead(auth: AuthContext, ids: string[] | 'all') {
  const r = await db.notification.updateMany({ where: { userId: auth.userId, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) }, data: { readAt: new Date() } });
  return { marked: r.count };
}

/** Old read notifications are tidied away (run daily). */
export async function pruneNotifications(days = 90) {
  const r = await db.notification.deleteMany({ where: { readAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
  return r.count;
}

// ---------------------------------------------------------------------------
// Status feed: the audit trail, in plain words, for the jobs you can see
// ---------------------------------------------------------------------------
type Resolved = { siteId: string | null; companyId: string | null; text: string; link: string | null; icon: string } | null;

const FEED_ACTIONS = ['order.submit', 'yard.stock_check', 'yard.receive', 'po.issue', 'bol.issue', 'bol.ship', 'bol.receive', 'meeting.finish', 'qc.upload', 'equipment.move', 'site.create', 'ap.decide', 'ar.send'] as const;

async function resolve(auth: AuthContext, action: string, entityId: string): Promise<Resolved> {
  switch (action) {
    case 'order.submit':
    case 'yard.stock_check': {
      const o = await db.orderForm.findUnique({ where: { id: entityId }, include: { site: { select: { jobNumber: true } }, _count: { select: { lines: true } } } });
      if (!o) return null;
      const label = formatListLabel(o.site.jobNumber, o.listNo);
      return { siteId: o.siteId, companyId: o.companyId, text: action === 'order.submit' ? `submitted ${label} (${o._count.lines} lines)` : `checked yard stock for ${label}`, link: paths.order(o.id), icon: action === 'order.submit' ? '📝' : '🔎' };
    }
    case 'yard.receive': {
      const r = await db.yardReceipt.findUnique({ where: { id: entityId }, include: { yard: { select: { name: true } }, purchaseOrder: { select: { poNumber: true, siteId: true } } } });
      if (!r) return null;
      return { siteId: r.purchaseOrder?.siteId ?? null, companyId: r.companyId, text: `received ${r.purchaseOrder ? `PO ${r.purchaseOrder.poNumber}` : 'a delivery'} at ${r.yard.name}`, link: paths.yardReceipt(r.id), icon: '📦' };
    }
    case 'po.issue': {
      const po = await db.purchaseOrder.findUnique({ where: { id: entityId }, include: { vendor: { select: { name: true } } } });
      if (!po || !can(auth, 'po:view')) return null;
      return { siteId: po.siteId, companyId: po.companyId, text: `issued PO ${po.poNumber} to ${po.vendor.name}`, link: paths.po(po.id), icon: '🧾' };
    }
    case 'bol.issue':
    case 'bol.ship': {
      const b = await db.billOfLading.findUnique({ where: { id: entityId } });
      if (!b) return null;
      const label = b.bolNumber ? `BOL #${b.bolNumber}` : 'a BOL';
      return { siteId: b.siteId, companyId: b.companyId, text: action === 'bol.ship' ? `shipped ${label} — truck has left` : `issued ${label}`, link: paths.bol(b.id), icon: '🚚' };
    }
    case 'bol.receive': {
      const r = await db.siteReceipt.findUnique({ where: { id: entityId }, include: { bol: { select: { bolNumber: true, companyId: true } }, lines: { select: { damaged: true, qtyShort: true } } } });
      if (!r) return null;
      const problems = r.lines.filter((l) => l.damaged || Number(l.qtyShort) > 0).length;
      return { siteId: r.siteId, companyId: r.bol.companyId, text: `received BOL #${r.bol.bolNumber ?? ''}${problems ? ` — ${problems} problem${problems === 1 ? '' : 's'}` : ''}`, link: paths.bolReceipt(r.id), icon: problems ? '⚠' : '✅' };
    }
    case 'meeting.finish': {
      const m = await db.meeting.findUnique({ where: { id: entityId } });
      if (!m) return null;
      return { siteId: m.siteId, companyId: m.companyId, text: `sent the minutes for ${m.title}`, link: `/meetings/run/?id=${m.id}`, icon: '◷' };
    }
    case 'qc.upload': {
      const q = await db.qCDocument.findUnique({ where: { id: entityId } });
      if (!q?.siteId) return null;
      const site = await db.site.findUnique({ where: { id: q.siteId }, select: { companyId: true } });
      return { siteId: q.siteId, companyId: site?.companyId ?? null, text: `added a QC document`, link: `/sites/qc/?id=${q.siteId}`, icon: '📄' };
    }
    case 'equipment.move': {
      const e = await db.equipment.findUnique({ where: { id: entityId } });
      if (!e) return null;
      return { siteId: null, companyId: e.companyId, text: `moved unit ${e.unitNumber}`, link: paths.equipmentView(e.id), icon: '🚜' };
    }
    case 'site.create': {
      const s = await db.site.findUnique({ where: { id: entityId } });
      if (!s) return null;
      return { siteId: s.id, companyId: s.companyId, text: `added ${s.type === 'JOB' ? `job ${s.jobNumber} ${s.name}` : `yard ${s.name}`}`, link: paths.site(s.id), icon: '🏗' };
    }
    case 'ap.decide': {
      if (!can(auth, 'ap:work')) return null;
      const a = await db.apInvoice.findUnique({ where: { id: entityId }, include: { vendor: { select: { name: true } } } });
      if (!a) return null;
      return { siteId: a.siteId, companyId: a.companyId, text: `reviewed invoice ${a.invoiceNumber ?? ''} from ${a.vendor?.name ?? a.vendorName ?? 'a vendor'}`, link: paths.apInvoice(a.id), icon: '💳' };
    }
    case 'ar.send': {
      if (!can(auth, 'ar:work')) return null;
      const a = await db.arInvoice.findUnique({ where: { id: entityId }, include: { customer: { select: { name: true } } } });
      if (!a) return null;
      return { siteId: a.siteId, companyId: a.companyId, text: `sent invoice ${a.invoiceNumber} to ${a.customer.name}`, link: paths.arInvoice(a.id), icon: '💲' };
    }
  }
  return null;
}

export async function activityFeed(auth: AuthContext, f: { siteId?: string; limit?: number } = {}): Promise<ActivityItem[]> {
  const limit = Math.min(f.limit ?? 30, 100);
  const companies = new Set(await accessibleCompanyIds(auth));
  const sites = await db.site.findMany({ where: await siteWhereFor(auth), select: { id: true, jobNumber: true, name: true, type: true } });
  const siteMap = new Map(sites.map((s) => [s.id, s.type === 'JOB' ? `JOB#${s.jobNumber} ${s.name}` : s.name]));
  const out: ActivityItem[] = [];
  let cursor: bigint | undefined;
  // Read the trail in pages until there's enough you're allowed to see.
  for (let page = 0; page < 6 && out.length < limit; page++) {
    const rows = await db.auditLog.findMany({
      where: { organizationId: auth.orgId, action: { in: [...FEED_ACTIONS] }, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: 80,
    });
    if (!rows.length) break;
    cursor = rows.at(-1)!.id;
    const users = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    for (const r of rows) {
      if (out.length >= limit) break;
      const x = await resolve(auth, r.action, r.entityId).catch(() => null);
      if (!x) continue;
      if (x.companyId && !companies.has(x.companyId)) continue;
      if (x.siteId && !siteMap.has(x.siteId)) continue;
      if (f.siteId && x.siteId !== f.siteId) continue;
      const who = r.userId ? (users.get(r.userId) ?? null) : null;
      out.push({ id: String(r.id), at: r.at.toISOString(), text: `${who ?? 'SupplyLine'} ${x.text}`, who, siteLabel: x.siteId ? (siteMap.get(x.siteId) ?? null) : null, link: x.link, icon: x.icon });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------
export async function search(auth: AuthContext, q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const ci = { contains: term, mode: 'insensitive' as const };
  const companies = await accessibleCompanyIds(auth);
  const siteWhere = await siteWhereFor(auth);
  const hits: SearchHit[] = [];

  const sites = await db.site.findMany({ where: { AND: [siteWhere, { OR: [{ jobNumber: ci }, { name: ci }, { clientName: ci }, { city: ci }] }] }, take: 8, orderBy: { jobNumber: 'asc' } });
  for (const s of sites) hits.push({ kind: 'JOB', id: s.id, title: s.type === 'JOB' ? `JOB#${s.jobNumber} ${s.name}` : s.name, subtitle: [s.type === 'YARD' ? 'Yard' : s.clientName, s.city].filter(Boolean).join(' · ') || null, link: paths.site(s.id) });

  // "JOB#2249 LIST#3", "2249 list 3", "2249-3"
  const list = /^(?:job\s*#?\s*)?([\w-]+?)\s*(?:list\s*#?\s*|[-\s])(\d+)$/i.exec(term);
  const visibleSiteIds = (await db.site.findMany({ where: siteWhere, select: { id: true } })).map((s) => s.id);
  if (list) {
    const orders = await db.orderForm.findMany({ where: { siteId: { in: visibleSiteIds }, listNo: Number(list[2]), site: { jobNumber: { equals: list[1], mode: 'insensitive' } } }, include: { site: { select: { jobNumber: true, name: true } } }, take: 5 });
    for (const o of orders) hits.push({ kind: 'ORDER', id: o.id, title: formatListLabel(o.site.jobNumber, o.listNo), subtitle: o.site.name, link: paths.order(o.id) });
  }
  const lines = await db.orderLine.findMany({ where: { siteId: { in: visibleSiteIds }, status: { not: 'DRAFT' }, description: ci }, include: { orderForm: { include: { site: { select: { jobNumber: true } } } } }, take: 8, orderBy: { createdAt: 'desc' } });
  for (const l of lines) hits.push({ kind: 'LINE', id: l.id, title: l.description, subtitle: `${formatListLabel(l.orderForm.site.jobNumber, l.orderForm.listNo)} L${l.lineNo} · ${Number(l.quantity)} ${l.uom}`, link: paths.order(l.orderFormId) });

  if (can(auth, 'po:view')) {
    const pos = await db.purchaseOrder.findMany({ where: { companyId: { in: companies }, OR: [{ poNumber: ci }, { vendor: { name: ci } }] }, include: { vendor: { select: { name: true } } }, take: 8, orderBy: { createdAt: 'desc' } });
    for (const p of pos) hits.push({ kind: 'PO', id: p.id, title: `PO ${p.poNumber}`, subtitle: `${p.vendor.name} · ${p.status.toLowerCase()}`, link: paths.po(p.id) });
  }
  const bolNo = /^(?:bol\s*#?\s*)?(\d+)$/i.exec(term);
  if (bolNo && can(auth, 'bol:view')) {
    const bols = await db.billOfLading.findMany({ where: { companyId: { in: companies }, bolNumber: Number(bolNo[1]) }, include: { company: { select: { code: true } } }, take: 5 });
    for (const b of bols) hits.push({ kind: 'BOL', id: b.id, title: `BOL #${b.bolNumber}`, subtitle: `${b.company.code} · ${b.status.toLowerCase()}`, link: paths.bol(b.id) });
  }
  if (can(auth, 'contact:view')) {
    const contacts = await db.contact.findMany({ where: { organizationId: auth.orgId, active: true, OR: [{ name: ci }, { businessName: ci }, { email: ci }, { phone: ci }, { cell: ci }] }, take: 8, orderBy: { name: 'asc' } });
    for (const c of contacts) hits.push({ kind: 'CONTACT', id: c.id, title: c.businessName ? `${c.businessName} — ${c.name}` : c.name, subtitle: [c.phone ?? c.cell, c.email].filter(Boolean).join(' · ') || null, link: paths.contactEdit(c.id) });
  }
  const units = await db.equipment.findMany({ where: { companyId: { in: companies }, OR: [{ unitNumber: ci }, { description: ci }, { serial: ci }] }, take: 8, orderBy: { unitNumber: 'asc' } });
  for (const e of units) hits.push({ kind: 'EQUIPMENT', id: e.id, title: `Unit ${e.unitNumber}`, subtitle: e.description, link: paths.equipmentView(e.id) });
  if (can(auth, 'ap:work')) {
    const inv = await db.apInvoice.findMany({ where: { companyId: { in: companies }, OR: [{ invoiceNumber: ci }, { vendorName: ci }, { vendor: { name: ci } }, { poNumberText: ci }] }, include: { vendor: { select: { name: true } } }, take: 8, orderBy: { createdAt: 'desc' } });
    for (const a of inv) hits.push({ kind: 'INVOICE', id: a.id, title: `Invoice ${a.invoiceNumber ?? '(no number)'}`, subtitle: `${a.vendor?.name ?? a.vendorName ?? 'Vendor'} · ${a.status.toLowerCase().replace('_', ' ')}`, link: paths.apInvoice(a.id) });
  }
  if (can(auth, 'ar:work')) {
    const cust = await db.customer.findMany({ where: { companyId: { in: companies }, OR: [{ name: ci }, { contactName: ci }, { email: ci }] }, take: 5 });
    for (const c of cust) hits.push({ kind: 'CUSTOMER', id: c.id, title: c.name, subtitle: c.contactName, link: paths.customers() });
  }
  if (can(auth, 'meeting:run')) {
    const meetings = await db.meeting.findMany({ where: { companyId: { in: companies }, OR: [{ siteId: null }, { siteId: { in: visibleSiteIds } }], AND: [{ OR: [{ title: ci }, { summary: ci }] }] }, take: 5, orderBy: { createdAt: 'desc' } });
    for (const m of meetings) hits.push({ kind: 'MEETING', id: m.id, title: m.title, subtitle: m.status === 'DONE' ? 'Minutes' : 'Meeting', link: `/meetings/run/?id=${m.id}` });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Dashboard tiles (by role)
// ---------------------------------------------------------------------------
export async function dashboard(auth: AuthContext): Promise<DashboardTile[]> {
  const companies = await accessibleCompanyIds(auth);
  const siteIds = (await db.site.findMany({ where: await siteWhereFor(auth), select: { id: true } })).map((s) => s.id);
  const today = new Date(new Date().toISOString().slice(0, 10));
  const week = new Date(today.getTime() + 7 * 86_400_000);
  const tiles: DashboardTile[] = [];

  const myActions = await db.meetingActionItem.findMany({ where: { assigneeUserId: auth.userId, status: 'OPEN' }, select: { dueDate: true } });
  if (myActions.length) tiles.push({ key: 'actions', label: 'My action items', value: myActions.length, warn: myActions.some((a) => a.dueDate && a.dueDate < today), link: '/actions/' });

  if (can(auth, 'procurement:work')) {
    const waiting = await db.orderLine.count({ where: { companyId: { in: companies }, status: { in: ['SUBMITTED', 'SENT_FOR_RFQ'] } } });
    tiles.push({ key: 'to-buy', label: 'Lines to buy', value: waiting, warn: waiting > 0, link: '/procurement/' });
  }
  if (can(auth, 'yard:work')) {
    const incoming = await db.purchaseOrder.count({ where: { companyId: { in: companies }, status: 'ISSUED', expectedDate: { gte: today, lt: week } } });
    tiles.push({ key: 'incoming', label: 'Deliveries due this week', value: incoming, warn: false, link: '/yard/incoming/' });
    const drafts = await db.billOfLading.count({ where: { companyId: { in: companies }, status: 'DRAFT', stops: { some: { kind: 'PICKUP', plannedDate: { gte: today, lt: week } } } } });
    tiles.push({ key: 'loads', label: 'Planned loads this week', value: drafts, warn: false, link: '/schedule/' });
  }
  if (siteIds.length && can(auth, 'bol:receive')) {
    const coming = await db.billOfLading.count({ where: { companyId: { in: companies }, status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] }, stops: { some: { kind: 'DROP', location: { siteId: { in: siteIds } } } } } });
    tiles.push({ key: 'to-receive', label: 'Loads on the way to my jobs', value: coming, warn: false, link: '/bols/' });
  }
  if (siteIds.length && can(auth, 'order:create')) {
    const drafts = await db.orderForm.count({ where: { siteId: { in: siteIds }, status: 'DRAFT', createdById: auth.userId } });
    if (drafts) tiles.push({ key: 'drafts', label: 'My unsent order lists', value: drafts, warn: true, link: '/orders/' });
  }
  const meetings = can(auth, 'meeting:run') ? await db.meeting.count({ where: { companyId: { in: companies }, status: 'IN_PROGRESS', createdById: auth.userId } }) : 0;
  if (meetings) tiles.push({ key: 'meetings', label: 'Meetings not finished', value: meetings, warn: true, link: '/meetings/' });
  if (can(auth, 'health:view')) {
    const last = await db.healthCheckRun.findFirst({ where: { organizationId: auth.orgId }, orderBy: { at: 'desc' } });
    if (last && !last.ok) tiles.push({ key: 'health', label: 'Health checks failing', value: (last.results as { ok: boolean }[]).filter((r) => !r.ok).length, warn: true, link: '/admin/health/' });
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Appearance (per company)
// ---------------------------------------------------------------------------
type AppearanceStored = { backgroundFileId?: string | null; fade?: number; decal?: boolean };

export async function saveAppearance(auth: AuthContext, companyId: string, input: AppearanceInput, file: File | null) {
  requirePermission(auth, 'company:edit');
  const c = await assertCompanyAccessible(auth, companyId);
  const settings = (c.settings as Record<string, unknown> | null) ?? {};
  const prev = (settings.appearance as AppearanceStored | undefined) ?? {};
  let backgroundFileId = input.clearBackground ? null : (prev.backgroundFileId ?? null);
  if (file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw badRequest('Use a JPG, PNG or WebP picture.');
    const asset = await saveUpload({ organizationId: auth.orgId, companyId, uploadedById: auth.userId, kind: 'BACKGROUND', file, maxBytes: 8 * 1_048_576, imagesOnly: true });
    backgroundFileId = asset.id;
  }
  const appearance: AppearanceStored = { backgroundFileId, fade: input.fade, decal: input.decal };
  await db.company.update({ where: { id: companyId }, data: { settings: { ...settings, appearance } } });
  await audit(db, auth, 'company.appearance', 'Company', companyId, prev, appearance);
  return { ok: true };
}
