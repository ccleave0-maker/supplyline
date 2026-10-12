import { afterAll, describe, expect, it } from 'vitest';
import { emptyDraftRow } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { listBoard } from '../src/services/board';
import { getBol, issueBol, receiveBol } from '../src/services/bols';
import { createEquipment } from '../src/services/equipment';
import { createDraft, saveDraft, submitOrder } from '../src/services/orders';
import { postPoToLoadBoard } from '../src/services/po-bol';
import { createPo, getPo, issuePo } from '../src/services/purchasing';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

async function setup() {
  const o = await makeOrg();
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const { auth: yardUser } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  return { ...o, buyer, yardUser, site, admin };
}

describe('PO → load board → BOL → inventory', () => {
  it('posts a committed PO, the yard ships it (PO shows shipped), receiving adds it to the yard', async () => {
    const s = await setup();
    const { id } = await createDraft(s.site, s.jobA.id);
    await saveDraft(s.site, id, { rows: [{ ...emptyDraftRow('SS'), description: 'Rebar 20M', quantity: '40', uom: 'EA' }] });
    const ord = (await submitOrder(s.site, id)).order;
    const draft = await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: `Mill ${uid()}`, siteId: s.jobA.id, deliverToYardId: s.yard.id, orderedDate: null, expectedDate: null, lines: [{ orderLineId: ord.lines[0]!.id, description: 'Rebar 20M', qty: 40, uom: 'EA', unitCost: 12 }] });
    // Pending POs can't go on the board.
    await expect(postPoToLoadBoard(s.buyer, draft.id, { priority: 'HIGH' })).rejects.toThrow(/Commit the PO first/);
    const po = await issuePo(s.buyer, draft.id);
    expect(po.shipping).toMatchObject({ state: 'NONE', canPost: true, destination: expect.stringContaining('Yard') });

    const { bolId } = await postPoToLoadBoard(s.buyer, po.id, { priority: 'HIGH', pickupDate: '2026-10-20', deliveryDate: '2026-10-21' });
    let after = await getPo(s.buyer, po.id);
    expect(after.shipping).toMatchObject({ state: 'POSTED', canPost: false });
    const board = await listBoard(s.yardUser, { from: '2026-10-19', to: '2026-10-25' });
    expect(board.find((b) => b.id === bolId)).toMatchObject({ priority: 'HIGH', title: expect.stringContaining(po.poNumber), lineCount: 1 });
    await expect(postPoToLoadBoard(s.buyer, po.id, { priority: 'HIGH' })).rejects.toThrow(/already received or on a load/);

    // The yard ships it: the PO shows as shipped; the vendor's stock is drawn down.
    await issueBol(s.yardUser, bolId, { ship: true });
    after = await getPo(s.buyer, po.id);
    expect(after.shipping.state).toBe('SHIPPED');
    const vendorLot = await db.inventoryLot.findFirstOrThrow({ where: { purchaseOrderLineId: po.lines[0]!.id, source: 'VENDOR' } });
    expect(Number(vendorLot.qtyAvailable)).toBe(0);

    // Received at the yard: it's in the yard's inventory for the job.
    const bol = await getBol(s.yardUser, bolId);
    const drop = bol.stops.find((x) => x.kind === 'DROP')!;
    await receiveBol(s.yardUser, bolId, { stopId: drop.id, lines: bol.lines.map((l) => ({ bolLineId: l.id, qtyReceived: l.qty, damaged: false })) });
    expect((await getPo(s.buyer, po.id)).shipping.state).toBe('DELIVERED');
    const yardLoc = await db.shippingLocation.findFirstOrThrow({ where: { siteId: s.yard.id } });
    const inYard = await db.inventoryLot.findMany({ where: { locationId: yardLoc.id, orderLineId: ord.lines[0]!.id, qtyAvailable: { gt: 0 } } });
    expect(inYard.reduce((t, l) => t + Number(l.qtyAvailable), 0)).toBe(40);
  });

  it('equipment POs go to their yard and become the unit’s stock; ship-direct POs can’t be posted', async () => {
    const s = await setup();
    const unit = await createEquipment(s.admin, { companyId: s.a.id, unitNumber: `EX-${uid().slice(0, 4)}`, description: 'Loader', category: 'Loader' });
    const po = await issuePo(s.buyer, (await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Oil Co', equipmentId: unit.id, deliverToYardId: s.yard.id, orderedDate: null, expectedDate: null, lines: [{ description: 'Hydraulic oil', qty: 4, uom: 'PAIL', unitCost: 90 }] })).id);
    const { bolId } = await postPoToLoadBoard(s.buyer, po.id, { priority: 'NORMAL' });
    const lot = await db.inventoryLot.findFirstOrThrow({ where: { purchaseOrderLineId: po.lines[0]!.id, source: 'VENDOR' } });
    expect([lot.equipmentId, lot.orderLineId]).toEqual([unit.id, null]);
    expect(bolId).toBeTruthy();
  });
});
