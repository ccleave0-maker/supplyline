import { afterAll, describe, expect, it } from 'vitest';
import { emptyDraftRow } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { availableLots, getBol, updateBol } from '../src/services/bols';
import { compareTrailers, listTrailers, loadItems, makePlannedLoads, planForTrailer, saveTrailer, setLineSize } from '../src/services/loads';
import { createDraft, saveDraft, submitOrder } from '../src/services/orders';
import { listSchedule } from '../src/services/schedule';
import { saveStockCheck } from '../src/services/yard';
import { makeOrg, makeUser } from './helpers';

afterAll(() => db.$disconnect());

const row = (description: string, quantity: string, uom = 'EA') => ({ ...emptyDraftRow('JS'), description, quantity, uom });
const locOf = async (siteId: string) => (await db.shippingLocation.findFirstOrThrow({ where: { siteId } })).id;
const flatdeck = { name: '48′ flat deck', kind: 'FLATDECK' as const, deckLengthM: 14.63, deckWidthM: 2.59, deckHeightM: 1.52, maxHeightM: 4.15, maxWidthM: 2.6, maxPayloadKg: 21_000 };

/** 40 piles + 2 wide girders + 10 boxes of bolts (no size) for Job A, in the yard. */
async function setup() {
  const o = await makeOrg();
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: yard } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const { id } = await createDraft(site, o.jobA.id);
  await saveDraft(site, id, { rows: [row('Pipe pile 324mm x 12m', '40'), row('Girder', '2'), row('Bolts', '10', 'BOX')] });
  const order = (await submitOrder(site, id)).order;
  await saveStockCheck(yard, order.id, { yardId: o.yard.id, lines: order.lines.map((l) => ({ lineId: l.id, qtyAvailable: Number(l.quantity) })) });
  const [pile, girder] = order.lines;
  await setLineSize(buyer, pile!.id, { unitWeightKg: 1200, lengthM: 12, widthM: 0.33, heightM: 0.33, stackable: true });
  await setLineSize(buyer, girder!.id, { unitWeightKg: 8000, lengthM: 6, widthM: 3, heightM: 1, stackable: false });
  return { ...o, site, yard, buyer, order, yardLoc: await locOf(o.yard.id), jobLoc: await locOf(o.jobA.id) };
}

describe('trailers and the load builder', () => {
  it('keeps a trailer library (yard and admin only)', async () => {
    const s = await setup();
    await expect(saveTrailer(s.site, null, flatdeck)).rejects.toThrow(/permission|access/i);
    const t = await saveTrailer(s.yard, null, { ...flatdeck, unitNumber: 'T-12' });
    expect(t).toMatchObject({ name: '48′ flat deck', maxPayloadKg: 21_000, unitNumber: 'T-12', active: true });
    await saveTrailer(s.yard, t.id, { ...flatdeck, active: false });
    expect(await listTrailers(s.site)).toEqual([]);
    expect(await listTrailers(s.site, true)).toHaveLength(1);
  });

  it('splits yard stock into loads, flags the wide girders and makes planned loads', async () => {
    const s = await setup();
    const t = await saveTrailer(s.yard, null, flatdeck);
    const lowboy = await saveTrailer(s.yard, null, { ...flatdeck, name: 'Lowboy', kind: 'LOWBOY', deckLengthM: 7.32, deckHeightM: 0.46, maxPayloadKg: 36_000 });
    await expect(setLineSize(s.site, s.order.lines[0]!.id, { unitWeightKg: 1, lengthM: null, widthM: null, heightM: null, stackable: true })).rejects.toThrow(/permission|access/i);

    const items = await loadItems(s.buyer, { locationId: s.yardLoc, siteId: s.jobA.id });
    expect(items.map((i) => [i.label, i.qty, i.unitWeightKg])).toEqual([
      ['Pipe pile 324mm x 12m', 40, 1200],
      ['Girder', 2, 8000],
      ['Bolts', 10, null],
    ]);
    const pick = items.map((i) => ({ key: i.key, qty: i.qty }));
    const plan = await planForTrailer(s.buyer, { trailerId: t.id, items: pick });
    // Girders are 3 m wide → each on its own load with a permit flag; piles 17/17/6; bolts ride on the first shared load.
    expect(plan.loads).toHaveLength(5);
    expect(plan.itemFlags[items[1]!.key]).toEqual(['PERMIT_WIDTH', 'TOO_WIDE']);
    expect(plan.loads.filter((l) => l.flags.includes('PERMIT_WIDTH'))).toHaveLength(2);
    expect(plan.unsized).toEqual([items[2]!.key]);
    expect(plan.totalWeightKg).toBe(64_000);

    const cmp = await compareTrailers(s.buyer, pick);
    // 12 m piles are too long for the lowboy (one per load), so the flat deck wins.
    expect(cmp.map((c) => c.name)).toEqual(['48′ flat deck', 'Lowboy']);
    expect(cmp[0]!.loads).toBe(5);
    expect(cmp[1]).toMatchObject({ trailerId: lowboy.id, loads: 43 }); // 40 piles + 2 girders on their own, + the bolts

    // Turn the plan into planned loads on the schedule.
    await expect(makePlannedLoads(s.buyer, { trailerId: t.id, companyId: s.a.id, pickupLocationId: s.yardLoc, dropLocationId: s.jobLoc, loads: [[{ lotId: items[0]!.key, qty: 1 }]] })).rejects.toThrow(/permission|access/i);
    const made = await makePlannedLoads(s.yard, {
      trailerId: t.id,
      companyId: s.a.id,
      pickupLocationId: s.yardLoc,
      dropLocationId: s.jobLoc,
      pickupDate: '2026-11-02',
      deliveryDate: '2026-11-02',
      loads: plan.loads.map((l) => l.lines.map((x) => ({ lotId: x.key, qty: x.qty }))),
    });
    expect(made.ids).toHaveLength(5);
    const first = await getBol(s.yard, made.ids[0]!);
    expect(first.status).toBe('DRAFT');
    expect(first.trailer).toMatchObject({ id: t.id, name: '48′ flat deck' });
    expect(first.notes).toBe('Load 1 of 5 (load builder)');
    expect(first.loadCheck!.flags).toEqual(['PERMIT_WIDTH', 'TOO_WIDE']);

    // Over-filling a BOL shows as overweight.
    const piles = plan.loads.find((l) => l.lines.some((x) => x.key === items[0]!.key) && !l.flags.length)!;
    const bolId = made.ids[plan.loads.indexOf(piles)]!;
    const b = await getBol(s.yard, bolId);
    expect(b.loadCheck).toMatchObject({ weightKg: 20_400, flags: [] });
    const lots = await availableLots(s.yard, s.yardLoc);
    const spare = lots.find((l) => l.lotId === items[0]!.key)!;
    expect(spare.qtyAvailable).toBe(40); // drafts don't hold stock
    await updateBol(s.yard, bolId, {
      companyId: s.a.id,
      trailerId: t.id,
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: s.yardLoc, plannedDate: '2026-11-02' },
        { key: 'd', kind: 'DROP', locationId: s.jobLoc, plannedDate: '2026-11-02' },
      ],
      lines: [{ lotId: items[0]!.key, qty: 20, pickupKey: 'p', dropKey: 'd' }],
    });
    expect((await getBol(s.yard, bolId)).loadCheck).toMatchObject({ weightKg: 24_000, loadsNeeded: 2, flags: ['OVERWEIGHT'] });

    const sched = await listSchedule(s.yard, { from: '2026-11-01', to: '2026-11-03' });
    expect(sched.filter((l) => made.ids.includes(l.id)).every((l) => l.trailerName === '48′ flat deck')).toBe(true);
  });

  it('warns when the same numbered trailer is booked twice on a day', async () => {
    const s = await setup();
    const t = await saveTrailer(s.yard, null, { ...flatdeck, unitNumber: 'T-7' });
    const [pile] = await loadItems(s.yard, { locationId: s.yardLoc });
    const base = { trailerId: t.id, companyId: s.a.id, pickupLocationId: s.yardLoc, dropLocationId: s.jobLoc, pickupDate: '2026-11-05', deliveryDate: '2026-11-05' };
    await makePlannedLoads(s.yard, { ...base, loads: [[{ lotId: pile!.key, qty: 5 }], [{ lotId: pile!.key, qty: 5 }]] });
    const sched = await listSchedule(s.yard, { from: '2026-11-05', to: '2026-11-05' });
    const mine = sched.filter((l) => l.trailerUnitId === t.id);
    expect(mine).toHaveLength(2);
    expect(mine[0]!.conflicts.some((c) => c.startsWith('Trailer 48′ flat deck #T-7 is also on'))).toBe(true);
  });
});
