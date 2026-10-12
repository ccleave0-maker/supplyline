import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_PURCHASING, emptyDraftRow, type PoInput } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { createEquipment, setEquipmentPstForm } from '../src/services/equipment';
import { listOutbox, saveTemplate, sendOutbox } from '../src/services/mail';
import { createDraft, getOrder, saveDraft, siteInventory, submitOrder } from '../src/services/orders';
import { assignPo, getProcurementOrder } from '../src/services/procurement';
import {
  cancelPo,
  createPo,
  decideApproval,
  getPo,
  getPoPdf,
  issuePo,
  listPos,
  poDashboard,
  runPoFollowUps,
  savePurchasingSettings,
  suggestPoNumber,
  updatePo,
  setPoEta,
} from '../src/services/purchasing';
import { todayLocal } from '../src/services/project';
import { setSitePstForm, updateSite } from '../src/services/sites';
import { createReceipt, incomingShipments, lookupForReceiving } from '../src/services/yard';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], 'exemption.pdf', { type: 'application/pdf' });

async function setup(settings: Partial<typeof DEFAULT_PURCHASING> = {}) {
  const o = await makeOrg();
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const { auth: yard } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: pm, user: pmUser } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  await db.site.update({ where: { id: o.jobA.id }, data: { province: 'BC' } });
  await updateSite(admin, o.jobA.id, { projectManagerId: pmUser.id });
  await db.companyEmailRecipient.create({ data: { companyId: o.a.id, kind: 'YARD', email: `yard-${uid()}@example.com` } });
  await savePurchasingSettings(admin, o.a.id, { ...DEFAULT_PURCHASING, poPrefix: 'AAA-', poNextNumber: 5001, ...settings });
  const vendor = await db.contact.create({ data: { organizationId: o.org.id, type: 'VENDOR', name: 'Sales desk', businessName: 'Coastal Steel', email: `sales-${uid()}@example.com` } });
  const input = (over: Partial<PoInput> = {}): PoInput => ({
    companyId: o.a.id,
    poNumber: `T-${uid()}`,
    vendorName: 'Coastal Steel',
    vendorContactId: vendor.id,
    siteId: o.jobA.id,
    expectedDate: '2026-11-20',
    deliverToYardId: o.yard.id,
    emailVendor: true,
    lines: [
      { description: 'Pipe pile 324 mm', qty: 10, uom: 'EA', unitCost: 100 },
      { description: 'Splice plate', qty: 4, uom: 'EA', unitCost: 25 },
    ],
    ...over,
  });
  return { ...o, yardSite: o.yard, admin, buyer, yard, site, pm, pmUser, vendor, input };
}

describe('purchase orders', () => {
  it('suggests the next PO number and moves past numbers used', async () => {
    const s = await setup();
    expect((await suggestPoNumber(s.buyer, s.a.id)).poNumber).toBe('AAA-5001');
    await createPo(s.buyer, s.input({ poNumber: 'AAA-5001' }));
    expect((await suggestPoNumber(s.buyer, s.a.id)).poNumber).toBe('AAA-5002');
    await createPo(s.buyer, s.input({ poNumber: 'AAA-5010' }));
    expect((await suggestPoNumber(s.buyer, s.a.id)).poNumber).toBe('AAA-5011');
    await expect(createPo(s.buyer, s.input({ poNumber: 'aaa-5010' }))).rejects.toThrow(/already exists/);
    await expect(createPo(s.site, s.input())).rejects.toThrow(/access|permission/i);
  });

  it('issues a job PO: BC PST, typed lines become a list on the job, PDFs and emails go out', async () => {
    const s = await setup();
    const draft = await createPo(s.buyer, s.input());
    expect(draft.status).toBe('DRAFT');
    expect(draft.totals).toEqual({ subtotal: 1100, gst: 55, pst: 77, hst: 0, total: 1232 });
    const po = await issuePo(s.buyer, draft.id);
    expect(po.status).toBe('ISSUED');
    expect([po.tax.pstRate, po.orderedDate]).toEqual([0.07, todayLocal()]);
    // The typed lines are now an order list on the job, on order, on site inventory.
    expect(po.madeListId).toBeTruthy();
    const list = await getOrder(s.site, po.madeListId!);
    expect(list.lines.map((l) => [l.description, l.status])).toEqual([
      ['Pipe pile 324 mm', 'ON_ORDER'],
      ['Splice plate', 'ON_ORDER'],
    ]);
    expect((await siteInventory(s.site, s.jobA.id)).some((r) => r.description === 'Splice plate')).toBe(true);
    // Emails: priced copy to the PM, packing list to the yard, PO to the vendor held for review.
    const mails = await db.emailOutbox.findMany({ where: { relatedId: po.id }, orderBy: { createdAt: 'asc' } });
    const byKey = Object.fromEntries(mails.map((m) => [m.templateKey, m]));
    expect(byKey.PO_PRICED_INTERNAL?.to).toEqual([s.pmUser.email]);
    expect(byKey.PO_PACKING_YARD?.status).toBe('SENT');
    expect(byKey.PO_TO_VENDOR?.status).toBe('REVIEW');
    expect(byKey.PO_TO_VENDOR?.attachmentFileIds).toHaveLength(1);
    // Reviewing and sending marks the PO as sent to the vendor.
    const held = (await listOutbox(s.buyer)).find((x) => x.relatedId === po.id)!;
    expect(held.subject).toBe(`Purchase order ${po.poNumber} – Alpha Co`);
    await sendOutbox(s.buyer, held.id, { to: held.to, cc: [], subject: held.subject, body: held.body + '\n\nThanks!' });
    expect((await getPo(s.buyer, po.id)).vendorSentAt).toBeTruthy();
    // PDFs: priced for buyers; the site only gets the packing list.
    expect((await getPoPdf(s.buyer, po.id, false)).bytes.length).toBeGreaterThan(1000);
    await expect(getPoPdf(s.yard, po.id, false)).rejects.toThrow(/prices/);
    expect((await getPoPdf(s.yard, po.id, true)).fileName).toMatch(/^Packing-list-/);
  });

  it('marks PST-exempt jobs exempt and attaches the form to the vendor email', async () => {
    const s = await setup();
    await updateSite(s.admin, s.jobA.id, { pstExempt: true, pstExemptNumber: 'EX-77' });
    await setSitePstForm(s.admin, s.jobA.id, pdf());
    const po = await issuePo(s.buyer, (await createPo(s.buyer, s.input())).id);
    expect([po.tax.pstRate, po.tax.pstExempt, po.totals?.pst]).toEqual([0, true, 0]);
    const v = await db.emailOutbox.findFirstOrThrow({ where: { relatedId: po.id, templateKey: 'PO_TO_VENDOR' } });
    expect(v.attachmentFileIds).toHaveLength(2);
    expect(v.bodyText).toMatch(/PST exempt – exemption # EX-77 \(exemption form attached\)/);
  });

  it('equipment POs: no order list; the yard can still receive them', async () => {
    const s = await setup();
    const { id: unit } = await createEquipment(s.yard, { companyId: s.a.id, unitNumber: 'EX-9', description: 'Excavator', pstExempt: true });
    await setEquipmentPstForm(s.admin, unit, pdf());
    const po = await issuePo(s.buyer, (await createPo(s.buyer, s.input({ siteId: null, equipmentId: unit, lines: [{ description: 'Hydraulic hose', qty: 2, uom: 'EA', unitCost: 80 }] }))).id);
    expect([po.target, po.madeListId, po.tax.pstExempt]).toEqual(['Unit EX-9 · Excavator', null, true]);
    const incoming = (await incomingShipments(s.yard)).find((l) => l.poNumber === po.poNumber)!;
    expect([incoming.orderId, incoming.orderLabel, incoming.description]).toEqual([null, 'Unit EX-9', 'Hydraulic hose']);
    const found = await lookupForReceiving(s.yard, po.poNumber);
    await createReceipt(s.yard, { yardId: s.yardSite.id, purchaseOrderId: found.purchaseOrderId, lines: [{ poLineId: found.lines[0]!.poLineId, qtyReceived: 2, problem: false }] });
    expect((await getPo(s.buyer, po.id)).received).toBe('FULL');
  });

  it('needs approval over the limit: the PM approves, or sends it back', async () => {
    const s = await setup({ approvalLimit: 1000 });
    const draft = await createPo(s.buyer, s.input());
    let po = await issuePo(s.buyer, draft.id);
    expect(po.status).toBe('PENDING_APPROVAL');
    await expect(lookupForReceiving(s.yard, po.poNumber)).rejects.toThrow(/waiting for approval/);
    expect((await poDashboard(s.pm)).awaitingMyApproval).toBe(1);
    expect((await db.emailOutbox.findFirst({ where: { relatedId: po.id, templateKey: 'PO_APPROVAL_REQUEST' } }))?.to).toContain(s.pmUser.email);
    await expect(decideApproval(s.site, po.id, { approve: true })).rejects.toThrow();
    po = await decideApproval(s.pm, po.id, { approve: false, note: 'Get a second quote' });
    expect([po.status, po.approval.note]).toEqual(['DRAFT', 'Get a second quote']);
    po = await updatePo(s.buyer, po.id, s.input({ poNumber: po.poNumber }));
    po = await issuePo(s.buyer, po.id);
    po = await decideApproval(s.pm, po.id, { approve: true });
    expect([po.status, po.approval.approvedByName]).toEqual(['ISSUED', s.pmUser.name]);
    // Admins approve their own.
    const own = await issuePo(s.admin, (await createPo(s.buyer, s.input())).id);
    expect(own.status).toBe('ISSUED');
  });

  it('Buying: a new PO from order-list lines is issued (and held over the limit)', async () => {
    const s = await setup({ approvalLimit: 500 });
    const { id } = await createDraft(s.site, s.jobA.id);
    await saveDraft(s.site, id, { rows: [{ ...emptyDraftRow('JS'), description: 'Rebar', quantity: '10', uom: 'EA' }] });
    const order = (await submitOrder(s.site, id)).order;
    const small = `B-${uid()}`;
    await assignPo(s.buyer, order.id, { poNumber: small, vendorName: 'Coastal Steel', lines: [{ lineId: order.lines[0]!.id, qty: 4, unitCost: 10 }] });
    expect((await listPos(s.buyer, { q: small }))[0]?.status).toBe('ISSUED');
    const big = `B-${uid()}`;
    await assignPo(s.buyer, order.id, { poNumber: big, vendorName: 'Coastal Steel', lines: [{ lineId: order.lines[0]!.id, qty: 6, unitCost: 100 }] });
    const pending = (await listPos(s.buyer, { q: big }))[0]!;
    expect(pending.status).toBe('PENDING_APPROVAL');
    // Only the issued 4 count as on order until the big one is approved.
    expect((await getProcurementOrder(s.buyer, order.id)).lines[0]!.qtyToBuy).toBe(6);
    await decideApproval(s.admin, pending.id, { approve: true });
    expect((await getOrder(s.site, order.id)).lines[0]!.status).toBe('ON_ORDER');
  });

  it('cancelling a PO cancels the lines it created', async () => {
    const s = await setup();
    const po = await issuePo(s.buyer, (await createPo(s.buyer, s.input())).id);
    await cancelPo(s.buyer, po.id);
    const list = await getOrder(s.site, po.madeListId!);
    expect(list.lines.every((l) => l.status === 'CANCELLED')).toBe(true);
    expect((await getPo(s.buyer, po.id)).status).toBe('CANCELLED');
  });

  it('chase-up: at 1 PM on the ETA day, the yard and supplier are asked and the owner is told — once, and again after an ETA change', async () => {
    const s = await setup();
    const today = todayLocal();
    const po = await issuePo(s.buyer, (await createPo(s.buyer, s.input({ expectedDate: today, emailVendor: false }))).id);
    const at = (h: number) => new Date(new Date(`${today}T${String(h + 7).padStart(2, '0')}:30:00Z`).getTime()); // Vancouver (PDT) h:30
    const pending = await createPo(s.buyer, s.input({ expectedDate: today, emailVendor: false })); // Pending: stays quiet
    expect(await runPoFollowUps(at(11))).toEqual({ followUps: 0, prompts: 0 });
    await runPoFollowUps(at(13));
    const mails = await db.emailOutbox.findMany({ where: { relatedId: po.id } });
    expect(mails.find((m) => m.templateKey === 'PO_FOLLOWUP_VENDOR')?.status).toBe('REVIEW'); // no supplier email on file → held
    expect(mails.find((m) => m.templateKey === 'PO_ARRIVAL_YARD')?.status).toBe('SENT');
    expect(await db.notification.count({ where: { userId: s.buyer.userId, type: 'po_chase' } })).toBe(1);
    expect(await db.emailOutbox.count({ where: { relatedId: pending.id } })).toBe(0);
    await runPoFollowUps(at(15));
    expect(await db.emailOutbox.count({ where: { relatedId: po.id, templateKey: { in: ['PO_FOLLOWUP_VENDOR', 'PO_ARRIVAL_YARD'] } } })).toBe(2);
    expect((await listPos(s.buyer, { show: 'overdue' })).some((p) => p.id === po.id)).toBe(false); // due today, not overdue yet

    // New ETA: logged, and the chase fires again on that day.
    const tomorrow = new Date(new Date(`${today}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    await setPoEta(s.buyer, po.id, tomorrow);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: po.id, action: 'po.eta_change' } });
    expect([log.before, log.after, log.userId]).toEqual([{ expectedDate: today }, { expectedDate: tomorrow }, s.buyer.userId]);
    expect(await runPoFollowUps(new Date(at(13).getTime() + 86_400_000))).toMatchObject({ followUps: expect.any(Number) });
    expect(await db.emailOutbox.count({ where: { relatedId: po.id, templateKey: 'PO_FOLLOWUP_VENDOR' } })).toBe(2);
    // No ETA: no chase.
    const noEta = await issuePo(s.buyer, (await createPo(s.buyer, s.input({ expectedDate: null, emailVendor: false }))).id);
    await runPoFollowUps(at(14));
    expect(await db.emailOutbox.count({ where: { relatedId: noEta.id, templateKey: 'PO_FOLLOWUP_VENDOR' } })).toBe(0);
  });

  it('a committed PO can be fully edited (new revision) without losing what was received', async () => {
    const s = await setup();
    const po = await issuePo(s.buyer, (await createPo(s.buyer, s.input({ emailVendor: false }))).id);
    const line = po.lines[0]!;
    const input = { ...s.input({ emailVendor: false }), poNumber: po.poNumber, lines: [{ id: line.id, description: `${line.description} (revised)`, qty: line.qty + 5, uom: line.uom, unitCost: 10 }, { description: 'Extra item', qty: 1, uom: 'EA', unitCost: 5 }] };
    const r = await updatePo(s.buyer, po.id, input);
    expect([r.status, r.revision, r.lines.length, r.lines[0]!.id]).toEqual(['ISSUED', 1, 2, line.id]);
    expect(await db.auditLog.count({ where: { entityId: po.id, action: 'po.revise' } })).toBe(1);
  });

  it('company templates: changed wording and review-first apply to order emails', async () => {
    const s = await setup();
    await db.companyEmailRecipient.create({ data: { companyId: s.a.id, kind: 'PROCUREMENT', email: `buy-${uid()}@example.com` } });
    await saveTemplate(s.admin, s.a.id, 'ORDER_TO_PROCUREMENT', { subject: 'NEW LIST {{orderLabel}}', body: 'Hi team – {{orderLabel}} from {{siteName}}.', mode: 'REVIEW' });
    const { id } = await createDraft(s.site, s.jobA.id);
    await saveDraft(s.site, id, { rows: [{ ...emptyDraftRow('JS'), description: 'Gravel', quantity: '3', uom: 'T' }] });
    const order = (await submitOrder(s.site, id)).order;
    const held = (await listOutbox(s.buyer)).find((x) => x.relatedId === order.id)!;
    expect(held.subject).toBe(`NEW LIST ${order.label}`);
    expect(held.attachments[0]?.fileName).toMatch(/\.pdf$/);
  });
});
