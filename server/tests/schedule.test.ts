import { afterAll, describe, expect, it } from 'vitest';
import { emptyDraftRow } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { availableLots, createBol, issueBol } from '../src/services/bols';
import { createDraft, getOrder, saveDraft, siteInventory, submitOrder } from '../src/services/orders';
import { listSchedule, localToday, rescheduleBol, sendDeliveryReminders } from '../src/services/schedule';
import { saveStockCheck } from '../src/services/yard';
import { makeOrg, makeUser } from './helpers';

afterAll(() => db.$disconnect());

const row = (description: string, quantity: string) => ({ ...emptyDraftRow('JS'), description, quantity, uom: 'EA' });
const locOf = async (siteId: string) => (await db.shippingLocation.findFirstOrThrow({ where: { siteId } })).id;
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const o = await makeOrg();
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: yard } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const { id } = await createDraft(site, o.jobA.id);
  await saveDraft(site, id, { rows: [row('20M rebar', '10'), row('Tie wire', '5')] });
  const order = (await submitOrder(site, id)).order;
  await saveStockCheck(yard, order.id, { yardId: o.yard.id, lines: order.lines.map((l) => ({ lineId: l.id, qtyAvailable: Number(l.quantity) })) });
  const yardLoc = await locOf(o.yard.id);
  const jobLoc = await locOf(o.jobA.id);
  const lots = await availableLots(yard, yardLoc);
  const trip = (date: string | null, lotIds: string[] = [], extra: { driverName?: string; truckUnit?: string } = {}) =>
    createBol(yard, {
      companyId: o.a.id,
      ...extra,
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: yardLoc, plannedDate: date },
        { key: 'd', kind: 'DROP', locationId: jobLoc, plannedDate: date },
      ],
      lines: lotIds.map((lotId) => ({ lotId, qty: 1, pickupKey: 'p', dropKey: 'd' })),
    });
  return { ...o, site, yard, buyer, order, lots, trip };
}

describe('load schedule', () => {
  it('shows planned loads (even with no items yet) and on-the-way loads on their days', async () => {
    const s = await setup();
    const placeholder = await s.trip('2026-11-03');
    expect(placeholder.lines).toHaveLength(0);
    const real = await s.trip('2026-11-04', [s.lots[0]!.lotId]);
    await issueBol(s.yard, real.id);
    const undated = await s.trip(null);

    const week = await listSchedule(s.yard, { from: '2026-11-02', to: '2026-11-08' });
    expect(week.filter((l) => l.companyId === s.a.id).map((l) => [l.label, l.firstDate])).toEqual(
      expect.arrayContaining([
        ['Planned load', '2026-11-03'],
        [expect.stringMatching(/^BOL #\d+$/), '2026-11-04'],
      ]),
    );
    expect(week.some((l) => l.id === undated.id)).toBe(false);
    const withUndated = await listSchedule(s.yard, { from: '2026-11-02', to: '2026-11-08', includeUndated: true });
    expect(withUndated.find((l) => l.id === undated.id)?.firstDate).toBeNull();
    // The job's people see it under their job too.
    expect((await listSchedule(s.site, { from: '2026-11-02', to: '2026-11-08', siteId: s.jobA.id })).map((l) => l.id)).toEqual(
      expect.arrayContaining([placeholder.id, real.id]),
    );
    // A planned load with no items can't be issued.
    await expect(issueBol(s.yard, placeholder.id)).rejects.toThrow(/at least one item/);
  });

  it('warns when a driver or truck is booked twice the same day', async () => {
    const s = await setup();
    const a = await s.trip('2026-11-10', [], { driverName: 'Sam Lee', truckUnit: 'T-7' });
    await s.trip('2026-11-10', [], { driverName: 'sam lee' });
    await s.trip('2026-11-11', [], { truckUnit: 'T-7' });
    const loads = await listSchedule(s.yard, { from: '2026-11-10', to: '2026-11-11' });
    const first = loads.find((l) => l.id === a.id)!;
    expect(first.conflicts).toHaveLength(1);
    expect(first.conflicts[0]).toMatch(/Driver Sam Lee is also on Planned load/);
  });

  it('yard can move a load; procurement and site cannot', async () => {
    const s = await setup();
    const b = await s.trip('2026-11-12', [s.lots[0]!.lotId]);
    await issueBol(s.yard, b.id);
    await expect(rescheduleBol(s.buyer, b.id, { shiftDays: 1, notify: true })).rejects.toThrow(/access|permission/i);
    await expect(rescheduleBol(s.site, b.id, { shiftDays: 1, notify: true })).rejects.toThrow(/access|permission/i);
    expect((await listSchedule(s.buyer, { from: '2026-11-12', to: '2026-11-12' })).find((l) => l.id === b.id)?.canMove).toBe(false);

    const moved = await rescheduleBol(s.yard, b.id, { shiftDays: 2, notify: true });
    expect([moved.firstDate, moved.lastDate]).toEqual(['2026-11-14', '2026-11-14']);
    expect((await db.billOfLading.findUniqueOrThrow({ where: { id: b.id } })).scheduledDate?.toISOString().slice(0, 10)).toBe('2026-11-14');
    // Already on its way, so the job is told.
    const mail = await db.emailOutbox.findFirst({ where: { relatedType: 'bol', relatedId: b.id, subject: { startsWith: 'Delivery date changed' } } });
    expect(mail?.bodyText).toMatch(/moved to 2026-11-14/);

    const undated = await s.trip(null);
    expect((await rescheduleBol(s.yard, undated.id, { setDate: '2026-11-20', notify: false })).firstDate).toBe('2026-11-20');
  });

  it('shows how each line is moving on the materials list and site inventory', async () => {
    const s = await setup();
    const rebar = s.lots.find((l) => l.description === '20M rebar')!;
    const b = await s.trip('2026-11-18', [rebar.lotId]);
    let order = await getOrder(s.site, s.order.id);
    const line = order.lines.find((l) => l.description === '20M rebar')!;
    expect(line.shipments).toEqual([expect.objectContaining({ state: 'PLANNED', bolLabel: 'Planned load', date: '2026-11-18', qty: 1 })]);
    expect(order.nextDelivery).toEqual(expect.objectContaining({ date: '2026-11-18', bolId: b.id }));

    const issued = await issueBol(s.yard, b.id);
    const inv = await siteInventory(s.site, s.jobA.id);
    expect(inv.find((r) => r.description === '20M rebar')?.shipments[0]).toEqual(
      expect.objectContaining({ state: 'ON_THE_WAY', bolLabel: `BOL #${issued.bolNumber}`, toName: expect.stringContaining('Job A') }),
    );
    order = await getOrder(s.site, s.order.id);
    expect(order.lines.find((l) => l.description === 'Tie wire')?.shipments).toEqual([]);
  });

  it('reminds the job the day before a delivery, once', async () => {
    const s = await setup();
    const now = new Date();
    const tomorrow = addDays(localToday(now), 1);
    const b = await s.trip(tomorrow, [s.lots[0]!.lotId]);
    await issueBol(s.yard, b.id);
    expect(await sendDeliveryReminders(now, { anyHour: true })).toBeGreaterThanOrEqual(1);
    const mail = await db.emailOutbox.findFirst({ where: { relatedId: b.id, subject: { startsWith: 'Delivery tomorrow' } } });
    expect(mail?.bodyText).toMatch(/20M rebar: 1 EA/);
    const again = await sendDeliveryReminders(now, { anyHour: true });
    expect(await db.emailOutbox.count({ where: { relatedId: b.id, subject: { startsWith: 'Delivery tomorrow' } } })).toBe(1);
    expect(again).toBeGreaterThanOrEqual(0);
  });
});
