import type { OrgCreateInput, OrgListItem, OrgUpdateInput } from '@supplyline/core/models';
import { db } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { conflict, notFound } from '../lib/errors';
import { sendInviteEmail } from './users';

// Platform-owner screens: create and manage customer organizations.

export async function listOrganizations(auth: AuthContext): Promise<OrgListItem[]> {
  requirePermission(auth, 'platform:manage');
  const orgs = await db.organization.findMany({
    include: { _count: { select: { companies: true, users: { where: { deletedAt: null, active: true } } } } },
    orderBy: { name: 'asc' },
  });
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    companyCount: o._count.companies,
    userCount: o._count.users,
    aiFallbackEnabled: o.aiFallbackEnabled,
    aiFallbackMonthlyCapCad: o.aiFallbackMonthlyCapCad == null ? null : Number(o.aiFallbackMonthlyCapCad),
    createdAt: o.createdAt.toISOString(),
    plan: o.plan,
    seats: o.seats,
    trialEndsAt: o.trialEndsAt?.toISOString().slice(0, 10) ?? null,
    billingStatus: o.billingStatus,
    billingNotes: o.billingNotes,
  }));
}

/** Creates an organization and invites its first admin. */
export async function createOrganization(auth: AuthContext, input: OrgCreateInput) {
  requirePermission(auth, 'platform:manage');
  if (await db.organization.findUnique({ where: { slug: input.slug } })) throw conflict('That short name is taken.');
  if (await db.user.findUnique({ where: { email: input.adminEmail } })) throw conflict('That admin email already has access.');

  const { org, invite } = await db.$transaction(async (tx) => {
    // New customers start on a 30-day trial.
    const org = await tx.organization.create({ data: { name: input.name, slug: input.slug, plan: 'TRIAL', trialEndsAt: new Date(Date.now() + 30 * 86_400_000) } });
    const invite = await tx.invite.create({
      data: {
        organizationId: org.id,
        email: input.adminEmail,
        name: input.adminName,
        roles: ['ADMIN'],
        siteIds: [],
        invitedById: auth.userId,
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
      },
    });
    await audit(tx, auth, 'organization.create', 'Organization', org.id, null, input, org.id);
    return { org, invite };
  });

  await sendInviteEmail({
    email: input.adminEmail,
    orgName: org.name,
    organizationId: org.id,
    inviterName: auth.name,
    inviterEmail: auth.email,
    inviteId: invite.id,
  });
  return { id: org.id };
}

export async function updateOrganization(auth: AuthContext, id: string, input: OrgUpdateInput) {
  requirePermission(auth, 'platform:manage');
  const before = await db.organization.findUnique({ where: { id } });
  if (!before) throw notFound('Organization');
  await db.$transaction(async (tx) => {
    const { trialEndsAt, ...rest } = input;
    await tx.organization.update({ where: { id }, data: { ...rest, ...(trialEndsAt !== undefined ? { trialEndsAt: trialEndsAt ? new Date(`${trialEndsAt}T23:59:59Z`) : null } : {}) } });
    await audit(
      tx,
      auth,
      'organization.update',
      'Organization',
      id,
      {
        status: before.status,
        aiFallbackEnabled: before.aiFallbackEnabled,
        aiFallbackMonthlyCapCad: before.aiFallbackMonthlyCapCad?.toString() ?? null,
      },
      input,
      id,
    );
  });
}
