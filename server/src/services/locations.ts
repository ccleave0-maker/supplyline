// Shipping locations library: every pickup/drop point. Jobs and yards have one
// automatically (kept in step with their profile); others are added by hand or
// on the fly while building a BOL.

import type { LocationInput, LocationItem } from '@supplyline/core/models';
import type { Prisma } from '../generated/prisma/client';
import { db } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { moveToTrash } from './trash';

const include = { site: { select: { type: true } } } satisfies Prisma.ShippingLocationInclude;
type LocWithSite = Prisma.ShippingLocationGetPayload<{ include: typeof include }>;

export function toLocation(l: LocWithSite): LocationItem {
  return {
    id: l.id,
    businessName: l.businessName,
    address: l.address,
    city: l.city,
    province: l.province,
    postalCode: l.postalCode,
    phone: l.phone,
    cell: l.cell,
    notes: l.notes,
    companyId: l.companyId,
    siteId: l.siteId,
    siteType: (l.site?.type as LocationItem['siteType']) ?? null,
    active: l.active,
  };
}

/** Ship-to choices for a job's POs: the job itself, its extra ship-tos, then the yards. */
export async function shipToOptions(auth: AuthContext, siteId: string): Promise<LocationItem[]> {
  requirePermission(auth, 'po:view');
  const site = await db.site.findFirst({ where: { id: siteId, organizationId: auth.orgId } });
  if (!site) return [];
  const rows = await db.shippingLocation.findMany({
    where: { organizationId: auth.orgId, active: true, OR: [{ siteId }, { forSiteId: siteId }, { site: { type: 'YARD', yardCompanies: site.companyId ? { some: { companyId: site.companyId } } : undefined } }] },
    include,
    orderBy: { businessName: 'asc' },
  });
  const rank = (l: (typeof rows)[number]) => (l.siteId === siteId ? 0 : l.forSiteId === siteId ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || a.businessName.localeCompare(b.businessName)).map(toLocation);
}

export async function listLocations(auth: AuthContext, filter: { q?: string; includeInactive?: boolean }): Promise<LocationItem[]> {
  requirePermission(auth, 'bol:view');
  const where: Prisma.ShippingLocationWhereInput = { organizationId: auth.orgId };
  if (!filter.includeInactive) where.active = true;
  if (filter.q)
    where.OR = [
      { businessName: { contains: filter.q, mode: 'insensitive' } },
      { address: { contains: filter.q, mode: 'insensitive' } },
      { city: { contains: filter.q, mode: 'insensitive' } },
    ];
  const rows = await db.shippingLocation.findMany({ where, include, orderBy: { businessName: 'asc' }, take: 500 });
  return rows.map(toLocation);
}

export async function getLocation(auth: AuthContext, id: string) {
  requirePermission(auth, 'bol:view');
  const l = await db.shippingLocation.findFirst({ where: { id, organizationId: auth.orgId }, include });
  if (!l) throw notFound('Location');
  return toLocation(l);
}

export async function createLocation(auth: AuthContext, input: LocationInput, source: 'MANUAL' | 'AUTO' = 'MANUAL') {
  // Anyone building a BOL may add a new stop on the fly; the library is otherwise for location editors.
  if (source === 'MANUAL') requirePermission(auth, 'location:edit');
  else requirePermission(auth, 'bol:view');
  const dupe = await db.shippingLocation.findFirst({
    where: { organizationId: auth.orgId, businessName: { equals: input.businessName, mode: 'insensitive' }, active: true },
    include,
  });
  if (dupe && (dupe.address ?? '') === (input.address ?? '')) return toLocation(dupe);  // same place typed again
  const l = await db.shippingLocation.create({
    data: {
      organizationId: auth.orgId,
      businessName: input.businessName,
      address: input.address ?? null,
      city: input.city ?? null,
      province: input.province ?? null,
      postalCode: input.postalCode ?? null,
      phone: input.phone ?? null,
      cell: input.cell ?? null,
      notes: input.notes ?? null,
      companyId: input.companyId ?? null,
      forSiteId: input.forSiteId ?? null,
      source,
    },
    include,
  });
  await audit(db, auth, 'location.create', 'ShippingLocation', l.id, null, { ...input, source });
  return toLocation(l);
}

export async function updateLocation(auth: AuthContext, id: string, input: Partial<LocationInput>) {
  requirePermission(auth, 'location:edit');
  const before = await db.shippingLocation.findFirst({ where: { id, organizationId: auth.orgId }, include });
  if (!before) throw notFound('Location');
  if (before.siteId) throw badRequest('Edit this location from its job or yard profile.');
  const l = await db.shippingLocation.update({ where: { id }, data: input, include });
  await audit(db, auth, 'location.update', 'ShippingLocation', id, toLocation(before) as unknown as Record<string, unknown>, input);
  return toLocation(l);
}

/** Into the recycle bin if nothing uses it; otherwise it can only be made inactive. */
export async function deleteLocation(auth: AuthContext, id: string) {
  requirePermission(auth, 'location:edit');
  const l = await db.shippingLocation.findFirst({
    where: { id, organizationId: auth.orgId },
    include: { _count: { select: { lots: true, stops: true, equipmentAt: true, movesFrom: true, movesTo: true } } },
  });
  if (!l) throw notFound('Location');
  if (l.siteId) throw badRequest('Jobs and yards are removed from their own profile.');
  const used = Object.values(l._count).some((c) => c > 0);
  if (used) throw conflict('This location is used on BOLs or holds inventory. Untick "Active" to hide it instead.');
  const { _count, ...snapshot } = l;
  await db.$transaction(async (tx) => {
    await moveToTrash(tx, auth, 'LOCATION', id, l.businessName, snapshot);
    await tx.shippingLocation.delete({ where: { id } });
  });
}
