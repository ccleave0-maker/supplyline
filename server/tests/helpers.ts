import { randomUUID } from 'node:crypto';
import type { Role } from '@supplyline/core/models';
import type { AuthContext } from '../src/lib/auth';
import { db } from '../src/lib/db';
import { syncShippingLocation } from '../src/services/sites';

export const uid = () => randomUUID().slice(0, 8);

export async function makeOrg() {
  const s = uid();
  const org = await db.organization.create({ data: { name: `Org ${s}`, slug: `org-${s}` } });
  const a = await db.company.create({ data: { organizationId: org.id, code: 'AAA', name: 'Alpha Co', themeColor: '#E8701A' } });
  const b = await db.company.create({ data: { organizationId: org.id, code: 'BBB', name: 'Beta Co', themeColor: '#2E7D32' } });
  const jobA = await db.site.create({ data: { organizationId: org.id, companyId: a.id, type: 'JOB', jobNumber: '2249', name: 'Job A' } });
  const jobB = await db.site.create({ data: { organizationId: org.id, companyId: b.id, type: 'JOB', jobNumber: '26-BC249', name: 'Job B' } });
  const yard = await db.site.create({
    data: { organizationId: org.id, type: 'YARD', jobNumber: 'Y1', name: 'Shared Yard', yardCompanies: { create: [{ companyId: a.id }, { companyId: b.id }] } },
  });
  // Real jobs and yards always have a shipping location (it is where inventory sits).
  await db.$transaction(async (tx) => {
    for (const s of [jobA, jobB, yard]) await syncShippingLocation(tx, s.id);
  });
  return { org, a, b, jobA, jobB, yard };
}

export async function makeUser(orgId: string, roles: Role[], companyId: string | null, siteIds: string[] = [], opts: { owner?: boolean } = {}) {
  const user = await db.user.create({
    data: {
      organizationId: orgId,
      companyId,
      email: `${uid()}@example.com`,
      name: `Test ${roles.join('-')}`,
      initials: 'TT',
      roles,
      isPlatformOwner: opts.owner ?? false,
      memberships: { create: siteIds.map((siteId) => ({ siteId })) },
    },
  });
  const auth: AuthContext = {
    sessionId: 'test',
    userId: user.id,
    orgId,
    companyId,
    email: user.email,
    name: user.name,
    roles,
    isPlatformOwner: user.isPlatformOwner,
    clientApp: 'test',
    clientVersion: '0',
  };
  return { user, auth };
}

export const client = { clientApp: 'web', clientVersion: '0.1.0', userAgent: 'vitest', ip: '127.0.0.1' };
