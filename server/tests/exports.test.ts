import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { parseQr, qrPayload } from '@supplyline/core/domain';
import { db } from '../src/lib/db';
import { createEquipment, equipmentTagsPdf } from '../src/services/equipment';
import { exportTable } from '../src/services/exports';
import { createPo, issuePo } from '../src/services/purchasing';
import { scanAnything } from '../src/services/scan';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

async function photoOf(text: string) {
  const qr = await QRCode.toBuffer(text, { type: 'png', margin: 1, width: 300 });
  const img = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: '#f4f4f0' } }).composite([{ input: qr, left: 820, top: 100 }]).jpeg().toBuffer();
  return new File([new Uint8Array(img)], 'photo.jpg', { type: 'image/jpeg' });
}

describe('printing and scanning', () => {
  it('exports any list to Excel and PDF', async () => {
    const o = await makeOrg();
    const { auth } = await makeUser(o.org.id, ['ADMIN'], null);
    const input = {
      title: 'Site inventory',
      subtitle: 'JOB#2249',
      companyId: o.a.id,
      columns: [
        { key: 'd', label: 'Description' },
        { key: 'q', label: 'Qty', align: 'right' as const },
      ],
      rows: [
        { d: 'Rebar', q: 10 },
        { d: 'Tie wire', q: null },
      ],
    };
    const x = await exportTable(auth, { ...input, format: 'xlsx' });
    expect(x.fileName).toMatch(/^Site-inventory-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.bytes.buffer as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const cells: unknown[] = [];
    ws.eachRow((r) => cells.push(r.getCell(1).value));
    expect(cells).toEqual(['Site inventory', 'Alpha Co · JOB#2249', 'Description', 'Rebar', 'Tie wire']);
    const p = await exportTable(auth, { ...input, format: 'pdf' });
    expect(Buffer.from(p.bytes.slice(0, 4)).toString()).toBe('%PDF');
  });

  it('QR codes: one Scan button opens POs, equipment and BOLs', async () => {
    const o = await makeOrg();
    const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
    const { auth: yard } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
    expect(parseQr(qrPayload({ kind: 'PO', id: 'abc', label: 'PO 1042' }))).toEqual({ kind: 'PO', id: 'abc', label: 'PO 1042' });
    expect(parseQr('SUPPLYLINE-BOL:xyz:12')).toEqual({ kind: 'BOL', id: 'xyz', label: 'BOL #12' });

    const po = await issuePo(
      buyer,
      (await createPo(buyer, { companyId: o.a.id, poNumber: `Q-${uid()}`, vendorName: 'V', siteId: o.jobA.id, deliverToYardId: o.yard.id, lines: [{ description: 'X', qty: 1, uom: 'EA', unitCost: 5 }] })).id,
    );
    const atYard = await scanAnything(yard, await photoOf(qrPayload({ kind: 'PO', id: po.id, label: `PO ${po.poNumber}` })));
    expect(atYard.target).toEqual({ kind: 'PO', id: po.id, label: `PO ${po.poNumber}`, link: `/yard/receive/?q=${encodeURIComponent(po.poNumber)}` });
    const forBuyer = await scanAnything(buyer, await photoOf(qrPayload({ kind: 'PO', id: po.id, label: 'x' })));
    expect(forBuyer.target?.link).toBe(`/purchase-orders/view/?id=${po.id}`);

    const { id: unit } = await createEquipment(yard, { companyId: o.a.id, unitNumber: 'EX-1', description: 'Excavator' });
    const tagScan = await scanAnything(yard, await photoOf(qrPayload({ kind: 'EQUIPMENT', id: unit, label: 'Unit EX-1' })));
    expect(tagScan.target?.link).toBe(`/equipment/view/?id=${unit}`);
    const tags = await equipmentTagsPdf(yard, [unit]);
    expect(tags.fileName).toBe('Tag-EX-1.pdf');
    // Someone else's code isn't opened.
    const other = await makeOrg();
    const { auth: stranger } = await makeUser(other.org.id, ['YARD'], other.a.id);
    expect((await scanAnything(stranger, await photoOf(qrPayload({ kind: 'EQUIPMENT', id: unit, label: 'x' })))).target).toBeNull();
  });
});
