import { afterAll, describe, expect, it } from 'vitest';
import { emptyDraftRow } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { createContact } from '../src/services/contacts';
import { createLocation, shipToOptions } from '../src/services/locations';
import { rowsFromSheet, importOrderSheet } from '../src/services/order-import';
import { createDraft, getOrder, saveDraft, submitOrder } from '../src/services/orders';
import { createPo, getPo, getPoPdf, issuePo } from '../src/services/purchasing';
import { getBol } from '../src/services/bols';
import { listShipVia, saveShipVia } from '../src/services/ship-via';
import { updateSite } from '../src/services/sites';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

async function setup() {
  const o = await makeOrg();
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const { auth: pm, user: pmUser } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: foreman } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  await updateSite(admin, o.jobA.id, { projectManagerId: pmUser.id });
  return { ...o, admin, buyer, pm, foreman };
}

describe('PO: ship via, ship to, contacts, ship direct', () => {
  it('carries the carrier + account, ship-to and contacts (with phone and email) onto the PO', async () => {
    const s = await setup();
    const via = await saveShipVia(s.buyer, null, { name: 'Island Freight', accountNumber: 'ACCT-7781', phone: '250-555-0100' });
    expect((await listShipVia(s.buyer, { companyId: s.a.id })).map((v) => v.name)).toEqual(['Island Freight']);
    await expect(saveShipVia(s.foreman, null, { name: 'X' })).rejects.toThrow(/permission|access/i);

    const laydown = await createLocation(s.admin, { businessName: 'Laydown 3 – north gate', address: '12 Gate Rd', forSiteId: s.jobA.id });
    const opts = await shipToOptions(s.buyer, s.jobA.id);
    expect(opts[0]!.siteId).toBe(s.jobA.id); // the job first, then its ship-tos, then yards
    expect(opts[1]!.id).toBe(laydown.id);

    const super1 = await createContact(s.admin, { type: 'PERSON', name: 'Sam Super', cell: '250-555-0111', email: 'sam@example.com' });
    const super2 = await createContact(s.admin, { type: 'PERSON', name: 'Fay Foreman', phone: '250-555-0122' });
    const rep = await createContact(s.admin, { type: 'VENDOR', name: 'Vic Sales', businessName: 'Coastal Steel', email: 'vic@coastal.example' });
    const po = await createPo(s.buyer, {
      companyId: s.a.id,
      poNumber: `P-${uid()}`,
      vendorName: 'Coastal Steel',
      siteId: s.jobA.id,
      shipViaId: via.id,
      shipToLocationId: laydown.id,
      siteContact1Id: super1.id,
      siteContact2Id: super2.id,
      supplierContactId: rep.id,
      lines: [{ description: 'Pile', qty: 2, uom: 'EA', unitCost: 10 }],
    });
    expect(po.shipVia).toMatchObject({ name: 'Island Freight', accountNumber: 'ACCT-7781' });
    expect(po.shipTo).toMatchObject({ name: 'Laydown 3 – north gate', address: '12 Gate Rd' });
    expect(po.contacts.map((c) => [c.role, c.name, c.phone, c.email])).toEqual([
      ['SITE_1', 'Sam Super', '250-555-0111', 'sam@example.com'],
      ['SITE_2', 'Fay Foreman', '250-555-0122', null],
      ['SUPPLIER', 'Vic Sales', null, 'vic@coastal.example'],
    ]);
    const pdf = await getPoPdf(s.buyer, po.id, false);
    expect(pdf.bytes.length).toBeGreaterThan(1000);
  });

  it('ship direct: issuing the PO makes a BOL from the vendor to the job with the ETA, and the site can receive it', async () => {
    const s = await setup();
    const po = await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Coastal Steel', siteId: s.jobA.id, shipDirect: true, orderedDate: '2026-10-13', expectedDate: '2026-10-20', lines: [{ description: 'Culvert 600mm', qty: 4, uom: 'EA', unitCost: 300 }] });
    const issued = await issuePo(s.buyer, po.id);
    const d = await getPo(s.buyer, issued.id);
    expect(d.shipDirect).toBe(true);
    expect(d.directBolId).toBeTruthy();
    const bol = await getBol(s.foreman, d.directBolId!);
    expect(bol.status).toBe('ISSUED');
    expect(bol.shippedAt).toBeTruthy();
    expect(bol.stops.map((x) => [x.kind, x.plannedDate])).toEqual([
      ['PICKUP', '2026-10-13'],
      ['DROP', '2026-10-20'],
    ]);
    expect(bol.lines.map((l) => [l.description, l.qty])).toEqual([['Culvert 600mm', 4]]);
    expect(bol.stops[1]!.canReceive).toBe(true);
    await expect(createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'X', equipmentId: null, siteId: null, shipDirect: true, lines: [{ description: 'x', qty: 1, uom: 'EA' }] })).rejects.toThrow();
  });
});

describe('orders: off-list buys, PO links for the PM, importing your own lists', () => {
  it('an off-list buy joins the job’s latest order list with its reason; the PM can open each line’s PO', async () => {
    const s = await setup();
    const { id } = await createDraft(s.foreman, s.jobA.id);
    await saveDraft(s.foreman, id, { rows: [{ ...emptyDraftRow('FF'), description: 'Rebar', quantity: '10', uom: 'EA' }] });
    const list = (await submitOrder(s.foreman, id)).order;
    const po = await issuePo(s.buyer, (await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Coastal Steel', siteId: s.jobA.id, lines: [{ description: 'Extra tie wire', qty: 3, uom: 'ROLL', unitCost: 5, offListReason: 'Super called — ran short on the deck pour' }] })).id);
    const after = await getOrder(s.pm, list.id);
    expect(after.lines.map((l) => [l.lineNo, l.description])).toEqual([
      [1, 'Rebar'],
      [2, 'Extra tie wire'],
    ]);
    expect(after.lines[1]!.offListReason).toBe('Super called — ran short on the deck pour');
    expect(after.lines[1]!.poLinks).toEqual([{ id: po.id, poNumber: po.poNumber }]); // the PM sees the PO link
    expect((await getOrder(s.foreman, list.id)).lines[1]!.poLinks).toBeNull(); // others don't
    expect((await getPo(s.pm, po.id)).poNumber).toBe(po.poNumber);
  });

  it('reads order lists in any layout: header anywhere, titles and totals skipped, "10 ea" split', () => {
    const sheet = [
      ['ACME CONSTRUCTION — ORDER LIST'],
      ['Job:', '2249 Bridge'],
      [],
      ['Item #', 'Description', 'Qty', 'Cost Code', "Req'd"],
      ['HP310', 'H-pile 310x110', '12 ea', '300', '10/20/2026'],
      ['', 'Splice plate', '24', '310', ''],
      ['', 'TOTAL', '36', '', ''],
    ];
    const r = rowsFromSheet(sheet, 'JS');
    expect(r.header).toBe(true);
    expect(r.rows).toEqual([
      { description: 'H-pile 310x110 — Part# HP310', quantity: '12', uom: 'EA', costCode: '300', orderedByInitials: 'JS', requiredOnSite: '2026-10-20' },
      { description: 'Splice plate', quantity: '24', uom: '', costCode: '310', orderedByInitials: 'JS', requiredOnSite: '' },
    ]);
    const loose = rowsFromSheet([['Gravel 3/4" clear', '40', 'T'], ['Geotextile fabric roll', '6 rolls']], 'JS');
    expect(loose.header).toBe(false);
    expect(loose.rows.map((x) => [x.description, x.quantity, x.uom])).toEqual([
      ['Gravel 3/4" clear', '40', 'T'],
      ['Geotextile fabric roll', '6', 'ROLLS'],
    ]);
  });

  it('imports a CSV order list for a job you are on', async () => {
    const s = await setup();
    const csv = new File(['Description,Quantity,Unit\nRebar 20M,10,EA\nTie wire,5,ROLL\n'], 'my-list.csv', { type: 'text/csv' });
    const r = await importOrderSheet(s.foreman, s.jobA.id, csv);
    expect(r.how).toBe('columns');
    expect(r.rows.map((x) => [x.description, x.quantity, x.uom])).toEqual([
      ['Rebar 20M', '10', 'EA'],
      ['Tie wire', '5', 'ROLL'],
    ]);
    await expect(importOrderSheet(s.foreman, s.jobB.id, csv)).rejects.toThrow(/not found/i);
  });
});
