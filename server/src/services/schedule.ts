// Load schedule: BOLs placed on the days their stops are planned for, moving a
// load to another day, double-booking warnings and day-before delivery reminders.

import type { RescheduleInput, ScheduleFilter, ScheduleLoad } from '@supplyline/core/models';
import { can } from '@supplyline/core/permissions';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { badRequest, conflict, notFound } from '../lib/errors';
import { publish } from '../lib/events';
import { sendEmail, viaName } from '../integrations/email';
import { appLink, bolLabel, bolWhereFor } from './bols';
import { notifyJob } from './notify';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (v: string) => new Date(`${v}T00:00:00Z`);
const addDays = (v: string, n: number) => day(new Date(toDate(v).getTime() + n * 86_400_000))!;
const OPEN = ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'] as const;

const loadInclude = {
  company: { select: { name: true, themeColor: true } },
  carrier: { select: { name: true, businessName: true } },
  trailer: { select: { id: true, name: true, unitNumber: true } },
  stops: { orderBy: { seq: 'asc' }, include: { location: { select: { businessName: true, siteId: true } } } },
  _count: { select: { lines: true } },
} satisfies Prisma.BillOfLadingInclude;
type LoadRow = Prisma.BillOfLadingGetPayload<{ include: typeof loadInclude }>;

const scheduleLabel = (b: { bolNumber: number | null; direction: string; status: string }) =>
  b.status === 'DRAFT' ? (b.direction === 'RETURN' ? 'Planned return' : 'Planned load') : bolLabel(b);
const norm = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function toLoad(auth: AuthContext, b: LoadRow): ScheduleLoad {
  const dates = b.stops.map((s) => day(s.plannedDate)).filter((d): d is string => !!d).sort();
  return {
    id: b.id,
    label: scheduleLabel(b),
    direction: b.direction,
    status: b.status,
    companyId: b.companyId,
    companyName: b.company.name,
    themeColor: b.company.themeColor,
    carrierName: b.carrier ? (b.carrier.businessName ?? b.carrier.name) : null,
    driverName: b.driverName,
    truckUnit: b.truckUnit,
    trailerName: b.trailer ? `${b.trailer.name}${b.trailer.unitNumber ? ` #${b.trailer.unitNumber}` : ''}` : null,
    trailerUnitId: b.trailer?.unitNumber ? b.trailer.id : null,
    notes: b.notes,
    lineCount: b._count.lines,
    stops: b.stops.map((s) => ({
      id: s.id,
      seq: s.seq,
      kind: s.kind,
      locationName: s.location.businessName,
      siteId: s.location.siteId,
      plannedDate: day(s.plannedDate),
      plannedTime: s.plannedTime,
      completedAt: s.completedAt?.toISOString() ?? null,
    })),
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    conflicts: [],
    canMove: can(auth, 'schedule:edit') && (OPEN as readonly string[]).includes(b.status),
  };
}

/** Same driver or same truck on two loads the same day. */
function markConflicts(loads: ScheduleLoad[]) {
  const byDay = new Map<string, ScheduleLoad[]>();
  for (const l of loads) {
    if (l.status === 'RECEIVED' || l.status === 'CANCELLED') continue;
    for (const d of new Set(l.stops.map((s) => s.plannedDate).filter((x): x is string => !!x))) byDay.set(d, [...(byDay.get(d) ?? []), l]);
  }
  for (const [d, list] of byDay) {
    const pretty = new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue;
        if (a.driverName && norm(a.driverName) === norm(b.driverName)) a.conflicts.push(`Driver ${a.driverName} is also on ${b.label} on ${pretty}`);
        if (a.truckUnit && norm(a.truckUnit) === norm(b.truckUnit)) a.conflicts.push(`Truck ${a.truckUnit} is also on ${b.label} on ${pretty}`);
        if (a.trailerUnitId && a.trailerUnitId === b.trailerUnitId) a.conflicts.push(`Trailer ${a.trailerName} is also on ${b.label} on ${pretty}`);
      }
    }
  }
  for (const l of loads) l.conflicts = [...new Set(l.conflicts)];
}

export async function listSchedule(auth: AuthContext, f: ScheduleFilter): Promise<ScheduleLoad[]> {
  requirePermission(auth, 'bol:view');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from) || !/^\d{4}-\d{2}-\d{2}$/.test(f.to) || f.to < f.from) throw badRequest('Choose a date range.');
  if (toDate(f.to).getTime() - toDate(f.from).getTime() > 93 * 86_400_000) throw badRequest('Show at most three months at a time.');
  const inRange: Prisma.BillOfLadingWhereInput = { stops: { some: { plannedDate: { gte: toDate(f.from), lte: toDate(f.to) } } } };
  const undated: Prisma.BillOfLadingWhereInput = { status: { in: [...OPEN] }, stops: { none: { plannedDate: { not: null } } } };
  const rows = await db.billOfLading.findMany({
    where: {
      AND: [
        await bolWhereFor(auth, { crossUnit: true }),
        { status: { not: 'CANCELLED' } },
        f.includeUndated ? { OR: [inRange, undated] } : inRange,
        f.siteId ? { stops: { some: { location: { siteId: f.siteId } } } } : {},
        f.companyId ? { companyId: f.companyId } : {},
        f.carrierId ? { carrierContactId: f.carrierId } : {},
      ],
    },
    include: loadInclude,
    orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
  });
  const loads = rows.map((b) => toLoad(auth, b));
  markConflicts(loads);
  return loads.sort((a, b) => (a.firstDate ?? '9999').localeCompare(b.firstDate ?? '9999'));
}

/** Move a load: shift its open stops by N days, put an undated load on a day, or set stop dates. */
export async function rescheduleBol(auth: AuthContext, id: string, input: RescheduleInput): Promise<ScheduleLoad> {
  requirePermission(auth, 'schedule:edit');
  const b = await db.billOfLading.findFirst({ where: { AND: [{ id }, await bolWhereFor(auth, { crossUnit: true })] }, include: loadInclude });
  if (!b) throw notFound('Load');
  if (!(OPEN as readonly string[]).includes(b.status)) throw conflict('This load is finished and can’t be moved.');

  const changes = new Map<string, { plannedDate: Date | null; plannedTime?: string | null }>();
  for (const s of b.stops) {
    if (s.completedAt) continue; // already delivered there
    if (input.stops) {
      const e = input.stops.find((x) => x.stopId === s.id);
      if (e) changes.set(s.id, { plannedDate: e.plannedDate ? toDate(e.plannedDate) : null, ...(e.plannedTime !== undefined ? { plannedTime: e.plannedTime } : {}) });
    } else if (input.setDate && !s.plannedDate) {
      changes.set(s.id, { plannedDate: toDate(input.setDate) });
    } else if (input.shiftDays && s.plannedDate) {
      changes.set(s.id, { plannedDate: toDate(addDays(day(s.plannedDate)!, input.shiftDays)) });
    }
  }
  if (input.stops?.some((x) => !b.stops.some((s) => s.id === x.stopId))) throw badRequest('That stop isn’t on this load.');
  if (changes.size === 0) return toLoad(auth, b);

  const before = b.stops.map((s) => ({ id: s.id, plannedDate: day(s.plannedDate), plannedTime: s.plannedTime }));
  await db.$transaction(async (tx) => {
    for (const [stopId, data] of changes) await tx.bolStop.update({ where: { id: stopId }, data: { ...data, reminderSentAt: null } });
    const firstPickup = await tx.bolStop.findFirst({ where: { bolId: id, kind: 'PICKUP', plannedDate: { not: null } }, orderBy: { seq: 'asc' } });
    await tx.billOfLading.update({ where: { id }, data: { scheduledDate: firstPickup?.plannedDate ?? null } });
    await audit(tx, auth, 'bol.reschedule', 'BillOfLading', id, { stops: before }, input);
  });
  const after = await db.billOfLading.findUniqueOrThrow({ where: { id }, include: loadInclude });

  // Already on its way: tell the people at each job whose delivery date changed.
  if (input.notify && b.status !== 'DRAFT') {
    for (const s of after.stops.filter((x) => x.kind === 'DROP' && changes.has(x.id) && x.location.siteId)) {
      const label = scheduleLabel(after);
      const when = s.plannedDate ? [day(s.plannedDate), s.plannedTime].filter(Boolean).join(' ') : 'a date to be confirmed';
      const text = `${label} to ${s.location.businessName} has been moved to ${when}.`;
      const link = `/bols/view/?id=${id}`;
      await notifyJob({
        organizationId: auth.orgId,
        siteId: s.location.siteId!,
        event: 'DELIVERY_RESCHEDULED',
        title: `${label} moved`,
        subject: `Delivery date changed – ${label} to ${s.location.businessName}`,
        text: `${text}\n\nOpen in Bowron: ${appLink(link)}`,
        link,
        fromName: viaName(auth.name),
        replyTo: auth.email,
        relatedType: 'bol',
        relatedId: id,
      });
    }
  }
  publish(auth.orgId, { type: 'order.changed', orderId: '', siteId: after.siteId ?? '', companyId: after.companyId });
  const view = toLoad(auth, after);
  return view;
}

// ---------------------------------------------------------------------------
// Day-before delivery reminders
// ---------------------------------------------------------------------------
/** Today's date where the company works (YYYY-MM-DD). */
export function localToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: env().SCHEDULE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const localHour = (now: Date) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: env().SCHEDULE_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(now));

/**
 * Remind the people at each job about tomorrow's deliveries (once per stop,
 * from early afternoon the day before). Returns how many stops were reminded.
 */
export async function sendDeliveryReminders(now = new Date(), opts: { anyHour?: boolean } = {}): Promise<number> {
  if (!opts.anyHour && localHour(now) < 13) return 0;
  const tomorrow = toDate(addDays(localToday(now), 1));
  const stops = await db.bolStop.findMany({
    where: {
      kind: 'DROP',
      plannedDate: tomorrow,
      reminderSentAt: null,
      completedAt: null,
      bol: { status: { in: ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'] } },
      location: { site: { type: 'JOB' } },
    },
    include: {
      location: { select: { businessName: true, siteId: true } },
      bol: { select: { id: true, organizationId: true, bolNumber: true, direction: true, status: true, driverName: true, truckUnit: true, carrier: { select: { name: true, businessName: true } } } },
      dropLines: { select: { description: true, qty: true, uom: true } },
    },
  });
  let sent = 0;
  for (const s of stops) {
    {
      const label = scheduleLabel(s.bol);
      const truck = [s.bol.carrier ? (s.bol.carrier.businessName ?? s.bol.carrier.name) : null, s.bol.driverName, s.bol.truckUnit && `unit ${s.bol.truckUnit}`].filter(Boolean).join(', ');
      const items = s.dropLines.length
        ? s.dropLines.map((l) => `  - ${l.description}: ${Number(l.qty)} ${l.uom}`).join('\n')
        : '  (items not picked yet)';
      const text = `Tomorrow${s.plannedTime ? ` at ${s.plannedTime}` : ''}: ${label} to ${s.location.businessName}${truck ? ` (${truck})` : ''}.\n\n${items}`;
      const link = `/bols/view/?id=${s.bol.id}`;
      await notifyJob({
        organizationId: s.bol.organizationId,
        siteId: s.location.siteId!,
        event: 'DELIVERY_TOMORROW',
        title: `Delivery tomorrow – ${s.location.businessName}`,
        subject: `Delivery tomorrow – ${label} to ${s.location.businessName}`,
        text: `${text}\n\nOpen in Bowron: ${appLink(link)}`,
        link,
        fromName: env().EMAIL_FROM_NAME,
        relatedType: 'bol',
        relatedId: s.bol.id,
      });
    }
    await db.bolStop.update({ where: { id: s.id }, data: { reminderSentAt: now } });
    sent++;
  }
  return sent;
}
