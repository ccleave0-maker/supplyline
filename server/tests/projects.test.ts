import { afterAll, describe, expect, it } from 'vitest';
import { emptyDraftRow } from '@supplyline/core/models';
import { taxProfile } from '@supplyline/core/domain';
import { db } from '../src/lib/db';
import { updateCompany } from '../src/services/companies';
import { createEquipment, getEquipment, importEquipment, listEquipment, moveEquipment, parseCsv, previewSheet } from '../src/services/equipment';
import { createDraft, getOrder, saveDraft, submitOrder } from '../src/services/orders';
import { assignPo } from '../src/services/procurement';
import {
  addCompliance,
  complianceOverview,
  createRental,
  deleteRental,
  listQcDocs,
  listRentals,
  listSubcontractDocs,
  todayLocal,
  uploadQcDoc,
  uploadSubcontractDoc,
  vendorCompliance,
} from '../src/services/project';
import { createContact } from '../src/services/contacts';
import { getSite, updateSite } from '../src/services/sites';
import { listDeleted, restoreDeleted } from '../src/services/trash';
import { makeOrg, makeUser } from './helpers';

afterAll(() => db.$disconnect());

const pdf = (name = 'doc.pdf') => new File([new Uint8Array([37, 80, 68, 70, 45, 49])], name, { type: 'application/pdf' });
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const o = await makeOrg();
  const { auth: admin, user: adminUser } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: pm, user: pmUser } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: yard } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  await db.site.update({ where: { id: o.jobA.id }, data: { lat: 49.28, lng: -123.12, province: 'BC' } });
  return { ...o, admin, adminUser, site, pm, pmUser, yard, buyer };
}

describe('jobs / projects', () => {
  it('works out PST from the province and the exemption flag', () => {
    expect(taxProfile('BC').pstRate).toBe(0.07);
    expect(taxProfile('b.c.', true).label).toMatch(/PST exempt/);
    expect(taxProfile('Alberta').label).toBe('GST 5% · no PST in AB');
    expect(taxProfile('ON').hstRate).toBe(0.13);
    expect(taxProfile(null).label).toMatch(/Set the province/);
  });

  it('stores the project manager, client and PST setup', async () => {
    const s = await setup();
    await updateSite(s.admin, s.jobA.id, { projectManagerId: s.pmUser.id, clientName: 'City of Example', startDate: '2026-11-01', pstExempt: true, pstExemptNumber: 'PST-123' });
    const d = await getSite(s.site, s.jobA.id);
    expect(d.projectManager?.name).toBe(s.pmUser.name);
    expect([d.clientName, d.startDate, d.pstExempt, d.pstExemptNumber]).toEqual(['City of Example', '2026-11-01', true, 'PST-123']);
    expect(d.taxLabel).toBe('GST 5% · PST exempt (BC)');
    await expect(updateSite(s.admin, s.jobA.id, { projectManagerId: 'nobody' })).rejects.toThrow(/project manager/);
  });

  it('shows prices only to the allowed roles and the job PM', async () => {
    const s = await setup();
    const { id } = await createDraft(s.site, s.jobA.id);
    await saveDraft(s.site, id, { rows: [{ ...emptyDraftRow('JS'), description: 'Rebar', quantity: '10', uom: 'EA' }] });
    const order = (await submitOrder(s.site, id)).order;
    await assignPo(s.buyer, order.id, { poNumber: `P-${id.slice(-5)}`, vendorName: 'Coastal Steel', lines: [{ lineId: order.lines[0]!.id, qty: 10, unitCost: 12.5 }] });

    expect((await getOrder(s.buyer, id)).lines[0]!.extendedCost).toBe(125);
    expect((await getOrder(s.site, id)).lines[0]!.unitCost).toBeNull();
    await updateSite(s.admin, s.jobA.id, { projectManagerId: s.pmUser.id });
    expect((await getOrder(s.pm, id)).lines[0]!.unitCost).toBe(12.5);
    await updateCompany(s.admin, s.a.id, { priceRoles: ['ADMIN', 'PROCUREMENT', 'SITE'] });
    expect((await getOrder(s.site, id)).lines[0]!.unitCost).toBe(12.5);
  });
});

describe('equipment', () => {
  it('records moves with history and a map position', async () => {
    const s = await setup();
    const { id } = await createEquipment(s.yard, { companyId: s.a.id, unitNumber: 'EX-101', description: '320 excavator', make: 'CAT', year: 2019 });
    await expect(createEquipment(s.yard, { companyId: s.a.id, unitNumber: 'ex-101', description: 'dup' })).rejects.toThrow(/already exists/);
    await expect(createEquipment(s.site, { companyId: s.a.id, unitNumber: 'X', description: 'x' })).rejects.toThrow(/access|permission/i);

    const jobLoc = await db.shippingLocation.findFirstOrThrow({ where: { siteId: s.jobA.id } });
    await moveEquipment(s.site, id, { toText: 'Shop – Kamloops', movedAt: '2026-10-01' });
    const e = await moveEquipment(s.site, id, { toLocationId: jobLoc.id, movedAt: '2026-10-05', notes: 'Low-bed' });
    expect(e.location?.siteId).toBe(s.jobA.id);
    expect([e.lat, e.lng]).toEqual([49.28, -123.12]);
    expect(e.movements.map((m) => [m.fromName, m.toName])).toEqual([
      ['Shop – Kamloops', jobLoc.businessName],
      [null, 'Shop – Kamloops'],
    ]);
    expect((await listEquipment(s.site, { siteId: s.jobA.id })).map((x) => x.unitNumber)).toEqual(['EX-101']);
    expect((await getEquipment(s.site, id)).canEdit).toBe(false);
  });

  it('imports a CSV list, matching columns and updating existing units', async () => {
    const s = await setup();
    await createEquipment(s.yard, { companyId: s.a.id, unitNumber: 'D-7', description: 'old description' });
    const csv = 'Unit #,Description,Make,Year,Serial,PST Exempt,Location\nD-7,"Dozer, D6",CAT,2018,ABC123,yes,Job A\nL-2,Loader,Volvo,20x,,no,Main shop\n,Missing unit,,,,,\nL-2,Dup,,,,,\n';
    expect(parseCsv('a;b\n"x;1";2\n')).toEqual([
      ['a', 'b'],
      ['x;1', '2'],
    ]);
    const preview = await previewSheet(s.yard, new File([csv], 'fleet.csv', { type: 'text/csv' }));
    expect(preview.suggested).toEqual(expect.objectContaining({ unitNumber: 0, description: 1, make: 2, year: 3, serial: 4, pstExempt: 5, location: 6 }));
    const jobName = (await db.shippingLocation.findFirstOrThrow({ where: { siteId: s.jobA.id } })).businessName;
    const rows = preview.rows.map((r) => (r[6] === 'Job A' ? [...r.slice(0, 6), jobName] : r));
    const r = await importEquipment(s.yard, { companyId: s.a.id, headers: preview.headers, rows, mapping: preview.suggested as Record<string, number>, updateExisting: true });
    expect([r.created, r.updated]).toEqual([1, 1]);
    expect(r.skipped.map((x) => x.row)).toEqual([4, 5]);
    const list = await listEquipment(s.yard, { companyId: s.a.id });
    const d7 = list.find((x) => x.unitNumber === 'D-7')!;
    expect([d7.description, d7.year, d7.pstExempt, d7.location?.siteId]).toEqual(['Dozer, D6', 2018, true, s.jobA.id]);
    const l2 = list.find((x) => x.unitNumber === 'L-2')!;
    expect([l2.year, l2.location?.name, l2.location?.id]).toEqual([null, 'Main shop', null]);
  });
});

describe('job areas', () => {
  it('tracks rentals, flags overdue ones, and restores a deleted one', async () => {
    const s = await setup();
    const rentals = await createContact(s.buyer, { type: 'RENTAL', name: 'Desk', businessName: 'Big Rentals', phone: '604-555-0100', email: 'desk@example.com' } as never);
    const today = todayLocal();
    const r = await createRental(s.site, s.jobA.id, {
      contactId: rentals.id,
      description: 'Light tower',
      onRentDate: addDays(today, -10),
      expectedOffDate: addDays(today, -1),
      rate: 95,
      ratePer: 'DAY',
      insured: true,
    });
    expect([r.onRent, r.overdue, r.company?.businessName]).toEqual([true, true, 'Big Rentals']);
    expect((await getSite(s.site, s.jobA.id)).counts.rentalsOnRent).toBe(1);
    await deleteRental(s.site, r.id);
    expect(await listRentals(s.site, s.jobA.id)).toHaveLength(0);
    const bin = (await listDeleted(s.admin)).find((x) => x.label === 'Rental: Light tower')!;
    await restoreDeleted(s.admin, bin.id);
    expect((await listRentals(s.site, s.jobA.id)).map((x) => x.description)).toEqual(['Light tower']);
  });

  it('files MTRs against order lines and finds them by heat number', async () => {
    const s = await setup();
    const { id } = await createDraft(s.site, s.jobA.id);
    await saveDraft(s.site, id, { rows: [{ ...emptyDraftRow('JS'), description: 'HP 310x110 pile', quantity: '6', uom: 'EA' }] });
    const order = (await submitOrder(s.site, id)).order;
    const doc = await uploadQcDoc(s.yard, s.jobA.id, { type: 'MTR', title: 'Pile MTR', heatNumber: 'H-88213', orderLineIds: [order.lines[0]!.id] }, pdf('mtr.pdf'));
    expect(doc.lines[0]!.description).toBe('HP 310x110 pile');
    expect((await listQcDocs(s.site, s.jobA.id, '88213')).map((d) => d.id)).toEqual([doc.id]);
    expect(await listQcDocs(s.site, s.jobA.id, 'nothing-like-this')).toHaveLength(0);
  });

  it('keeps subcontracts to admins, procurement and the PM', async () => {
    const s = await setup();
    await uploadSubcontractDoc(s.buyer, s.jobA.id, { subcontractor: 'Acme Drilling', docType: 'Subcontract agreement', title: 'Agreement', effectiveDate: '2026-10-01' }, pdf());
    await expect(listSubcontractDocs(s.site, s.jobA.id)).rejects.toThrow(/project manager/);
    await updateSite(s.admin, s.jobA.id, { projectManagerId: s.pmUser.id });
    expect((await listSubcontractDocs(s.pm, s.jobA.id)).map((d) => d.subcontractor)).toEqual(['Acme Drilling']);
  });

  it('flags missing and expired WCB / insurance', async () => {
    const s = await setup();
    const sub = await createContact(s.buyer, { type: 'SUBCONTRACTOR', name: 'Office', businessName: 'Acme Drilling Ltd' } as never);
    let all = await complianceOverview(s.buyer);
    expect(all.find((x) => x.contactId === sub.id)?.state).toBe('MISSING');
    const today = todayLocal();
    await addCompliance(s.buyer, sub.id, { kind: 'WCB', reference: '123456', expiresOn: addDays(today, -3) }, pdf('wcb.pdf'));
    const after = await addCompliance(s.buyer, sub.id, { kind: 'INSURANCE', provider: 'Example Mutual', expiresOn: addDays(today, 200) }, null);
    expect([after.summary.wcb, after.summary.insurance, after.summary.state]).toEqual(['EXPIRED', 'OK', 'EXPIRED']);
    expect(after.summary.problems[0]).toMatch(/WCB clearance expired/);
    expect(after.records.find((r) => r.kind === 'WCB')?.file?.fileName).toBe('wcb.pdf');
    // A vendor typed on a PO is matched by business name.
    expect((await vendorCompliance(s.buyer, s.a.id, 'acme drilling ltd'))?.state).toBe('EXPIRED');
    expect(await vendorCompliance(s.buyer, s.a.id, 'Unknown Co')).toBeNull();
    await expect(addCompliance(s.site, sub.id, { kind: 'WCB' }, null)).rejects.toThrow(/access|permission/i);
    all = await complianceOverview(s.buyer);
    expect(all[0]!.state).toBe('EXPIRED');
  });
});
