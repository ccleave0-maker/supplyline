import QRCode from 'qrcode';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { emptyDraftRow } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { bolQrPayload, parseBolQr } from '../src/pdf/bol-pdf';
import { availableLots, cancelBol, createBol, createReturn, getBol, issueBol, listBols, lookupBol, lotsAtSite, receiveBol } from '../src/services/bols';
import { createLocation, deleteLocation, listLocations } from '../src/services/locations';
import { createDraft, saveDraft, siteInventory, submitOrder } from '../src/services/orders';
import { scanDocument, textHasPo } from '../src/services/scan';
import { listDeleted, restoreDeleted } from '../src/services/trash';
import { saveStockCheck } from '../src/services/yard';
import { makeOrg, makeUser } from './helpers';

afterAll(() => db.$disconnect());

const row = (description: string, quantity: string, uom = 'EA') => ({ ...emptyDraftRow('JS'), description, quantity, uom });
const locOf = async (siteId: string) => (await db.shippingLocation.findFirstOrThrow({ where: { siteId } })).id;

/** A submitted list for Job A with 10 rebar + 5 tie wire sitting in the yard as yard stock. */
async function setup() {
  const o = await makeOrg();
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: yard } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { id } = await createDraft(site, o.jobA.id);
  await saveDraft(site, id, { rows: [row('20M rebar', '10'), row('Tie wire', '5', 'ROLL')] });
  const order = (await submitOrder(site, id)).order;
  await saveStockCheck(yard, order.id, {
    yardId: o.yard.id,
    lines: order.lines.map((l) => ({ lineId: l.id, qtyAvailable: Number(l.quantity) })),
  });
  const yardLoc = await locOf(o.yard.id);
  const jobLoc = await locOf(o.jobA.id);
  const lots = await availableLots(yard, yardLoc);
  return { ...o, yardSite: o.yard, site, yard, admin, order, yardLoc, jobLoc, lots };
}

describe('BOLs', () => {
  it('ships yard stock to a job, numbers on issue, and receives with a shortage', async () => {
    const s = await setup();
    expect(s.lots.map((l) => [l.description, l.qtyAvailable])).toEqual([
      ['20M rebar', 10],
      ['Tie wire', 5],
    ]);
    const [rebar, wire] = s.lots;
    const draft = await createBol(s.yard, {
      companyId: s.a.id,
      driverName: 'Sam',
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: s.yardLoc },
        { key: 'd', kind: 'DROP', locationId: s.jobLoc },
      ],
      lines: [
        { lotId: rebar!.lotId, qty: 10, pickupKey: 'p', dropKey: 'd' },
        { lotId: wire!.lotId, qty: 5, pickupKey: 'p', dropKey: 'd' },
      ],
    });
    expect(draft.bolNumber).toBeNull();
    expect(draft.label).toMatch(/Draft/);

    const issued = await issueBol(s.yard, draft.id);
    expect(issued.status).toBe('ISSUED');
    expect(issued.bolNumber).toBeGreaterThan(0);
    // Stock leaves the yard; the job sees it in transit.
    expect(await availableLots(s.yard, s.yardLoc)).toHaveLength(0);
    let inv = await siteInventory(s.site, s.jobA.id);
    expect(inv.find((r) => r.description === '20M rebar')?.inTransit).toBe(10);

    // Site finds it by number (as typed, or from the QR) and receives 9 of 10 rebar.
    expect((await lookupBol(s.site, `BOL #${issued.bolNumber}`)).id).toBe(draft.id);
    expect((await lookupBol(s.site, bolQrPayload(draft.id, issued.bolNumber))).id).toBe(draft.id);
    const site = await getBol(s.site, draft.id);
    const drop = site.stops.find((x) => x.kind === 'DROP')!;
    expect(drop.canReceive).toBe(true);
    const r = await receiveBol(s.site, draft.id, {
      stopId: drop.id,
      lines: site.lines.map((l) => ({ bolLineId: l.id, qtyReceived: l.description === '20M rebar' ? 9 : l.qty, damaged: false })),
    });
    expect(r.problems).toBe(1);
    expect(r.status).toBe('RECEIVED');
    inv = await siteInventory(s.site, s.jobA.id);
    const rebarRow = inv.find((x) => x.description === '20M rebar')!;
    expect([rebarRow.inTransit, rebarRow.onSite]).toEqual([0, 9]);
    await expect(receiveBol(s.site, draft.id, { stopId: drop.id, lines: [{ bolLineId: site.lines[0]!.id, qtyReceived: 1, damaged: false }] })).rejects.toThrow(
      /already been received/,
    );
  });

  it('stages material at a laydown on a multi-stop BOL', async () => {
    const s = await setup();
    const laydown = await createLocation(s.yard, { businessName: 'Laydown 3', city: 'Calgary' });
    const [rebar, wire] = s.lots;
    const b = await createBol(s.yard, {
      companyId: s.a.id,
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: s.yardLoc },
        { key: 'l', kind: 'DROP', locationId: laydown.id },
        { key: 'j', kind: 'DROP', locationId: s.jobLoc },
      ],
      lines: [
        { lotId: rebar!.lotId, qty: 10, pickupKey: 'p', dropKey: 'l' },
        { lotId: wire!.lotId, qty: 5, pickupKey: 'p', dropKey: 'j' },
      ],
    });
    await issueBol(s.yard, b.id);
    const d = await getBol(s.yard, b.id);
    const lay = d.stops.find((x) => x.location.id === laydown.id)!;
    const r = await receiveBol(s.yard, b.id, { stopId: lay.id, lines: d.lines.filter((l) => l.dropStopId === lay.id).map((l) => ({ bolLineId: l.id, qtyReceived: l.qty, damaged: false })) });
    expect(r.status).toBe('PARTIALLY_RECEIVED');
    const staged = await availableLots(s.yard, laydown.id);
    expect(staged.map((l) => [l.description, l.qtyAvailable])).toEqual([['20M rebar', 10]]);
    expect((await siteInventory(s.site, s.jobA.id)).find((x) => x.description === '20M rebar')?.staged).toBe(10);
  });

  it('keeps a pickup / delivery date on each stop', async () => {
    const s = await setup();
    const laydown = await createLocation(s.yard, { businessName: 'Laydown 9' });
    const b = await createBol(s.yard, {
      companyId: s.a.id,
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: s.yardLoc, plannedDate: '2026-10-14', plannedTime: '07:30' },
        { key: 'l', kind: 'DROP', locationId: laydown.id, plannedDate: '2026-10-14', plannedTime: '' },
        { key: 'j', kind: 'DROP', locationId: s.jobLoc, plannedDate: '2026-10-15' },
      ],
      lines: [
        { lotId: s.lots[0]!.lotId, qty: 1, pickupKey: 'p', dropKey: 'l' },
        { lotId: s.lots[1]!.lotId, qty: 1, pickupKey: 'p', dropKey: 'j' },
      ],
    });
    expect(b.stops.map((x) => [x.plannedDate, x.plannedTime])).toEqual([
      ['2026-10-14', '07:30'],
      ['2026-10-14', null],
      ['2026-10-15', null],
    ]);
    expect([b.scheduledDate, b.deliveryDate]).toEqual(['2026-10-14', '2026-10-15']);
    expect((await listBols(s.yard, { status: 'draft' })).find((x) => x.id === b.id)?.deliveryDate).toBe('2026-10-15');
  });

  it('cancelling an issued BOL puts the stock back', async () => {
    const s = await setup();
    const b = await createBol(s.yard, {
      companyId: s.a.id,
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: s.yardLoc },
        { key: 'd', kind: 'DROP', locationId: s.jobLoc },
      ],
      lines: [{ lotId: s.lots[0]!.lotId, qty: 4, pickupKey: 'p', dropKey: 'd' }],
    });
    await issueBol(s.yard, b.id);
    expect((await availableLots(s.yard, s.yardLoc)).find((l) => l.lotId === s.lots[0]!.lotId)?.qtyAvailable).toBe(6);
    expect((await cancelBol(s.yard, b.id)).status).toBe('CANCELLED');
    expect((await availableLots(s.yard, s.yardLoc)).find((l) => l.lotId === s.lots[0]!.lotId)?.qtyAvailable).toBe(10);
  });

  it('site users cannot build BOLs and only see BOLs for their jobs', async () => {
    const s = await setup();
    const input = {
      companyId: s.a.id,
      stops: [
        { key: 'p', kind: 'PICKUP' as const, locationId: s.yardLoc },
        { key: 'd', kind: 'DROP' as const, locationId: await locOf(s.jobB.id) },
      ],
      lines: [{ lotId: s.lots[0]!.lotId, qty: 1, pickupKey: 'p', dropKey: 'd' }],
    };
    await expect(createBol(s.site, input)).rejects.toThrow(/access|permission/i);
    const b = await createBol(s.yard, input);
    await issueBol(s.yard, b.id);
    expect((await listBols(s.site, {})).some((x) => x.id === b.id)).toBe(false);
  });

  it('returns material from a job to the yard', async () => {
    const s = await setup();
    const b = await createBol(s.yard, {
      companyId: s.a.id,
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: s.yardLoc },
        { key: 'd', kind: 'DROP', locationId: s.jobLoc },
      ],
      lines: [{ lotId: s.lots[0]!.lotId, qty: 10, pickupKey: 'p', dropKey: 'd' }],
    });
    await issueBol(s.yard, b.id);
    const d = await getBol(s.site, b.id);
    await receiveBol(s.site, b.id, { stopId: d.stops[1]!.id, lines: [{ bolLineId: d.lines[0]!.id, qtyReceived: 10, damaged: false }] });

    const onSite = await lotsAtSite(s.site, s.jobA.id);
    expect(onSite.map((l) => l.qtyAvailable)).toEqual([10]);
    const ret = await createReturn(s.site, { siteId: s.jobA.id, yardId: s.yardSite.id, lines: [{ lotId: onSite[0]!.lotId, qty: 3 }] });
    expect([ret.direction, ret.status]).toEqual(['RETURN', 'ISSUED']);
    const rd = await getBol(s.yard, ret.id);
    await receiveBol(s.yard, ret.id, { stopId: rd.stops[1]!.id, lines: [{ bolLineId: rd.lines[0]!.id, qtyReceived: 3, damaged: false }] });
    const row = (await siteInventory(s.site, s.jobA.id)).find((x) => x.description === '20M rebar')!;
    expect([row.onSite, row.qtyReturned]).toEqual([7, 3]);
  });
});

describe('locations and recycle bin', () => {
  it('deletes an unused location to the recycle bin and restores it', async () => {
    const s = await setup();
    const loc = await createLocation(s.yard, { businessName: 'Old Dock' });
    await deleteLocation(s.yard, loc.id);
    expect((await listLocations(s.yard, {})).some((l) => l.id === loc.id)).toBe(false);
    await expect(listDeleted(s.yard)).rejects.toThrow(/access|permission/i);
    const bin = await listDeleted(s.admin);
    const item = bin.find((x) => x.label.includes('Old Dock'))!;
    expect(item.entityType).toBe('LOCATION');
    await restoreDeleted(s.admin, item.id);
    expect((await listLocations(s.yard, {})).some((l) => l.businessName === 'Old Dock')).toBe(true);
    expect((await listDeleted(s.admin)).some((x) => x.id === item.id)).toBe(false);
  });

  it('will not delete a location that has stock', async () => {
    const s = await setup();
    await expect(deleteLocation(s.admin, s.yardLoc)).rejects.toThrow();
  });
});

describe('scanning a BOL photo', () => {
  it('finds the BOL from the QR code in a photo of the paper', async () => {
    const s = await setup();
    const b = await createBol(s.yard, {
      companyId: s.a.id,
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: s.yardLoc },
        { key: 'd', kind: 'DROP', locationId: s.jobLoc },
      ],
      lines: [{ lotId: s.lots[0]!.lotId, qty: 1, pickupKey: 'p', dropKey: 'd' }],
    });
    const issued = await issueBol(s.yard, b.id);
    // A "photo": the QR code sitting on a big white page, saved as a JPEG like a phone camera would.
    const qr = await QRCode.toBuffer(bolQrPayload(b.id, issued.bolNumber), { type: 'png', margin: 1, width: 300 });
    const photo = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: '#f4f4f0' } })
      .composite([{ input: qr, left: 1150, top: 120 }])
      .jpeg({ quality: 80 })
      .toBuffer();
    const r = await scanDocument(s.site, new File([new Uint8Array(photo)], 'bol.jpg', { type: 'image/jpeg' }), 'site');
    expect(r.method).toBe('qr');
    expect(r.match?.bolId).toBe(b.id);
  });
});

describe('scanning helpers', () => {
  it('parses BOL QR codes', () => {
    expect(parseBolQr(bolQrPayload('abc123', 12))).toEqual({ bolId: 'abc123', bolNumber: 12 });
    expect(parseBolQr('hello')).toBeNull();
  });
  it('finds PO numbers in OCR text', () => {
    expect(textHasPo('Packing slip\nPO# 4471-A  ship to', '4471-A')).toBe(true);
    expect(textHasPo('Customer PO:PO4471A', '4471-A')).toBe(true);
    expect(textHasPo('Invoice 144712', '4471')).toBe(false);
  });
});

describe('shipped notices and job notification setup', () => {
  it('tells the job when the shipper marks the BOL shipped, using the job’s notification list', async () => {
    const s = await setup();
    const { getNotifySetup, saveNotifySetup } = await import('../src/services/notify');
    const { shipBol } = await import('../src/services/bols');
    const mk = async () => {
      const b = await createBol(s.yard, {
        companyId: s.a.id,
        stops: [
          { key: 'p', kind: 'PICKUP', locationId: s.yardLoc },
          { key: 'd', kind: 'DROP', locationId: s.jobLoc },
        ],
        lines: [{ lotId: s.lots[0]!.lotId, qty: 1, pickupKey: 'p', dropKey: 'd' }],
      });
      return issueBol(s.yard, b.id);
    };
    const shippedMails = (id: string) => db.emailOutbox.findMany({ where: { relatedId: id, subject: { contains: 'shipped' } } });

    // Defaults: issuing alone tells no one; Mark shipped tells the job's people.
    const first = await mk();
    expect(first.canShip).toBe(true);
    expect(await shippedMails(first.id)).toHaveLength(0);
    const shipped = await shipBol(s.yard, first.id);
    expect([shipped.shippedAt != null, shipped.canShip]).toEqual([true, false]);
    const siteUser = await db.user.findUniqueOrThrow({ where: { id: s.site.userId } });
    expect((await shippedMails(first.id))[0]?.to).toContain(siteUser.email);
    await expect(shipBol(s.yard, first.id)).rejects.toThrow(/already/);

    // Custom list: the site person only wants deliveries; the office gets shipped notices.
    const setupNow = await getNotifySetup(s.admin, s.jobA.id);
    expect(setupNow.usingDefaults).toBe(true);
    await saveNotifySetup(s.admin, s.jobA.id, {
      rows: [
        { userId: s.site.userId, events: ['BOL_DELIVERED'] },
        { email: 'office@example.com', name: 'Site office', events: ['BOL_SHIPPED', 'BOL_DELIVERED'] },
      ],
    });
    await expect(saveNotifySetup(s.site, s.jobA.id, { rows: [] })).rejects.toThrow(/project manager/);
    const second = await mk();
    await shipBol(s.yard, second.id);
    expect((await shippedMails(second.id))[0]?.to).toEqual(['office@example.com']);
    const d = await getBol(s.site, second.id);
    await receiveBol(s.site, second.id, { stopId: d.stops[1]!.id, lines: [{ bolLineId: d.lines[0]!.id, qtyReceived: 1, damaged: false }] });
    const delivered = await db.emailOutbox.findFirst({ where: { relatedId: second.id, subject: { startsWith: `${second.label} delivered` } } });
    // The person who received it isn't told about their own receipt.
    expect(delivered?.to).toEqual(['office@example.com']);
  });
});
