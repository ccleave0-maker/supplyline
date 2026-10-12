import { afterAll, describe, expect, it } from 'vitest';
import { emptyDraftRow } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { createDraft, getOrder, saveDraft, siteInventory, submitOrder } from '../src/services/orders';
import {
  assignPo,
  createCustomColumn,
  getProcurementOrder,
  markRfq,
  procurementQueue,
  removePoLine,
  setCustomValue,
  updatePoLine,
} from '../src/services/procurement';
import {
  createReceipt,
  getReceipt,
  incomingShipments,
  lookupForReceiving,
  saveStockCheck,
  stockCheckQueue,
  yardInventory,
} from '../src/services/yard';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

const row = (description: string, quantity: string, uom = 'EA') => ({ ...emptyDraftRow('JS'), description, quantity, uom });

async function setup() {
  const o = await makeOrg();
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: yard } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  await db.companyEmailRecipient.create({ data: { companyId: o.a.id, kind: 'PROCUREMENT', email: 'buyer@example.com' } });
  const { id } = await createDraft(site, o.jobA.id);
  await saveDraft(site, id, { rows: [row('20M rebar', '10'), row('Tie wire', '5', 'ROLL'), row('Form ply', '40', 'SHEET')] });
  const order = (await submitOrder(site, id)).order;
  const [l1, l2, l3] = order.lines;
  return { ...o, yardSite: o.yard, site, yard, buyer, order, l1: l1!, l2: l2!, l3: l3! };
}

describe('yard stock check', () => {
  it('shows new lists to the yard and marks lines yard stock or to buy', async () => {
    const s = await setup();
    const queue = await stockCheckQueue(s.yard);
    const mine = queue.find((q) => q.orderId === s.order.id);
    expect(mine?.lines).toHaveLength(3);
    expect(mine?.yards.map((y) => y.id)).toEqual([s.yardSite.id]);

    // All of L1, 2 of the 5 for L2, none of L3.
    const r = await saveStockCheck(s.yard, s.order.id, {
      yardId: mine!.yards[0]!.id,
      lines: [
        { lineId: s.l1.id, qtyAvailable: 10 },
        { lineId: s.l2.id, qtyAvailable: 2 },
        { lineId: s.l3.id, qtyAvailable: 0 },
      ],
    });
    expect(r).toEqual({ full: 1, part: 1, none: 1 });
    const after = await getOrder(s.site, s.order.id);
    expect(after.lines.map((l) => l.status)).toEqual(['YARD_STOCK', 'SUBMITTED', 'SUBMITTED']);
    expect((await stockCheckQueue(s.yard)).some((q) => q.orderId === s.order.id)).toBe(false);

    // Yard stock is now yard inventory, ready to ship.
    const inv = await yardInventory(s.yard);
    expect(inv.filter((i) => i.orderId === s.order.id).map((i) => [i.lineNo, i.qtyAvailable, i.source])).toEqual(
      expect.arrayContaining([
        [1, 10, 'YARD_STOCK'],
        [2, 2, 'YARD_STOCK'],
      ]),
    );
    // Procurement is told.
    const mail = await db.emailOutbox.findFirst({ where: { relatedType: 'yard_check', relatedId: s.order.id } });
    expect(mail?.subject).toMatch(/yard stock check done/);
  });

  it('site users cannot do stock checks', async () => {
    const s = await setup();
    await expect(stockCheckQueue(s.site)).rejects.toThrow(/access/);
  });
});

describe('procurement', () => {
  it('lists what needs buying, marks RFQs and assigns POs (yard stock reduces the qty to buy)', async () => {
    const s = await setup();
    const yardId = s.yardSite.id;
    await saveStockCheck(s.yard, s.order.id, { yardId, lines: [{ lineId: s.l2.id, qtyAvailable: 2 }] });

    const queue = await procurementQueue(s.buyer, {});
    expect(queue.find((q) => q.orderId === s.order.id)?.toBuy).toBe(3);

    let po = await markRfq(s.buyer, s.order.id, [s.l1.id, s.l3.id], true);
    expect(po.lines.find((l) => l.id === s.l1.id)?.status).toBe('SENT_FOR_RFQ');

    const view = await getProcurementOrder(s.buyer, s.order.id);
    expect(view.lines.find((l) => l.id === s.l2.id)?.qtyToBuy).toBe(3); // 5 ordered, 2 in the yard

    const poNo = `PO-${uid()}`;
    po = await assignPo(s.buyer, s.order.id, {
      poNumber: poNo,
      vendorName: 'Coastal Steel',
      vendorEta: '2026-10-20',
      yardId,
      lines: [
        { lineId: s.l1.id, qty: 10, unitCost: 12.5 },
        { lineId: s.l2.id, qty: 3, unitCost: 4 },
      ],
    });
    expect(po.lines.find((l) => l.id === s.l1.id)).toMatchObject({ status: 'ON_ORDER', qtyToBuy: 0, unitCost: 12.5, extendedCost: 125 });
    expect(po.lines.find((l) => l.id === s.l2.id)?.status).toBe('ON_ORDER');

    // The site sees the PO, vendor and ETA on their order list; prices are hidden from site users by default.
    const site = await getOrder(s.site, s.order.id);
    expect(site.lines[0]).toMatchObject({ poNumbers: [poNo], vendorNames: ['Coastal Steel'], vendorEta: '2026-10-20', unitCost: null });

    // Same PO number with a different vendor is refused.
    await expect(
      assignPo(s.buyer, s.order.id, { poNumber: poNo, vendorName: 'Someone Else', lines: [{ lineId: s.l3.id, qty: 40 }] }),
    ).rejects.toThrow(/already used for Coastal Steel/);

    // Edit and remove PO lines.
    const pl = po.lines.find((l) => l.id === s.l1.id)!.pos[0]!;
    po = await updatePoLine(s.buyer, pl.poLineId, { vendorEta: '2026-10-25' });
    expect(po.lines.find((l) => l.id === s.l1.id)!.pos[0]!.vendorEta).toBe('2026-10-25');
    po = await removePoLine(s.buyer, pl.poLineId);
    expect(po.lines.find((l) => l.id === s.l1.id)?.status).toBe('SENT_FOR_RFQ');
  });

  it('yard and site users cannot change POs', async () => {
    const s = await setup();
    await expect(markRfq(s.site, s.order.id, [s.l1.id], true)).rejects.toThrow(/access/);
    await expect(assignPo(s.yard, s.order.id, { poNumber: 'X', vendorName: 'Y', lines: [{ lineId: s.l1.id, qty: 1 }] })).rejects.toThrow(/access/);
  });
});

describe('custom columns', () => {
  it('procurement adds columns; the site only sees shared ones', async () => {
    const s = await setup();
    const priv = await createCustomColumn(s.buyer, s.a.id, { name: 'Quote ref', dataType: 'TEXT', sharedWithSite: false });
    const pub = await createCustomColumn(s.buyer, s.a.id, { name: 'Expected', dataType: 'DATE', sharedWithSite: true });
    await setCustomValue(s.buyer, s.l1.id, priv.id, 'Q-778');
    await setCustomValue(s.buyer, s.l1.id, pub.id, '2026-11-01');
    await expect(setCustomValue(s.buyer, s.l1.id, pub.id, 'next week')).rejects.toThrow(/date/);

    const proc = await getProcurementOrder(s.buyer, s.order.id);
    expect(proc.lines[0]!.custom).toEqual({ [priv.id]: 'Q-778', [pub.id]: '2026-11-01' });
    const site = await getOrder(s.site, s.order.id);
    expect(site.customColumns.map((c) => c.name)).toEqual(['Expected']);
    expect(site.lines[0]!.custom).toEqual({ [pub.id]: '2026-11-01' });

    await setCustomValue(s.buyer, s.l1.id, priv.id, '');
    expect((await getProcurementOrder(s.buyer, s.order.id)).lines[0]!.custom[priv.id]).toBeUndefined();
    await expect(createCustomColumn(s.site, s.a.id, { name: 'Nope', dataType: 'TEXT', sharedWithSite: true })).rejects.toThrow(/access/);
  });
});

describe('incoming list and yard receiving', () => {
  async function onOrder() {
    const s = await setup();
    const yardId = s.yardSite.id;
    const poNo = `PO-${uid()}`;
    await assignPo(s.buyer, s.order.id, {
      poNumber: poNo,
      vendorName: 'Coastal Steel',
      vendorEta: '2026-10-20',
      yardId,
      lines: [
        { lineId: s.l1.id, qty: 10 },
        { lineId: s.l2.id, qty: 5 },
      ],
    });
    return { ...s, yardId, poNo };
  }

  it('lists what is coming to the yard, by ETA', async () => {
    const s = await onOrder();
    const inc = (await incomingShipments(s.yard, s.yardId)).filter((i) => i.poNumber === s.poNo);
    expect(inc.map((i) => [i.lineNo, i.qtyRemaining, i.vendorEta])).toEqual([
      [1, 10, '2026-10-20'],
      [2, 5, '2026-10-20'],
    ]);
  });

  it('finds deliveries by PO number or order number', async () => {
    const s = await onOrder();
    const byPo = await lookupForReceiving(s.yard, s.poNo.toLowerCase());
    expect(byPo).toMatchObject({ kind: 'PO', vendorName: 'Coastal Steel', defaultYardId: s.yardId });
    expect(byPo.lines).toHaveLength(2);
    for (const q of ['JOB#2249 LIST#1', 'job 2249 list 1', '2249-1']) {
      const byOrder = await lookupForReceiving(s.yard, q);
      expect(byOrder.kind).toBe('ORDER');
      expect(byOrder.orderId).toBe(s.order.id);
    }
    await expect(lookupForReceiving(s.yard, 'PO-DOES-NOT-EXIST')).rejects.toThrow(/not found/);
  });

  it('partial delivery: 5 ordered, 4 received → still on order, 4 in the yard, procurement told', async () => {
    const s = await onOrder();
    const look = await lookupForReceiving(s.yard, s.poNo);
    const l2 = look.lines.find((l) => l.lineNo === 2)!;
    const l1 = look.lines.find((l) => l.lineNo === 1)!;
    const r = await createReceipt(s.yard, {
      yardId: s.yardId,
      purchaseOrderId: look.purchaseOrderId,
      notes: 'Driver was late',
      lines: [
        { poLineId: l1.poLineId, qtyReceived: 10, problem: false },
        { poLineId: l2.poLineId, qtyReceived: 4, problem: true, problemNote: 'one roll damaged' },
      ],
    });
    expect(r.problems).toBe(1);
    const order = await getOrder(s.site, s.order.id);
    expect(order.lines.map((l) => l.status)).toEqual(['RECEIVED_AT_YARD', 'ON_ORDER', 'SUBMITTED']);

    const inv = (await yardInventory(s.yard, s.yardId)).filter((i) => i.orderId === s.order.id);
    expect(inv.map((i) => [i.lineNo, i.qtyAvailable, i.source, i.poNumber])).toEqual(
      expect.arrayContaining([
        [1, 10, 'PO_RECEIPT', s.poNo],
        [2, 4, 'PO_RECEIPT', s.poNo],
      ]),
    );
    // Only 1 still to come.
    const inc = (await incomingShipments(s.yard)).filter((i) => i.poNumber === s.poNo);
    expect(inc.map((i) => [i.lineNo, i.qtyRemaining])).toEqual([[2, 1]]);

    const mail = await db.emailOutbox.findFirst({ where: { relatedType: 'yard_problem', relatedId: r.id } });
    expect(mail?.bodyText).toMatch(/PROBLEM .* got 4 of 5 ROLL – one roll damaged/);
    const notes = await db.notification.count({ where: { type: 'yard_problem', link: { contains: r.id } } });
    expect(notes).toBeGreaterThan(0);

    const detail = await getReceipt(s.buyer, r.id);
    expect(detail).toMatchObject({ problemCount: 1, notes: 'Driver was late' });

    // The rest arrives later.
    await createReceipt(s.yard, { yardId: s.yardId, lines: [{ poLineId: l2.poLineId, qtyReceived: 1, problem: false }] });
    expect((await getOrder(s.site, s.order.id)).lines[1]!.status).toBe('RECEIVED_AT_YARD');
    expect((await siteInventory(s.site, s.jobA.id)).find((x) => x.lineNo === 2)?.poNumbers.map((p) => p.poNumber)).toEqual([s.poNo]);
  });

  it('cannot remove a PO line once something was received against it', async () => {
    const s = await onOrder();
    const look = await lookupForReceiving(s.yard, s.poNo);
    await createReceipt(s.yard, { yardId: s.yardId, lines: [{ poLineId: look.lines[0]!.poLineId, qtyReceived: 3, problem: false }] });
    await expect(removePoLine(s.buyer, look.lines[0]!.poLineId)).rejects.toThrow(/already been received/);
  });

  it('site users cannot receive at the yard', async () => {
    const s = await onOrder();
    await expect(lookupForReceiving(s.site, s.poNo)).rejects.toThrow(/access/);
  });
});
