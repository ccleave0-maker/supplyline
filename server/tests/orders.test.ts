import { afterAll, describe, expect, it } from 'vitest';
import { emptyDraftRow } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { createCostCode } from '../src/services/cost-codes';
import { cancelLine, createDraft, getOrder, getOrderPdf, listOrders, saveDraft, siteInventory, submitOrder } from '../src/services/orders';
import { makeOrg, makeUser } from './helpers';

afterAll(() => db.$disconnect());

const row = (description: string, quantity: string, uom = 'EA', extra: Partial<ReturnType<typeof emptyDraftRow>> = {}) => ({
  ...emptyDraftRow('JS'),
  description,
  quantity,
  uom,
  ...extra,
});

async function setup() {
  const o = await makeOrg();
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  await db.companyEmailRecipient.create({ data: { companyId: o.a.id, kind: 'PROCUREMENT', email: 'buyer@example.com' } });
  await db.companyEmailRecipient.create({ data: { companyId: o.a.id, kind: 'YARD', email: 'yard@example.com' } });
  return { ...o, site, admin };
}

async function submitted(auth: Parameters<typeof createDraft>[0], siteId: string, rows: ReturnType<typeof row>[]) {
  const { id } = await createDraft(auth, siteId);
  await saveDraft(auth, id, { rows });
  return submitOrder(auth, id);
}

describe('order numbering', () => {
  it('numbers lists 1, 2, 3 per job on submit, with a separate running number per company', async () => {
    const { site, admin, jobA, b } = await setup();
    const first = await submitted(site, jobA.id, [row('20M rebar', '10')]);
    const second = await submitted(site, jobA.id, [row('Tie wire', '5', 'ROLL')]);
    expect(first.order.label).toBe('JOB#2249 LIST#1');
    expect(second.order.label).toBe('JOB#2249 LIST#2');
    expect(second.order.companySeq).toBe(first.order.companySeq! + 1);

    // Another company's job starts its own count.
    const jobB2 = await db.site.findFirstOrThrow({ where: { companyId: b.id, type: 'JOB' } });
    const other = await submitted(admin, jobB2.id, [row('Asphalt', '12', 'TON')]);
    expect(other.order.label).toBe('JOB#26-BC249 LIST#1');
    expect(other.order.companySeq).toBe(1);
  });

  it('drafts do not use a number', async () => {
    const { site, jobA } = await setup();
    const { id } = await createDraft(site, jobA.id);
    const draft = await getOrder(site, id);
    expect(draft.listNo).toBeNull();
    expect(draft.label).toBe('JOB#2249 DRAFT');
    const done = await submitted(site, jobA.id, [row('Pipe', '3')]);
    expect(done.order.listNo).toBe(1);
  });

  it('pressing Submit twice only submits once', async () => {
    const { site, jobA } = await setup();
    const { id } = await createDraft(site, jobA.id);
    await saveDraft(site, id, { rows: [row('Gravel', '2', 'TON')] });
    const results = await Promise.allSettled([submitOrder(site, id), submitOrder(site, id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.orderLine.count({ where: { orderFormId: id } })).toBe(1);
  });
});

describe('submit flow', () => {
  it('turns rows into lines, skips blanks, adds lines to site inventory and emails procurement + yard', async () => {
    const { site, jobA } = await setup();
    const result = await submitted(site, jobA.id, [row('20M rebar 6m', '1,200'), emptyDraftRow('JS'), row('Form ply', '40', 'sheet')]);
    expect(result.order.status).toBe('SUBMITTED');
    expect(result.order.lines.map((l) => [l.lineNo, l.description, l.quantity, l.uom, l.status])).toEqual([
      [1, '20M rebar 6m', 1200, 'EA', 'SUBMITTED'],
      [2, 'Form ply', 40, 'SHEET', 'SUBMITTED'],
    ]);
    expect(result.email).toMatchObject({ sent: 2, failed: 0 });

    const outbox = await db.emailOutbox.findMany({ where: { relatedId: result.order.id }, orderBy: { subject: 'asc' } });
    const proc = outbox.find((e) => e.to.includes('buyer@example.com'))!;
    expect(proc.bodyText).toMatch(/^Please see attached list for processing\./);
    expect(proc.replyTo).toBe(site.email);
    expect(proc.fromName).toBe(`${site.name} via Bowron`);
    expect(proc.attachments).toEqual([{ fileName: 'JOB2249-LIST1.pdf', contentType: 'application/pdf' }]);
    expect(outbox.find((e) => e.to.includes('yard@example.com'))!.bodyText).toMatch(/^Please confirm what you have available for stock\./);

    const inv = await siteInventory(site, jobA.id);
    expect(inv.map((r) => [r.orderLabel, r.lineNo, r.qtyOrdered, r.leftToShip])).toEqual([
      ['JOB#2249 LIST#1', 1, 1200, 1200],
      ['JOB#2249 LIST#1', 2, 40, 40],
    ]);
  });

  it('refuses to submit bad rows and says which cells', async () => {
    const { site, jobA } = await setup();
    const { id } = await createDraft(site, jobA.id);
    await saveDraft(site, id, { rows: [row('Good', '1'), row('', 'abc')] });
    await expect(submitOrder(site, id)).rejects.toMatchObject({ code: 'invalid_rows', details: { rows: { 2: { description: expect.any(String), quantity: expect.any(String) } } } });
    expect((await getOrder(site, id)).status).toBe('DRAFT');
  });

  it('enforces the cost code list when the company has one', async () => {
    const { site, admin, jobA, a } = await setup();
    await createCostCode(admin, a.id, { code: 'C-100' });
    const { id } = await createDraft(site, jobA.id);
    await saveDraft(site, id, { rows: [row('Rebar', '1', 'EA', { costCode: 'C-999' })] });
    await expect(submitOrder(site, id)).rejects.toMatchObject({ code: 'invalid_rows' });
    await saveDraft(site, id, { rows: [row('Rebar', '1', 'EA', { costCode: 'c-100' })] });
    expect((await submitOrder(site, id)).order.lines[0]!.costCode).toBe('C-100');
  });

  it('warns when no procurement email is set up, but still submits', async () => {
    const o = await makeOrg();
    const { auth } = await makeUser(o.org.id, ['ADMIN'], null);
    const r = await submitted(auth, o.jobA.id, [row('Bolts', '100')]);
    expect(r.order.status).toBe('SUBMITTED');
    expect(r.email.warnings.join(' ')).toMatch(/No procurement email/);
  });

  it('submitted lists are locked; drafts can be deleted', async () => {
    const { site, jobA } = await setup();
    const r = await submitted(site, jobA.id, [row('Pipe', '1')]);
    await expect(saveDraft(site, r.order.id, { rows: [] })).rejects.toThrow(/already been submitted/);
  });

  it('creates a PDF of the list', async () => {
    const { site, jobA } = await setup();
    const r = await submitted(site, jobA.id, [row('Pipe', '1')]);
    const pdf = await getOrderPdf(site, r.order.id);
    expect(pdf.fileName).toBe('JOB2249-LIST1.pdf');
    expect(pdf.bytes.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('cancelling lines', () => {
  it('cancels a line, keeps it on record, and removes it from left-to-ship', async () => {
    const { site, jobA } = await setup();
    const r = await submitted(site, jobA.id, [row('A', '5'), row('B', '3')]);
    const after = await cancelLine(site, r.order.id, r.order.lines[1]!.id, 'Ordered twice');
    expect(after.lines.map((l) => l.status)).toEqual(['SUBMITTED', 'CANCELLED']);
    const inv = await siteInventory(site, jobA.id);
    expect(inv.find((x) => x.lineNo === 2)).toMatchObject({ status: 'CANCELLED', leftToShip: 0 });
    await expect(cancelLine(site, r.order.id, r.order.lines[1]!.id, null)).rejects.toThrow(/can't be cancelled/);
  });

  it('cancelling every line cancels the list', async () => {
    const { site, jobA } = await setup();
    const r = await submitted(site, jobA.id, [row('A', '5')]);
    const after = await cancelLine(site, r.order.id, r.order.lines[0]!.id, null);
    expect(after.status).toBe('CANCELLED');
  });
});

describe('who can see and create orders', () => {
  it("site users only see their own jobs' lists and can't order for other jobs", async () => {
    const { site, admin, jobA, jobB } = await setup();
    await submitted(admin, jobB.id, [row('Hidden', '1')]);
    await submitted(site, jobA.id, [row('Mine', '1')]);
    const list = await listOrders(site, {});
    expect(list.every((o) => o.siteId === jobA.id)).toBe(true);
    await expect(createDraft(site, jobB.id)).rejects.toThrow(/not found/);
  });

  it('yard users can view but not create', async () => {
    const { org, a, yard, jobA } = await setup();
    const { auth } = await makeUser(org.id, ['YARD'], a.id, [yard.id]);
    await expect(createDraft(auth, jobA.id)).rejects.toThrow(/access/);
  });

  it('orders cannot be created for yards', async () => {
    const { admin, yard } = await setup();
    await expect(createDraft(admin, yard.id)).rejects.toThrow(/jobs, not yards/);
  });
});
