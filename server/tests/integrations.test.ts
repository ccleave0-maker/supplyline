import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNTING, DEFAULT_FILING, type InvoiceScanResult } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { setClaudeForTests } from '../src/integrations/claude';
import { saveAiSettings } from '../src/services/ai';
import { saveAccountingSettings } from '../src/services/ap';
import { exportAllData } from '../src/services/data-export';
import { runExportMapping, saveExportMapping } from '../src/services/export-mappings';
import { createSyncDevice, deviceFromRequest, fileDocument, listFilingJobs, processFiling, revokeSyncDevice, saveFilingSettings, syncAck, syncApMoved, syncApMoves, syncApUpload, syncConfig, syncPending } from '../src/services/filing';
import { runImport } from '../src/services/imports';
import { createPo, issuePo } from '../src/services/purchasing';
import { saveUpload } from '../src/services/files';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());
afterEach(() => setClaudeForTests(null));

async function setup() {
  const o = await makeOrg();
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  return { ...o, admin, buyer, site };
}

const issue = async (s: Awaited<ReturnType<typeof setup>>) =>
  issuePo(s.buyer, (await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Coastal Steel', siteId: s.jobA.id, deliverToYardId: s.yard.id, lines: [{ description: 'Pipe pile', qty: 10, uom: 'EA', unitCost: 100, costCode: '300' }] })).id);

describe('network filing', () => {
  it('copies documents into the folders by type when the server can reach them', async () => {
    const s = await setup();
    const root = mkdtempSync(path.join(tmpdir(), 'sl-filing-'));
    await expect(saveFilingSettings(s.site, s.a.id, { ...DEFAULT_FILING, enabled: true, root })).rejects.toThrow(/permission|access/i);
    await expect(saveFilingSettings(s.admin, s.a.id, { ...DEFAULT_FILING, enabled: true, root: 'relative\\folder' })).rejects.toThrow(/full folder path/);
    await saveFilingSettings(s.admin, s.a.id, { ...DEFAULT_FILING, enabled: true, root });
    await issue(s);
    const pending = await listFilingJobs(s.admin, 'pending');
    expect(pending.map((j) => j.docType).sort()).toEqual(['PACKING_PDF', 'PO_PDF']);
    expect(pending.find((j) => j.docType === 'PO_PDF')!.relativePath).toMatch(new RegExp(`^AAA/Purchase orders/${new Date().getFullYear()}/`));

    const r = await processFiling(s.org.id);
    expect(r).toEqual({ done: 2, failed: 0 });
    const year = String(new Date().getFullYear());
    expect(readdirSync(path.join(root, 'AAA', 'Purchase orders', year)).some((f) => f.endsWith('.pdf'))).toBe(true);
    expect(readdirSync(path.join(root, 'AAA', 'Purchase orders', year, 'Packing lists')).length).toBe(1);
    expect((await listFilingJobs(s.admin, 'done')).length).toBe(2);
  });

  it('does nothing when filing is off or the kind is not ticked, and never writes outside the root', async () => {
    const s = await setup();
    await issue(s);
    expect(await listFilingJobs(s.admin, 'pending')).toEqual([]);
    const root = mkdtempSync(path.join(tmpdir(), 'sl-filing-'));
    await saveFilingSettings(s.admin, s.a.id, { ...DEFAULT_FILING, enabled: true, root, types: ['BOL_PDF'] });
    await issue(s);
    expect(await listFilingJobs(s.admin, 'pending')).toEqual([]);
    // Job names with slashes or dots can't climb out of the folder.
    await saveFilingSettings(s.admin, s.a.id, { ...DEFAULT_FILING, enabled: true, root, folders: { ...DEFAULT_FILING.folders, QC_DOC: '{company}\\Jobs\\{job}\\QC' } });
    const asset = await saveUpload({ organizationId: s.org.id, companyId: s.a.id, uploadedById: s.admin.userId, kind: 'MTR', file: new File([new Uint8Array([1, 2, 3])], 'mtr.pdf', { type: 'application/pdf' }), maxBytes: 1_048_576 });
    await fileDocument({ companyId: s.a.id, docType: 'QC_DOC', fileId: asset.id, vars: { job: '..\\..\\Windows' } });
    const [job] = await listFilingJobs(s.admin, 'pending');
    expect(job!.relativePath).toBe('AAA/Jobs/.. .. Windows/QC/mtr.pdf');
    await processFiling(s.org.id);
    expect(readdirSync(path.join(root, 'AAA', 'Jobs'))).toEqual(['.. .. Windows']);
  });
});

describe('Bowron Sync app', () => {
  it('a device key collects SYNC-mode files and acknowledges them; a removed key stops working', async () => {
    const s = await setup();
    await saveFilingSettings(s.admin, s.a.id, { ...DEFAULT_FILING, enabled: true, mode: 'SYNC', root: 'P:\\Bowron' });
    const { id, token } = await createSyncDevice(s.admin, 'Office PC');
    expect(token).toMatch(/^sls_/);
    const req = (t: string) => new Request('http://x/api/v1/sync/jobs', { headers: { authorization: `Bearer ${t}`, 'x-sync-version': 'sync-1.0.0' } });
    expect(await deviceFromRequest(req('sls_wrong'))).toBeNull();
    const d = await deviceFromRequest(req(token));
    expect(d?.organizationId).toBe(s.org.id);

    const cfg = await syncConfig(s.org.id);
    expect(cfg.companies.find((c) => c.id === s.a.id)!.filing).toEqual({ root: 'P:\\Bowron' });
    expect(cfg.companies.find((c) => c.id === s.b.id)!.filing).toBeNull();

    await issue(s);
    expect(await processFiling(s.org.id)).toEqual({ done: 0, failed: 0 }); // the server leaves SYNC jobs alone
    const jobs = await syncPending(s.org.id);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.url).toMatch(/^\/api\/v1\/files\/.+sig=/);
    await syncAck(s.org.id, jobs[0]!.id, true);
    await syncAck(s.org.id, jobs[1]!.id, false, 'Access denied');
    expect(await syncPending(s.org.id)).toHaveLength(1);
    expect((await listFilingJobs(s.admin, 'pending'))[0]!.error).toBe('Access denied');

    await revokeSyncDevice(s.admin, id);
    expect(await deviceFromRequest(req(token))).toBeNull();
  });

  it('brings in AP invoices from the inbox and tells the app where to move each file', async () => {
    const s = await setup();
    await saveFilingSettings(s.admin, s.a.id, { ...DEFAULT_FILING, enabled: false, mode: 'SYNC', root: 'P:\\Bowron' });
    await saveAccountingSettings(s.admin, s.a.id, { ...DEFAULT_ACCOUNTING, folders: { inbox: 'P:\\AP\\Inbox', inReview: 'P:\\AP\\In review', approved: 'P:\\AP\\Approved', rejected: 'P:\\AP\\Rejected', held: 'P:\\AP\\Held' } });
    await saveAiSettings(s.admin, { enabled: true, model: 'claude-sonnet-5-5', apiKey: 'sk-ant-api03-test-key-abcdefghijklmnopqrstuvwxyz1234', monthlyCapCad: null, usdToCad: 1.37, priceInputUsdPerM: 3, priceOutputUsdPerM: 15, sttProvider: 'none' });
    const read: InvoiceScanResult = { documentType: 'INVOICE', refInvoiceNumber: null, vendorName: 'Nobody We Know', invoiceNumber: `INV-${uid()}`, invoiceDate: '2026-10-01', dueDate: null, poNumber: null, subtotal: 100, gst: 5, pst: 7, total: 112, lines: [] };
    setClaudeForTests(async () => ({ input: read, inputTokens: 1, outputTokens: 1 }));

    const cfg = await syncConfig(s.org.id);
    expect(cfg.companies.find((c) => c.id === s.a.id)!.apFolders?.inbox).toBe('P:\\AP\\Inbox');
    const file = new File([new Uint8Array([37, 80, 68, 70, 9, 8, 7])], 'inv-1.pdf', { type: 'application/pdf' });
    const up = await syncApUpload(s.org.id, s.a.id, 'P:\\AP\\Inbox\\inv-1.pdf', file);
    expect(up.duplicate).toBe(false);
    expect((await syncApUpload(s.org.id, s.a.id, 'P:\\AP\\Inbox\\inv-1.pdf', file)).duplicate).toBe(true);
    await expect(syncApUpload(s.org.id, s.a.id, 'P:\\AP\\Inbox\\notes.docx', new File([new Uint8Array([1])], 'notes.docx'))).rejects.toThrow(/PDF and image/);

    let moves = await syncApMoves(s.org.id);
    expect(moves).toEqual([{ id: up.id, from: 'P:\\AP\\Inbox\\inv-1.pdf', toFolder: 'P:\\AP\\In review', state: 'IN_REVIEW' }]);
    await syncApMoved(s.org.id, up.id!, 'IN_REVIEW', 'P:\\AP\\In review\\inv-1.pdf');
    expect(await syncApMoves(s.org.id)).toEqual([]);
    await db.apInvoice.update({ where: { id: up.id! }, data: { status: 'APPROVED' } });
    moves = await syncApMoves(s.org.id);
    expect(moves[0]).toMatchObject({ from: 'P:\\AP\\In review\\inv-1.pdf', toFolder: 'P:\\AP\\Approved', state: 'APPROVED' });
  });
});

describe('import tools', () => {
  it('imports jobs, contacts, cost codes and customers from a sheet, updating ones already there', async () => {
    const s = await setup();
    const jobs = await runImport(s.admin, {
      dataset: 'jobs',
      companyId: s.a.id,
      headers: ['Job #', 'Name', 'City', 'Start', 'PST exempt'],
      rows: [
        ['2301', 'Harbour Bridge', 'Victoria', '10/20/2026', 'yes'],
        ['2249', 'Job A renamed', 'Nanaimo', '', ''],
        ['', 'No number', '', '', ''],
      ],
      mapping: { jobNumber: 0, name: 1, city: 2, startDate: 3, pstExempt: 4 },
      updateExisting: true,
    });
    expect(jobs).toMatchObject({ created: 1, updated: 1 });
    expect(jobs.skipped).toEqual([{ row: 4, reason: 'Job # and name are needed' }]);
    const harbour = await db.site.findFirstOrThrow({ where: { organizationId: s.org.id, jobNumber: '2301' } });
    expect(harbour).toMatchObject({ name: 'Harbour Bridge', city: 'Victoria', pstExempt: true, companyId: s.a.id });
    expect(harbour.startDate?.toISOString().slice(0, 10)).toBe('2026-10-20');
    expect((await db.site.findUniqueOrThrow({ where: { id: s.jobA.id } })).name).toBe('Job A renamed');

    const contacts = await runImport(s.admin, {
      dataset: 'contacts',
      companyId: s.a.id,
      headers: ['Business', 'Contact', 'Type', 'Email'],
      rows: [
        ['Coastal Steel', 'Pat Lee', 'Supplier', 'pat@coastal.example'],
        ['Island Haul', 'Sam Ray', 'Trucking', ''],
        ['Coastal Steel', 'Pat Lee', 'Supplier', 'PAT@coastal.example'],
      ],
      mapping: { businessName: 0, name: 1, type: 2, email: 3 },
      updateExisting: true,
    });
    expect(contacts).toMatchObject({ created: 2, updated: 1, skipped: [] });
    expect((await db.contact.findFirstOrThrow({ where: { organizationId: s.org.id, name: 'Sam Ray' } })).type).toBe('TRUCKING');

    const codes = await runImport(s.admin, { dataset: 'costCodes', companyId: s.a.id, headers: ['Code', 'Desc'], rows: [['300', 'Piling'], ['310', 'Steel'], ['300', 'Piling (driven)']], mapping: { code: 0, description: 1 }, updateExisting: true });
    expect(codes).toMatchObject({ created: 2, updated: 1 });
    const noUpdate = await runImport(s.admin, { dataset: 'costCodes', companyId: s.a.id, headers: ['Code'], rows: [['300']], mapping: { code: 0 }, updateExisting: false });
    expect(noUpdate.skipped[0]!.reason).toMatch(/already there/);

    const customers = await runImport(s.admin, { dataset: 'customers', companyId: s.a.id, headers: ['Customer', 'Terms'], rows: [['City of Victoria', '45'], ['city of victoria', 'x']], mapping: { name: 0, termsDays: 1 }, updateExisting: true });
    expect(customers).toMatchObject({ created: 1, updated: 1 });
    expect((await db.customer.findFirstOrThrow({ where: { companyId: s.a.id } })).termsDays).toBe(30);

    await expect(runImport(s.site, { dataset: 'costCodes', companyId: s.a.id, headers: ['Code'], rows: [['1']], mapping: { code: 0 }, updateExisting: true })).rejects.toThrow(/permission|access/i);
    await expect(runImport(s.admin, { dataset: 'jobs', companyId: s.a.id, headers: ['Name'], rows: [['x']], mapping: { name: 0 }, updateExisting: true })).rejects.toThrow(/Job #/);
  });
});

describe('export mappings and data export', () => {
  it('runs a saved mapping as CSV with the chosen columns, names and date format', async () => {
    const s = await setup();
    await issue(s);
    const m = await saveExportMapping(s.admin, null, {
      name: 'Sage Intacct POs',
      target: 'sage-intacct',
      dataset: 'PO_LINES',
      companyId: s.a.id,
      format: 'csv',
      dateFormat: 'MM/DD/YYYY',
      columns: [
        { field: 'poNumber', header: 'DOCNO' },
        { field: 'vendor', header: 'VENDOR NAME' },
        { field: 'orderedDate', header: 'WHENCREATED' },
        { field: 'amount', header: 'PRICE' },
        { field: 'fixed', header: 'CURRENCY', fixed: 'CAD' },
      ],
    });
    await expect(saveExportMapping(s.admin, null, { ...m, columns: [{ field: 'nope', header: 'X' }] })).rejects.toThrow(/Unknown column/);
    const today = new Date().toISOString().slice(0, 10);
    const out = await runExportMapping(s.buyer, m.id, '2020-01-01', today);
    expect(out.rows).toBe(1);
    const lines = new TextDecoder().decode(out.bytes).trim().split('\r\n');
    expect(lines[0]).toBe('DOCNO,VENDOR NAME,WHENCREATED,PRICE,CURRENCY');
    expect(lines[1]).toMatch(/^P-\w+,Coastal Steel,\d{2}\/\d{2}\/\d{4},1000,CAD$/);
    await expect(runExportMapping(s.site, m.id, '2020-01-01', today)).rejects.toThrow(/permission|access/i);
  });

  it('exports all of the organization as a ZIP without keys or secrets', async () => {
    const s = await setup();
    await createSyncDevice(s.admin, 'Office PC');
    await issue(s);
    const { bytes, fileName } = await exportAllData(s.admin, { includeFiles: true });
    expect(fileName).toMatch(/^Bowron-export-.+\.zip$/);
    const zip = await JSZip.loadAsync(bytes);
    const companies = JSON.parse(await zip.file('data/company.json')!.async('string'));
    expect(companies.map((c: { code: string }) => c.code).sort()).toEqual(['AAA', 'BBB']);
    const devices = await zip.file('data/syncDevice.json')!.async('string');
    expect(devices).not.toMatch(/tokenHash/);
    const files = JSON.parse(await zip.file('data/fileAsset.json')!.async('string'));
    expect(files.length).toBeGreaterThan(0);
    expect(JSON.stringify(files)).not.toMatch(/storageKey/);
    expect(Object.keys(zip.files).some((f) => f.startsWith('files/'))).toBe(true);
    expect(await zip.file('README.txt')!.async('string')).toMatch(/never exported/);
    await expect(exportAllData(s.buyer, { includeFiles: false })).rejects.toThrow(/permission|access/i);
    // keep the export on disk for a quick look if a test fails
    writeFileSync(path.join(tmpdir(), 'sl-last-export.zip'), bytes);
    expect(readFileSync(path.join(tmpdir(), 'sl-last-export.zip')).length).toBe(bytes.length);
  });
});
