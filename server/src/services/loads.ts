// Loads: the trailer library, optional sizes and weights on lines, and the load
// builder (split material into truckloads, flag oversize / overweight, and turn
// the result into planned loads — draft BOLs — on the schedule).

import { formatListLabel, planLoads, type TrailerSpec } from '@supplyline/core/domain';
import type { LineSizeInput, LoadItem, LoadPlan, MakeLoadsInput, TrailerInput, TrailerView } from '@supplyline/core/models';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { accessibleCompanyIds } from './access';
import { createBol } from './bols';

const num = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d));

type TrailerRow = Prisma.TrailerGetPayload<object>;
export const trailerSpec = (t: TrailerRow): TrailerSpec => ({
  id: t.id,
  deckLengthM: Number(t.deckLengthM),
  deckWidthM: Number(t.deckWidthM),
  deckHeightM: Number(t.deckHeightM),
  maxHeightM: Number(t.maxHeightM),
  maxWidthM: Number(t.maxWidthM),
  maxPayloadKg: Number(t.maxPayloadKg),
});

async function toView(t: TrailerRow): Promise<TrailerView> {
  const carrier = t.carrierContactId ? await db.contact.findUnique({ where: { id: t.carrierContactId }, select: { name: true, businessName: true } }) : null;
  return {
    id: t.id,
    name: t.name,
    kind: t.kind as TrailerView['kind'],
    unitNumber: t.unitNumber,
    carrierContactId: t.carrierContactId,
    carrierName: carrier ? (carrier.businessName ?? carrier.name) : null,
    deckLengthM: Number(t.deckLengthM),
    deckWidthM: Number(t.deckWidthM),
    deckHeightM: Number(t.deckHeightM),
    maxHeightM: Number(t.maxHeightM),
    maxWidthM: Number(t.maxWidthM),
    maxPayloadKg: Number(t.maxPayloadKg),
    notes: t.notes,
    active: t.active,
  };
}

export async function listTrailers(auth: AuthContext, includeInactive = false): Promise<TrailerView[]> {
  const rows = await db.trailer.findMany({ where: { organizationId: auth.orgId, ...(includeInactive ? {} : { active: true }) }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  return Promise.all(rows.map(toView));
}

export async function saveTrailer(auth: AuthContext, id: string | null, input: TrailerInput): Promise<TrailerView> {
  requirePermission(auth, 'trailer:manage');
  if (input.carrierContactId && !(await db.contact.findFirst({ where: { id: input.carrierContactId, organizationId: auth.orgId } }))) throw badRequest('Carrier not found in contacts.');
  const data = {
    name: input.name,
    kind: input.kind,
    unitNumber: input.unitNumber ?? null,
    carrierContactId: input.carrierContactId ?? null,
    deckLengthM: input.deckLengthM,
    deckWidthM: input.deckWidthM,
    deckHeightM: input.deckHeightM,
    maxHeightM: input.maxHeightM,
    maxWidthM: input.maxWidthM,
    maxPayloadKg: input.maxPayloadKg,
    notes: input.notes ?? null,
    ...(input.active !== undefined ? { active: input.active } : {}),
  };
  let t;
  if (id) {
    if (!(await db.trailer.findFirst({ where: { id, organizationId: auth.orgId } }))) throw notFound('Trailer');
    t = await db.trailer.update({ where: { id }, data });
  } else t = await db.trailer.create({ data: { organizationId: auth.orgId, ...data } });
  await audit(db, auth, id ? 'trailer.update' : 'trailer.create', 'Trailer', t.id, null, input);
  return toView(t);
}

async function trailerFor(auth: AuthContext, id: string) {
  const t = await db.trailer.findFirst({ where: { id, organizationId: auth.orgId } });
  if (!t) throw notFound('Trailer');
  return t;
}

/** Sizes and weight (per unit) on an order-list line. */
export async function setLineSize(auth: AuthContext, orderLineId: string, input: LineSizeInput) {
  requirePermission(auth, 'loads:plan');
  const line = await db.orderLine.findFirst({ where: { id: orderLineId, organizationId: auth.orgId, companyId: { in: await accessibleCompanyIds(auth, { crossUnit: true }) } } });
  if (!line) throw notFound('Line');
  await db.orderLine.update({ where: { id: orderLineId }, data: input });
  await audit(db, auth, 'order_line.size', 'OrderLine', orderLineId, null, input);
  return { ok: true };
}

const lotInclude = {
  orderLine: { include: { orderForm: { include: { site: { select: { jobNumber: true } } } } } },
  location: { select: { businessName: true } },
  equipment: { select: { unitNumber: true } },
} satisfies Prisma.InventoryLotInclude;

function toItem(l: Prisma.InventoryLotGetPayload<{ include: typeof lotInclude }>): LoadItem {
  const ol = l.orderLine;
  return {
    key: l.id,
    lotId: l.id,
    orderLineId: ol?.id ?? null,
    label: l.description,
    ref: ol ? `${formatListLabel(ol.orderForm.site.jobNumber, ol.orderForm.listNo)} L${ol.lineNo}` : l.equipment ? `Unit ${l.equipment.unitNumber} stock` : 'Stock',
    uom: l.uom,
    qty: Number(l.qtyAvailable),
    unitWeightKg: num(ol?.unitWeightKg),
    lengthM: num(ol?.lengthM),
    widthM: num(ol?.widthM),
    heightM: num(ol?.heightM),
    stackable: ol?.stackable ?? true,
    locationId: l.locationId,
    locationName: l.location.businessName,
    companyId: l.companyId,
    finalSiteId: l.finalSiteId,
  };
}

/** Material ready to load: at a location (yard / laydown), optionally only what's for one job. */
export async function loadItems(auth: AuthContext, f: { locationId: string; siteId?: string; companyId?: string }): Promise<LoadItem[]> {
  requirePermission(auth, 'loads:plan');
  const companies = await accessibleCompanyIds(auth, { crossUnit: true });
  const lots = await db.inventoryLot.findMany({
    where: {
      organizationId: auth.orgId,
      locationId: f.locationId,
      companyId: f.companyId ? { in: companies.filter((c) => c === f.companyId) } : { in: companies },
      status: { in: ['IN_STOCK', 'STAGED'] },
      qtyAvailable: { gt: 0 },
      ...(f.siteId ? { finalSiteId: f.siteId } : {}),
    },
    include: lotInclude,
    orderBy: [{ finalSiteId: 'asc' }, { createdAt: 'asc' }],
  });
  return lots.map(toItem);
}

/** Split the chosen material into loads for a trailer. */
export async function planForTrailer(auth: AuthContext, input: { trailerId: string; items: { key: string; qty: number }[] }): Promise<LoadPlan & { items: LoadItem[] }> {
  requirePermission(auth, 'loads:plan');
  const t = await trailerFor(auth, input.trailerId);
  const lots = await db.inventoryLot.findMany({ where: { id: { in: input.items.map((i) => i.key) }, organizationId: auth.orgId, companyId: { in: await accessibleCompanyIds(auth, { crossUnit: true }) } }, include: lotInclude });
  const items = input.items.map((i) => {
    const lot = lots.find((l) => l.id === i.key);
    if (!lot) throw badRequest('One of the items is no longer in inventory.');
    const it = toItem(lot);
    if (i.qty > it.qty + 1e-6) throw badRequest(`Only ${it.qty} ${it.uom} of "${it.label}" is there.`);
    return { ...it, qty: i.qty };
  });
  return { ...planLoads(items, trailerSpec(t)), items };
}

/** Compare: how many loads on each trailer in the library. */
export async function compareTrailers(auth: AuthContext, items: { key: string; qty: number }[]) {
  const trailers = await db.trailer.findMany({ where: { organizationId: auth.orgId, active: true }, orderBy: { name: 'asc' } });
  const out = [];
  for (const t of trailers) {
    const p = await planForTrailer(auth, { trailerId: t.id, items });
    out.push({ trailerId: t.id, name: t.name, loads: p.loads.length, flagged: p.loads.filter((l) => l.flags.length).length });
  }
  return out.sort((a, b) => a.loads - b.loads || a.flagged - b.flagged);
}

/** Turn a plan into planned loads (draft BOLs on the schedule), one per load. */
export async function makePlannedLoads(auth: AuthContext, input: MakeLoadsInput): Promise<{ ids: string[] }> {
  requirePermission(auth, 'bol:create');
  await trailerFor(auth, input.trailerId);
  const ids: string[] = [];
  for (const [i, load] of input.loads.entries()) {
    const bol = await createBol(auth, {
      companyId: input.companyId,
      carrierContactId: input.carrierContactId ?? null,
      trailerId: input.trailerId,
      notes: input.loads.length > 1 ? `Load ${i + 1} of ${input.loads.length} (load builder)` : null,
      scheduledDate: input.pickupDate ?? null,
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: input.pickupLocationId, plannedDate: input.pickupDate ?? null },
        { key: 'd', kind: 'DROP', locationId: input.dropLocationId, plannedDate: input.deliveryDate ?? null },
      ],
      lines: load.map((l) => ({ lotId: l.lotId, qty: l.qty, pickupKey: 'p', dropKey: 'd' })),
    });
    ids.push(bol.id);
  }
  return { ids };
}
