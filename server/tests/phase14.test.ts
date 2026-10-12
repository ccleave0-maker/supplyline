import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { createBol, getBol, issueBol } from '../src/services/bols';
import { pickUpAtVendor, poForBol, posForBol } from '../src/services/po-bol';
import { createPo, issuePo } from '../src/services/purchasing';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

describe('BOL from a purchase order', () => {
  it('picks a PO up at the vendor when it has not come into the yard, and ships it to the job', async () => {
    const o = await makeOrg();
    const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
    const { auth: yard } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
    const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
    const po = await issuePo(
      buyer,
      (await createPo(buyer, { companyId: o.a.id, poNumber: `P-${uid()}`, vendorName: 'Coastal Steel', siteId: o.jobA.id, deliverToYardId: o.yard.id, lines: [{ description: 'Pipe pile 324mm', qty: 10, uom: 'EA', unitCost: 100 }] })).id,
    );
    expect((await posForBol(yard, o.a.id)).map((p) => p.poNumber)).toContain(po.poNumber);
    await expect(posForBol(site, o.a.id)).rejects.toThrow(/permission|access/i);

    let view = await poForBol(yard, po.id);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]).toMatchObject({ ordered: 10, inYards: [], atVendor: [], canPickUpAtVendor: 10, linkedToOrderList: true });
    expect(view.vendorLocationId).toBeNull();

    await expect(pickUpAtVendor(yard, po.id, [{ poLineId: view.lines[0]!.poLineId, qty: 11 }])).rejects.toThrow(/Only 10 EA/);
    const r = await pickUpAtVendor(yard, po.id, [{ poLineId: view.lines[0]!.poLineId, qty: 6 }]);
    view = await poForBol(yard, po.id);
    expect(view.vendorLocationId).toBe(r.locationId);
    expect(view.lines[0]).toMatchObject({ canPickUpAtVendor: 4, atVendor: [{ lotId: r.lots[0]!.lotId, qtyAvailable: 6, locationName: 'Coastal Steel' }] });

    // The vendor is a pickup stop; the job is the drop.
    const jobLoc = (await db.shippingLocation.findFirstOrThrow({ where: { siteId: o.jobA.id } })).id;
    const bol = await createBol(yard, {
      companyId: o.a.id,
      stops: [
        { key: 'p', kind: 'PICKUP', locationId: r.locationId, plannedDate: '2026-11-03' },
        { key: 'd', kind: 'DROP', locationId: jobLoc, plannedDate: '2026-11-03' },
      ],
      lines: [{ lotId: r.lots[0]!.lotId, qty: 6, pickupKey: 'p', dropKey: 'd' }],
    });
    expect(bol.lines[0]).toMatchObject({ poNumber: po.poNumber, qty: 6 });
    const issued = await issueBol(yard, bol.id);
    expect(issued.status).toBe('ISSUED');
    expect((await getBol(site, bol.id)).route).toMatch(/Coastal Steel →/);
    const line = await db.orderLine.findFirstOrThrow({ where: { poLines: { some: { purchaseOrderId: po.id } } } });
    expect(line.status).toBe('SHIPPED_PARTIAL');
  });
});

describe('billing backup documents', () => {
  it('attaches backup documents to a customer invoice, files them to the chosen network folder, and sends them along', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { DEFAULT_FILING } = await import('@supplyline/core/models');
    const { saveFilingSettings, listFilingJobs } = await import('../src/services/filing');
    const { addArBackup, removeArBackup, saveArInvoice, saveCustomer, sendArInvoice } = await import('../src/services/accounting');
    const o = await makeOrg();
    const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
    const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
    const root = mkdtempSync(path.join(tmpdir(), 'sl-ar-'));
    await saveFilingSettings(admin, o.a.id, { ...DEFAULT_FILING, enabled: true, root, types: ['AR_BACKUP'], folders: { ...DEFAULT_FILING.folders, AR_BACKUP: '{company}\\Billing backup\\{invoice}' } });
    const { id: customerId } = await saveCustomer(admin, null, { companyId: o.a.id, name: 'City of Example', email: 'ap@city.example.com', termsDays: 30 });
    const number = `A-${uid()}`;
    const inv = await saveArInvoice(admin, null, { companyId: o.a.id, customerId, siteId: o.jobA.id, invoiceNumber: number, invoiceDate: '2026-10-12', dueDate: '2026-11-12', gstRate: 0.05, pstRate: 0, lines: [{ description: 'Progress 1', qty: 1, uom: 'LS', unitPrice: 1000 }] });
    expect(inv.backupFolder).toBe(path.join(root, 'AAA', 'Billing backup', number));

    const ticket = new File([new Uint8Array([37, 80, 68, 70, 1])], 'ticket-1042.pdf', { type: 'application/pdf' });
    await expect(addArBackup(site, inv.id, ticket)).rejects.toThrow(/permission|access/i);
    let d = await addArBackup(admin, inv.id, ticket);
    d = await addArBackup(admin, inv.id, new File([new Uint8Array([1, 2])], 'timesheet.jpg', { type: 'image/jpeg' }));
    expect(d.backups.map((b) => b.fileName)).toEqual(['ticket-1042.pdf', 'timesheet.jpg']);
    expect((await listFilingJobs(admin, 'pending')).map((j) => j.relativePath).sort()).toEqual([`AAA/Billing backup/${number}/ticket-1042.pdf`, `AAA/Billing backup/${number}/timesheet.jpg`]);

    d = await removeArBackup(admin, inv.id, d.backups[1]!.id);
    expect(d.backups).toHaveLength(1);
    await sendArInvoice(admin, inv.id, { email: true });
    const mail = await db.emailOutbox.findFirstOrThrow({ where: { relatedId: inv.id } });
    expect(mail.attachmentFileIds).toHaveLength(2); // the invoice + the remaining backup document
  });
});
