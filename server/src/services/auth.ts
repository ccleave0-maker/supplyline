import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthResult, RequestCodeResult } from '@supplyline/core/models';
import { initialsFromName, normalizeEmail } from '@supplyline/core/domain';
import { db } from '../lib/db';
import { audit } from '../lib/audit';
import { SESSION_DAYS, type AuthContext } from '../lib/auth';
import { hashSecret, randomToken, safeEqual, sixDigitCode } from '../lib/crypto';
import { devShowLoginCode, env } from '../lib/env';
import { badRequest, conflict, tooMany, unauthorized } from '../lib/errors';
import { sendEmail } from '../integrations/email';
import { buildMe } from './me';

const CODE_TTL_MINUTES = 10;
const MAX_CODES_PER_15_MIN = 5;
const MAX_ATTEMPTS = 5;

export interface ClientInfo {
  clientApp: string | null;
  clientVersion: string | null;
  userAgent: string | null;
  ip: string | null;
}

const NOT_INVITED = "This email hasn't been invited to Bowron. Ask your administrator for an invite.";

async function findActiveInvite(email: string) {
  return db.invite.findFirst({
    where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
}

/** Sends a 6-digit code. Always answers "ok" so it can't be used to discover who has access. */
export async function requestLoginCode(rawEmail: string, client: ClientInfo): Promise<RequestCodeResult> {
  const email = normalizeEmail(rawEmail);
  const user = await db.user.findUnique({ where: { email } });
  const allowed = (user && user.active && !user.deletedAt) || (!user && (await findActiveInvite(email)));
  if (!allowed) return { ok: true };

  const recent = await db.loginCode.count({ where: { email, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
  if (recent >= MAX_CODES_PER_15_MIN) throw tooMany('Too many codes requested. Wait a few minutes and try again.');

  const code = sixDigitCode();
  await db.loginCode.create({
    data: {
      email,
      codeHash: hashSecret(`${email}:${code}`),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      ip: client.ip,
    },
  });

  await sendEmail(
    {
      fromName: env().EMAIL_FROM_NAME,
      to: [email],
      subject: `Your Bowron sign-in code: ${code}`,
      text:
        `Your Bowron sign-in code is ${code}\n\n` +
        `It expires in ${CODE_TTL_MINUTES} minutes. If you didn't try to sign in, you can ignore this email.`,
    },
    { organizationId: user?.organizationId ?? null, relatedType: 'login' },
  );

  return devShowLoginCode() ? { ok: true, devCode: code } : { ok: true };
}

export async function verifyLoginCode(rawEmail: string, code: string, client: ClientInfo): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  const record = await db.loginCode.findFirst({
    where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) throw badRequest('That code has expired. Request a new one.');
  if (record.attempts >= MAX_ATTEMPTS) throw tooMany('Too many wrong tries. Request a new code.');

  if (!safeEqual(record.codeHash, hashSecret(`${email}:${code}`))) {
    await db.loginCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    const who = await db.user.findUnique({ where: { email }, select: { id: true, organizationId: true } });
    if (who && record.attempts + 1 >= MAX_ATTEMPTS) await audit(db, null, 'auth.code_locked', 'User', who.id, null, { ip: client.ip }, who.organizationId);
    throw badRequest("That code isn't right. Check the email and try again.");
  }
  await db.loginCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });

  const userId = await resolveUserForLogin(email, 'EMAIL', email);
  return startSession(userId, client);
}

let googleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function signInWithGoogle(idToken: string, client: ClientInfo): Promise<AuthResult> {
  const clientId = env().GOOGLE_CLIENT_ID;
  if (!clientId) throw badRequest('Google sign-in is not turned on.');
  googleJwks ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, googleJwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
    }));
  } catch {
    throw unauthorized('Google sign-in failed. Try again or use an email code.');
  }
  const email = typeof payload.email === 'string' ? normalizeEmail(payload.email) : null;
  if (!email || payload.email_verified !== true || !payload.sub) throw unauthorized('Your Google email is not verified.');

  const userId = await resolveUserForLogin(email, 'GOOGLE', payload.sub);
  return startSession(userId, client);
}

/** Finds the user for an email, or turns a pending invite into a user. */
async function resolveUserForLogin(email: string, provider: 'EMAIL' | 'GOOGLE', subject: string): Promise<string> {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.active || existing.deletedAt) throw unauthorized('Your access has been removed. Contact your administrator.');
    await db.authIdentity.upsert({
      where: { provider_providerSubject: { provider, providerSubject: subject } },
      create: { userId: existing.id, provider, providerSubject: subject },
      update: {},
    });
    await db.user.update({ where: { id: existing.id }, data: { lastLoginAt: new Date() } });
    return existing.id;
  }

  const invite = await findActiveInvite(email);
  if (!invite) throw unauthorized(NOT_INVITED);

  return db.$transaction(async (tx) => {
    const name = invite.name?.trim() || email.split('@')[0]!;
    const validSites = await tx.site.findMany({
      where: { id: { in: invite.siteIds }, organizationId: invite.organizationId },
      select: { id: true },
    });
    const user = await tx.user.create({
      data: {
        organizationId: invite.organizationId,
        companyId: invite.companyId,
        email,
        name,
        initials: initialsFromName(name),
        roles: invite.roles,
        lastLoginAt: new Date(),
        identities: { create: { provider, providerSubject: subject } },
        memberships: { create: validSites.map((s) => ({ siteId: s.id })) },
      },
    });
    await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    await audit(tx, null, 'user.invite_accepted', 'User', user.id, null, { email, roles: invite.roles }, invite.organizationId);
    return user.id;
  });
}

async function startSession(userId: string, client: ClientInfo): Promise<AuthResult> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashSecret(token),
      clientApp: client.clientApp,
      clientVersion: client.clientVersion,
      userAgent: client.userAgent?.slice(0, 300) ?? null,
      ip: client.ip?.slice(0, 60) ?? null,
      expiresAt,
    },
  });
  return { token, expiresAt: expiresAt.toISOString(), me: await buildMe(userId, session.id) };
}

export async function logout(auth: AuthContext): Promise<void> {
  await db.session.update({ where: { id: auth.sessionId }, data: { revokedAt: new Date() } });
}

/**
 * In-app account deletion (App Store requirement). Personal data is removed and
 * the account can't sign in; business records it created stay for the company's
 * audit trail, attributed to "Deleted user".
 */
export async function deleteOwnAccount(auth: AuthContext): Promise<void> {
  if (auth.isPlatformOwner) throw conflict('The platform owner account cannot be deleted from the app.');
  if (auth.roles.includes('ADMIN')) {
    const otherAdmins = await db.user.count({
      where: { organizationId: auth.orgId, id: { not: auth.userId }, active: true, deletedAt: null, roles: { has: 'ADMIN' } },
    });
    if (otherAdmins === 0) throw conflict('You are the only admin. Make someone else an admin before deleting your account.');
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: auth.userId },
      data: {
        email: `deleted+${auth.userId}@invalid.supplyline`,
        name: 'Deleted user',
        initials: 'XX',
        phone: null,
        active: false,
        deletedAt: new Date(),
      },
    });
    await tx.authIdentity.deleteMany({ where: { userId: auth.userId } });
    await tx.session.updateMany({ where: { userId: auth.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.siteMembership.deleteMany({ where: { userId: auth.userId } });
    await tx.deviceRegistration.deleteMany({ where: { userId: auth.userId } });
    await tx.mailboxConnection.deleteMany({ where: { userId: auth.userId } });
    await tx.loginCode.deleteMany({ where: { email: auth.email } });
    await audit(tx, auth, 'user.deleted_self', 'User', auth.userId);
  });
}
