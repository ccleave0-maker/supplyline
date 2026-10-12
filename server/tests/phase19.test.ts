import { afterAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { emptyDraftRow, REPORT_PRESETS } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { datasetRows, saveExportMapping } from '../src/services/export-mappings';
import { createDraft, saveDraft, submitOrder } from '../src/services/orders';
import { createPo, issuePo } from '../src/services/purchasing';
import { buildReport, isDue, listSavedReports, periodRange, pmUpdateText, renderReport, runPmWeekly, runScheduledReports, saveReport } from '../src/services/report-builder';
import { saveStockCheck } from '../src/services/yard';
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

async function withOrder(s: Awaited<ReturnType<typeof setup>>) {
  const { id } = await createDraft(s.site, s.jobA.id);
  await saveDraft(s.site, id, { rows: [{ ...emptyDraftRow('SS'), description: 'Rebar 15M', quantity: '10', uom: 'EA' }] });
  const ord = (await submitOrder(s.site, id)).order;
  await saveStockCheck(s.yardUser, ord.id, { yardId: s.yard.id, lines: [{ lineId: ord.lines[0]!.id, qtyAvailable: 4 }] });
  return ord;
}

describe('periods and schedules', () => {
  const sundayAfternoon = new Date('2026-10-11T23:30:00Z'); // 4:30 pm Sunday in Vancouver
  it('works out last week and last month in local time', () => {
    expect(periodRange('LAST_WEEK', null, null, sundayAfternoon)).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(periodRange('LAST_MONTH', null, null, sundayAfternoon)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(() => periodRange('CUSTOM')).toThrow(/from and to/);
  });
  it('is due once on the right day and hour', () => {
    const weekly = { frequency: 'WEEKLY' as const, weekday: 0, monthDay: 1, hour: 15 };
    expect(isDue(weekly, null, sundayAfternoon)).toBe(true);
    expect(isDue(weekly, sundayAfternoon, sundayAfternoon)).toBe(false); // already sent today
    expect(isDue({ ...weekly, hour: 17 }, null, sundayAfternoon)).toBe(false);
    expect(isDue({ ...weekly, weekday: 1 }, null, sundayAfternoon)).toBe(false);
    expect(isDue(null, null, sundayAfternoon)).toBe(false);
  });
});

describe('Sage datasets', () => {
  it('POs issued are commitments; one row per line with job and amount', async () => {
    const s = await setup();
    const po = await issuePo(s.buyer, (await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Coastal Steel', siteId: s.jobA.id, lines: [{ description: 'Pile', qty: 10, uom: 'EA', unitCost: 100 }, { description: 'Plate', qty: 2, uom: 'EA', unitCost: 50 }] })).id);
    const today = new Date().toISOString().slice(0, 10);
    const rows = (await datasetRows(s.admin, 'SAGE_COMMITMENTS', '2000-01-01', '2099-12-31', null)).filter((r) => r.poNumber === po.poNumber);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ jobNumber: s.jobA.jobNumber, description: 'Pile', qty: 10, amount: 1000, currency: 'CAD' });
    expect(today).toBeTruthy();
  });
});

describe('report builder', () => {
  it('builds the job update list for one job, as Excel and as PDF', async () => {
    const s = await setup();
    await withOrder(s);
    const preset = REPORT_PRESETS.find((p) => p.key === 'job-update')!.report;
    const input = { ...preset, filters: { ...preset.filters, siteIds: [s.jobA.id] } };
    const built = await buildReport(s.site, input);
    expect(built.sections[0]!.rows).toHaveLength(1);
    expect(built.sections[0]!.rows[0]).toMatchObject({ jobNumber: s.jobA.jobNumber, description: 'Rebar 15M', ordered: 10 });
    expect(built.sections[0]!.columns[0]).toEqual({ key: 'jobNumber', label: 'Job #' });

    const xlsx = await renderReport(s.site, input);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(xlsx.bytes) as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(2);
    expect(wb.worksheets[0]!.getRow(5).getCell(3).value).toBe('Rebar 15M');

    const pdf = await renderReport(s.site, { ...input, format: 'pdf' });
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBeGreaterThanOrEqual(2); // a page per section
  });

  it('rejects unknown fields, saves, and sends on schedule to the recipients', async () => {
    const s = await setup();
    await withOrder(s);
    await expect(buildReport(s.admin, { name: 'x', sections: [{ dataset: 'JOBS', columns: ['nope'] }], filters: { period: 'ALL', siteIds: [] }, format: 'xlsx', recipients: [] })).rejects.toThrow(/Pick fields/);
    await expect(saveReport(s.admin, null, { name: 'Jobs', sections: [{ dataset: 'JOBS', columns: ['jobNumber', 'name'] }], filters: { period: 'ALL', siteIds: [] }, format: 'xlsx', schedule: { frequency: 'DAILY', weekday: 1, monthDay: 1, hour: 0 }, recipients: [] })).rejects.toThrow(/who gets it/);
    const name = `Jobs ${uid()}`;
    const { id } = await saveReport(s.admin, null, { name, sections: [{ dataset: 'JOBS', columns: ['jobNumber', 'name', 'pm'] }], filters: { period: 'ALL', siteIds: [] }, format: 'xlsx', schedule: { frequency: 'DAILY', weekday: 1, monthDay: 1, hour: 0 }, recipients: ['office@example.com'] });
    expect((await listSavedReports(s.admin)).find((r) => r.id === id)).toMatchObject({ name, canEdit: true });
    expect((await listSavedReports(s.site)).find((r) => r.id === id)).toBeUndefined(); // only their own
    await expect(buildReport(s.site, { name: 'x', sections: [{ dataset: 'AP_INVOICES', columns: ['vendor'] }], filters: { period: 'ALL', siteIds: [] }, format: 'xlsx', recipients: [] })).rejects.toThrow(/reports access/);

    await runScheduledReports();
    const mail = await db.emailOutbox.findFirst({ where: { relatedId: id } });
    expect(mail?.to).toContain('office@example.com');
    expect(mail?.subject).toContain(name);
    expect((await db.savedReport.findUniqueOrThrow({ where: { id } })).lastSentAt).toBeTruthy();
    await runScheduledReports(); // not twice the same day
    expect(await db.emailOutbox.count({ where: { relatedId: id } })).toBe(1);
  });

  it('export mappings can be scheduled to email', async () => {
    const s = await setup();
    await expect(saveExportMapping(s.admin, null, { name: 'Sage', target: 'sage-intacct', dataset: 'SAGE_COMMITMENTS', format: 'csv', dateFormat: 'YYYY-MM-DD', columns: [{ field: 'poNumber', header: 'PO' }], schedule: { frequency: 'DAILY', weekday: 1, monthDay: 1, hour: 0 } })).rejects.toThrow(/who gets it/);
    const m = await saveExportMapping(s.admin, null, { name: 'Sage', target: 'sage-intacct', dataset: 'SAGE_COMMITMENTS', format: 'csv', dateFormat: 'YYYY-MM-DD', columns: [{ field: 'poNumber', header: 'PO' }], schedule: { frequency: 'DAILY', weekday: 1, monthDay: 1, hour: 0 }, recipients: ['acct@example.com'] });
    expect(m).toMatchObject({ recipients: ['acct@example.com'], fileToNetwork: false, schedule: { frequency: 'DAILY' } });
    await runScheduledReports();
    expect((await db.emailOutbox.findFirst({ where: { relatedId: m.id } }))?.to).toContain('acct@example.com');
  });
});

describe('weekly update to the PM', () => {
  it('lists what is still outstanding and goes out once on Sunday afternoon', async () => {
    const s = await setup();
    const { auth: pm, user } = await makeUser(s.org.id, ['SITE'], s.a.id, [s.jobA.id]);
    await db.site.update({ where: { id: s.jobA.id }, data: { projectManagerId: user.id } });
    await withOrder(s);
    const u = await pmUpdateText(pm, s.jobA.id);
    expect(u!.text).toMatch(/STILL OUTSTANDING[\s\S]*Rebar 15M/);

    const sunday = new Date('2026-10-11T23:30:00Z');
    await runPmWeekly(sunday);
    expect(await db.emailOutbox.count({ where: { relatedType: 'pm_weekly', relatedId: s.jobA.id } })).toBe(1);
    await runPmWeekly(sunday);
    expect(await db.emailOutbox.count({ where: { relatedType: 'pm_weekly', relatedId: s.jobA.id } })).toBe(1);
  });
});
