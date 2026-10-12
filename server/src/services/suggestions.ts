// Suggestions learned from this organization's own history — never another
// customer's. Smart defaults (the carrier a vendor usually ships with, the yard
// you usually receive into, items you usually order), ranked up when people keep
// them and down when they change them. Admins get an Insights page of patterns.

import type { InsightsView, ItemSuggestion, PoDefaults, SuggestionFeedback } from '@supplyline/core/models';
import { isAdmin, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { forbidden } from '../lib/errors';
import { accessibleCompanyIds, assertCompanyAccessible } from './access';

const YEAR = 365 * 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Keep/change history for one kind of suggestion: value → score adjustment. */
async function feedbackScores(orgId: string, kind: string, contextKey: string) {
  const rows = await db.suggestionEvent.groupBy({ by: ['value', 'accepted'], where: { organizationId: orgId, kind, contextKey, createdAt: { gte: new Date(Date.now() - YEAR) } }, _count: { _all: true } });
  const score = new Map<string, number>();
  for (const r of rows) score.set(r.value, (score.get(r.value) ?? 0) + (r.accepted ? 2 : -3) * r._count._all);
  return score;
}

export async function recordSuggestion(auth: AuthContext, f: SuggestionFeedback) {
  if (f.companyId) await assertCompanyAccessible(auth, f.companyId);
  await db.suggestionEvent.create({ data: { organizationId: auth.orgId, companyId: f.companyId ?? auth.companyId, userId: auth.userId, kind: f.kind, contextKey: f.contextKey, value: f.value, accepted: f.accepted } });
  return { ok: true };
}

/** Items to suggest while typing a description: this job first, then the company's history. */
export async function suggestItems(auth: AuthContext, f: { q: string; siteId?: string | null; companyId?: string | null }): Promise<ItemSuggestion[]> {
  const q = f.q.trim();
  if (q.length < 2) return [];
  const companies = f.companyId ? [f.companyId] : await accessibleCompanyIds(auth);
  if (f.companyId) await assertCompanyAccessible(auth, f.companyId);
  const where = { organizationId: auth.orgId, companyId: { in: companies }, description: { contains: q, mode: 'insensitive' as const }, createdAt: { gte: new Date(Date.now() - 2 * YEAR) } };
  const [all, here, fb] = await Promise.all([
    db.orderLine.groupBy({ by: ['description', 'uom'], where, _count: { _all: true }, _max: { createdAt: true, costCode: true }, orderBy: { _count: { description: 'desc' } }, take: 40 }),
    f.siteId ? db.orderLine.groupBy({ by: ['description', 'uom'], where: { ...where, siteId: f.siteId }, _count: { _all: true } }) : Promise.resolve([]),
    feedbackScores(auth.orgId, 'ITEM', ''),
  ]);
  const local = new Map(here.map((h) => [`${h.description}|${h.uom}`, h._count._all]));
  const byText = new Map<string, ItemSuggestion & { score: number }>();
  for (const g of all) {
    const key = g.description.trim().toLowerCase();
    const score = g._count._all + 3 * (local.get(`${g.description}|${g.uom}`) ?? 0) + (fb.get(g.description) ?? 0) + (g.description.toLowerCase().startsWith(q.toLowerCase()) ? 2 : 0);
    const cur = byText.get(key);
    if ((fb.get(g.description) ?? 0) <= -6) continue; // changed at least twice and never kept
    if (!cur || score > cur.score) byText.set(key, { description: g.description, uom: g.uom || null, costCode: g._max.costCode ?? null, count: g._count._all + (cur?.count ?? 0), lastUsed: iso(g._max.createdAt ?? new Date()), score });
    else cur.count += g._count._all;
  }
  return [...byText.values()]
    .filter((s) => s.score > -3)
    .sort((a, b) => b.score - a.score || b.lastUsed.localeCompare(a.lastUsed))
    .slice(0, 8)
    .map(({ score: _s, ...s }) => s);
}

/** Defaults for a new PO. */
export async function poDefaults(auth: AuthContext, f: { companyId: string; vendorName?: string | null; description?: string | null }): Promise<PoDefaults> {
  await assertCompanyAccessible(auth, f.companyId);
  const since = new Date(Date.now() - YEAR);
  let shipViaId: string | null = null;
  const vendor = f.vendorName?.trim();
  if (vendor) {
    const [rows, fb] = await Promise.all([
      db.purchaseOrder.groupBy({ by: ['shipViaId'], where: { companyId: f.companyId, shipViaId: { not: null }, createdAt: { gte: since }, vendor: { name: { equals: vendor, mode: 'insensitive' } } }, _count: { _all: true } }),
      feedbackScores(auth.orgId, 'PO_SHIP_VIA', vendor.toLowerCase()),
    ]);
    const best = rows.map((r) => ({ id: r.shipViaId!, score: r._count._all + (fb.get(r.shipViaId!) ?? 0) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score)[0];
    shipViaId = best?.id ?? null;
  }
  const [yards, yfb] = await Promise.all([
    db.purchaseOrder.groupBy({ by: ['deliverToYardId'], where: { companyId: f.companyId, createdById: auth.userId, deliverToYardId: { not: null }, createdAt: { gte: since } }, _count: { _all: true } }),
    feedbackScores(auth.orgId, 'PO_YARD', auth.userId),
  ]);
  const yard = yards.map((r) => ({ id: r.deliverToYardId!, score: r._count._all + (yfb.get(r.deliverToYardId!) ?? 0) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score)[0];
  let vendors: PoDefaults['vendors'] = [];
  const d = f.description?.trim();
  if (d && d.length >= 3) {
    const lines = await db.purchaseOrderLine.findMany({ where: { description: { contains: d, mode: 'insensitive' }, purchaseOrder: { companyId: f.companyId, status: { in: ['ISSUED', 'CLOSED'] }, createdAt: { gte: since } } }, select: { purchaseOrder: { select: { vendor: { select: { name: true } } } } }, take: 400 });
    const count = new Map<string, number>();
    for (const l of lines) count.set(l.purchaseOrder.vendor.name, (count.get(l.purchaseOrder.vendor.name) ?? 0) + 1);
    vendors = [...count.entries()].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count).slice(0, 5);
  }
  return { shipViaId, deliverToYardId: yard?.id ?? null, vendors };
}

// ---------------------------------------------------------------------------
// Insights — admins only
// ---------------------------------------------------------------------------
export async function insights(auth: AuthContext, days = 90): Promise<InsightsView> {
  if (!isAdmin(auth)) throw forbidden('Insights are for admins.');
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const org = auth.orgId;
  const range = { gte: from, lte: to };

  const [topItems, offList, problems, late, changed, unanswered, convoCount, actionsDone] = await Promise.all([
    db.orderLine.groupBy({ by: ['description', 'uom'], where: { organizationId: org, createdAt: range, cancelledAt: null }, _count: { _all: true }, orderBy: { _count: { description: 'desc' } }, take: 10 }),
    db.orderLine.groupBy({ by: ['siteId'], where: { organizationId: org, createdAt: range, addedFromPoId: { not: null } }, _count: { _all: true }, orderBy: { _count: { siteId: 'desc' } }, take: 10 }),
    db.yardReceiptLine.findMany({ where: { problem: true, yardReceipt: { organizationId: org, receivedAt: range } }, select: { yardReceipt: { select: { purchaseOrder: { select: { vendor: { select: { name: true } } } } } } }, take: 2000 }),
    db.purchaseOrder.findMany({ where: { organizationId: org, status: 'ISSUED', expectedDate: { lt: to, gte: from } }, select: { vendor: { select: { name: true } }, lines: { select: { qty: true, yardReceiptLines: { select: { qtyReceived: true } } } } }, take: 2000 }),
    db.suggestionEvent.groupBy({ by: ['kind', 'accepted'], where: { organizationId: org, createdAt: range }, _count: { _all: true } }),
    db.assistantMessage.findMany({ where: { unanswered: true, role: 'ASSISTANT', createdAt: range, conversation: { organizationId: org } }, orderBy: { createdAt: 'desc' }, take: 10, select: { conversationId: true, createdAt: true } }),
    db.assistantMessage.count({ where: { role: 'USER', createdAt: range, conversation: { organizationId: org } } }),
    db.assistantMessage.count({ where: { actionStatus: 'DONE', createdAt: range, conversation: { organizationId: org } } }),
  ]);
  const siteNames = new Map((await db.site.findMany({ where: { id: { in: offList.map((o) => o.siteId) } }, select: { id: true, jobNumber: true, name: true } })).map((s) => [s.id, `JOB#${s.jobNumber} ${s.name}`]));
  const tally = (names: string[]) => {
    const m = new Map<string, number>();
    for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  };
  const lateVendors = tally(late.filter((p) => p.lines.some((l) => l.yardReceiptLines.reduce((t, r) => t + Number(r.qtyReceived), 0) < Number(l.qty))).map((p) => p.vendor.name));
  // What the person asked just before each unanswered reply
  const askedFirst = await Promise.all(unanswered.map((u) => db.assistantMessage.findFirst({ where: { conversationId: u.conversationId, role: 'USER', createdAt: { lte: u.createdAt } }, orderBy: { createdAt: 'desc' }, select: { text: true, createdAt: true } })));
  const kinds: Record<string, string> = { PO_SHIP_VIA: 'Carrier for a vendor', PO_YARD: 'Receiving yard', ITEM: 'Item while typing', VENDOR: 'Vendor for an item' };
  const changedRows = Object.keys(kinds)
    .map((k) => {
      const kept = changed.find((c) => c.kind === k && c.accepted)?._count._all ?? 0;
      const swapped = changed.find((c) => c.kind === k && !c.accepted)?._count._all ?? 0;
      return { label: kinds[k]!, value: kept + swapped ? `${Math.round((kept / (kept + swapped)) * 100)}% kept (${kept + swapped})` : 'not used yet' };
    })
    .filter((r) => r.value !== 'not used yet');

  return {
    period: { from: iso(from), to: iso(to) },
    crossCustomerLearning: false,
    cards: [
      { key: 'top-items', title: 'Ordered most', detail: 'Worth keeping in stock or getting a standing price for.', rows: topItems.map((t) => ({ label: `${t.description}${t.uom ? ` (${t.uom})` : ''}`, value: t._count._all })) },
      { key: 'off-list', title: 'Bought off the order list', detail: 'PO lines that weren’t on the job’s order list — maybe the list is missing things.', rows: offList.map((o) => ({ label: siteNames.get(o.siteId) ?? 'Job', value: o._count._all, href: `/yard/by-job/?siteId=${o.siteId}` })) },
      { key: 'problems', title: 'Delivery problems by vendor', detail: 'Lines received short, damaged or wrong.', rows: tally(problems.map((p) => p.yardReceipt.purchaseOrder?.vendor.name ?? 'No PO')).map(([label, value]) => ({ label, value })) },
      { key: 'late', title: 'Late deliveries by vendor', detail: 'Issued POs past their expected date and not fully received.', rows: lateVendors.map(([label, value]) => ({ label, value })) },
      { key: 'defaults', title: 'Suggested defaults', detail: 'How often people keep what SupplyLine suggests. Low numbers mean the suggestion needs work.', rows: changedRows },
      {
        key: 'assistant',
        title: 'Assistant',
        detail: `${convoCount} questions asked, ${actionsDone} things done for people. Recent questions it couldn’t help with:`,
        rows: askedFirst.filter((a): a is { text: string; createdAt: Date } => !!a).map((a) => ({ label: a.text.slice(0, 160), value: iso(a.createdAt) })),
      },
    ],
  };
}
