import { afterAll, describe, expect, it } from 'vitest';
import { emptyDraftRow } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { availableLots, createBol, getBol, getBolPdf, issueBol, receiveBol } from '../src/services/bols';
import { importKml, listBoard, parseKml, postLoad, saveBoardSettings, setLocationPin, setPriority } from '../src/services/board';
import { setLineSize, saveTrailer } from '../src/services/loads';
import { makeRun, optimize } from '../src/services/optimizer';
import { createDraft, saveDraft, submitOrder } from '../src/services/orders';
import { saveStockCheck } from '../src/services/yard';
import { makeOrg, makeUser } from './helpers';

afterAll(() => db.$disconnect());

const locOf = async (siteId: string) => (await db.shippingLocation.findFirstOrThrow({ where: { siteId } })).id;

/** Two nearby jobs of company A with material in the yard, due the same week; a buyer to be told. */
async function setup() {
  const o = await makeOrg();
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: yard } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { user: buyerUser } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const jobA2 = await db.site.create({ data: { organizationId: o.org.id, companyId: o.a.id, type: 'JOB', jobNumber: '2250', name: 'Job A2', lat: 49.3, lng: -123.1 } });
  const { syncShippingLocation } = await import('../src/services/sites');
  await db.$transaction((tx) => syncShippingLocation(tx, jobA2.id));
  await db.site.update({ where: { id: o.jobA.id }, data: { lat: 49.28, lng: -123.12 } });
  await db.shippingLocation.updateMany({ where: { siteId: o.jobA.id }, data: { lat: 49.28, lng: -123.12 } });
  await db.shippingLocation.updateMany({ where: { siteId: jobA2.id }, data: { lat: 49.3, lng: -123.1 } });
  await db.shippingLocation.updateMany({ where: { siteId: o.yard.id }, data: { lat: 49.19, lng: -122.85 } });
  const { auth: siteA2 } = await makeUser(o.org.id, ['SITE'], o.a.id, [jobA2.id]);
  const order = async (auth: typeof site, siteId: string, desc: string, qty: string, req: string) => {
    const { id } = await createDraft(auth, siteId);
    await saveDraft(auth, id, { rows: [{ ...emptyDraftRow('SS'), description: desc, quantity: qty, uom: 'EA', requiredOnSite: req }] });
    const ord = (await submitOrder(auth, id)).order;
    await saveStockCheck(yard, ord.id, { yardId: o.yard.id, lines: ord.lines.map((l) => ({ lineId: l.id, qtyAvailable: Number(l.quantity) })) });
    await setLineSize(admin, ord.lines[0]!.id, { unitWeightKg: 500, lengthM: 6, widthM: 0.5, heightM: 0.3, stackable: true });
    return ord;
  };
  await order(site, o.jobA.id, 'Rebar bundle', '4', '2026-10-21');
  await order(siteA2, jobA2.id, 'Pipe section', '6', '2026-10-22');
  return { ...o, admin, yard, site, buyerUser, jobA2, yardLoc: await locOf(o.yard.id), jobLoc: await locOf(o.jobA.id), job2Loc: await locOf(jobA2.id) };
}

describe('milk-run BOLs with typed-in items', () => {
  it('ships two jobs on one BOL plus a typed-in item, prints a section per job, and the site receives it', async () => {
    const s = await setup();
    const lots = await availableLots(s.yard, s.yardLoc);
    const forA = lots.find((l) => l.finalSiteId === s.jobA.id)!;
    const forA2 = lots.find((l) => l.finalSiteId === s.jobA2.id)!;
    const bol = await createBol(s.yard, {
      companyId: s.a.id,
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: s.yardLoc, plannedDate: '2026-10-20' },
        { key: 'd1', kind: 'DROP', locationId: s.jobLoc, plannedDate: '2026-10-20' },
        { key: 'd2', kind: 'DROP', locationId: s.job2Loc, plannedDate: '2026-10-20' },
      ],
      lines: [
        { lotId: forA.lotId, qty: 4, pickupKey: 'p', dropKey: 'd1' },
        { lotId: forA2.lotId, qty: 6, pickupKey: 'p', dropKey: 'd2' },
        { manual: { description: 'Spare grader blade', uom: 'ea', siteId: s.jobA2.id }, qty: 1, pickupKey: 'p', dropKey: 'd2' },
      ],
    });
    expect(bol.lines.map((l) => [l.description, l.manual, l.finalSiteLabel])).toEqual([
      ['Rebar bundle', false, 'JOB#2249 Job A'],
      ['Pipe section', false, 'JOB#2250 Job A2'],
      ['Spare grader blade', true, 'JOB#2250 Job A2'],
    ]);
    const issued = await issueBol(s.yard, bol.id);
    expect(issued.status).toBe('ISSUED');
    expect((await getBolPdf(s.yard, bol.id)).bytes.length).toBeGreaterThan(1000);
    // The typed-in item is received like anything else (no stock is made for it).
    const stop = issued.stops.find((x) => x.location.id === s.job2Loc)!;
    const r = await receiveBol(s.yard, bol.id, { stopId: stop.id, lines: issued.lines.filter((l) => l.dropStopId === stop.id).map((l) => ({ bolLineId: l.id, qtyReceived: l.qty, damaged: false })) });
    expect(r.problems).toBe(0);
    const d = await getBol(s.yard, bol.id);
    expect(d.lines.find((l) => l.manual)!.received).toBe(1);
  });
});

describe('load board', () => {
  it('shows open loads with urgency, directions and whether a truck is booked; procurement hears about it', async () => {
    const s = await setup();
    const posted = await postLoad(s.yard, { companyId: s.a.id, title: 'Excavator move', priority: 'EMERGENCY', pickupLocationId: s.yardLoc, dropLocationId: s.jobLoc, pickupDate: '2026-10-20' });
    expect(await db.notification.count({ where: { userId: s.buyerUser.id, type: 'load_planned' } })).toBe(1);
    const board = await listBoard(s.yard);
    expect(board[0]).toMatchObject({ id: posted.id, title: 'Excavator move', priority: 'EMERGENCY', needsTruck: true });
    expect(board[0]!.directions!.google).toContain('origin=49.19,-122.85');
    await setPriority(s.yard, posted.id, 'ANYTIME');
    expect((await listBoard(s.yard)).find((x) => x.id === posted.id)!.priority).toBe('ANYTIME');
    // The admin can limit the board to some companies.
    await saveBoardSettings(s.admin, { companyIds: [s.b.id], mapProvider: 'osm', googleMapsKey: null });
    expect(await listBoard(s.yard)).toEqual([]);
    await expect(saveBoardSettings(s.admin, { companyIds: null, mapProvider: 'google', googleMapsKey: null })).rejects.toThrow(/Google Maps key/);
  });

  it('pins locations from map links and KML', async () => {
    const s = await setup();
    const r = await setLocationPin(s.yard, s.jobLoc, 'https://www.google.com/maps/place/Job+A/@49.2,-123.0,15z/data=!3d49.21!4d-123.01');
    expect(r).toMatchObject({ lat: 49.21, lng: -123.01, how: 'link' });
    expect((await db.site.findUniqueOrThrow({ where: { id: s.jobA.id } })).lat).toBe(49.21);
    await expect(setLocationPin(s.yard, s.jobLoc, 'https://example.com/nothing-here')).rejects.toThrow(/no location/);
    const kml = '<kml><Document><Placemark><name>Red Knife laydown</name><description><![CDATA[North gate]]></description><Point><coordinates>-123.5,49.7,0</coordinates></Point></Placemark><Placemark><name>No point</name></Placemark></Document></kml>';
    expect(parseKml(kml)).toEqual([{ name: 'Red Knife laydown', lat: 49.7, lng: -123.5, description: 'North gate' }]);
    expect(await importKml(s.admin, new File([kml], 'pins.kml'))).toEqual({ created: 1, updated: 0 });
    expect(await importKml(s.admin, new File([kml], 'pins.kml'))).toEqual({ created: 0, updated: 1 });
  });
});

describe('load optimizer', () => {
  it('combines nearby jobs due the same week onto one truck, picks the trailer, and plans it', async () => {
    const s = await setup();
    await saveTrailer(s.admin, null, { name: '48′ flat deck', kind: 'FLATDECK', deckLengthM: 14.63, deckWidthM: 2.59, deckHeightM: 1.52, maxHeightM: 4.15, maxWidthM: 2.6, maxPayloadKg: 21000 });
    const runs = await optimize(s.admin, { from: '2026-10-12', to: '2026-10-31', combineKm: 60, combineDays: 3 });
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    // Driving order: Job A2 is a little closer to the yard, so it's the first drop.
    expect(run.drops.map((d) => d.siteId)).toEqual([s.jobA2.id, s.jobA.id]);
    expect(run).toMatchObject({ loads: 1, weightKg: 5000, needBy: '2026-10-21', trailerName: '48′ flat deck' });
    expect(run.reasons[0]).toMatch(/Combines 2 jobs/);
    // Too far apart to combine.
    expect(await optimize(s.admin, { from: '2026-10-12', to: '2026-10-31', combineKm: 1, combineDays: 3 })).toHaveLength(2);

    const made = await makeRun(s.yard, { companyId: run.companyId, pickupLocationId: run.pickup.locationId, trailerId: run.trailerId, shipOn: run.shipOn, needBy: run.needBy, drops: run.drops.map((d) => ({ siteId: d.siteId, locationId: d.locationId, needBy: d.needBy })), plan: run.plan });
    expect(made.ids).toHaveLength(1);
    const b = await getBol(s.yard, made.ids[0]!);
    expect(b.stops.map((x) => x.kind)).toEqual(['PICKUP', 'DROP', 'DROP']);
    expect(b.lines).toHaveLength(2);
    // Already on a planned load: not suggested again.
    expect(await optimize(s.admin, { from: '2026-10-12', to: '2026-10-31', combineKm: 60, combineDays: 3 })).toEqual([]);
  });
});
