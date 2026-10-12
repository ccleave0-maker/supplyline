import type { CostCodeInput, CostCodeItem } from '@supplyline/core/models';
import { db } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { assertCompanyAccessible, assertSiteVisible } from './access';

/** Company-wide codes plus the job's own codes. */
export async function costCodesFor(companyId: string, siteId: string | null) {
  return db.costCode.findMany({
    where: { companyId, active: true, OR: [{ siteId: null }, ...(siteId ? [{ siteId }] : [])] },
    orderBy: { code: 'asc' },
  });
}

export async function listCostCodes(auth: AuthContext, companyId: string, siteId?: string): Promise<CostCodeItem[]> {
  await assertCompanyAccessible(auth, companyId);
  if (siteId) await assertSiteVisible(auth, siteId);
  const codes = await costCodesFor(companyId, siteId ?? null);
  return codes.map((c) => ({ id: c.id, code: c.code, description: c.description, siteId: c.siteId }));
}

export async function createCostCode(auth: AuthContext, companyId: string, input: CostCodeInput) {
  requirePermission(auth, 'costcode:manage');
  await assertCompanyAccessible(auth, companyId);
  if (input.siteId) {
    const site = await assertSiteVisible(auth, input.siteId);
    if (site.companyId !== companyId) throw badRequest('That job belongs to a different company.');
  }
  const existing = await db.costCode.findFirst({
    where: { companyId, siteId: input.siteId ?? null, code: { equals: input.code, mode: 'insensitive' } },
  });
  if (existing?.active) throw conflict(`Cost code ${input.code} already exists.`);
  const c = existing
    ? await db.costCode.update({ where: { id: existing.id }, data: { active: true, description: input.description ?? null } })
    : await db.costCode.create({ data: { companyId, siteId: input.siteId ?? null, code: input.code, description: input.description ?? null } });
  await audit(db, auth, 'costcode.create', 'CostCode', c.id, null, input);
  return { id: c.id, code: c.code, description: c.description, siteId: c.siteId } satisfies CostCodeItem;
}

export async function removeCostCode(auth: AuthContext, companyId: string, id: string) {
  requirePermission(auth, 'costcode:manage');
  await assertCompanyAccessible(auth, companyId);
  const c = await db.costCode.findFirst({ where: { id, companyId } });
  if (!c) throw notFound('Cost code');
  // Deactivate rather than delete: old orders keep showing the code they used.
  await db.costCode.update({ where: { id }, data: { active: false } });
  await audit(db, auth, 'costcode.remove', 'CostCode', id, { code: c.code }, null);
}
