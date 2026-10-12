// Inventory by job (where each job's material is) and pre-job equipment planning
// (what each job will need, what we own that can cover it, which jobs compete for
// the same equipment, and who goes first).

import { formatListLabel } from '@supplyline/core/domain';
import type { EquipmentNeedInput, EquipmentNeedView, JobMaterialSummary } from '@supplyline/core/models';
import { can } from '@supplyline/core/permissions';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { isAdmin, requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { forbidden, notFound } from '../lib/errors';
import { accessibleCompanyIds, assertSiteVisible, siteWhereFor } from './access';

const n = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

// ---------------------------------------------------------------------------
// Inventory by job
// ---------------------------------------------------------------------------
export async function jobMaterials(auth: AuthContext, f: { siteId?: string; openOnly?: boolean } = {}): Promise<JobMaterialSummary[]> {
  requirePermission(auth, 'order:view');
  const sites = await db.site.findMany({ where: { AND: [await siteWhereFor(auth), { type: 'JOB', active: true }, f.siteId ? { id: f.siteId } : {}] }, select: { id: true, jobNumber: true, name: true } });
  if (!sites.length) return [];
  const lines = await db.orderLine.findMany({
    where: { siteId: { in: sites.map((s) => s.id) }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
    include: {
      orderForm: { select: { id: true, listNo: true, site: { select: { jobNumber: true } } } },
      siteInventory: true,
      inventoryLots: { where: { qtyAvailable: { gt: 0 } }, select: { qtyAvailable: true, status: true, location: { select: { siteId: true, site: { select: { type: true } } } } } },
      bolLines: { where: { bol: { status: 'DRAFT' } }, select: { qty: true } },
    },
    orderBy: [{ siteId: 'asc' }, { orderForm: { listNo: 'asc' } }, { lineNo: 'asc' }],
  });
  return sites.map((s) => {
    const rows = lines
      .filter((l) => l.siteId === s.id)
      .map((l) => {
        const ordered = n(l.quantity);
        const shipped = n(l.siteInventory?.qtyShipped);
        const received = n(l.siteInventory?.qtyReceived);
        const atYard = l.inventoryLots.filter((x) => x.status === 'IN_STOCK' && x.location.site?.type === 'YARD').reduce((t, x) => t + n(x.qtyAvailable), 0);
        const staged = l.inventoryLots.filter((x) => x.status === 'STAGED').reduce((t, x) => t + n(x.qtyAvailable), 0);
        const planned = l.bolLines.reduce((t, x) => t + n(x.qty), 0);
        const inYard = Math.max(0, atYard - planned);
        const stagedToShip = staged + Math.min(planned, atYard);
        const inTransit = Math.max(0, shipped - received);
        const outstanding = Math.max(0, r3(ordered - received - inTransit - inYard - stagedToShip));
        return {
          orderLineId: l.id,
          orderId: l.orderForm.id,
          ref: `${formatListLabel(l.orderForm.site.jobNumber, l.orderForm.listNo)} L${l.lineNo}`,
          description: l.description,
          uom: l.uom,
          ordered,
          outstanding,
          inYard: r3(inYard),
          stagedToShip: r3(stagedToShip),
          inTransit: r3(inTransit),
          receivedAtSite: r3(received),
          requiredOnSite: day(l.requiredOnSite),
        };
      })
      .filter((r) => !f.openOnly || r.receivedAtSite + 1e-6 < r.ordered);
    const sum = (k: 'outstanding' | 'inYard' | 'stagedToShip' | 'inTransit' | 'receivedAtSite') => r3(rows.reduce((t, r) => t + r[k], 0));
    return {
      siteId: s.id,
      siteLabel: `JOB#${s.jobNumber} ${s.name}`,
      rows,
      totals: { lines: rows.length, outstanding: sum('outstanding'), inYard: sum('inYard'), stagedToShip: sum('stagedToShip'), inTransit: sum('inTransit'), receivedAtSite: sum('receivedAtSite'), complete: rows.filter((r) => r.receivedAtSite + 1e-6 >= r.ordered).length },
    };
  });
}

// ---------------------------------------------------------------------------
// Pre-job equipment planning
// ---------------------------------------------------------------------------
/** Admins, yard, procurement — and the job's PM for their own job. */
async function canPlan(auth: AuthContext, siteId: string) {
  if (can(auth, 'equipment:edit') || can(auth, 'procurement:work')) return true;
  const s = await db.site.findUnique({ where: { id: siteId }, select: { projectManagerId: true } });
  return s?.projectManagerId === auth.userId;
}

const overlaps = (a: { fromDate: Date; toDate: Date }, b: { fromDate: Date; toDate: Date }) => a.fromDate <= b.toDate && b.fromDate <= a.toDate;
const kindOf = (x: { category: string | null; description: string }) => (x.category ?? x.description).trim().toLowerCase();

export async function listEquipmentNeeds(auth: AuthContext, f: { siteId?: string; from?: string; to?: string } = {}): Promise<EquipmentNeedView[]> {
  requirePermission(auth, 'order:view');
  const companies = await accessibleCompanyIds(auth);
  // Everything in the window (all jobs, so competing demand is seen), then show the ones asked for.
  const window: Prisma.JobEquipmentNeedWhereInput = { organizationId: auth.orgId, ...(f.from ? { toDate: { gte: new Date(`${f.from}T00:00:00Z`) } } : {}), ...(f.to ? { fromDate: { lte: new Date(`${f.to}T00:00:00Z`) } } : {}) };
  const all = await db.jobEquipmentNeed.findMany({ where: window, orderBy: [{ fromDate: 'asc' }] });
  const sites = new Map((await db.site.findMany({ where: { id: { in: [...new Set(all.map((x) => x.siteId))] } }, select: { id: true, jobNumber: true, name: true, equipmentPriority: true, companyId: true } })).map((s) => [s.id, s]));
  const fleet = await db.equipment.findMany({ where: { organizationId: auth.orgId, active: true, companyId: { in: companies } }, select: { id: true, unitNumber: true, description: true, category: true } });
  const visible = new Set((await db.site.findMany({ where: await siteWhereFor(auth), select: { id: true } })).map((s) => s.id));
  const pr = (siteId: string) => sites.get(siteId)?.equipmentPriority ?? 100;
  const label = (siteId: string) => {
    const s = sites.get(siteId);
    return s ? `JOB#${s.jobNumber} ${s.name}` : 'Job';
  };
  const units = new Map(fleet.map((u) => [u.id, u]));

  return all
    .filter((x) => visible.has(x.siteId) && (!f.siteId || x.siteId === f.siteId))
    .map((need) => {
      const others = all.filter((o) => o.id !== need.id && overlaps(o, need));
      const sameUnit = need.equipmentId ? others.filter((o) => o.equipmentId === need.equipmentId) : [];
      const sameKind = others.filter((o) => kindOf(o) === kindOf(need));
      // Our units of this kind not taken by another job at the same time.
      const takenIds = new Set(others.map((o) => o.equipmentId).filter((x): x is string => !!x));
      const matches = fleet.filter((u) => {
        const k = kindOf(need);
        return (u.category && u.category.trim().toLowerCase() === k) || u.description.toLowerCase().includes(k) || (need.category && u.description.toLowerCase().includes(need.category.toLowerCase()));
      });
      const freeUnits = matches.filter((u) => !takenIds.has(u.id) && u.id !== need.equipmentId);
      let status: EquipmentNeedView['status'];
      let advice: string | null = null;
      if (sameUnit.length) {
        status = 'CONFLICT';
        const first = [...sameUnit, need].sort((a, b) => pr(a.siteId) - pr(b.siteId) || a.fromDate.getTime() - b.fromDate.getTime())[0]!;
        const u = units.get(need.equipmentId!);
        advice = first.id === need.id ? `This job goes first for ${u ? `unit ${u.unitNumber}` : 'that unit'} (priority ${pr(need.siteId)}); the other job${sameUnit.length > 1 ? 's' : ''} should rent or wait.` : `${label(first.siteId)} goes first (priority ${pr(first.siteId)}) — ${freeUnits.length ? `use unit ${freeUnits[0]!.unitNumber} instead` : 'rent one or wait'}.`;
      } else if (need.coverage !== 'NEEDED') {
        status = 'COVERED';
      } else if (freeUnits.length >= need.qty) {
        status = 'CAN_COVER';
        advice = `Free: ${freeUnits.slice(0, 3).map((u) => `unit ${u.unitNumber}`).join(', ')}.`;
      } else {
        status = 'SHORT';
        const ahead = sameKind.filter((o) => pr(o.siteId) < pr(need.siteId));
        advice = ahead.length ? `${ahead.length} job${ahead.length === 1 ? '' : 's'} ahead of this one want the same — rent or buy, or change the priorities.` : 'None of ours is free for these dates — rent or buy.';
      }
      return {
        id: need.id,
        siteId: need.siteId,
        siteLabel: label(need.siteId),
        jobPriority: pr(need.siteId),
        description: need.description,
        category: need.category,
        qty: need.qty,
        fromDate: day(need.fromDate)!,
        toDate: day(need.toDate)!,
        coverage: need.coverage as EquipmentNeedView['coverage'],
        equipment: need.equipmentId && units.get(need.equipmentId) ? { id: need.equipmentId, unitNumber: units.get(need.equipmentId)!.unitNumber, description: units.get(need.equipmentId)!.description } : null,
        notes: need.notes,
        freeUnits: freeUnits.map((u) => ({ id: u.id, unitNumber: u.unitNumber, description: u.description })),
        competing: [...new Set([...sameUnit, ...sameKind])].map((o) => ({ needId: o.id, siteLabel: label(o.siteId), jobPriority: pr(o.siteId), fromDate: day(o.fromDate)!, toDate: day(o.toDate)!, equipmentId: o.equipmentId })),
        status,
        advice,
      };
    })
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.jobPriority - b.jobPriority);
}

export async function saveEquipmentNeed(auth: AuthContext, id: string | null, input: EquipmentNeedInput) {
  await assertSiteVisible(auth, input.siteId);
  if (!(await canPlan(auth, input.siteId))) throw forbidden();
  if (input.equipmentId && !(await db.equipment.findFirst({ where: { id: input.equipmentId, organizationId: auth.orgId } }))) throw notFound('Unit');
  const data = {
    siteId: input.siteId,
    description: input.description,
    category: input.category ?? null,
    qty: input.qty,
    fromDate: new Date(`${input.fromDate}T00:00:00Z`),
    toDate: new Date(`${input.toDate}T00:00:00Z`),
    equipmentId: input.equipmentId ?? null,
    coverage: input.equipmentId && input.coverage === 'NEEDED' ? 'OWN' : input.coverage,
    notes: input.notes ?? null,
  };
  let row;
  if (id) {
    const existing = await db.jobEquipmentNeed.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!existing) throw notFound('Equipment need');
    row = await db.jobEquipmentNeed.update({ where: { id }, data });
  } else row = await db.jobEquipmentNeed.create({ data: { organizationId: auth.orgId, createdById: auth.userId, ...data } });
  await audit(db, auth, id ? 'equipment_need.update' : 'equipment_need.create', 'JobEquipmentNeed', row.id, null, input);
  return { id: row.id };
}

export async function deleteEquipmentNeed(auth: AuthContext, id: string) {
  const need = await db.jobEquipmentNeed.findFirst({ where: { id, organizationId: auth.orgId } });
  if (!need) throw notFound('Equipment need');
  if (!(await canPlan(auth, need.siteId))) throw forbidden();
  await db.jobEquipmentNeed.delete({ where: { id } });
  await audit(db, auth, 'equipment_need.delete', 'JobEquipmentNeed', id, { description: need.description }, null);
  return { ok: true };
}

/** Which job goes first when jobs want the same equipment (admin). */
export async function setEquipmentPriority(auth: AuthContext, siteId: string, priority: number) {
  if (!isAdmin(auth)) throw forbidden();
  await assertSiteVisible(auth, siteId);
  await db.site.update({ where: { id: siteId }, data: { equipmentPriority: Math.max(1, Math.min(999, Math.round(priority))) } });
  await audit(db, auth, 'site.equipment_priority', 'Site', siteId, null, { priority });
  return { ok: true };
}
