import type { Prisma } from '../generated/prisma/client';
import { can } from '@supplyline/core/permissions';
import { db } from '../lib/db';
import { isAdmin, type AuthContext } from '../lib/auth';
import { forbidden, notFound } from '../lib/errors';

/** Companies served by the yards this user belongs to. */
async function yardServedCompanyIds(auth: AuthContext): Promise<string[]> {
  const rows = await db.yardCompany.findMany({
    where: { yard: { organizationId: auth.orgId, members: { some: { userId: auth.userId } } } },
    select: { companyId: true },
  });
  return [...new Set(rows.map((r) => r.companyId))];
}

/** Every company (business unit) this user may work in. Admins: every company in the organization. */
export async function allUnitIds(auth: AuthContext): Promise<string[]> {
  if (isAdmin(auth)) {
    const all = await db.company.findMany({ where: { organizationId: auth.orgId }, select: { id: true } });
    return all.map((c) => c.id);
  }
  const ids = new Set<string>();
  if (auth.companyId) ids.add(auth.companyId);
  for (const id of auth.extraCompanyIds ?? []) ids.add(id);
  if (auth.roles.includes('YARD')) for (const id of await yardServedCompanyIds(auth)) ids.add(id);
  return [...ids];
}

/** True when lists should show only the business unit the person is working in. */
export function isolating(auth: AuthContext): boolean {
  return !isAdmin(auth) && !!auth.activeCompanyId && (auth.access?.isolateUnits ?? false);
}

/**
 * Company IDs this user may see right now. With business-unit isolation on (Admin › Access),
 * that's only the unit they're working in. crossUnit: the load builder / schedule see all their units.
 */
export async function accessibleCompanyIds(auth: AuthContext, opts: { crossUnit?: boolean } = {}): Promise<string[]> {
  const all = await allUnitIds(auth);
  if (opts.crossUnit || !isolating(auth) || !all.includes(auth.activeCompanyId!)) return all;
  return [auth.activeCompanyId!];
}

/**
 * Which jobs/yards a user can see:
 *  - Admin: everything in the organization
 *  - Procurement: all jobs of their company + yards serving it
 *  - Yard: their yards + jobs of the companies those yards serve + their company's jobs
 *  - Site: only the jobs/yards they're a member of
 */
export async function siteWhereFor(auth: AuthContext): Promise<Prisma.SiteWhereInput> {
  const base: Prisma.SiteWhereInput = { organizationId: auth.orgId };
  if (isAdmin(auth)) return base;

  const or: Prisma.SiteWhereInput[] = [{ members: { some: { userId: auth.userId } } }];
  // Their business units (home + extra units an admin gave them).
  const units = [...new Set([...(auth.companyId ? [auth.companyId] : []), ...(auth.extraCompanyIds ?? [])])];
  if ((auth.roles.includes('PROCUREMENT') || auth.roles.includes('AP')) && units.length) {
    or.push({ type: 'JOB', companyId: { in: units } });
    or.push({ type: 'YARD', yardCompanies: { some: { companyId: { in: units } } } });
  }
  if (auth.roles.includes('YARD')) {
    const served = [...(await yardServedCompanyIds(auth)), ...units];
    if (served.length) or.push({ type: 'JOB', companyId: { in: served } });
  }
  // Business-unit isolation: jobs of the unit they're working in only (yards are shared).
  if (isolating(auth) && (await allUnitIds(auth)).includes(auth.activeCompanyId!)) {
    return { ...base, OR: or, AND: [{ OR: [{ type: 'YARD' }, { companyId: auth.activeCompanyId! }] }] };
  }
  return { ...base, OR: or };
}

export async function assertSiteVisible(auth: AuthContext, siteId: string) {
  const site = await db.site.findFirst({ where: { AND: [{ id: siteId }, await siteWhereFor(auth)] } });
  if (!site) throw notFound('Job or yard');
  return site;
}

export function canEditSite(auth: AuthContext): boolean {
  return can(auth, 'site:edit');
}

export async function assertCompanyAccessible(auth: AuthContext, companyId: string) {
  const company = await db.company.findFirst({ where: { id: companyId, organizationId: auth.orgId } });
  if (!company) throw notFound('Company');
  if (!isAdmin(auth) && !(await accessibleCompanyIds(auth)).includes(companyId)) {
    // One of their units, just not the one they're working in: say how to get there.
    if ((await allUnitIds(auth)).includes(companyId)) throw forbidden(`You're working in another business unit. Switch to ${company.name} (top of the screen) to work on it.`);
    throw notFound('Company');
  }
  return company;
}

/**
 * Yards this person can work at for a company: yards serving that company
 * (admins: all of them; others: only yards they're a member of).
 */
export async function yardsFor(auth: AuthContext, companyId: string) {
  return db.site.findMany({
    where: {
      organizationId: auth.orgId,
      type: 'YARD',
      active: true,
      yardCompanies: { some: { companyId } },
      ...(isAdmin(auth) || auth.roles.includes('PROCUREMENT') ? {} : { members: { some: { userId: auth.userId } } }),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}
