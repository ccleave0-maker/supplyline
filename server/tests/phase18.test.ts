import { afterAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { emptyDraftRow, type InvoiceScanResult } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { setClaudeForTests } from '../src/integrations/claude';
import { saveAiSettings } from '../src/services/ai';
import { getApInvoice, invoicePack, receiveInvoice } from '../src/services/ap';
import { availableLots, createBol, issueBol } from '../src/services/bols';
import { createEquipment } from '../src/services/equipment';
import { readFileAsset } from '../src/services/files';
import { jobMaterials, listEquipmentNeeds, saveEquipmentNeed, setEquipmentPriority } from '../src/services/planning';
import { createDraft, saveDraft, submitOrder } from '../src/services/orders';
import { createPo, issuePo } from '../src/services/purchasing';
import { createReceipt, saveStockCheck } from '../src/services/yard';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

async function setup() {
  const o = await makeOrg();
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const { auth: yardUser } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  return { ...o, admin, buyer, yardUser, site };
}

describe('equipment stock', () => {
  it('oil bought on an equipment PO becomes the unit’s stock in the yard and ships on a BOL', async () => {
    const s = await setup();
    const unit = await createEquipment(s.admin, { companyId: s.a.id, unitNumber: `EX-${uid().slice(0, 4)}`, description: '320 excavator', category: 'Excavator' });
    const po = await issuePo(s.buyer, (await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Oil Co', equipmentId: unit.id, deliverToYardId: s.yard.id, lines: [{ description: 'Hydraulic oil 20L', qty: 6, uom: 'PAIL', unitCost: 90 }] })).id);
    const poLine = (await db.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id } })).id;
    await createReceipt(s.yardUser, { yardId: s.yard.id, purchaseOrderId: po.id, lines: [{ poLineId: poLine, qtyReceived: 6, problem: false }] });
    const yardLoc = (await db.shippingLocation.findFirstOrThrow({ where: { siteId: s.yard.id } })).id;
    const lot = (await availableLots(s.yardUser, yardLoc)).find((l) => l.description === 'Hydraulic oil 20L')!;
    expect(lot).toMatchObject({ qtyAvailable: 6, orderLabel: null, finalSiteId: null, equipmentLabel: expect.stringContaining('320 excavator') });
    const jobLoc = (await db.shippingLocation.findFirstOrThrow({ where: { siteId: s.jobA.id } })).id;
    const bol = await createBol(s.yardUser, { companyId: s.a.id, stops: [{ key: 'p', kind: 'PICKUP', locationId: yardLoc }, { key: 'd', kind: 'DROP', locationId: jobLoc }], lines: [{ lotId: lot.lotId, qty: 2, pickupKey: 'p', dropKey: 'd' }] });
    await issueBol(s.yardUser, bol.id);
    expect((await availableLots(s.yardUser, yardLoc)).find((l) => l.lotId === lot.lotId)!.qtyAvailable).toBe(4); // came out of stock
  });
});

describe('receiving reports', () => {
  it('a yard receipt makes a receiving report that shows on the invoice and is added to its PDF', async () => {
    const s = await setup();
    const po = await issuePo(s.buyer, (await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Coastal Steel', siteId: s.jobA.id, deliverToYardId: s.yard.id, lines: [{ description: 'Pile', qty: 10, uom: 'EA', unitCost: 100 }] })).id);
    const poLine = (await db.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id } })).id;
    const r = await createReceipt(s.yardUser, { yardId: s.yard.id, purchaseOrderId: po.id, lines: [{ poLineId: poLine, qtyReceived: 8, problem: true, problemNote: '2 bent' }] });
    const receipt = await db.yardReceipt.findUniqueOrThrow({ where: { id: r.id } });
    expect(receipt.reportFileId).toBeTruthy();
    const pdf = await readFileAsset(receipt.reportFileId!);
    expect(pdf!.file.mimeType).toBe('application/pdf');

    // The vendor's invoice for that PO: the report shows, and the "with reports" PDF has its pages.
    await saveAiSettings(s.admin, { enabled: true, model: 'claude-sonnet-5-5', apiKey: 'sk-ant-api03-test-key-abcdefghijklmnopqrstuvwxyz1234', monthlyCapCad: null, usdToCad: 1.37, priceInputUsdPerM: 3, priceOutputUsdPerM: 15, sttProvider: 'none' });
    const read: InvoiceScanResult = { documentType: 'INVOICE', refInvoiceNumber: null, vendorName: 'Coastal Steel', invoiceNumber: `INV-${uid()}`, invoiceDate: '2026-10-12', dueDate: null, poNumber: po.poNumber, subtotal: 800, gst: 40, pst: 56, total: 896, lines: [] };
    setClaudeForTests(async () => ({ input: read, inputTokens: 1, outputTokens: 1 }));
    const invPdf = await PDFDocument.create();
    invPdf.addPage([612, 792]);
    const inv = await receiveInvoice(s.admin, s.a.id, new File([Buffer.from(await invPdf.save())], 'inv.pdf', { type: 'application/pdf' }));
    setClaudeForTests(null);
    const d = await getApInvoice(s.admin, inv.id);
    expect(d.receivingReports).toHaveLength(1);
    expect(d.receivingReports[0]!.label).toMatch(/Received at Shared Yard/);
    const pack = await invoicePack(s.admin, inv.id);
    const merged = await PDFDocument.load(pack.bytes);
    expect(merged.getPageCount()).toBeGreaterThanOrEqual(2); // invoice page + report
  });
});

describe('inventory by job and equipment planning', () => {
  it('shows where each line is: in the yard, on the way, received', async () => {
    const s = await setup();
    const { id } = await createDraft(s.site, s.jobA.id);
    await saveDraft(s.site, id, { rows: [{ ...emptyDraftRow('SS'), description: 'Rebar', quantity: '10', uom: 'EA' }, { ...emptyDraftRow('SS'), description: 'Tie wire', quantity: '5', uom: 'ROLL' }] });
    const ord = (await submitOrder(s.site, id)).order;
    await saveStockCheck(s.yardUser, ord.id, { yardId: s.yard.id, lines: [{ lineId: ord.lines[0]!.id, qtyAvailable: 10 }, { lineId: ord.lines[1]!.id, qtyAvailable: 0 }] });
    const [job] = await jobMaterials(s.site, { siteId: s.jobA.id });
    expect(job!.rows.map((r) => [r.description, r.outstanding, r.inYard])).toEqual([
      ['Rebar', 0, 10],
      ['Tie wire', 5, 0],
    ]);
    expect(job!.totals).toMatchObject({ lines: 2, complete: 0 });
  });

  it('cross-references the fleet and flags jobs that want the same unit; priority decides who goes first', async () => {
    const s = await setup();
    const e1 = await createEquipment(s.admin, { companyId: s.a.id, unitNumber: `EX-${uid().slice(0, 4)}`, description: '320 excavator', category: 'Excavator' });
    const jobB2 = await db.site.create({ data: { organizationId: s.org.id, companyId: s.a.id, type: 'JOB', jobNumber: '2251', name: 'Job A3' } });
    const need = (siteId: string, equipmentId: string | null) => saveEquipmentNeed(s.admin, null, { siteId, description: 'Excavator', category: 'Excavator', qty: 1, fromDate: '2026-11-01', toDate: '2026-11-20', equipmentId, coverage: 'NEEDED' });
    const n1 = await need(s.jobA.id, null);
    let list = await listEquipmentNeeds(s.admin, {});
    expect(list.find((x) => x.id === n1.id)).toMatchObject({ status: 'CAN_COVER', freeUnits: [expect.objectContaining({ id: e1.id })] });

    await need(s.jobA.id, e1.id).then(() => db.jobEquipmentNeed.delete({ where: { id: n1.id } }));
    const n3 = await need(jobB2.id, e1.id);
    await setEquipmentPriority(s.admin, jobB2.id, 1);
    list = await listEquipmentNeeds(s.admin, {});
    const mine = list.find((x) => x.siteId === s.jobA.id)!;
    expect(mine.status).toBe('CONFLICT');
    expect(mine.advice).toMatch(/JOB#2251 Job A3 goes first \(priority 1\)/);
    expect(list.find((x) => x.id === n3.id)!.advice).toMatch(/This job goes first/);
    await expect(saveEquipmentNeed(s.site, null, { siteId: s.jobA.id, description: 'Loader', qty: 1, fromDate: '2026-11-01', toDate: '2026-11-02', coverage: 'NEEDED' })).rejects.toThrow(/access/i);
    await expect(setEquipmentPriority(s.buyer, jobB2.id, 2)).rejects.toThrow(/access/i);
  });
});
