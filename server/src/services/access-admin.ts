// Admin › Access & menu: business-unit isolation, PO rules, each person's extra
// units and buying scope, and the menu (admin areas + each person's own order).

import { DEFAULT_NAV, navSettingsInput, type AccessSettings, type NavLayout, type NavSettings, type UserAccessInput } from '@supplyline/core/models';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { accessOf, requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, conflict, notFound } from '../lib/errors';

async function orgSettings(orgId: string) {
  const o = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  return (o.settings as Record<string, unknown> | null) ?? {};
}

export async function getAccessSettings(auth: AuthContext): Promise<AccessSettings> {
  requirePermission(auth, 'org:manage');
  return accessOf(await orgSettings(auth.orgId));
}

export async function saveAccessSettings(auth: AuthContext, input: AccessSettings) {
  requirePermission(auth, 'org:manage');
  const s = await orgSettings(auth.orgId);
  await db.organization.update({ where: { id: auth.orgId }, data: { settings: { ...s, access: input } as Prisma.InputJsonValue } });
  await audit(db, auth, 'org.access_settings', 'Organization', auth.orgId, null, input);
  return input;
}

export async function setUserAccess(auth: AuthContext, userId: string, input: UserAccessInput) {
  requirePermission(auth, 'user:manage');
  const u = await db.user.findFirst({ where: { id: userId, organizationId: auth.orgId } });
  if (!u) throw notFound('Person');
  const extra = [...new Set(input.extraCompanyIds.filter((c) => c !== u.companyId))];
  if (extra.length) {
    const found = await db.company.count({ where: { id: { in: extra }, organizationId: auth.orgId } });
    if (found !== extra.length) throw badRequest('One of those companies isn’t in this organization.');
  }
  await db.user.update({ where: { id: userId }, data: { extraCompanyIds: extra, procurementScope: input.procurementScope } });
  await audit(db, auth, 'user.access', 'User', userId, { extraCompanyIds: u.extraCompanyIds, procurementScope: u.procurementScope }, { extraCompanyIds: extra, procurementScope: input.procurementScope });
  return { ok: true };
}

export function navOf(settings: unknown): NavSettings {
  const parsed = navSettingsInput.safeParse((settings as { nav?: unknown } | null)?.nav ?? DEFAULT_NAV);
  return parsed.success ? parsed.data : DEFAULT_NAV;
}

export async function saveNavSettings(auth: AuthContext, input: NavSettings) {
  requirePermission(auth, 'org:manage');
  const ids = input.groups.map((g) => g.id);
  if (new Set(ids).size !== ids.length) throw badRequest('Two menu areas have the same id.');
  const s = await orgSettings(auth.orgId);
  await db.organization.update({ where: { id: auth.orgId }, data: { settings: { ...s, nav: input } as Prisma.InputJsonValue } });
  await audit(db, auth, 'org.nav_settings', 'Organization', auth.orgId, null, input);
  return input;
}

export async function saveMyNav(auth: AuthContext, layout: NavLayout | null) {
  const nav = navOf(await orgSettings(auth.orgId));
  if (layout && !nav.allowPersonal) throw conflict('Your administrator has set the menu for everyone.');
  await db.user.update({ where: { id: auth.userId }, data: { navLayout: layout === null ? (null as unknown as Prisma.InputJsonValue) : (layout as Prisma.InputJsonValue) } });
  return { ok: true };
}
