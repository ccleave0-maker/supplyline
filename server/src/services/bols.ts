// Bills of lading: build a multi-stop BOL from inventory, issue it (number +
// PDF with QR code), receive it at each drop stop (job, staging area, or the
// yard for returns), returns from site, and cancelling.

import { counterKeys, formatListLabel } from '@supplyline/core/domain';
import type {
  AvailableLot,
  BolDetail,
  BolInput,
  BolLineView,
  BolStatus,
  BolSummary,
  ReceiveBolInput,
  ReturnInput,
  SiteReceiptView,
} from '@supplyline/core/models';
import { can } from '@supplyline/core/permissions';
import type { Prisma } from '../generated/prisma/client';
import { db, type Tx } from '../lib/db';
import { audit } from '../lib/audit';
import { isAdmin, requirePermission, type AuthContext } from '../lib/auth';
import { nextCounter } from '../lib/counters';
import { env } from '../lib/env';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { publish } from '../lib/events';
import { sendEmail, viaName } from '../integrations/email';
import { renderBolPdf } from '../pdf/bol-pdf';
import { accessibleCompanyIds, siteWhereFor } from './access';
import { fileUrl, logoForPdf, readFileAsset, saveUpload } from './files';
import { makeSiteReceiptReport } from './receiving-report';
import { checkLoad } from '@supplyline/core/domain';
import { trailerSpec } from './loads';
import { fileDocument, jobLabel } from './filing';
import { locationIdForSite, lotStatusAt } from './inventory';
import { recomputeLines } from './line-status';
import { toLocation } from './locations';
import { recipientsFor } from './orders';
import { notifyJob } from './notify';
import { moveToTrash } from './trash';

const n = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d));
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : null);
/** "2026-10-14 07:30", "2026-10-14" or null */
const whenLabel = (s: { plannedDate: Date | null; plannedTime: string | null }) =>
  s.plannedDate ? [dateOnly(s.plannedDate), s.plannedTime].filter(Boolean).join(' ') : null;
export const appLink = (path: string) => `${env().APP_URL.replace(/\/$/, '')}${path}`;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

const locInclude = { site: { select: { type: true, name: true } } } satisfies Prisma.ShippingLocationInclude;

const bolInclude = {
  company: true,
  carrier: true,
  trailer: true,
  stops: {
    orderBy: { seq: 'asc' },
    include: {
      location: { include: locInclude },
      siteReceipts: {
        orderBy: { receivedAt: 'asc' },
        include: { receivedBy: { select: { name: true } }, photos: { where: { deletedAt: null }, select: { id: true } }, lines: true },
      },
    },
  },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      orderLine: { include: { orderForm: { include: { site: { select: { jobNumber: true, name: true } } } } } },
      poLine: { include: { purchaseOrder: { select: { poNumber: true } } } },
      sourceLot: { include: { finalSite: { select: { jobNumber: true, name: true } } } },
      forSite: { select: { id: true, jobNumber: true, name: true } },
      siteReceiptLines: { select: { qtyReceived: true } },
    },
  },
} satisfies Prisma.BillOfLadingInclude;
type BolFull = Prisma.BillOfLadingGetPayload<{ include: typeof bolInclude }>;

export const bolLabel = (b: { bolNumber: number | null; direction: string }) =>
  b.bolNumber == null ? (b.direction === 'RETURN' ? 'Draft return BOL' : 'Draft BOL') : `${b.direction === 'RETURN' ? 'Return BOL' : 'BOL'} #${b.bolNumber}`;
const stopLabel = (kind: string, seq: number, stops: { kind: string; seq: number }[]) =>
  `${kind === 'PICKUP' ? 'Pickup' : 'Delivery'} ${stops.filter((x) => x.kind === kind && x.seq <= seq).length}`;
const lineReceived = (l: BolFull['lines'][number]) => l.siteReceiptLines.reduce((a, r) => a + n(r.qtyReceived), 0);

/** Site-only people see BOLs touching their jobs; everyone else sees their companies' BOLs. */
export async function bolWhereFor(auth: AuthContext, opts: { crossUnit?: boolean } = {}): Promise<Prisma.BillOfLadingWhereInput> {
  const base: Prisma.BillOfLadingWhereInput = { organizationId: auth.orgId };
  if (isAdmin(auth)) return base;
  const siteOnly = auth.roles.every((r) => r === 'SITE');
  if (siteOnly) {
    const sites = await db.site.findMany({ where: await siteWhereFor(auth), select: { id: true } });
    return { ...base, stops: { some: { location: { siteId: { in: sites.map((s) => s.id) } } } } };
  }
  return { ...base, companyId: { in: await accessibleCompanyIds(auth, opts) } };
}

async function loadBol(auth: AuthContext, id: string): Promise<BolFull> {
  requirePermission(auth, 'bol:view');
  const b = await db.billOfLading.findFirst({ where: { AND: [{ id }, await bolWhereFor(auth)] }, include: bolInclude });
  if (!b) throw notFound('BOL');
  return b;
}

/** Can this person receive at this drop stop? Yard people anywhere; others at jobs they can see. */
async function canReceiveAt(auth: AuthContext, b: BolFull, stop: BolFull['stops'][number]): Promise<boolean> {
  if (stop.kind !== 'DROP' || (b.status !== 'ISSUED' && b.status !== 'PARTIALLY_RECEIVED')) return false;
  if (!can(auth, 'bol:receive')) return false;
  if (can(auth, 'yard:work')) return true;
  const finals = new Set(b.lines.filter((l) => l.dropStopId === stop.id).map((l) => l.sourceLot?.finalSiteId ?? l.forSiteId).filter((x): x is string => !!x));
  if (stop.location.siteId) finals.add(stop.location.siteId);
  const visible = await db.site.count({ where: { AND: [{ id: { in: [...finals] } }, await siteWhereFor(auth)] } });
  return visible > 0;
}

function toSummary(b: Pick<BolFull, 'id' | 'bolNumber' | 'direction' | 'status' | 'companyId' | 'scheduledDate' | 'issuedAt' | 'createdAt'> & { company: { name: string }; stops: { kind: string; plannedDate: Date | null; location: { businessName: string } }[]; lines: unknown[] }): BolSummary {
  const pick = [...new Set(b.stops.filter((s) => s.kind === 'PICKUP').map((s) => s.location.businessName))];
  const drop = [...new Set(b.stops.filter((s) => s.kind === 'DROP').map((s) => s.location.businessName))];
  return {
    id: b.id,
    bolNumber: b.bolNumber,
    label: bolLabel(b),
    direction: b.direction,
    status: b.status as BolStatus,
    companyId: b.companyId,
    companyName: b.company.name,
    route: `${pick.join(' · ')} → ${drop.join(' · ')}`,
    lineCount: b.lines.length,
    scheduledDate: dateOnly(b.scheduledDate),
    deliveryDate: dateOnly(b.stops.filter((s) => s.kind === 'DROP' && s.plannedDate).at(-1)?.plannedDate ?? null),
    issuedAt: b.issuedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}

function toLineView(l: BolFull['lines'][number]): BolLineView {
  const o = l.orderLine?.orderForm ?? null;
  const site = l.sourceLot?.finalSite ?? l.forSite ?? null;
  return {
    id: l.id,
    lineNo: l.lineNo,
    lotId: l.sourceLotId,
    orderId: o?.id ?? null,
    orderLabel: o ? formatListLabel(o.site.jobNumber, o.listNo) : null,
    orderLineNo: l.orderLine?.lineNo ?? null,
    manual: l.manual,
    finalSiteId: l.sourceLot?.finalSiteId ?? l.forSiteId,
    description: l.description,
    uom: l.uom,
    qty: n(l.qty),
    received: round3(lineReceived(l)),
    poNumber: l.poLine?.purchaseOrder.poNumber ?? null,
    pickupStopId: l.pickupStopId,
    dropStopId: l.dropStopId,
    finalSiteLabel: site ? `JOB#${site.jobNumber} ${site.name}` : null,
  };
}

async function toDetail(auth: AuthContext, b: BolFull): Promise<BolDetail> {
  const editable = b.status === 'DRAFT' && can(auth, b.direction === 'RETURN' ? 'return:create' : 'bol:create');
  const stops = [];
  for (const s of b.stops) {
    stops.push({
      id: s.id,
      seq: s.seq,
      kind: s.kind,
      location: toLocation(s.location),
      plannedDate: dateOnly(s.plannedDate),
      plannedTime: s.plannedTime,
      completedAt: s.completedAt?.toISOString() ?? null,
      canReceive: await canReceiveAt(auth, b, s),
      receipts: s.siteReceipts.map((r) => ({
        id: r.id,
        receivedAt: r.receivedAt.toISOString(),
        receivedByName: r.receivedBy.name,
        photoCount: r.photos.length,
        problems: r.lines.filter((x) => x.damaged || n(x.qtyShort) > 0).length,
      })),
    });
  }
  return {
    ...toSummary(b),
    carrier: b.carrier
      ? { id: b.carrier.id, name: b.carrier.name, businessName: b.carrier.businessName, phone: b.carrier.phone, cell: b.carrier.cell, email: b.carrier.email }
      : null,
    driverName: b.driverName,
    truckUnit: b.truckUnit,
    notes: b.notes,
    stops,
    lines: b.lines.map(toLineView),
    canEdit: editable,
    canIssue: editable && b.lines.length > 0,
    canCancel:
      (b.status === 'ISSUED' && b.lines.every((l) => l.siteReceiptLines.length === 0) && can(auth, 'bol:create')) ||
      (b.status === 'DRAFT' && editable),
    trailer: b.trailer ? { id: b.trailer.id, name: b.trailer.name, maxPayloadKg: Number(b.trailer.maxPayloadKg) } : null,
    loadCheck: b.trailer
      ? checkLoad(
          b.lines.map((l) => ({ key: l.id, qty: n(l.qty), unitWeightKg: sizeNum(l.orderLine?.unitWeightKg), lengthM: sizeNum(l.orderLine?.lengthM), widthM: sizeNum(l.orderLine?.widthM), heightM: sizeNum(l.orderLine?.heightM), stackable: l.orderLine?.stackable ?? true })),
          trailerSpec(b.trailer),
        )
      : null,
    shippedAt: b.shippedAt?.toISOString() ?? null,
    canShip: !b.shippedAt && (b.status === 'ISSUED' || b.status === 'PARTIALLY_RECEIVED') && can(auth, b.direction === 'RETURN' ? 'return:create' : 'bol:create'),
  };
}

// ---------------------------------------------------------------------------
// Inventory to pick from
// ---------------------------------------------------------------------------
const lotInclude = {
  orderLine: { include: { orderForm: { include: { site: { select: { jobNumber: true } } } } } },
  finalSite: { select: { jobNumber: true, name: true } },
  yardReceiptLine: { include: { poLine: { include: { purchaseOrder: { select: { poNumber: true } } } } } },
  equipment: { select: { unitNumber: true, description: true } },
} satisfies Prisma.InventoryLotInclude;

function toAvailable(l: Prisma.InventoryLotGetPayload<{ include: typeof lotInclude }>): AvailableLot {
  return {
    lotId: l.id,
    companyId: l.companyId,
    locationId: l.locationId,
    status: l.status,
    orderId: l.orderLine?.orderFormId ?? null,
    orderLabel: l.orderLine ? formatListLabel(l.orderLine.orderForm.site.jobNumber, l.orderLine.orderForm.listNo) : null,
    lineNo: l.orderLine?.lineNo ?? null,
    description: l.description,
    uom: l.uom,
    qtyAvailable: n(l.qtyAvailable),
    finalSiteId: l.finalSiteId,
    finalSiteLabel: l.finalSite ? `JOB#${l.finalSite.jobNumber} ${l.finalSite.name}` : null,
    equipmentLabel: l.equipment ? `Unit ${l.equipment.unitNumber} · ${l.equipment.description}` : null,
    poNumber: l.yardReceiptLine?.poLine?.purchaseOrder.poNumber ?? null,
  };
}

/** What's available to load at a location (for one company, or all you can see). */
export async function availableLots(auth: AuthContext, locationId: string, companyId?: string): Promise<AvailableLot[]> {
  requirePermission(auth, 'bol:view');
  const companies = await accessibleCompanyIds(auth);
  const rows = await db.inventoryLot.findMany({
    where: {
      organizationId: auth.orgId,
      locationId,
      qtyAvailable: { gt: 0 },
      companyId: companyId ? (companies.includes(companyId) ? companyId : '__none__') : { in: companies },
    },
    include: lotInclude,
    orderBy: [{ finalSiteId: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toAvailable);
}

/** Material sitting at a job (for returns). */
export async function lotsAtSite(auth: AuthContext, siteId: string): Promise<AvailableLot[]> {
  requirePermission(auth, 'bol:view');
  const site = await db.site.findFirst({ where: { AND: [{ id: siteId }, await siteWhereFor(auth)] } });
  if (!site) throw notFound('Job');
  const loc = await locationIdForSite(db, siteId);
  const rows = await db.inventoryLot.findMany({
    where: { organizationId: auth.orgId, locationId: loc, qtyAvailable: { gt: 0 } },
    include: lotInclude,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toAvailable);
}

// ---------------------------------------------------------------------------
// Create / edit / delete drafts
// ---------------------------------------------------------------------------
async function writeDraft(tx: Tx, auth: AuthContext, input: BolInput, direction: 'OUTBOUND' | 'RETURN', bolId: string | null): Promise<string> {
  const companies = await accessibleCompanyIds(auth);
  if (!companies.includes(input.companyId)) throw notFound('Company');

  // Stops: real locations, unique keys, at least one pickup and one drop.
  const keys = new Set(input.stops.map((s) => s.key));
  if (keys.size !== input.stops.length) throw badRequest('Two stops have the same key.');
  if (!input.stops.some((s) => s.kind === 'PICKUP') || !input.stops.some((s) => s.kind === 'DROP')) {
    throw badRequest('A BOL needs at least one pickup and one delivery.');
  }
  const locations = await tx.shippingLocation.findMany({ where: { id: { in: input.stops.map((s) => s.locationId) }, organizationId: auth.orgId } });
  if (locations.length !== new Set(input.stops.map((s) => s.locationId)).size) throw badRequest('One of the stops is not in the locations list.');
  const seqOf = new Map(input.stops.map((s, i) => [s.key, i + 1]));
  const kindOf = new Map(input.stops.map((s) => [s.key, s.kind]));
  const locOf = new Map(input.stops.map((s) => [s.key, s.locationId]));

  // Lines: from lots at their pickup stop, dropped later on the route, within what's there.
  const lots = await tx.inventoryLot.findMany({ where: { id: { in: input.lines.map((l) => l.lotId).filter((x): x is string => !!x) }, organizationId: auth.orgId }, include: { orderLine: true } });
  const used = new Map<string, number>();
  // Typed-in items (milk runs, extras): just need a pickup before their drop, and a job you can see.
  const manualSites = [...new Set(input.lines.map((l) => l.manual?.siteId).filter((x): x is string => !!x))];
  if (manualSites.length) {
    const ok = await tx.site.count({ where: { id: { in: manualSites }, organizationId: auth.orgId, type: 'JOB' } });
    if (ok !== manualSites.length) throw badRequest('One of the jobs for a typed-in item was not found.');
  }
  for (const l of input.lines) {
    if (l.manual) {
      if (kindOf.get(l.pickupKey) !== 'PICKUP' || kindOf.get(l.dropKey) !== 'DROP') throw badRequest('Each item needs a pickup stop and a delivery stop.');
      if ((seqOf.get(l.pickupKey) ?? 0) > (seqOf.get(l.dropKey) ?? 0)) throw badRequest(`"${l.manual.description}" is dropped before it's picked up.`);
      continue;
    }
    const lot = lots.find((x) => x.id === l.lotId);
    if (!lot) throw badRequest('One of the items is no longer in inventory.');
    if (lot.companyId !== input.companyId) throw badRequest('All items on a BOL must belong to the same company.');
    if (kindOf.get(l.pickupKey) !== 'PICKUP' || kindOf.get(l.dropKey) !== 'DROP') throw badRequest('Each item needs a pickup stop and a delivery stop.');
    if (locOf.get(l.pickupKey) !== lot.locationId) throw badRequest(`"${lot.description}" isn't at that pickup location.`);
    if ((seqOf.get(l.pickupKey) ?? 0) > (seqOf.get(l.dropKey) ?? 0)) throw badRequest(`"${lot.description}" is dropped before it's picked up.`);
    used.set(lot.id, (used.get(lot.id) ?? 0) + l.qty);
    if ((used.get(lot.id) ?? 0) > n(lot.qtyAvailable) + 1e-6) throw badRequest(`Only ${n(lot.qtyAvailable)} ${lot.uom} of "${lot.description}" is available there.`);
  }

  // Main job = the job most of the material is for (used for lists and filters).
  const counts = new Map<string, number>();
  for (const l of lots) if (l.finalSiteId) counts.set(l.finalSiteId, (counts.get(l.finalSiteId) ?? 0) + 1);
  for (const id of manualSites) counts.set(id, (counts.get(id) ?? 0) + 1);
  // A planned load with no items yet: the first job it drops at.
  const mainSite =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    locations.find((l) => l.siteId && input.stops.some((s) => s.kind === 'DROP' && s.locationId === l.id))?.siteId ??
    null;

  const data = {
    companyId: input.companyId,
    siteId: mainSite,
    carrierContactId: input.carrierContactId ?? null,
    driverName: input.driverName ?? null,
    truckUnit: input.truckUnit ?? null,
    trailerId: input.trailerId ?? null,
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.title !== undefined ? { title: input.title || null } : {}),
    scheduledDate: toDate(input.stops.find((s) => s.kind === 'PICKUP' && s.plannedDate)?.plannedDate ?? input.scheduledDate),
    notes: input.notes ?? null,
  };
  if (data.trailerId && !(await tx.trailer.findFirst({ where: { id: data.trailerId, organizationId: auth.orgId } }))) throw badRequest('Trailer not found.');
  if (data.carrierContactId) {
    const c = await tx.contact.findFirst({ where: { id: data.carrierContactId, organizationId: auth.orgId } });
    if (!c) throw badRequest('Carrier not found in contacts.');
  }
  let id = bolId;
  if (id) {
    await tx.bOLLine.deleteMany({ where: { bolId: id } });
    await tx.bolStop.deleteMany({ where: { bolId: id } });
    await tx.billOfLading.update({ where: { id }, data });
  } else {
    id = (await tx.billOfLading.create({ data: { ...data, organizationId: auth.orgId, direction, createdById: auth.userId } })).id;
  }
  const stopIds = new Map<string, string>();
  for (const [i, s] of input.stops.entries()) {
    const st = await tx.bolStop.create({
      data: { bolId: id, seq: i + 1, kind: s.kind, locationId: s.locationId, plannedDate: toDate(s.plannedDate), plannedTime: s.plannedTime || null },
    });
    stopIds.set(s.key, st.id);
  }
  for (const [i, l] of input.lines.entries()) {
    if (l.manual) {
      await tx.bOLLine.create({
        data: {
          bolId: id,
          lineNo: i + 1,
          manual: true,
          forSiteId: l.manual.siteId ?? locations.find((x) => x.id === locOf.get(l.dropKey))?.siteId ?? null,
          pickupStopId: stopIds.get(l.pickupKey)!,
          dropStopId: stopIds.get(l.dropKey)!,
          description: l.manual.description,
          uom: l.manual.uom.toUpperCase(),
          qty: l.qty,
        },
      });
      continue;
    }
    const lot = lots.find((x) => x.id === l.lotId)!;
    const poLineId =
      lot.purchaseOrderLineId ??
      (lot.yardReceiptLineId
        ? ((await tx.yardReceiptLine.findUnique({ where: { id: lot.yardReceiptLineId }, select: { purchaseOrderLineId: true } }))?.purchaseOrderLineId ?? null)
        : null);
    await tx.bOLLine.create({
      data: {
        bolId: id,
        lineNo: i + 1,
        orderLineId: lot.orderLineId,
        purchaseOrderLineId: poLineId,
        sourceLotId: lot.id,
        pickupStopId: stopIds.get(l.pickupKey)!,
        dropStopId: stopIds.get(l.dropKey)!,
        description: lot.description,
        uom: lot.uom,
        qty: l.qty,
      },
    });
  }
  return id;
}

export async function createBol(auth: AuthContext, input: BolInput): Promise<BolDetail> {
  requirePermission(auth, 'bol:create');
  const id = await db.$transaction(async (tx) => {
    const bolId = await writeDraft(tx, auth, input, 'OUTBOUND', null);
    await audit(tx, auth, 'bol.create', 'BillOfLading', bolId, null, input);
    return bolId;
  });
  // Procurement hears about planned loads (and the truck, if it's booked already).
  const { tellProcurement } = await import('./board');
  await tellProcurement(auth.orgId, auth.userId, id, 'planned').catch(() => undefined);
  if (input.carrierContactId || input.driverName || input.truckUnit) await tellProcurement(auth.orgId, auth.userId, id, 'truck').catch(() => undefined);
  return toDetail(auth, await loadBol(auth, id));
}

export async function updateBol(auth: AuthContext, id: string, input: BolInput): Promise<BolDetail> {
  const b = await loadBol(auth, id);
  requirePermission(auth, b.direction === 'RETURN' ? 'return:create' : 'bol:create');
  if (b.status !== 'DRAFT') throw conflict('Only draft BOLs can be changed.');
  await db.$transaction(async (tx) => {
    await writeDraft(tx, auth, input, b.direction, id);
    await audit(tx, auth, 'bol.update', 'BillOfLading', id, null, input);
  });
  // A truck was just booked on it: tell procurement.
  const hadTruck = !!(b.carrierContactId || b.driverName || b.truckUnit);
  if (!hadTruck && (input.carrierContactId || input.driverName || input.truckUnit)) {
    const { tellProcurement } = await import('./board');
    await tellProcurement(auth.orgId, auth.userId, id, 'truck').catch(() => undefined);
  }
  return toDetail(auth, await loadBol(auth, id));
}

export async function deleteDraftBol(auth: AuthContext, id: string) {
  const b = await loadBol(auth, id);
  requirePermission(auth, b.direction === 'RETURN' ? 'return:create' : 'bol:create');
  if (b.status !== 'DRAFT') throw conflict('Issued BOLs can’t be deleted. Cancel it instead.');
  const raw = await db.billOfLading.findUniqueOrThrow({ where: { id }, include: { stops: true, lines: true } });
  await db.$transaction(async (tx) => {
    await moveToTrash(tx, auth, 'BOL_DRAFT', id, `${bolLabel(b)} (${toSummary(b).route})`, raw);
    await tx.billOfLading.delete({ where: { id } });  // stops and lines cascade
  });
}

// ---------------------------------------------------------------------------
// Issue / cancel
// ---------------------------------------------------------------------------
export async function buildBolPdf(b: BolFull): Promise<Buffer> {
  return renderBolPdf({
    bolId: b.id,
    bolNumber: b.bolNumber,
    direction: b.direction,
    companyName: b.company.name,
    companyCode: b.company.code,
    themeColor: b.company.themeColor,
    logo: await logoForPdf(b.company.logoFileId),
    issuedAt: b.issuedAt,
    scheduledDate: dateOnly(b.scheduledDate),
    carrier: b.carrier ? { name: [b.carrier.businessName, b.carrier.name].filter(Boolean).join(' – '), phone: b.carrier.cell ?? b.carrier.phone } : null,
    driverName: b.driverName,
    truckUnit: b.truckUnit,
    trailer: b.trailer ? b.trailer.name + (b.trailer.unitNumber ? ` #${b.trailer.unitNumber}` : '') : null,
    weightKg: b.lines.some((l) => l.orderLine?.unitWeightKg != null) ? Math.round(b.lines.reduce((t, l) => t + n(l.qty) * (sizeNum(l.orderLine?.unitWeightKg) ?? 0), 0)) : null,
    notes: b.notes,
    stops: b.stops.map((s) => ({
      seq: s.seq,
      kind: s.kind,
      label: stopLabel(s.kind, s.seq, b.stops),
      when: whenLabel(s),
      name: s.location.businessName,
      address: [s.location.address, s.location.city, s.location.province].filter(Boolean).join(', ') || null,
      phone: s.location.phone ?? s.location.cell,
      lines: b.lines
        .filter((l) => (s.kind === 'PICKUP' ? l.pickupStopId : l.dropStopId) === s.id)
        .map((l) => {
          const v = toLineView(l);
          return { lineNo: v.lineNo, orderLabel: v.orderLabel, orderLineNo: v.orderLineNo, poNumber: v.poNumber, description: v.description, qty: v.qty, uom: v.uom, job: v.finalSiteLabel };
        })
        // Grouped by job (milk runs), then in line order.
        .sort((a, b) => (a.job ?? '').localeCompare(b.job ?? '') || a.lineNo - b.lineNo),
    })),
  });
}

/** Number it, take the material out of its pickup locations, file the PDF and tell the receivers. */
async function issueInternal(auth: AuthContext, id: string): Promise<void> {
  const b = await db.billOfLading.findUniqueOrThrow({ where: { id }, include: bolInclude });
  if (b.status !== 'DRAFT') throw conflict('This BOL has already been issued.');
  if (b.lines.length === 0) throw badRequest('Add at least one item.');
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text FROM "BillOfLading" WHERE "id" = ${id} FOR UPDATE`;
    if (locked[0]?.status !== 'DRAFT') throw conflict('This BOL has already been issued.');
    const bolNumber = await nextCounter(tx, counterKeys.companyBol(b.companyId));
    for (const l of b.lines) {
      if (!l.sourceLotId) continue; // typed-in item: nothing to take out of stock
      const lot = await tx.inventoryLot.findUniqueOrThrow({ where: { id: l.sourceLotId } });
      if (n(lot.qtyAvailable) + 1e-6 < n(l.qty)) {
        throw conflict(`Only ${n(lot.qtyAvailable)} ${lot.uom} of "${lot.description}" is left at the pickup. Edit the BOL and try again.`);
      }
      await tx.inventoryLot.update({ where: { id: lot.id }, data: { qtyAvailable: { decrement: n(l.qty) } } });
      // Leaving a yard toward the job counts as shipped on the site inventory list.
      const pickup = b.stops.find((s) => s.id === l.pickupStopId)!;
      // (and so does leaving the vendor straight for the job).
      if (b.direction === 'OUTBOUND' && (pickup.location.site?.type === 'YARD' || lot.source === 'VENDOR')) {
        if (l.orderLineId) await tx.siteInventoryItem.updateMany({ where: { orderLineId: l.orderLineId }, data: { qtyShipped: { increment: n(l.qty) } } });
      }
    }
    await tx.billOfLading.update({ where: { id }, data: { bolNumber, status: 'ISSUED', issuedAt: new Date() } });
    await recomputeLines(tx, orderLineIdsOf(b.lines));
    await audit(tx, auth, 'bol.issue', 'BillOfLading', id, null, { bolNumber });
  });

  // File the PDF with the BOL (it's also generated fresh whenever it's downloaded).
  const issued = await db.billOfLading.findUniqueOrThrow({ where: { id }, include: bolInclude });
  try {
    const pdf = await buildBolPdf(issued);
    const asset = await saveUpload({
      organizationId: auth.orgId,
      companyId: issued.companyId,
      uploadedById: auth.userId,
      kind: 'BOL_PDF',
      file: new File([new Uint8Array(pdf)], `BOL-${issued.bolNumber}.pdf`, { type: 'application/pdf' }),
      maxBytes: 20 * 1_048_576,
    });
    await db.billOfLading.update({ where: { id }, data: { pdfFileId: asset.id } });
    await fileDocument({ companyId: issued.companyId, docType: 'BOL_PDF', fileId: asset.id, vars: { job: await jobLabel(issued.siteId) } });
  } catch (e) {
    console.error('[bol] PDF filing failed', e);
  }

  publishOrders(auth.orgId, issued);
}

export async function issueBol(auth: AuthContext, id: string, opts: { ship?: boolean } = {}): Promise<BolDetail> {
  const b = await loadBol(auth, id);
  requirePermission(auth, b.direction === 'RETURN' ? 'return:create' : 'bol:create');
  await issueInternal(auth, id);
  if (opts.ship) await shipInternal(auth, id);
  return toDetail(auth, await loadBol(auth, id));
}

/** The shipper says the truck has left: mark it shipped and tell everyone set up on each drop-off job. */
export async function shipBol(auth: AuthContext, id: string): Promise<BolDetail> {
  const b = await loadBol(auth, id);
  requirePermission(auth, b.direction === 'RETURN' ? 'return:create' : 'bol:create');
  if (b.status === 'DRAFT') throw conflict('Issue the BOL first.');
  if (b.status === 'CANCELLED') throw conflict('This BOL was cancelled.');
  if (b.shippedAt) throw conflict('This BOL is already marked as shipped.');
  await shipInternal(auth, id);
  return toDetail(auth, await loadBol(auth, id));
}

async function shipInternal(auth: AuthContext, id: string) {
  await db.billOfLading.update({ where: { id }, data: { shippedAt: new Date(), shippedById: auth.userId } });
  await audit(db, auth, 'bol.ship', 'BillOfLading', id, null, null);
  const issued = await db.billOfLading.findUniqueOrThrow({ where: { id }, include: bolInclude });
  const label = bolLabel(issued);
  const link = `/bols/view/?id=${id}`;
  const truck = [issued.carrier ? (issued.carrier.businessName ?? issued.carrier.name) : null, issued.driverName && `driver ${issued.driverName}`, issued.truckUnit && `unit ${issued.truckUnit}`].filter(Boolean).join(', ');
  const pdf = issued.pdfFileId ? [issued.pdfFileId] : [];
  for (const stop of issued.stops.filter((s) => s.kind === 'DROP')) {
    const items = issued.lines.filter((l) => l.dropStopId === stop.id);
    const when = whenLabel(stop);
    const text =
      `${label} has shipped and is on its way to ${stop.location.businessName}${when ? ` – expected ${when}` : ''}.` +
      (truck ? `\nTruck: ${truck}` : '') +
      `\n\n${items.map((l) => `  - ${l.description}: ${n(l.qty)} ${l.uom}`).join('\n')}\n\nOpen in Bowron: ${appLink(link)}`;
    if (stop.location.siteId && stop.location.site?.type === 'JOB') {
      await notifyJob({
        organizationId: auth.orgId,
        siteId: stop.location.siteId,
        event: 'BOL_SHIPPED',
        title: `${label} shipped`,
        subject: `${label} shipped – on its way to ${stop.location.businessName}`,
        text,
        link,
        fromName: viaName(auth.name),
        replyTo: auth.email,
        attachments: await fileAttachments(pdf),
        attachmentFileIds: pdf,
        relatedType: 'bol',
        relatedId: id,
        exceptUserId: auth.userId,
      });
    } else if (stop.location.site?.type === 'YARD') {
      // Returns coming back: the company's yard list.
      const to = await recipientsFor(issued.companyId, stop.location.siteId!, 'YARD');
      if (to.length)
        await sendEmail(
          { fromName: viaName(auth.name), replyTo: auth.email, to, subject: `${label} coming to ${stop.location.businessName}`, text },
          { organizationId: auth.orgId, relatedType: 'bol', relatedId: id },
        );
    }
  }
  publish(auth.orgId, { type: 'order.changed', orderId: '', siteId: issued.siteId ?? '', companyId: issued.companyId });
}

async function fileAttachments(ids: string[]) {
  const out = [];
  for (const fid of ids) {
    const f = await readFileAsset(fid).catch(() => null);
    if (f) out.push({ fileName: f.file.fileName, contentType: f.file.mimeType, content: Buffer.from(f.bytes).toString('base64') });
  }
  return out;
}

/** Cancel an issued BOL that hasn't been received anywhere: the material goes back where it was. */
export async function cancelBol(auth: AuthContext, id: string): Promise<BolDetail> {
  requirePermission(auth, 'bol:create');
  const b = await loadBol(auth, id);
  if (b.status === 'DRAFT') {
    await deleteDraftBol(auth, id);
    return { ...(await toDetail(auth, b)), status: 'CANCELLED' };
  }
  if (b.status !== 'ISSUED' || b.lines.some((l) => l.siteReceiptLines.length > 0)) throw conflict('Something on this BOL has been received, so it can’t be cancelled.');
  await db.$transaction(async (tx) => {
    for (const l of b.lines) {
      if (!l.sourceLotId) continue; // typed-in item: no stock to put back
      const lot = await tx.inventoryLot.update({ where: { id: l.sourceLotId }, data: { qtyAvailable: { increment: n(l.qty) } } });
      const pickup = b.stops.find((s) => s.id === l.pickupStopId)!;
      if (b.direction === 'OUTBOUND' && (pickup.location.site?.type === 'YARD' || lot.source === 'VENDOR')) {
        if (l.orderLineId) await tx.siteInventoryItem.updateMany({ where: { orderLineId: l.orderLineId }, data: { qtyShipped: { decrement: n(l.qty) } } });
      }
    }
    await tx.billOfLading.update({ where: { id }, data: { status: 'CANCELLED' } });
    await recomputeLines(tx, orderLineIdsOf(b.lines));
    await audit(tx, auth, 'bol.cancel', 'BillOfLading', id, { status: b.status }, { status: 'CANCELLED' });
  });
  return toDetail(auth, await loadBol(auth, id));
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
export async function getBol(auth: AuthContext, id: string): Promise<BolDetail> {
  return toDetail(auth, await loadBol(auth, id));
}

export async function getBolPdf(auth: AuthContext, id: string) {
  const b = await loadBol(auth, id);
  return { bytes: await buildBolPdf(b), fileName: `${bolLabel(b).replace(/[#\s]+/g, '-')}.pdf` };
}

export async function listBols(auth: AuthContext, filter: { status?: string; siteId?: string; companyId?: string }): Promise<BolSummary[]> {
  requirePermission(auth, 'bol:view');
  const statuses: Record<string, Prisma.BillOfLadingWhereInput> = {
    open: { status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] } },
    draft: { status: 'DRAFT' },
    done: { status: { in: ['RECEIVED', 'CANCELLED'] } },
  };
  const rows = await db.billOfLading.findMany({
    where: {
      AND: [
        await bolWhereFor(auth),
        filter.status && statuses[filter.status] ? statuses[filter.status]! : {},
        filter.siteId ? { OR: [{ siteId: filter.siteId }, { stops: { some: { location: { siteId: filter.siteId } } } }] } : {},
        filter.companyId ? { companyId: filter.companyId } : {},
      ],
    },
    include: { company: { select: { name: true } }, stops: { orderBy: { seq: 'asc' }, include: { location: { select: { businessName: true } } } }, lines: { select: { id: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((b) => toSummary(b));
}

/** Find a BOL from what someone typed or scanned: "BOL #12", "12", or the QR code text. */
export async function lookupBol(auth: AuthContext, query: string): Promise<{ id: string; label: string }> {
  requirePermission(auth, 'bol:view');
  const q = query.trim();
  const qr = /^SUPPLYLINE-BOL:([a-z0-9]+):/i.exec(q);
  const where = await bolWhereFor(auth);
  let b = qr ? await db.billOfLading.findFirst({ where: { AND: [{ id: qr[1] }, where] } }) : null;
  if (!b) {
    const num = /(\d{1,7})\s*$/.exec(q.replace(/^(return\s+)?b\s*o\s*l\s*#?\s*/i, ''));
    if (num) {
      const matches = await db.billOfLading.findMany({
        where: { AND: [{ bolNumber: Number(num[1]) }, where] },
        orderBy: { issuedAt: 'desc' },
        include: bolInclude,
      });
      // Several companies can have the same number: prefer one you can receive.
      for (const m of matches) {
        if (m.stops.some((s) => s.kind === 'DROP') && (await Promise.all(m.stops.map((s) => canReceiveAt(auth, m, s)))).some(Boolean)) {
          b = m;
          break;
        }
      }
      b ??= matches[0] ?? null;
    }
  }
  if (!b) throw notFound('BOL');
  return { id: b.id, label: bolLabel(b) };
}

// ---------------------------------------------------------------------------
// Receiving at a drop stop
// ---------------------------------------------------------------------------
export async function receiveBol(auth: AuthContext, id: string, input: ReceiveBolInput): Promise<{ receiptId: string; problems: number; status: BolStatus }> {
  const b = await loadBol(auth, id);
  const stop = b.stops.find((s) => s.id === input.stopId);
  if (!stop) throw notFound('Stop');
  if (!(await canReceiveAt(auth, b, stop))) {
    if (b.status === 'RECEIVED') throw conflict('This BOL has already been received.');
    if (b.status === 'DRAFT' || b.status === 'CANCELLED') throw conflict('This BOL is not on its way.');
    throw forbidden('You can’t receive at this stop.');
  }
  const lines = b.lines.filter((l) => l.dropStopId === stop.id);
  for (const e of input.lines) if (!lines.some((l) => l.id === e.bolLineId)) throw badRequest('One of the lines isn’t delivered at this stop.');

  let problems = 0;
  const receipt = await db.$transaction(async (tx) => {
    const r = await tx.siteReceipt.create({
      data: { organizationId: auth.orgId, bolId: id, stopId: stop.id, siteId: stop.location.siteId, receivedById: auth.userId, notes: input.notes ?? null },
    });
    for (const e of input.lines) {
      const l = lines.find((x) => x.id === e.bolLineId)!;
      const remaining = Math.max(0, n(l.qty) - lineReceived(l));
      const short = Math.max(0, round3(remaining - e.qtyReceived));
      if (short > 0 || e.damaged) problems++;
      const rl = await tx.siteReceiptLine.create({
        data: { siteReceiptId: r.id, bolLineId: l.id, qtyReceived: e.qtyReceived, qtyShort: short, damaged: e.damaged, note: e.note ?? null },
      });
      if (e.qtyReceived > 0 && l.sourceLot) {
        await tx.inventoryLot.create({
          data: {
            organizationId: auth.orgId,
            companyId: b.companyId,
            orderLineId: l.orderLineId,
            finalSiteId: l.sourceLot.finalSiteId,
            locationId: stop.locationId,
            equipmentId: l.sourceLot.equipmentId,
            purchaseOrderLineId: l.sourceLot.purchaseOrderLineId,
            status: l.sourceLot.finalSiteId ? lotStatusAt(stop.location, l.sourceLot.finalSiteId) : 'IN_STOCK',
            source: b.direction === 'RETURN' ? 'RETURN' : 'TRANSFER',
            siteReceiptLineId: rl.id,
            parentLotId: l.sourceLotId,
            description: l.description,
            uom: l.uom,
            qtyIn: e.qtyReceived,
            qtyAvailable: e.qtyReceived,
          },
        });
        // Site inventory list: arriving at its own job = received on site; coming back to a yard = returned.
        if (l.orderLineId && b.direction === 'OUTBOUND' && stop.location.siteId === l.sourceLot.finalSiteId) {
          await tx.siteInventoryItem.updateMany({ where: { orderLineId: l.orderLineId }, data: { qtyReceived: { increment: e.qtyReceived } } });
        }
        if (l.orderLineId && b.direction === 'RETURN' && stop.location.site?.type === 'YARD') {
          await tx.siteInventoryItem.updateMany({ where: { orderLineId: l.orderLineId }, data: { qtyReturned: { increment: e.qtyReceived } } });
        }
      }
    }
    // Stop done when every line dropped here has been received; BOL done when every stop is.
    const after = await tx.bOLLine.findMany({ where: { bolId: id }, include: { siteReceiptLines: { select: { id: true } } } });
    const stopDone = after.filter((l) => l.dropStopId === stop.id).every((l) => l.siteReceiptLines.length > 0);
    if (stopDone) await tx.bolStop.update({ where: { id: stop.id }, data: { completedAt: new Date() } });
    const allDone = after.every((l) => l.siteReceiptLines.length > 0);
    await tx.billOfLading.update({ where: { id }, data: { status: allDone ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
    await recomputeLines(tx, orderLineIdsOf(lines));
    await audit(tx, auth, 'bol.receive', 'SiteReceipt', r.id, null, input);
    return r;
  });

  if (problems > 0) {
    const label = bolLabel(b);
    const issues = input.lines
      .map((e) => {
        const l = lines.find((x) => x.id === e.bolLineId)!;
        const remaining = Math.max(0, n(l.qty) - lineReceived(l));
        const short = Math.max(0, round3(remaining - e.qtyReceived));
        if (!short && !e.damaged) return null;
        const v = toLineView(l);
        return `${v.orderLabel} L${v.orderLineNo} ${l.description}: got ${e.qtyReceived} of ${remaining} ${l.uom}${e.damaged ? ' – DAMAGED' : ''}${e.note ? ` – ${e.note}` : ''}`;
      })
      .filter(Boolean);
    const siteForRouting = stop.location.siteId ?? b.siteId;
    const to = new Set<string>();
    if (siteForRouting)
      for (const kind of ['YARD', 'PROCUREMENT'] as const) for (const e of await recipientsFor(b.companyId, siteForRouting, kind)) to.add(e);
    if (to.size)
      await sendEmail(
        {
          fromName: viaName(auth.name),
          replyTo: auth.email,
          to: [...to],
          subject: `${label} – received with ${problems} issue(s) at ${stop.location.businessName}`,
          text: `${auth.name} received ${label} at ${stop.location.businessName}:\n\n${issues.join('\n')}${input.notes ? `\n\nNotes: ${input.notes}` : ''}\n\nOpen in Bowron: ${appLink(`/bols/view/?id=${id}`)}`,
        },
        { organizationId: auth.orgId, relatedType: 'bol_problem', relatedId: receipt.id },
      );
  }
  if (stop.location.siteId && stop.location.site?.type === 'JOB') {
    const summary = input.lines
      .map((e) => {
        const l = lines.find((x) => x.id === e.bolLineId)!;
        return `  - ${l.description}: ${e.qtyReceived} ${l.uom}${e.damaged ? ' (DAMAGED)' : ''}`;
      })
      .join('\n');
    const base = { organizationId: auth.orgId, siteId: stop.location.siteId, link: `/bols/receipts/view/?id=${receipt.id}`, fromName: viaName(auth.name), replyTo: auth.email, relatedType: 'bol', relatedId: id, exceptUserId: auth.userId };
    await notifyJob({
      ...base,
      event: 'BOL_DELIVERED',
      title: `${bolLabel(b)} delivered`,
      subject: `${bolLabel(b)} delivered – ${stop.location.businessName}`,
      text: `${auth.name} received ${bolLabel(b)} at ${stop.location.businessName}${problems ? ` with ${problems} problem(s)` : ''}.\n\n${summary}\n\nOpen in Bowron: ${appLink(base.link)}`,
    });
    if (problems)
      await notifyJob({
        ...base,
        event: 'DELIVERY_PROBLEM',
        title: `Problem with ${bolLabel(b)}`,
        subject: `Short / damaged delivery – ${bolLabel(b)} at ${stop.location.businessName}`,
        text: `${auth.name} received ${bolLabel(b)} at ${stop.location.businessName} with ${problems} problem(s):\n\n${summary}${input.notes ? `\n\nNotes: ${input.notes}` : ''}\n\nOpen in Bowron: ${appLink(base.link)}`,
      });
  }
  publishOrders(auth.orgId, { companyId: b.companyId, lines });
  const status = (await db.billOfLading.findUniqueOrThrow({ where: { id }, select: { status: true } })).status as BolStatus;
  await makeSiteReceiptReport(receipt.id, auth.userId);
  return { receiptId: receipt.id, problems, status };
}

async function loadSiteReceipt(auth: AuthContext, receiptId: string) {
  const r = await db.siteReceipt.findFirst({
    where: { id: receiptId, organizationId: auth.orgId },
    include: {
      stop: { include: { location: true } },
      receivedBy: { select: { name: true } },
      photos: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      lines: { include: { bolLine: { include: { orderLine: { include: { orderForm: { include: { site: { select: { jobNumber: true } } } } } } } } } },
    },
  });
  if (!r) throw notFound('Receipt');
  await loadBol(auth, r.bolId);  // access check via the BOL
  return r;
}

export async function getSiteReceipt(auth: AuthContext, receiptId: string): Promise<SiteReceiptView> {
  const r = await loadSiteReceipt(auth, receiptId);
  const b = await db.billOfLading.findUniqueOrThrow({ where: { id: r.bolId }, select: { bolNumber: true, direction: true } });
  return {
    id: r.id,
    bolId: r.bolId,
    bolLabel: bolLabel(b),
    locationName: r.stop.location.businessName,
    receivedAt: r.receivedAt.toISOString(),
    receivedByName: r.receivedBy.name,
    notes: r.notes,
    lines: r.lines.map((l) => ({
      description: l.bolLine.description,
      uom: l.bolLine.uom,
      orderLabel: l.bolLine.orderLine ? formatListLabel(l.bolLine.orderLine.orderForm.site.jobNumber, l.bolLine.orderLine.orderForm.listNo) : 'Typed-in item',
      lineNo: l.bolLine.orderLine?.lineNo ?? 0,
      expected: n(l.qtyReceived) + n(l.qtyShort),
      received: n(l.qtyReceived),
      short: n(l.qtyShort),
      damaged: l.damaged,
      note: l.note,
    })),
    photos: r.photos.map((p) => ({ id: p.id, url: fileUrl(p.id)!, fileName: p.fileName })),
  };
}

export async function addSiteReceiptPhoto(auth: AuthContext, receiptId: string, file: File) {
  requirePermission(auth, 'bol:receive');
  const r = await loadSiteReceipt(auth, receiptId);
  const b = await db.billOfLading.findUniqueOrThrow({ where: { id: r.bolId }, select: { companyId: true } });
  const asset = await saveUpload({ organizationId: auth.orgId, companyId: b.companyId, uploadedById: auth.userId, kind: 'PHOTO', file, maxBytes: 15 * 1_048_576, imagesOnly: true });
  await db.fileAsset.update({ where: { id: asset.id }, data: { siteReceiptId: receiptId } });
  await fileDocument({ companyId: b.companyId, docType: 'RECEIPT_PHOTO', fileId: asset.id, vars: { job: await jobLabel(r.siteId) } });
  await audit(db, auth, 'bol.receipt_photo', 'SiteReceipt', receiptId, null, { fileId: asset.id });
  return { id: asset.id, url: fileUrl(asset.id)! };
}

// ---------------------------------------------------------------------------
// Returns from site
// ---------------------------------------------------------------------------
export async function createReturn(auth: AuthContext, input: ReturnInput): Promise<BolDetail> {
  requirePermission(auth, 'return:create');
  const site = await db.site.findFirst({ where: { AND: [{ id: input.siteId }, await siteWhereFor(auth)] } });
  if (!site || site.type !== 'JOB') throw notFound('Job');
  const yard = await db.site.findFirst({ where: { id: input.yardId, organizationId: auth.orgId, type: 'YARD', yardCompanies: { some: { companyId: site.companyId! } } } });
  if (!yard) throw badRequest('Pick a yard that serves this company.');
  const [from, to] = await Promise.all([locationIdForSite(db, site.id), locationIdForSite(db, yard.id)]);
  const lots = await db.inventoryLot.findMany({ where: { id: { in: input.lines.map((l) => l.lotId) }, organizationId: auth.orgId } });
  const companyIds = new Set(lots.map((l) => l.companyId));
  if (companyIds.size !== 1) throw badRequest('Return one company’s material at a time.');
  const id = await db.$transaction(async (tx) => {
    const bolId = await writeDraft(
      tx,
      auth,
      {
        companyId: [...companyIds][0]!,
        carrierContactId: input.carrierContactId ?? null,
        driverName: input.driverName ?? null,
        notes: input.notes ?? null,
        stops: [
          { key: 'p', kind: 'PICKUP', locationId: from, plannedDate: input.pickupDate ?? null },
          { key: 'd', kind: 'DROP', locationId: to, plannedDate: input.deliveryDate ?? input.pickupDate ?? null },
        ],
        lines: input.lines.map((l) => ({ lotId: l.lotId, qty: l.qty, pickupKey: 'p', dropKey: 'd' })),
      },
      'RETURN',
      null,
    );
    await tx.billOfLading.update({ where: { id: bolId }, data: { siteId: site.id } });
    await audit(tx, auth, 'bol.return_create', 'BillOfLading', bolId, null, input);
    return bolId;
  });
  await issueInternal(auth, id);
  await shipInternal(auth, id);
  return toDetail(auth, await loadBol(auth, id));
}

const sizeNum = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d));

/**
 * Ship-direct POs: the vendor delivers straight to the job. The buyer issuing the PO
 * gets the BOL made, issued and marked shipped (it tells the site) without needing
 * BOL rights of their own.
 */
export async function createDirectBol(auth: AuthContext, input: BolInput): Promise<string> {
  requirePermission(auth, 'procurement:work');
  const id = await db.$transaction(async (tx) => {
    const bolId = await writeDraft(tx, auth, input, 'OUTBOUND', null);
    await audit(tx, auth, 'bol.create_direct', 'BillOfLading', bolId, null, input);
    return bolId;
  });
  await issueInternal(auth, id);
  await shipInternal(auth, id);
  return id;
}

/** Procurement posts a PO's pickup to the load board: a planned load (draft BOL) the yard ships later. */
export async function createPoLoad(auth: AuthContext, input: BolInput): Promise<string> {
  requirePermission(auth, 'procurement:work');
  const id = await db.$transaction(async (tx) => {
    const bolId = await writeDraft(tx, auth, input, 'OUTBOUND', null);
    await audit(tx, auth, 'bol.create_from_po', 'BillOfLading', bolId, null, input);
    return bolId;
  });
  const { tellProcurement } = await import('./board');
  await tellProcurement(auth.orgId, auth.userId, id, 'planned').catch(() => undefined);
  return id;
}

/** Order lines on a BOL (typed-in items have none). */
const orderLineIdsOf = (lines: { orderLineId: string | null }[]) => lines.map((l) => l.orderLineId).filter((x): x is string => !!x);

/** Tell open screens the order lists on this BOL changed. */
function publishOrders(orgId: string, b: { companyId: string; lines: { orderLine: { orderFormId: string; siteId: string } | null }[] }) {
  const seen = new Set<string>();
  for (const l of b.lines) {
    if (!l.orderLine || seen.has(l.orderLine.orderFormId)) continue;
    seen.add(l.orderLine.orderFormId);
    publish(orgId, { type: 'order.changed', orderId: l.orderLine.orderFormId, siteId: l.orderLine.siteId, companyId: b.companyId });
  }
}
