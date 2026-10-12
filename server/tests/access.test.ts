import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { nextCounter } from '../src/lib/counters';
import { createSite, getSite, listSites, updateSite } from '../src/services/sites';
import { createCompany } from '../src/services/companies';
import { listOrganizations, updateOrganization } from '../src/services/organizations';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

const numbers = (sites: { jobNumber: string }[]) => sites.map((s) => s.jobNumber).sort();

describe('who sees which jobs and yards', () => {
  it('admin sees everything in their organization', async () => {
    const { org } = await makeOrg();
    const { auth } = await makeUser(org.id, ['ADMIN'], null);
    expect(numbers(await listSites(auth, {}))).toEqual(['2249', '26-BC249', 'Y1']);
  });

  it('site user sees only their jobs', async () => {
    const { org, a, jobA } = await makeOrg();
    const { auth } = await makeUser(org.id, ['SITE'], a.id, [jobA.id]);
    expect(numbers(await listSites(auth, {}))).toEqual(['2249']);
  });

  it("procurement sees their company's jobs and the yards serving it", async () => {
    const { org, a } = await makeOrg();
    const { auth } = await makeUser(org.id, ['PROCUREMENT'], a.id);
    expect(numbers(await listSites(auth, {}))).toEqual(['2249', 'Y1']);
  });

  it('yard user in a shared yard sees jobs of every company the yard serves', async () => {
    const { org, a, yard } = await makeOrg();
    const { auth } = await makeUser(org.id, ['YARD'], a.id, [yard.id]);
    expect(numbers(await listSites(auth, {}))).toEqual(['2249', '26-BC249', 'Y1']);
  });

  it('organizations are fully separated', async () => {
    const one = await makeOrg();
    const two = await makeOrg();
    const { auth } = await makeUser(one.org.id, ['ADMIN'], null);
    await expect(getSite(auth, two.jobA.id)).rejects.toThrow(/not found/);
    expect((await listSites(auth, {})).every((s) => s.id !== two.jobA.id)).toBe(true);
  });
});

describe('role permissions are enforced on the server', () => {
  it('only admins create jobs and companies', async () => {
    const { org, a } = await makeOrg();
    const { auth: proc } = await makeUser(org.id, ['PROCUREMENT'], a.id);
    await expect(createSite(proc, { type: 'JOB', companyId: a.id, jobNumber: 'X1', name: 'Nope' })).rejects.toThrow(/access/);
    await expect(createCompany(proc, { name: 'Nope Co', code: 'NOPE', themeColor: '#123456' })).rejects.toThrow(/access/);
  });

  it('site users cannot edit job profiles', async () => {
    const { org, a, jobA } = await makeOrg();
    const { auth } = await makeUser(org.id, ['SITE'], a.id, [jobA.id]);
    await expect(updateSite(auth, jobA.id, { name: 'Changed' })).rejects.toThrow(/access/);
  });

  it('job numbers are unique per company, and every change is audited', async () => {
    const { org, a, b } = await makeOrg();
    const { auth } = await makeUser(org.id, ['ADMIN'], null);
    await expect(createSite(auth, { type: 'JOB', companyId: a.id, jobNumber: '2249', name: 'Dup' })).rejects.toThrow(/already exists/);
    // Same number in a different company is fine.
    const { id } = await createSite(auth, { type: 'JOB', companyId: b.id, jobNumber: '2249', name: 'Other company' });
    const audit = await db.auditLog.findFirst({ where: { entityId: id, action: 'site.create' } });
    expect(audit?.userId).toBe(auth.userId);
    const loc = await db.shippingLocation.findUnique({ where: { siteId: id } });
    expect(loc?.businessName).toBe('JOB#2249 – Other company');
  });

  it('only the platform owner manages organizations; AI fallback is off by default', async () => {
    const { org } = await makeOrg();
    const { auth: admin } = await makeUser(org.id, ['ADMIN'], null);
    await expect(listOrganizations(admin)).rejects.toThrow(/access/);
    const { auth: owner } = await makeUser(org.id, ['ADMIN'], null, [], { owner: true });
    const found = (await listOrganizations(owner)).find((o) => o.id === org.id);
    expect(found?.aiFallbackEnabled).toBe(false);
    await updateOrganization(owner, org.id, { aiFallbackEnabled: true, aiFallbackMonthlyCapCad: 50 });
    const after = (await listOrganizations(owner)).find((o) => o.id === org.id);
    expect(after).toMatchObject({ aiFallbackEnabled: true, aiFallbackMonthlyCapCad: 50 });
  });
});

describe('sequence counters', () => {
  it('count 1, 2, 3 per key with no gaps under concurrency', async () => {
    const key = `list:${uid()}`;
    const values = await Promise.all(Array.from({ length: 20 }, () => nextCounter(db, key)));
    expect(values.sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await nextCounter(db, `list:${uid()}`)).toBe(1);
  });
});
