import { afterAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { db } from '../src/lib/db';
import { addProjectDocument, listProjectDocuments, removeProjectDocument } from '../src/services/project-docs';
import { createPo, getPo, getPoPdf, updatePo } from '../src/services/purchasing';
import { importSuppliers, mapSupplierSheet, previewSuppliers } from '../src/services/supplier-import';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

async function setup() {
  const o = await makeOrg();
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  return { ...o, admin, buyer, site };
}
const csv = (text: string, name = 'vendors.csv') => new File([text], name, { type: 'text/csv' });
async function onePagePdf() {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  d.addPage([612, 792]);
  return new File([Buffer.from(await d.save())], 'agreement.pdf', { type: 'application/pdf' });
}

describe('supplier import', () => {
  it('finds Sage-style columns under a title row', () => {
    const r = mapSupplierSheet([['Vendor list – exported 2026-10-12'], ['Vendor ID', 'Vendor Name', 'Primary Contact', 'Email', 'Phone', 'City'], ['V100', 'Coastal Steel', 'Pat', 'AP@COASTAL.example', '604-555-0100', 'Surrey'], ['', '', '', '', '', '']]);
    expect(r.rows).toEqual([expect.objectContaining({ vendorId: 'V100', name: 'Coastal Steel', contactName: 'Pat', email: 'AP@COASTAL.example', city: 'Surrey' })]);
    expect(r.columns.name).toBe('Vendor Name');
  });

  it('adds new suppliers, fills blanks on existing ones, keeps the vendor ID for Sage', async () => {
    const s = await setup();
    const tag = uid().slice(0, 6);
    await db.contact.create({ data: { organizationId: s.org.id, type: 'VENDOR', name: `Old ${tag}`, businessName: `Old Supply ${tag}`, phone: '111' } });
    const file = csv(`Vendor ID,Vendor Name,Email,Phone\nV1-${tag},New Metals ${tag},sales@new.example,222\nV2-${tag},Old Supply ${tag},ap@old.example,999\nV1-${tag},New Metals ${tag},dup@x.example,`);
    const p = await previewSuppliers(s.admin, file);
    expect([p.total, p.newCount]).toEqual([3, 2]);
    const r = await importSuppliers(s.admin, s.a.id, file);
    expect(r).toEqual({ total: 3, created: 1, updated: 1, skipped: 1 });
    const old = await db.contact.findFirstOrThrow({ where: { organizationId: s.org.id, businessName: `Old Supply ${tag}` } });
    expect([old.email, old.phone]).toEqual(['ap@old.example', '111']); // blank filled, typed value kept
    expect((await db.vendor.findFirstOrThrow({ where: { companyId: s.a.id, name: `New Metals ${tag}` } })).externalId).toBe(`V1-${tag}`);
    await expect(importSuppliers(s.site, s.a.id, file)).rejects.toThrow();
  });
});

describe('project documents on POs', () => {
  it('attached on the job, picked per PO, shown by link name and added at the end of the PO', async () => {
    const s = await setup();
    const { id: docId } = await addProjectDocument(s.admin, s.jobA.id, await onePagePdf(), 'Subcontract agreement');
    await addProjectDocument(s.admin, s.jobA.id, new File(['drawing'], 'S-201.dwg', { type: 'application/octet-stream' }), null);
    const docs = await listProjectDocuments(s.buyer, s.jobA.id);
    expect(docs.map((d) => d.linkName)).toEqual(['Subcontract agreement', 'S-201']);
    const input = { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Sub Co', siteId: s.jobA.id, orderedDate: null, expectedDate: null, lines: [{ description: 'Piling works', qty: 1, uom: 'LOT', unitCost: 60000 }], documentIds: [docId] };
    const po = await createPo(s.buyer, input);
    expect(po.documents.map((d) => d.linkName)).toEqual(['Subcontract agreement']);
    const plain = await getPoPdf(s.buyer, po.id, true); // packing list: no attachments
    const priced = await getPoPdf(s.buyer, po.id, false);
    const pages = (b: Uint8Array) => PDFDocument.load(b).then((d) => d.getPageCount());
    expect(await pages(priced.bytes)).toBe((await pages(plain.bytes)) + 1 + 2); // list page + the agreement's 2 pages
    // Untick it on edit.
    await updatePo(s.buyer, po.id, { ...input, documentIds: [] });
    expect((await getPo(s.buyer, po.id)).documents).toEqual([]);
    // Another job's document can't be attached.
    const { id: other } = await addProjectDocument(s.admin, s.jobB.id, await onePagePdf(), 'Other job');
    await expect(updatePo(s.buyer, po.id, { ...input, documentIds: [other] })).rejects.toThrow(/from this job/);
    await removeProjectDocument(s.admin, docId);
    expect((await listProjectDocuments(s.admin, s.jobA.id)).length).toBe(1);
  });
});
