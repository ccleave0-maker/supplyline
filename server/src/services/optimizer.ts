// Load optimizer: looks at everything waiting to move (across the companies on the
// load board), with the required-on-site dates from the order lists, and suggests
// how to move it — which jobs to combine on one truck (close together, due around
// the same time), on which trailer, in what order, and when to ship. Suggestions
// only: "Plan these loads" turns one into planned loads on the schedule.

import { distanceKm, planLoads, type TrailerSpec } from '@supplyline/core/domain';
import type { LoadItem, OptimizeInput, SuggestedRun } from '@supplyline/core/models';
import { z } from 'zod';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest } from '../lib/errors';
import { allUnitIds } from './access';
import { getBoardSettings } from './board';
import { createBol } from './bols';
import { trailerSpec } from './loads';

const num = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);

export async function optimize(auth: AuthContext, input: OptimizeInput): Promise<SuggestedRun[]> {
  requirePermission(auth, 'loads:plan');
  const board = await getBoardSettings(auth);
  const mine = await allUnitIds(auth);
  const companies = (input.companyIds?.length ? input.companyIds : (board.companyIds ?? mine)).filter((c) => mine.includes(c));
  const today = new Date().toISOString().slice(0, 10);

  // Everything sitting somewhere other than its job, not already on a draft load.
  // (Job material only: equipment stock has no job to deliver to.)
  const found = await db.inventoryLot.findMany({
    where: { organizationId: auth.orgId, companyId: { in: companies }, status: { in: ['IN_STOCK', 'STAGED'] }, qtyAvailable: { gt: 0 }, orderLineId: { not: null }, finalSiteId: { not: null } },
    include: {
      location: { select: { id: true, businessName: true, lat: true, lng: true, siteId: true } },
      finalSite: { select: { id: true, jobNumber: true, name: true, lat: true, lng: true } },
      orderLine: { include: { orderForm: { select: { listNo: true } } } },
      bolLines: { where: { bol: { status: 'DRAFT' } }, select: { qty: true } },
    },
  });
  type Found = (typeof found)[number];
  const lots = found.filter((l): l is Found & { orderLine: NonNullable<Found['orderLine']>; finalSiteId: string } => !!l.orderLine && !!l.finalSiteId);
  const jobLocs = new Map((await db.shippingLocation.findMany({ where: { organizationId: auth.orgId, siteId: { in: [...new Set(lots.map((l) => l.finalSiteId))] } }, select: { id: true, siteId: true, businessName: true, lat: true, lng: true } })).map((l) => [l.siteId!, l]));
  type Pending = (typeof lots)[number] & { left: number; needBy: string | null };
  const pending: Pending[] = [];
  for (const l of lots) {
    if (l.location.siteId === l.finalSiteId) continue; // already at its job
    const left = Number(l.qtyAvailable) - l.bolLines.reduce((s, b) => s + Number(b.qty), 0);
    if (left <= 1e-6) continue;
    const needBy = day(l.orderLine.requiredOnSite);
    if (needBy && needBy > input.to) continue; // not needed in this window yet
    if (!jobLocs.get(l.finalSiteId)) continue;
    pending.push({ ...l, left, needBy });
  }
  if (!pending.length) return [];

  const trailers = await db.trailer.findMany({ where: { organizationId: auth.orgId, active: true, ...(input.trailerIds?.length ? { id: { in: input.trailerIds } } : {}) } });
  const companyNames = new Map((await db.company.findMany({ where: { id: { in: companies } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));

  // Group by company + pickup, then by job.
  const groups = new Map<string, Pending[]>();
  for (const p of pending) {
    const k = `${p.companyId}|${p.locationId}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const runs: SuggestedRun[] = [];
  for (const [k, list] of groups) {
    const [companyId, pickupId] = k.split('|') as [string, string];
    const pickup = list[0]!.location;
    const jobs = [...new Set(list.map((p) => p.finalSiteId))].map((siteId) => {
      const items = list.filter((p) => p.finalSiteId === siteId);
      const needs = items.map((i) => i.needBy).filter((x): x is string => !!x).sort();
      const loc = jobLocs.get(siteId)!;
      return { siteId, loc, items, needBy: needs[0] ?? null };
    });
    jobs.sort((a, b) => (a.needBy ?? '9999').localeCompare(b.needBy ?? '9999'));

    // Milk runs: jobs close together, due around the same time.
    const used = new Set<string>();
    for (const first of jobs) {
      if (used.has(first.siteId)) continue;
      const cluster = [first];
      used.add(first.siteId);
      for (const other of jobs) {
        if (used.has(other.siteId)) continue;
        const near = cluster.some((c) => c.loc.lat != null && c.loc.lng != null && other.loc.lat != null && other.loc.lng != null && distanceKm({ lat: c.loc.lat, lng: c.loc.lng }, { lat: other.loc.lat, lng: other.loc.lng }) <= input.combineKm);
        const soon = !first.needBy || !other.needBy || Math.abs(daysBetween(first.needBy, other.needBy)) <= input.combineDays;
        if (near && soon) {
          cluster.push(other);
          used.add(other.siteId);
        }
      }
      // Drive order: nearest next stop from the pickup.
      const ordered: typeof cluster = [];
      let at = pickup.lat != null && pickup.lng != null ? { lat: pickup.lat, lng: pickup.lng } : null;
      let dist = 0;
      const left = [...cluster];
      while (left.length) {
        let bestI = 0;
        if (at) {
          let best = Infinity;
          left.forEach((j, i) => {
            if (j.loc.lat == null || j.loc.lng == null) return;
            const d = distanceKm(at!, { lat: j.loc.lat, lng: j.loc.lng });
            if (d < best) {
              best = d;
              bestI = i;
            }
          });
          if (best < Infinity) dist += best;
        }
        const next = left.splice(bestI, 1)[0]!;
        ordered.push(next);
        if (next.loc.lat != null && next.loc.lng != null) at = { lat: next.loc.lat, lng: next.loc.lng };
      }

      // Which trailer: fewest loads, then fewest warnings.
      const items: LoadItem[] = ordered.flatMap((j) =>
        j.items.map((i) => ({
          key: i.id,
          lotId: i.id,
          orderLineId: i.orderLineId,
          label: i.description,
          ref: `L${i.orderLine.lineNo}`,
          uom: i.uom,
          qty: i.left,
          unitWeightKg: num(i.orderLine.unitWeightKg),
          lengthM: num(i.orderLine.lengthM),
          widthM: num(i.orderLine.widthM),
          heightM: num(i.orderLine.heightM),
          stackable: i.orderLine.stackable,
          locationId: i.locationId,
          locationName: pickup.businessName,
          companyId,
          finalSiteId: i.finalSiteId,
        })),
      );
      const options = trailers.length ? trailers.map((t) => ({ t, spec: trailerSpec(t) })) : [{ t: null, spec: { id: null, deckLengthM: 14.63, deckWidthM: 2.59, deckHeightM: 1.52, maxPayloadKg: 21000 } as TrailerSpec }];
      const scored = options
        .map((o) => ({ ...o, plan: planLoads(items, o.spec) }))
        .sort((a, b) => a.plan.loads.length - b.plan.loads.length || a.plan.loads.filter((l) => l.flags.length).length - b.plan.loads.filter((l) => l.flags.length).length || a.spec.maxPayloadKg - b.spec.maxPayloadKg);
      const best = scored[0]!;
      const needBy = ordered.map((j) => j.needBy).filter((x): x is string => !!x).sort()[0] ?? null;
      const shipOn = needBy ? (addDays(needBy, -1) < today ? today : addDays(needBy, -1)) : null;
      const flags = [...new Set(best.plan.loads.flatMap((l) => l.flags))];
      const reasons: string[] = [];
      if (ordered.length > 1) reasons.push(`Combines ${ordered.length} jobs${input.combineKm ? ` within ${input.combineKm} km` : ''} — one truck instead of ${ordered.length}.`);
      if (needBy) reasons.push(needBy < today ? `Overdue: needed ${needBy}.` : `Needed on site ${needBy} (${daysBetween(today, needBy)} day${daysBetween(today, needBy) === 1 ? '' : 's'}).`);
      if (best.t) reasons.push(`${best.plan.loads.length} load${best.plan.loads.length === 1 ? '' : 's'} on ${best.t.name}${scored.length > 1 ? ' — the fewest of your trailers' : ''}.`);
      if (best.plan.unsized.length) reasons.push(`${best.plan.unsized.length} item(s) have no size or weight — check the fit.`);
      runs.push({
        key: `${k}|${ordered.map((j) => j.siteId).join(',')}`,
        companyId,
        companyName: companyNames.get(companyId) ?? '',
        pickup: { locationId: pickupId, name: pickup.businessName },
        drops: ordered.map((j) => ({
          siteId: j.siteId,
          locationId: j.loc.id,
          name: j.loc.businessName,
          needBy: j.needBy,
          items: j.items.map((i) => ({ lotId: i.id, label: `${i.description}${i.orderLine.orderForm.listNo ? ` (LIST#${i.orderLine.orderForm.listNo} L${i.orderLine.lineNo})` : ''}`, qty: Math.round(i.left * 1000) / 1000, uom: i.uom })),
        })),
        trailerId: best.t?.id ?? null,
        trailerName: best.t?.name ?? null,
        loads: best.plan.loads.length,
        weightKg: Math.round(best.plan.totalWeightKg),
        shipOn,
        needBy,
        distanceKm: dist ? Math.round(dist) : null,
        flags,
        reasons,
        plan: best.plan.loads.map((l) => l.lines.map((x) => ({ lotId: x.key, qty: x.qty }))),
      });
    }
  }
  return runs.sort((a, b) => (a.needBy ?? '9999').localeCompare(b.needBy ?? '9999') || b.drops.length - a.drops.length);
}

export const makeRunInput = z.object({
  companyId: z.string().min(1).max(40),
  pickupLocationId: z.string().min(1).max(40),
  trailerId: z.string().max(40).nullable(),
  shipOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  needBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  drops: z.array(z.object({ siteId: z.string().max(40), locationId: z.string().max(40), needBy: z.string().nullable() })).min(1).max(20),
  plan: z.array(z.array(z.object({ lotId: z.string().max(40), qty: z.number().positive() })).min(1)).min(1).max(30),
});

/** Turn a suggestion into planned loads (one draft BOL per truckload, drops in order). */
export async function makeRun(auth: AuthContext, run: z.infer<typeof makeRunInput>): Promise<{ ids: string[] }> {
  requirePermission(auth, 'bol:create');
  const lotSites = new Map((await db.inventoryLot.findMany({ where: { id: { in: run.plan.flat().map((x) => x.lotId) }, organizationId: auth.orgId }, select: { id: true, finalSiteId: true } })).map((l) => [l.id, l.finalSiteId]));
  const today = new Date().toISOString().slice(0, 10);
  const priority = run.needBy && run.needBy < today ? 'HIGH' : 'NORMAL';
  const ids: string[] = [];
  for (const [i, load] of run.plan.entries()) {
    const drops = run.drops.filter((d) => load.some((x) => lotSites.get(x.lotId) === d.siteId));
    if (!drops.length) throw badRequest('One of the items isn’t for any of the drop-offs.');
    const bol = await createBol(auth, {
      companyId: run.companyId,
      trailerId: run.trailerId,
      priority,
      notes: run.plan.length > 1 ? `Load ${i + 1} of ${run.plan.length} (suggested by the load optimizer)` : 'Suggested by the load optimizer',
      scheduledDate: run.shipOn,
      stops: [{ key: 'p', kind: 'PICKUP', locationId: run.pickupLocationId, plannedDate: run.shipOn }, ...drops.map((d, j) => ({ key: `d${j}`, kind: 'DROP' as const, locationId: d.locationId, plannedDate: d.needBy && run.shipOn && d.needBy > run.shipOn ? run.shipOn : (d.needBy ?? run.shipOn) }))],
      lines: load.map((x) => ({ lotId: x.lotId, qty: x.qty, pickupKey: 'p', dropKey: `d${drops.findIndex((d) => d.siteId === lotSites.get(x.lotId))}` })),
    });
    ids.push(bol.id);
  }
  return { ids };
}
