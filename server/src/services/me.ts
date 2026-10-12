import type { CompanySummary, Me, NavLayout, Role } from '@supplyline/core/models';
import { accessOf, mfaStatusOf } from '../lib/auth';
import { navOf } from './access-admin';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { notFound } from '../lib/errors';
import { fileUrl } from './files';

export function toCompanySummary(c: {
  id: string;
  code: string;
  name: string;
  themeColor: string;
  logoFileId: string | null;
  loginBackgroundFileId: string | null;
  settings?: unknown;
}): CompanySummary {
  const a = ((c.settings as { appearance?: { backgroundFileId?: string | null; fade?: number; decal?: boolean } } | null)?.appearance ?? {});
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    themeColor: c.themeColor,
    logoUrl: fileUrl(c.logoFileId),
    loginBackgroundUrl: fileUrl(c.loginBackgroundFileId),
    appearance: { backgroundUrl: fileUrl(a.backgroundFileId ?? null), fade: typeof a.fade === 'number' ? a.fade : 85, decal: !!a.decal },
  };
}

export async function buildMe(userId: string, sessionId?: string): Promise<Me> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { organization: true } });
  if (!user) throw notFound('User');
  const roles = user.roles as Role[];

  let companyIds: string[] | null = null; // null = all (admin)
  if (!roles.includes('ADMIN')) {
    const ids = new Set<string>([...(user.companyId ? [user.companyId] : []), ...user.extraCompanyIds]);
    if (roles.includes('YARD')) {
      const served = await db.yardCompany.findMany({
        where: { yard: { members: { some: { userId } } } },
        select: { companyId: true },
      });
      served.forEach((s) => ids.add(s.companyId));
    }
    companyIds = [...ids];
  }

  const companies = await db.company.findMany({
    where: { organizationId: user.organizationId, ...(companyIds ? { id: { in: companyIds } } : {}) },
    orderBy: { name: 'asc' },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      initials: user.initials,
      phone: user.phone,
      roles,
      isPlatformOwner: user.isPlatformOwner,
      companyId: user.companyId,
      procurementScope: user.procurementScope as 'ALL' | 'JOBS' | 'EQUIPMENT',
    },
    organization: { id: user.organization.id, name: user.organization.name, slug: user.organization.slug },
    companies: companies.map(toCompanySummary),
    features: { googleSignIn: !!env().GOOGLE_CLIENT_ID, webPushKey: env().VAPID_PUBLIC_KEY || null },
    billingNotice: roles.includes('ADMIN') ? billingNotice(user.organization) : null,
    nav: { settings: navOf(user.organization.settings), mine: (user.navLayout as NavLayout | null) ?? null },
    isolateUnits: accessOf(user.organization.settings).isolateUnits,
    mfa: mfaStatusOf(user, sessionId ? await db.session.findUnique({ where: { id: sessionId }, select: { mfaVerifiedAt: true } }) : null, user.organization.settings),
  };
}

/** What an admin should know about the subscription (shown as a banner). */
export function billingNotice(o: { plan: string; trialEndsAt: Date | null; billingStatus: string }): string | null {
  if (o.billingStatus === 'PAST_DUE') return 'The last payment for SupplyLine didn’t go through. Update the card under Account › Billing.';
  if (o.plan === 'TRIAL' && o.trialEndsAt) {
    const days = Math.ceil((o.trialEndsAt.getTime() - Date.now()) / 86_400_000);
    if (days < 0) return 'Your SupplyLine trial has ended. Choose a plan under Account › Billing to keep going.';
    if (days <= 7) return `Your SupplyLine trial ends in ${days} day${days === 1 ? '' : 's'}. Choose a plan under Account › Billing.`;
  }
  if (o.billingStatus === 'CANCELLED' && o.plan !== 'FREE' && o.plan !== 'CUSTOM') return 'Your SupplyLine subscription was cancelled. Choose a plan under Account › Billing.';
  return null;
}
