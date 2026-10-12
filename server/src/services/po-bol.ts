// Building a BOL from a purchase order: pick the PO's material that's already
// in a yard, or — when it hasn't come in — pick it up at the vendor (the vendor
// becomes a pickup stop; the material is "at the vendor" until the truck takes it).

import type { PoForBol, PoShipping, PostPoLoadInput } from '@supplyline/core/models';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { accessibleCompanyIds } from './access';

const n = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

async function loadPo(auth: AuthContext, poId: string) {
  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, organizationId: auth.orgId, companyId: { in: await accessibleCompanyIds(auth) } },
    include: {
      vendor: { select: { id: true, name: true } },
      site: { select: { id: true, jobNumber: true, name: true } },
      equipment: { select: { id: true, unitNumber: true, description: true } },
      deliverTo: { select: { id: true, name: true } },
      lines: { orderBy: { lineNo: 'asc' }, include: { orderLine: { select: { id: true, lineNo: true, description: true, uom: true } }, yardReceiptLines: { select: { qtyReceived: true, bolLineId: true } } } },
    },
  });
  if (!po) throw notFound('Purchase order');
  return po;
}

/** Open job POs you can build a BOL from (for the picker). */
export async function posForBol(auth: AuthContext, companyId: string) {
  requirePermission(auth, 'bol:create');
  if (!(await accessibleCompanyIds(auth)).includes(companyId)) throw notFound('Company');
  const pos = await db.purchaseOrder.findMany({
    where: { companyId, status: { in: ['ISSUED', 'CLOSED'] }, siteId: { not: null } },
    include: { vendor: { select: { name: true } }, site: { select: { jobNumber: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return pos.map((p) => ({ id: p.id, poNumber: p.poNumber, vendorName: p.vendor.name, siteLabel: p.site ? `JOB#${p.site.jobNumber} ${p.site.name}` : null, status: p.status }));
}

export async function poForBol(auth: AuthContext, poId: string): Promise<PoForBol> {
  requirePermission(auth, 'bol:create');
  return viewFor(auth, poId);
}

async function viewFor(auth: AuthContext, poId: string): Promise<PoForBol> {
  const po = await loadPo(auth, poId);
  const lineIds = po.lines.map((l) => l.id);
  // What's in yards from this PO (received, still there) and what's waiting at the vendor.
  const received = await db.inventoryLot.findMany({
    where: { organizationId: auth.orgId, qtyAvailable: { gt: 0 }, status: { in: ['IN_STOCK', 'STAGED'] }, yardReceiptLine: { purchaseOrderLineId: { in: lineIds } } },
    include: { location: { select: { businessName: true } }, yardReceiptLine: { select: { purchaseOrderLineId: true } } },
  });
  const vendorLots = await db.inventoryLot.findMany({ where: { organizationId: auth.orgId, source: 'VENDOR', purchaseOrderLineId: { in: lineIds } }, include: { location: { select: { businessName: true } } } });
  const vendorLoc = await db.shippingLocation.findFirst({ where: { organizationId: auth.orgId, vendorId: po.vendor.id } });
  return {
    po: { id: po.id, poNumber: po.poNumber, vendorName: po.vendor.name, companyId: po.companyId, siteId: po.siteId, siteLabel: po.site ? `JOB#${po.site.jobNumber} ${po.site.name}` : null },
    vendorLocationId: vendorLoc?.id ?? null,
    lines: po.lines.map((l) => {
      const ordered = n(l.qty);
      const receivedQty = l.yardReceiptLines.filter((y) => !y.bolLineId).reduce((s, y) => s + n(y.qtyReceived), 0);
      const setUpAtVendor = vendorLots.filter((v) => v.purchaseOrderLineId === l.id).reduce((s, v) => s + n(v.qtyIn), 0);
      return {
        poLineId: l.id,
        lineNo: l.lineNo ?? l.orderLine?.lineNo ?? null,
        description: l.description ?? l.orderLine?.description ?? '',
        uom: l.uom ?? l.orderLine?.uom ?? '',
        ordered,
        linkedToOrderList: !!l.orderLineId,
        inYards: received.filter((x) => x.yardReceiptLine?.purchaseOrderLineId === l.id).map((x) => ({ lotId: x.id, locationId: x.locationId, locationName: x.location.businessName, qtyAvailable: n(x.qtyAvailable) })),
        atVendor: vendorLots.filter((v) => v.purchaseOrderLineId === l.id && n(v.qtyAvailable) > 0).map((v) => ({ lotId: v.id, locationId: v.locationId, locationName: v.location.businessName, qtyAvailable: n(v.qtyAvailable) })),
        canPickUpAtVendor: (l.orderLineId && po.siteId) || po.equipmentId ? Math.max(0, r3(ordered - receivedQty - setUpAtVendor)) : 0,
      };
    }),
  };
}

/** Make the vendor a pickup stop for these PO lines; returns the lots to put on the BOL. */
export async function pickUpAtVendor(auth: AuthContext, poId: string, lines: { poLineId: string; qty: number }[]) {
  requirePermission(auth, 'bol:create');
  return stage(auth, poId, lines);
}

async function stage(auth: AuthContext, poId: string, lines: { poLineId: string; qty: number }[]) {
  const po = await loadPo(auth, poId);
  if (!po.siteId && !po.equipmentId) throw badRequest('Only purchase orders for a job or a piece of equipment can be picked up at the vendor.');
  const view = await viewFor(auth, poId);
  return db.$transaction(async (tx) => {
    let loc = await tx.shippingLocation.findFirst({ where: { organizationId: auth.orgId, vendorId: po.vendor.id } });
    if (!loc) {
      const v = await tx.vendor.findUnique({ where: { id: po.vendor.id }, include: { contact: true } });
      loc = await tx.shippingLocation.create({
        data: {
          organizationId: auth.orgId,
          companyId: po.companyId,
          vendorId: po.vendor.id,
          businessName: po.vendor.name,
          phone: v?.contact?.phone ?? null,
          cell: v?.contact?.cell ?? null,
          source: 'AUTO',
          notes: 'Vendor pick-up (made from a PO). Add the address in Locations.',
        },
      });
    }
    const lots: { lotId: string; poLineId: string; qty: number }[] = [];
    for (const want of lines) {
      if (!(want.qty > 0)) continue;
      const line = po.lines.find((l) => l.id === want.poLineId);
      const v = view.lines.find((l) => l.poLineId === want.poLineId);
      if (!line || !v || (!line.orderLineId && !po.equipmentId)) throw badRequest('That PO line can’t be picked up at the vendor.');
      if (want.qty > v.canPickUpAtVendor + 1e-6) throw badRequest(`Only ${v.canPickUpAtVendor} ${v.uom} of "${v.description}" is left to pick up.`);
      const lot = await tx.inventoryLot.create({
        data: {
          organizationId: auth.orgId,
          companyId: po.companyId,
          orderLineId: line.orderLineId ?? null,
          finalSiteId: po.siteId ?? null,
          equipmentId: po.siteId ? null : po.equipmentId,
          locationId: loc.id,
          status: 'IN_STOCK',
          source: 'VENDOR',
          purchaseOrderLineId: line.id,
          description: v.description,
          uom: v.uom,
          qtyIn: want.qty,
          qtyAvailable: want.qty,
        },
      });
      lots.push({ lotId: lot.id, poLineId: line.id, qty: want.qty });
    }
    await audit(tx, auth, 'bol.vendor_pickup', 'PurchaseOrder', po.id, null, { lines });
    return { locationId: loc.id, lots };
  });
}

/**
 * Ship direct: everything on the PO is set up at the vendor and a BOL is made from the
 * vendor to the job (or the PO's ship-to), dated with the PO's ETA, issued and marked
 * shipped — so the site is told and can receive it like any load. Returns the BOL id.
 */
export async function shipDirectFromPo(auth: AuthContext, poId: string): Promise<string | null> {
  const po = await db.purchaseOrder.findFirst({ where: { id: poId, organizationId: auth.orgId }, include: { vendor: { select: { name: true } } } });
  if (!po?.siteId || po.directBolId) return po?.directBolId ?? null;
  const view = await viewFor(auth, poId);
  const lines = view.lines.filter((l) => l.canPickUpAtVendor > 0).map((l) => ({ poLineId: l.poLineId, qty: l.canPickUpAtVendor }));
  if (!lines.length) return null;
  const staged = await stage(auth, poId, lines);
  const drop = po.shipToLocationId ?? (await db.shippingLocation.findFirst({ where: { siteId: po.siteId } }))?.id;
  if (!drop) throw badRequest('The job has no location to deliver to.');
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const { createDirectBol } = await import('./bols');
  const bolId = await createDirectBol(auth, {
    companyId: po.companyId,
    notes: `Ship direct — PO ${po.poNumber} from ${po.vendor.name}`,
    scheduledDate: day(po.orderedDate),
    stops: [
      { key: 'p', kind: 'PICKUP', locationId: staged.locationId, plannedDate: day(po.orderedDate) },
      { key: 'd', kind: 'DROP', locationId: drop, plannedDate: day(po.expectedDate) },
    ],
    lines: staged.lots.map((l) => ({ lotId: l.lotId, qty: l.qty, pickupKey: 'p', dropKey: 'd' })),
  });
  await db.purchaseOrder.update({ where: { id: poId }, data: { directBolId: bolId } });
  return bolId;
}

// ---------------------------------------------------------------------------
// The PO on SupplyLine's own load board (when the vendor isn't arranging shipping)
// ---------------------------------------------------------------------------
/** Where the PO's material goes: its delivery yard, else the job's ship-to (or the job). */
async function destinationOf(po: { deliverToYardId: string | null; shipToLocationId: string | null; siteId: string | null }) {
  if (po.deliverToYardId) return db.shippingLocation.findFirst({ where: { siteId: po.deliverToYardId }, select: { id: true, businessName: true } });
  if (po.shipToLocationId) return db.shippingLocation.findUnique({ where: { id: po.shipToLocationId }, select: { id: true, businessName: true } });
  if (po.siteId) return db.shippingLocation.findFirst({ where: { siteId: po.siteId }, select: { id: true, businessName: true } });
  return null;
}

/** The loads made for a PO, and where it stands: on the load board, shipped, delivered. */
export async function poShipping(auth: AuthContext, poId: string): Promise<PoShipping> {
  const po = await loadPo(auth, poId);
  const lineIds = po.lines.map((l) => l.id);
  const bolLines = await db.bOLLine.findMany({
    where: { OR: [{ sourceLot: { purchaseOrderLineId: { in: lineIds } } }, ...(po.directBolId ? [{ bolId: po.directBolId }] : [])], bol: { status: { not: 'CANCELLED' } } },
    select: { bol: { select: { id: true, bolNumber: true, title: true, status: true, priority: true, stops: { orderBy: { seq: 'asc' }, select: { kind: true, plannedDate: true } } } } },
  });
  const bols = [...new Map(bolLines.map((l) => [l.bol.id, l.bol])).values()];
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const loads = bols.map((b) => ({
    id: b.id,
    label: b.bolNumber ? `BOL #${b.bolNumber}` : 'Planned load',
    status: b.status,
    priority: b.priority,
    pickupDate: day(b.stops.find((s) => s.kind === 'PICKUP')?.plannedDate),
    deliveryDate: day(b.stops.filter((s) => s.kind === 'DROP').at(-1)?.plannedDate),
  }));
  const state: PoShipping['state'] = !loads.length
    ? 'NONE'
    : loads.every((l) => l.status === 'RECEIVED')
      ? 'DELIVERED'
      : loads.some((l) => ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(l.status))
        ? 'SHIPPED'
        : 'POSTED';
  const view = await viewFor(auth, poId);
  const left = view.lines.reduce((t, l) => t + l.canPickUpAtVendor, 0);
  const dest = await destinationOf(po);
  return {
    state,
    loads,
    canPost: po.status === 'ISSUED' && !po.shipDirect && left > 0 && !!dest,
    destination: dest?.businessName ?? (po.equipmentId ? 'Pick a yard to deliver to on the PO' : null),
  };
}

/**
 * Post the PO to the load board: everything still to come is set up at the vendor and a
 * planned load is made from the vendor to the yard (or the job). When the yard ships it
 * (issues the BOL) the PO shows as shipped, and receiving it adds to that yard's or job's
 * inventory — the usual BOL → inventory steps.
 */
export async function postPoToLoadBoard(auth: AuthContext, poId: string, input: PostPoLoadInput) {
  requirePermission(auth, 'procurement:work');
  const po = await loadPo(auth, poId);
  if (po.status !== 'ISSUED') throw badRequest('Commit the PO first — then it can go on the load board.');
  if (po.shipDirect) throw badRequest('This PO is set to ship direct — the vendor is delivering it.');
  const dest = await destinationOf(po);
  if (!dest) throw badRequest(po.equipmentId ? 'Choose the yard it’s delivered to on the PO first.' : 'The job has no location to deliver to — add one on the job’s page.');
  const view = await viewFor(auth, poId);
  const lines = view.lines.filter((l) => l.canPickUpAtVendor > 0).map((l) => ({ poLineId: l.poLineId, qty: l.canPickUpAtVendor }));
  if (!lines.length) throw badRequest('Everything on this PO is already received or on a load.');
  const staged = await stage(auth, poId, lines);
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const pickup = input.pickupDate ?? day(po.orderedDate);
  const delivery = input.deliveryDate ?? day(po.expectedDate) ?? pickup;
  const { createPoLoad } = await import('./bols');
  const bolId = await createPoLoad(auth, {
    companyId: po.companyId,
    title: `PO ${po.poNumber} — ${po.vendor.name}`.slice(0, 120),
    priority: input.priority,
    notes: [input.notes, `Pick up PO ${po.poNumber} at ${po.vendor.name} for ${po.site ? `JOB#${po.site.jobNumber} ${po.site.name}` : po.equipment ? `unit ${po.equipment.unitNumber}` : dest.businessName}.`].filter(Boolean).join('\n'),
    scheduledDate: pickup,
    stops: [
      { key: 'p', kind: 'PICKUP', locationId: staged.locationId, plannedDate: pickup },
      { key: 'd', kind: 'DROP', locationId: dest.id, plannedDate: delivery },
    ],
    lines: staged.lots.map((l) => ({ lotId: l.lotId, qty: l.qty, pickupKey: 'p', dropKey: 'd' })),
  });
  await audit(db, auth, 'po.post_load', 'PurchaseOrder', po.id, null, { bolId, priority: input.priority });
  return { bolId };
}
