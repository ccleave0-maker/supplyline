import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { matchInvoice, sameVendor } from '@supplyline/core/domain';
import { DEFAULT_ACCOUNTING, type AccountingSettings, type InvoiceScanResult } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { setClaudeForTests } from '../src/integrations/claude';
import { saveAiSettings } from '../src/services/ai';
import { apAction, decide, getApInvoice, payRuns, receiveInvoice, saveAccountingSettings } from '../src/services/ap';
import { scanApFolders } from '../src/services/ap-folders';
import { accountingExport, getBudget, getSubHoldback, recordArPayment, saveArInvoice, saveBudget, saveCustomer, saveSubHoldback, sendArInvoice } from '../src/services/accounting';
import { createContact } from '../src/services/contacts';
import { createPo, issuePo } from '../src/services/purchasing';
import { todayLocal } from '../src/services/project';
import { updateSite } from '../src/services/sites';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());
afterEach(() => setClaudeForTests(null));

const pdf = (name = 'inv.pdf') => new File([new Uint8Array([37, 80, 68, 70, 45, Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)])], name, { type: 'application/pdf' });
/** Pretend the AI read this invoice. */
function invoiceSays(r: Partial<InvoiceScanResult>) {
  const full: InvoiceScanResult = { documentType: 'INVOICE', refInvoiceNumber: null, vendorName: 'Coastal Steel Ltd.', invoiceNumber: `INV-${uid()}`, invoiceDate: todayLocal(), dueDate: null, poNumber: null, subtotal: 1100, gst: 55, pst: 77, total: 1232, lines: [], ...r };
  setClaudeForTests(async () => ({ input: full, inputTokens: 500, outputTokens: 200 }));
  return full;
}

async function setup(acct: Partial<AccountingSettings> = {}) {
  const o = await makeOrg();
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: buyer, user: buyerUser } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const { auth: ap } = await makeUser(o.org.id, ['AP'], o.a.id);
  const { auth: pm, user: pmUser } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: ops, user: opsUser } = await makeUser(o.org.id, ['SITE'], o.a.id);
  await db.site.update({ where: { id: o.jobA.id }, data: { province: 'BC' } });
  await updateSite(admin, o.jobA.id, { projectManagerId: pmUser.id });
  await saveAiSettings(admin, { enabled: true, model: 'claude-sonnet-5-5', apiKey: 'sk-ant-api03-test-key-abcdefghijklmnopqrstuvwxyz1234', monthlyCapCad: null, usdToCad: 1.37, priceInputUsdPerM: 3, priceOutputUsdPerM: 15, sttProvider: 'none' });
  await saveAccountingSettings(admin, o.a.id, { ...DEFAULT_ACCOUNTING, ...acct, opsManagerIds: [opsUser.id] });
  const po = await issuePo(
    buyer,
    (
      await createPo(buyer, {
        companyId: o.a.id,
        poNumber: `P-${uid()}`,
        vendorName: 'Coastal Steel',
        siteId: o.jobA.id,
        deliverToYardId: o.yard.id,
        lines: [
          { description: 'Pipe pile 324mm', qty: 10, uom: 'EA', unitCost: 100, costCode: '300' },
          { description: 'Splice plate', qty: 4, uom: 'EA', unitCost: 25, costCode: '310' },
        ],
      })
    ).id,
  );
  const goodLines = [
    { description: 'Pipe pile 324mm', qty: 10, uom: 'EA', unitPrice: 100, amount: 1000 },
    { description: 'Splice plate', qty: 4, uom: 'EA', unitPrice: 25, amount: 100 },
  ];
  return { ...o, admin, buyer, buyerUser, ap, pm, pmUser, ops, opsUser, po, goodLines };
}

describe('invoice matching rules', () => {
  const po = { poNumber: '1042', vendorName: 'Coastal Steel', status: 'ISSUED', pstExempt: false, gstRate: 0.05, pstRate: 0.07, hstRate: 0, lines: [{ id: 'a', description: 'Pipe pile 324mm', qty: 10, unitCost: 100, alreadyInvoiced: 0 }] };
  const inv = { vendorName: 'COASTAL STEEL LTD', invoiceNumber: '9', poNumber: '1042', subtotal: 1000, gst: 50, pst: 70, total: 1120, lines: [{ description: 'pipe pile 324 mm', qty: 10, unitPrice: 100, amount: 1000 }] };
  it('passes a clean invoice and flags each kind of problem in plain words', () => {
    expect(sameVendor('Coastal Steel Ltd.', 'COASTAL STEEL')).toBe(true);
    expect(matchInvoice(inv, po)).toEqual({ issues: [], lineMatches: ['a'] });
    expect(matchInvoice({ ...inv, lines: [{ ...inv.lines[0]!, unitPrice: 110, amount: 1100 }], subtotal: 1100, gst: 55, pst: 77, total: 1232 }, po).issues[0]).toMatch(/price \$110\.00 vs \$100\.00/);
    expect(matchInvoice({ ...inv, lines: [{ ...inv.lines[0]!, qty: 12, amount: 1200 }], subtotal: 1200, gst: 60, pst: 84, total: 1344 }, po).issues[0]).toMatch(/billing 12 but the PO is for 10/);
    expect(matchInvoice(inv, { ...po, pstExempt: true, pstRate: 0 }).issues).toEqual(['PST of $70.00 was charged, but this PO is PST exempt.']);
    expect(matchInvoice({ ...inv, vendorName: 'Other Supply' }, po).issues[0]).toMatch(/is from “Other Supply”/);
    expect(matchInvoice({ ...inv, poNumber: null }, null).issues).toContain('No PO number on the invoice.');
  });
});

describe('accounts payable', () => {
  it('a clean invoice goes to procurement, then is approved and paid', async () => {
    const s = await setup();
    const said = invoiceSays({ poNumber: `PO ${s.po.poNumber}`, lines: s.goodLines });
    let inv = await receiveInvoice(s.ap, s.a.id, pdf());
    expect([inv.status, inv.issues, inv.poNumber, inv.target]).toEqual(['IN_APPROVAL', [], s.po.poNumber, 'JOB#2249 Job A']);
    expect(inv.waitingOn).toBe('Procurement');
    expect((await db.emailOutbox.findFirst({ where: { relatedId: inv.id, templateKey: 'AP_APPROVAL_REQUEST' } }))?.to).toContain(s.buyerUser.email);
    await expect(decide(s.pm, inv.id, { approvalId: inv.approvals[0]!.id, decision: 'APPROVED' })).rejects.toThrow();
    inv = await decide(s.buyer, inv.id, { approvalId: inv.approvals[0]!.id, decision: 'APPROVED' });
    expect(inv.status).toBe('APPROVED');
    inv = await apAction(s.ap, inv.id, { action: 'MARK_PAID', paidOn: todayLocal(), paymentRef: 'CHQ 5521' });
    expect([inv.status, inv.paymentRef]).toEqual(['PAID', 'CHQ 5521']);
    // Invoiced in full: the PO is now Complete and locked.
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: s.po.id } })).status).toBe('CLOSED');
    // Entering the same invoice again goes to the rejection area to be investigated, not paid twice.
    invoiceSays({ ...said });
    const again = await receiveInvoice(s.ap, s.a.id, pdf());
    expect(again.status).toBe('REJECTED');
    expect(again.rejectedReason).toMatch(/is complete/);
    // A credit still posts against it.
    invoiceSays({ ...said, documentType: 'CREDIT', invoiceNumber: `CR-${Date.now()}`, refInvoiceNumber: said.invoiceNumber, subtotal: -100, gst: -5, pst: -7, total: -112, lines: [] });
    const credit = await receiveInvoice(s.ap, s.a.id, pdf());
    expect(credit.status).not.toBe('REJECTED');
  });

  it('a mismatch waits for AP; AP can send it on with a note', async () => {
    const s = await setup();
    invoiceSays({ poNumber: s.po.poNumber, lines: [{ ...s.goodLines[0]!, unitPrice: 110, amount: 1100 }, s.goodLines[1]!], subtotal: 1200, gst: 60, pst: 84, total: 1344 });
    let inv = await receiveInvoice(s.ap, s.a.id, pdf());
    expect(inv.status).toBe('NEEDS_REVIEW');
    expect(inv.issues.join(' ')).toMatch(/price \$110\.00 vs \$100\.00/);
    await expect(apAction(s.ap, inv.id, { action: 'SEND_TO_APPROVAL' })).rejects.toThrow(/add a note/);
    inv = await apAction(s.ap, inv.id, { action: 'SEND_TO_APPROVAL', note: 'Price increase agreed by phone' });
    expect(inv.status).toBe('IN_APPROVAL');
  });

  it('procurement can pass; extra steps and side reviews follow the company setup', async () => {
    const s = await setup({ extraSteps: [{ type: 'PM' }], sideReviews: [{ type: 'OPS' }] });
    invoiceSays({ poNumber: s.po.poNumber, lines: s.goodLines });
    let inv = await receiveInvoice(s.ap, s.a.id, pdf());
    const [proc, pmStep] = inv.approvals.filter((a) => a.kind === 'MAIN');
    const side = inv.approvals.find((a) => a.kind === 'SIDE')!;
    inv = await decide(s.buyer, inv.id, { approvalId: proc!.id, decision: 'PASSED', note: 'Approved at time of purchase' });
    expect([inv.status, inv.waitingOn]).toEqual(['IN_APPROVAL', `${s.pmUser.name} (PM)`]);
    inv = await decide(s.ops, inv.id, { approvalId: side.id, decision: 'FLAGGED', note: 'Check the freight' });
    expect(inv.status).toBe('IN_APPROVAL'); // side reviews don't hold it up
    inv = await decide(s.pm, inv.id, { approvalId: pmStep!.id, decision: 'APPROVED' });
    expect(inv.status).toBe('APPROVED');
    expect(await db.notification.count({ where: { title: { startsWith: 'Concern flagged' } } })).toBeGreaterThan(0);
  });

  it('rejects to the vendor’s accounts contact; a revised invoice takes it out of the Rejection Area', async () => {
    const s = await setup();
    await createContact(s.admin, { type: 'VENDOR', name: 'Accounts', businessName: 'Coastal Steel', email: 'ar@coastal.example.com', isApContact: true } as never);
    const said = invoiceSays({ poNumber: s.po.poNumber, lines: s.goodLines });
    let inv = await receiveInvoice(s.ap, s.a.id, pdf());
    inv = await decide(s.buyer, inv.id, { approvalId: inv.approvals[0]!.id, decision: 'REJECTED', note: 'Wrong delivery address on invoice' });
    expect(inv.status).toBe('REJECTED');
    const out = await db.emailOutbox.findFirstOrThrow({ where: { relatedId: inv.id, templateKey: 'AP_REJECTION' } });
    expect([out.status, out.to]).toEqual(['REVIEW', ['ar@coastal.example.com']]);
    expect(out.bodyText).toMatch(/Wrong delivery address/);
    invoiceSays({ documentType: 'REVISED', refInvoiceNumber: said.invoiceNumber, invoiceNumber: `${said.invoiceNumber}-R1`, poNumber: s.po.poNumber, lines: s.goodLines });
    const revised = await receiveInvoice(s.ap, s.a.id, pdf());
    expect([revised.status, revised.replaces?.id]).toEqual(['IN_APPROVAL', inv.id]);
    expect((await getApInvoice(s.ap, inv.id)).status).toBe('REPLACED');
  });

  it('holds back the project’s % on subcontractor invoices', async () => {
    const s = await setup();
    const sub = await createContact(s.admin, { type: 'SUBCONTRACTOR', name: 'Office', businessName: 'Coastal Steel' } as never);
    await saveSubHoldback(s.pm, s.jobA.id, { defaultPct: 10, overrides: [] });
    invoiceSays({ poNumber: s.po.poNumber, lines: s.goodLines });
    const inv = await receiveInvoice(s.ap, s.a.id, pdf());
    expect([inv.holdbackPct, inv.holdbackAmount, inv.payable]).toEqual([10, 110, 1122]);
    await saveSubHoldback(s.admin, s.jobA.id, { defaultPct: 10, overrides: [{ contactId: sub.id, pct: 5 }] });
    invoiceSays({ poNumber: s.po.poNumber, lines: [s.goodLines[1]!], subtotal: 100, gst: 5, pst: 7, total: 112 });
    expect((await receiveInvoice(s.ap, s.a.id, pdf())).holdbackAmount).toBe(5);
    const view = await getSubHoldback(s.pm, s.jobA.id);
    expect(view.owing[0]).toEqual(expect.objectContaining({ name: 'Coastal Steel', held: 115, owing: 115 }));
  });

  it('brings invoices in from the network folder and moves the file as it goes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sl-ap-'));
    const folders = { inbox: path.join(root, 'Inbox'), inReview: path.join(root, 'In review'), approved: path.join(root, 'Approved'), rejected: path.join(root, 'Rejected'), held: path.join(root, 'On hold') };
    const s = await setup({ folders });
    const { mkdirSync, utimesSync } = await import('node:fs');
    mkdirSync(folders.inbox, { recursive: true });
    const file = path.join(folders.inbox, 'coastal-invoice.pdf');
    writeFileSync(file, Buffer.from([37, 80, 68, 70, 45, 1, 2, 3]));
    utimesSync(file, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    invoiceSays({ poNumber: s.po.poNumber, lines: s.goodLines });
    const r = await scanApFolders(s.org.id);
    expect(r.imported).toBe(1);
    expect(readdirSync(folders.inbox)).toEqual([]);
    expect(readdirSync(folders.inReview)).toEqual(['coastal-invoice.pdf']);
    expect((await scanApFolders(s.org.id)).imported).toBe(0);
    const inv = await db.apInvoice.findFirstOrThrow({ where: { companyId: s.a.id, receivedVia: 'FOLDER' }, include: { approvals: true } });
    await decide(s.buyer, inv.id, { approvalId: inv.approvals[0]!.id, decision: 'APPROVED' });
    expect(readdirSync(folders.approved)).toEqual(['coastal-invoice.pdf']);
  });

  it('forecasts pay runs from approved invoices and open POs', async () => {
    const s = await setup({ payDays: [15, 31] });
    invoiceSays({ poNumber: s.po.poNumber, lines: [s.goodLines[1]!], subtotal: 100, gst: 5, pst: 7, total: 112, dueDate: todayLocal() });
    const inv = await receiveInvoice(s.ap, s.a.id, pdf());
    await decide(s.buyer, inv.id, { approvalId: inv.approvals[0]!.id, decision: 'APPROVED' });
    const runs = await payRuns(s.ap, s.a.id);
    expect(runs.length).toBeGreaterThanOrEqual(6);
    const first = runs.find((r) => r.date >= todayLocal())!;
    expect(first.approvedDue).toBe(112);
    expect(runs.reduce((a, r) => a + r.forecast, 0)).toBeGreaterThan(0); // the rest of the PO
  });
});

describe('budgets, receivables and exports', () => {
  it('compares budget, committed and actual by cost code', async () => {
    const s = await setup();
    await saveBudget(s.pm, s.jobA.id, { rows: [{ costCode: '300', amount: 900 }, { costCode: '310', amount: 500 }] });
    invoiceSays({ poNumber: s.po.poNumber, lines: s.goodLines });
    const inv = await receiveInvoice(s.ap, s.a.id, pdf());
    await decide(s.buyer, inv.id, { approvalId: inv.approvals[0]!.id, decision: 'APPROVED' });
    const b = await getBudget(s.pm, s.jobA.id);
    expect(b.rows.map((r) => [r.costCode, r.budget, r.committed, r.actual, r.over])).toEqual([
      ['300', 900, 1000, 1000, true],
      ['310', 500, 100, 100, false],
    ]);
  });

  it('bills a customer (holdback off unless set), tracks payments, and exports AP / AR / tax', async () => {
    const s = await setup();
    const { id: customerId } = await saveCustomer(s.ap, null, { companyId: s.a.id, name: 'City of Example', email: 'ap@city.example.com', termsDays: 30 });
    const base = { companyId: s.a.id, customerId, siteId: s.jobA.id, invoiceDate: todayLocal(), dueDate: '2000-01-01', gstRate: 0.05, pstRate: 0, lines: [{ description: 'Pile installation – progress 1', qty: 1, uom: 'LS', unitPrice: 10000 }] };
    let inv = await saveArInvoice(s.ap, null, { ...base, invoiceNumber: `A-${uid()}` });
    expect([inv.total, inv.holdbackAmount, inv.state]).toEqual([10500, 0, 'DRAFT']);
    const withHb = await saveArInvoice(s.ap, null, { ...base, invoiceNumber: `A-${uid()}`, holdbackPct: 10 });
    expect(withHb.holdbackAmount).toBe(1000);
    const sent = await sendArInvoice(s.ap, inv.id, { email: true });
    expect(sent.state).toBe('HELD'); // customer emails wait for review
    expect(sent.invoice.state).toBe('OVERDUE');
    inv = await recordArPayment(s.ap, inv.id, { paidOn: todayLocal(), amount: 4000 });
    expect([inv.state, inv.balance]).toEqual(['OVERDUE', 6500]);
    inv = await recordArPayment(s.ap, inv.id, { paidOn: todayLocal(), amount: 6500 });
    expect(inv.state).toBe('PAID');
    invoiceSays({ poNumber: s.po.poNumber, lines: s.goodLines });
    await receiveInvoice(s.ap, s.a.id, pdf());
    const from = `${todayLocal().slice(0, 7)}-01`;
    const apRows = await accountingExport(s.ap, 'ap', from, todayLocal(), s.a.id);
    expect(apRows[0]).toEqual(expect.objectContaining({ vendor: 'Coastal Steel', subtotal: 1100, gst: 55, pst: 77 }));
    const tax = await accountingExport(s.ap, 'tax', from, todayLocal(), s.a.id);
    expect(tax[0]).toEqual(expect.objectContaining({ gstCollected: 500, gstPaidItc: 55, netGst: 445, pstPaid: 77 }));
    await expect(accountingExport(s.pm, 'ap', from, todayLocal())).rejects.toThrow();
  });
});
