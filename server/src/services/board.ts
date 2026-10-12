// Load board: every open load (planned, posted, on the way) for the companies the
// admin picked, on a map, colour-coded by urgency, with directions. Pins come from
// Google / Apple Maps links, geo: links, coordinates, addresses or a KML file.
// Procurement is told when loads are planned and trucks booked.

import { directionsLinks, isShortMapLink, parseMapLink } from '@supplyline/core/domain';
import { boardSettingsInput, DEFAULT_BOARD, LOAD_PRIORITIES, type BoardLoad, type BoardSettings, type LoadPriority, type PostLoadInput } from '@supplyline/core/models';
import type { Prisma } from '../generated/prisma/client';
import { geocode } from '../integrations/geocode';
import { audit } from '../lib/audit';
import { isAdmin, requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { allUnitIds } from './access';
import { createBol } from './bols';

export function boardOf(settings: unknown): BoardSettings {
  const parsed = boardSettingsInput.partial().safeParse((settings as { loadBoard?: unknown } | null)?.loadBoard ?? {});
  return { ...DEFAULT_BOARD, ...(parsed.success ? parsed.data : {}) };
}

export async function getBoardSettings(auth: AuthContext) {
  requirePermission(auth, 'bol:view');
  const o = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { settings: true } });
  return boardOf(o.settings);
}

export async function saveBoardSettings(auth: AuthContext, input: BoardSettings) {
  requirePermission(auth, 'org:manage');
  const o = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { settings: true } });
  if (input.companyIds?.length && (await db.company.count({ where: { id: { in: input.companyIds }, organizationId: auth.orgId } })) !== input.companyIds.length) throw badRequest('Pick companies from this organization.');
  if (input.mapProvider === 'google' && !input.googleMapsKey) throw badRequest('Add the Google Maps key to use Google Maps, or choose OpenStreetMap.');
  await db.organization.update({ where: { id: auth.orgId }, data: { settings: { ...((o.settings as Record<string, unknown>) ?? {}), loadBoard: input } as Prisma.InputJsonValue } });
  await audit(db, auth, 'org.load_board', 'Organization', auth.orgId, null, { ...input, googleMapsKey: input.googleMapsKey ? '(set)' : null });
  return input;
}

const boardInclude = {
  company: { select: { name: true, themeColor: true } },
  carrier: { select: { name: true, businessName: true } },
  trailer: { select: { name: true, unitNumber: true } },
  stops: { orderBy: { seq: 'asc' }, include: { location: { select: { businessName: true, lat: true, lng: true, siteId: true } } } },
  lines: { select: { qty: true, orderLine: { select: { unitWeightKg: true, requiredOnSite: true } } } },
} satisfies Prisma.BillOfLadingInclude;

/** The board: open loads across the companies chosen in the board settings (and the person's units). */
export async function listBoard(auth: AuthContext, f: { from?: string; to?: string; companyId?: string } = {}): Promise<BoardLoad[]> {
  requirePermission(auth, 'bol:view');
  const settings = await getBoardSettings(auth);
  const mine = await allUnitIds(auth); // cross-unit by design
  const companies = (settings.companyIds ?? mine).filter((c) => mine.includes(c) && (!f.companyId || c === f.companyId));
  const dated: Prisma.BillOfLadingWhereInput | undefined =
    f.from && f.to ? { OR: [{ stops: { some: { plannedDate: { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T23:59:59Z`) } } } }, { stops: { every: { plannedDate: null } } }] } : undefined;
  const rows = await db.billOfLading.findMany({
    where: { AND: [{ organizationId: auth.orgId, companyId: { in: companies }, status: { in: ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'] } }, dated ?? {}] },
    include: boardInclude,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const canEdit = isAdmin(auth) || auth.roles.includes('YARD');
  const rank = (p: string) => LOAD_PRIORITIES.findIndex((x) => x.key === p);
  return rows
    .map((b) => {
      const stops = b.stops.map((s) => ({ kind: s.kind as 'PICKUP' | 'DROP', name: s.location.businessName, lat: s.location.lat, lng: s.location.lng, date: s.plannedDate?.toISOString().slice(0, 10) ?? null, time: s.plannedTime, siteId: s.location.siteId }));
      const needs = b.lines.map((l) => l.orderLine?.requiredOnSite).filter((d): d is Date => !!d).sort((a, z) => a.getTime() - z.getTime());
      const weighed = b.lines.some((l) => l.orderLine?.unitWeightKg != null);
      return {
        id: b.id,
        label: b.bolNumber ? `BOL #${b.bolNumber}` : b.title ? 'Posted load' : 'Planned load',
        title: b.title,
        status: b.status,
        priority: (b.priority as LoadPriority) ?? 'NORMAL',
        companyId: b.companyId,
        companyName: b.company.name,
        companyColor: b.company.themeColor,
        stops,
        lineCount: b.lines.length,
        weightKg: weighed ? Math.round(b.lines.reduce((t, l) => t + Number(l.qty) * Number(l.orderLine?.unitWeightKg ?? 0), 0)) : null,
        trailerName: b.trailer ? `${b.trailer.name}${b.trailer.unitNumber ? ` #${b.trailer.unitNumber}` : ''}` : null,
        carrierName: b.carrier ? (b.carrier.businessName ?? b.carrier.name) : null,
        needsTruck: !b.carrierContactId && !b.driverName && !b.truckUnit,
        needBy: needs[0]?.toISOString().slice(0, 10) ?? null,
        directions: directionsLinks(stops),
        canEdit,
      };
    })
    .sort((a, z) => rank(a.priority) - rank(z.priority) || (a.needBy ?? a.stops[0]?.date ?? '9999').localeCompare(z.needBy ?? z.stops[0]?.date ?? '9999'));
}

/** "New load available": a one-off load posted to the board (a planned load with a name and urgency). */
export async function postLoad(auth: AuthContext, input: PostLoadInput) {
  requirePermission(auth, 'bol:create');
  const bol = await createBol(auth, {
    companyId: input.companyId,
    title: input.title,
    priority: input.priority,
    notes: input.notes ?? null,
    scheduledDate: input.pickupDate ?? null,
    stops: [
      { key: 'p', kind: 'PICKUP', locationId: input.pickupLocationId, plannedDate: input.pickupDate ?? null },
      { key: 'd', kind: 'DROP', locationId: input.dropLocationId, plannedDate: input.deliveryDate ?? input.pickupDate ?? null },
    ],
    lines: [],
  });
  return bol;
}

export async function setPriority(auth: AuthContext, bolId: string, priority: LoadPriority) {
  requirePermission(auth, 'schedule:edit');
  const b = await db.billOfLading.findFirst({ where: { id: bolId, organizationId: auth.orgId } });
  if (!b) throw notFound('Load');
  await db.billOfLading.update({ where: { id: bolId }, data: { priority } });
  await audit(db, auth, 'bol.priority', 'BillOfLading', bolId, { priority: b.priority }, { priority });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pins: links, coordinates, addresses, KML
// ---------------------------------------------------------------------------
/** Short links (maps.app.goo.gl…) are followed once — only to Google / Apple map hosts. */
async function expandShortLink(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const loc = res.headers.get('location');
    if (!loc || !/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple\.com)\//i.test(loc)) return null;
    return loc;
  } catch {
    return null;
  }
}

export async function pinFromText(text: string) {
  let t = text.trim();
  if (isShortMapLink(t)) t = (await expandShortLink(t)) ?? t;
  const p = parseMapLink(t);
  if (p) return { lat: p.lat, lng: p.lng, label: p.label, how: 'link' as const };
  if (/^https?:\/\//i.test(t)) throw badRequest('That link has no location in it. Open the place in Google / Apple Maps and share or copy its link, or paste the address.');
  const hits = await geocode(t);
  if (!hits[0]) throw badRequest('Couldn’t find that address. Try adding the city and province.');
  return { lat: hits[0].lat, lng: hits[0].lng, label: hits[0].label, how: 'address' as const };
}

export async function setLocationPin(auth: AuthContext, locationId: string, text: string) {
  requirePermission(auth, 'bol:view');
  const loc = await db.shippingLocation.findFirst({ where: { id: locationId, organizationId: auth.orgId } });
  if (!loc) throw notFound('Location');
  const p = await pinFromText(text);
  await db.shippingLocation.update({ where: { id: locationId }, data: { lat: p.lat, lng: p.lng } });
  if (loc.siteId) await db.site.update({ where: { id: loc.siteId }, data: { lat: p.lat, lng: p.lng } });
  await audit(db, auth, 'location.pin', 'ShippingLocation', locationId, { lat: loc.lat, lng: loc.lng }, { lat: p.lat, lng: p.lng, how: p.how });
  return { lat: p.lat, lng: p.lng, how: p.how };
}

/** Placemarks from a KML file (Google Earth / My Maps): name + point. */
export function parseKml(xml: string): { name: string; lat: number; lng: number; description: string | null }[] {
  const out: { name: string; lat: number; lng: number; description: string | null }[] = [];
  const text = (s: string | undefined) => (s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  for (const pm of xml.match(/<Placemark[\s\S]*?<\/Placemark>/gi) ?? []) {
    const coords = pm.match(/<Point>[\s\S]*?<coordinates>\s*([-\d.]+)\s*,\s*([-\d.]+)/i);
    if (!coords) continue;
    const lng = Number(coords[1]);
    const lat = Number(coords[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const name = text(pm.match(/<name>([\s\S]*?)<\/name>/i)?.[1]).slice(0, 160) || `Pin ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    out.push({ name, lat, lng, description: text(pm.match(/<description>([\s\S]*?)<\/description>/i)?.[1]).slice(0, 500) || null });
  }
  return out;
}

/** KML → shipping locations (matched by name; new ones added). */
export async function importKml(auth: AuthContext, file: File) {
  requirePermission(auth, 'location:edit');
  if (file.size > 5 * 1_048_576) throw badRequest('That file is over 5 MB.');
  const marks = parseKml(await file.text());
  if (!marks.length) throw badRequest('No pins (placemarks with a point) were found in that file.');
  let created = 0;
  let updated = 0;
  for (const m of marks.slice(0, 500)) {
    const existing = await db.shippingLocation.findFirst({ where: { organizationId: auth.orgId, businessName: { equals: m.name, mode: 'insensitive' } } });
    if (existing) {
      await db.shippingLocation.update({ where: { id: existing.id }, data: { lat: m.lat, lng: m.lng } });
      updated++;
    } else {
      await db.shippingLocation.create({ data: { organizationId: auth.orgId, businessName: m.name, lat: m.lat, lng: m.lng, notes: m.description, source: 'AUTO' } });
      created++;
    }
  }
  await audit(db, auth, 'location.kml_import', 'Organization', auth.orgId, null, { created, updated });
  return { created, updated };
}

// ---------------------------------------------------------------------------
// Procurement is told when loads are planned and trucks booked
// ---------------------------------------------------------------------------
export async function tellProcurement(orgId: string, actorUserId: string | null, bolId: string, what: 'planned' | 'truck') {
  const b = await db.billOfLading.findUnique({ where: { id: bolId }, include: { stops: { orderBy: { seq: 'asc' }, include: { location: { select: { businessName: true } } } }, carrier: { select: { name: true, businessName: true } } } });
  if (!b) return;
  const people = await db.user.findMany({
    where: { organizationId: orgId, active: true, deletedAt: null, roles: { has: 'PROCUREMENT' }, OR: [{ companyId: b.companyId }, { extraCompanyIds: { has: b.companyId } }], ...(actorUserId ? { id: { not: actorUserId } } : {}) },
    select: { id: true },
  });
  if (!people.length) return;
  const route = `${b.stops.filter((s) => s.kind === 'PICKUP').map((s) => s.location.businessName).join(' · ')} → ${b.stops.filter((s) => s.kind === 'DROP').map((s) => s.location.businessName).join(' · ')}`;
  const day = b.stops.find((s) => s.plannedDate)?.plannedDate?.toISOString().slice(0, 10);
  const truck = [b.carrier ? (b.carrier.businessName ?? b.carrier.name) : null, b.driverName, b.truckUnit && `unit ${b.truckUnit}`].filter(Boolean).join(', ');
  const title = what === 'planned' ? `Load planned: ${b.title ?? route}` : `Truck booked: ${b.title ?? route}`;
  const body = [route, day && `on ${day}`, what === 'truck' && truck].filter(Boolean).join(' · ');
  await db.notification.createMany({ data: people.map((p) => ({ userId: p.id, type: what === 'planned' ? 'load_planned' : 'truck_booked', title: title.slice(0, 200), body: body.slice(0, 300), link: `/bols/view/?id=${bolId}` })) });
}
