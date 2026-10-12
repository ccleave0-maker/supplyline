// Inventory by location: every lot sits at a ShippingLocation (a yard, a job,
// or an in-between spot like a laydown area) and is always for one final job.

import type { InventoryStatus } from '../generated/prisma/client';
import type { Db, Tx } from '../lib/db';
import { syncShippingLocation } from './sites';

/** The shipping location that represents a job or yard (created if missing). */
export async function locationIdForSite(tx: Tx | Db, siteId: string): Promise<string> {
  const found = await tx.shippingLocation.findUnique({ where: { siteId }, select: { id: true } });
  if (found) return found.id;
  await syncShippingLocation(tx as Tx, siteId);
  return (await tx.shippingLocation.findUniqueOrThrow({ where: { siteId }, select: { id: true } })).id;
}

/** At its own job = delivered; at a yard = in stock; anywhere else = staged (still owes a leg). */
export function lotStatusAt(location: { siteId: string | null; site?: { type: string } | null }, finalSiteId: string): InventoryStatus {
  if (location.siteId && location.siteId === finalSiteId) return 'DELIVERED';
  if (location.site?.type === 'YARD') return 'IN_STOCK';
  return 'STAGED';
}
