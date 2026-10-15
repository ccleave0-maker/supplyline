import type { InviteInput, InviteListItem, ProfileUpdateInput, Role, UserListItem, UserUpdateInput } from '@supplyline/core/models';
import { db } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { env } from '../lib/env';
import { badRequest, conflict, notFound } from '../lib/errors';
import { sendEmail, viaName } from '../integrations/email';
import { buildMe } from './me';

const INVITE_DAYS = 14;

export async function listUsers(auth: AuthContext, includeInactive = false): Promise<UserListItem[]> {
  // Admins manage people; procurement may also see the list to staff job profiles.
  requirePermission(auth, 'site:edit');
  const users = await db.user.findMany({
    where: { organizationId: auth.orgId, deletedAt: null, ...(includeInactive ? {} : { active: true }) },
    include: { memberships: { select: { siteId: true } } },
    orderBy: { name: 'asc' },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    initials: u.initials,
    phone: u.phone,
    roles: u.roles as Role[],
    companyId: u.companyId,
    active: u.active,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    siteIds: u.memberships.map((m) => m.siteId),
    extraCompanyIds: u.extraCompanyIds,
    procurementScope: u.procurementScope as 'ALL' | 'JOBS' | 'EQUIPMENT',
  }));
}

async function validateCompanyAndSites(auth: AuthContext, companyId: string | null | undefined, siteIds: string[] | undefined) {
  if (companyId) {
    const c = await db.company.findFirst({ where: { id: companyId, organizationId: auth.orgId } });
    if (!c) throw badRequest('Company not found.');
  }
  if (siteIds?.length) {
    const n = await db.site.count({ where: { id: { in: siteIds }, organizationId: auth.orgId } });
    if (n !== new Set(siteIds).size) throw badRequest('One of the selected jobs or yards was not found.');
  }
}

async function otherActiveAdmins(auth: AuthContext, exceptUserId: string) {
  return db.user.count({
    where: { organizationId: auth.orgId, id: { not: exceptUserId }, active: true, deletedAt: null, roles: { has: 'ADMIN' } },
  });
}

export async function updateUser(auth: AuthContext, id: string, input: UserUpdateInput) {
  requirePermission(auth, 'user:manage');
  const before = await db.user.findFirst({ where: { id, organizationId: auth.orgId, deletedAt: null } });
  if (!before) throw notFound('User');
  if (before.isPlatformOwner && !auth.isPlatformOwner) throw badRequest('The platform owner can only be changed by themselves.');
  await validateCompanyAndSites(auth, input.companyId, input.siteIds);

  const losingAdmin =
    before.roles.includes('ADMIN') && ((input.roles && !input.roles.includes('ADMIN')) || input.active === false);
  if (losingAdmin && (await otherActiveAdmins(auth, id)) === 0) {
    throw conflict('This is the only admin. Make someone else an admin first.');
  }

  const { siteIds, ...fields } = input;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: fields });
    if (siteIds) {
      await tx.siteMembership.deleteMany({ where: { userId: id } });
      await tx.siteMembership.createMany({ data: siteIds.map((siteId) => ({ siteId, userId: id })) });
    }
    if (input.active === false) {
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(tx, auth, 'user.update', 'User', id, { roles: before.roles, companyId: before.companyId, active: before.active }, input);
  });
}

export async function updateOwnProfile(auth: AuthContext, input: ProfileUpdateInput) {
  await db.user.update({ where: { id: auth.userId }, data: input });
  await audit(db, auth, 'user.profile_update', 'User', auth.userId, null, input);
  return buildMe(auth.userId);
}

export async function listInvites(auth: AuthContext): Promise<InviteListItem[]> {
  requirePermission(auth, 'user:manage');
  const invites = await db.invite.findMany({
    where: { organizationId: auth.orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { invitedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return invites.map((i) => ({
    id: i.id,
    email: i.email,
    name: i.name,
    roles: i.roles as Role[],
    companyId: i.companyId,
    siteIds: i.siteIds,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    invitedByName: i.invitedBy?.name ?? null,
  }));
}

export async function sendInviteEmail(opts: {
  email: string;
  orgName: string;
  organizationId: string;
  inviterName: string | null;
  inviterEmail: string | null;
  inviteId: string;
}) {
  const appUrl = env().APP_URL;
  await sendEmail(
    {
      fromName: viaName(opts.inviterName),
      replyTo: opts.inviterEmail,
      to: [opts.email],
      subject: `You're invited to ${opts.orgName} on Bowron`,
      text:
        `${opts.inviterName ?? 'Your administrator'} has given you access to ${opts.orgName} on Bowron.\n\n` +
        `To sign in, open ${appUrl} (or the Bowron app) and enter this email address: ${opts.email}\n` +
        `We'll email you a 6-digit code — no password needed.\n\n` +
        `This invite expires in ${INVITE_DAYS} days.`,
    },
    { organizationId: opts.organizationId, relatedType: 'invite', relatedId: opts.inviteId },
  );
}

export async function createInvite(auth: AuthContext, input: InviteInput) {
  requirePermission(auth, 'user:manage');
  if (await db.user.findUnique({ where: { email: input.email } })) {
    throw conflict('Someone with that email already has access.');
  }
  await validateCompanyAndSites(auth, input.companyId, input.siteIds);

  const invite = await db.$transaction(async (tx) => {
    // Replace any earlier pending invite for the same email.
    await tx.invite.updateMany({
      where: { organizationId: auth.orgId, email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const i = await tx.invite.create({
      data: {
        organizationId: auth.orgId,
        companyId: input.companyId,
        email: input.email,
        name: input.name,
        roles: input.roles,
        siteIds: input.siteIds,
        invitedById: auth.userId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      },
    });
    await audit(tx, auth, 'invite.create', 'Invite', i.id, null, input);
    return i;
  });

  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
  await sendInviteEmail({
    email: input.email,
    orgName: org.name,
    organizationId: org.id,
    inviterName: auth.name,
    inviterEmail: auth.email,
    inviteId: invite.id,
  });
  return { id: invite.id };
}

export async function revokeInvite(auth: AuthContext, id: string) {
  requirePermission(auth, 'user:manage');
  const i = await db.invite.findFirst({ where: { id, organizationId: auth.orgId } });
  if (!i) throw notFound('Invite');
  await db.invite.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(db, auth, 'invite.revoke', 'Invite', id, { email: i.email }, null);
}
