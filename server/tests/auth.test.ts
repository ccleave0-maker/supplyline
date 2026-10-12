import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { authenticate } from '../src/lib/auth';
import { deleteOwnAccount, requestLoginCode, verifyLoginCode } from '../src/services/auth';
import { createInvite } from '../src/services/users';
import { client, makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

describe('email-code login', () => {
  it('signs in an existing user with the emailed code', async () => {
    const { org } = await makeOrg();
    const { user } = await makeUser(org.id, ['SITE'], null);
    const { devCode } = await requestLoginCode(user.email.toUpperCase(), client);
    expect(devCode).toMatch(/^\d{6}$/);
    const result = await verifyLoginCode(user.email, devCode!, client);
    expect(result.me.user.id).toBe(user.id);

    const ctx = await authenticate(new Request('http://x', { headers: { authorization: `Bearer ${result.token}` } }));
    expect(ctx.userId).toBe(user.id);
  });

  it('does not reveal or send codes to uninvited emails', async () => {
    const r = await requestLoginCode(`stranger-${uid()}@gmail.com`, client);
    expect(r).toEqual({ ok: true });
  });

  it('rejects a wrong code and locks after 5 tries', async () => {
    const { org } = await makeOrg();
    const { user } = await makeUser(org.id, ['SITE'], null);
    const { devCode } = await requestLoginCode(user.email, client);
    const wrong = devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expect(verifyLoginCode(user.email, wrong, client)).rejects.toThrow(/isn't right/);
    await expect(verifyLoginCode(user.email, devCode!, client)).rejects.toThrow(/Too many/);
  });

  it('codes are single-use', async () => {
    const { org } = await makeOrg();
    const { user } = await makeUser(org.id, ['SITE'], null);
    const { devCode } = await requestLoginCode(user.email, client);
    await verifyLoginCode(user.email, devCode!, client);
    await expect(verifyLoginCode(user.email, devCode!, client)).rejects.toThrow(/expired/);
  });

  it('turns an invite into a user with roles, company and jobs on first sign-in', async () => {
    const { org, a, jobA } = await makeOrg();
    const { auth: admin } = await makeUser(org.id, ['ADMIN'], null);
    const email = `new-${uid()}@gmail.com`;
    await createInvite(admin, { email, name: 'New Person', companyId: a.id, roles: ['SITE', 'YARD'], siteIds: [jobA.id] });

    const { devCode } = await requestLoginCode(email, client);
    const result = await verifyLoginCode(email, devCode!, client);
    expect(result.me.user.roles.sort()).toEqual(['SITE', 'YARD']);
    expect(result.me.user.companyId).toBe(a.id);
    expect(result.me.user.initials).toBe('NP');
    const membership = await db.siteMembership.findFirst({ where: { userId: result.me.user.id, siteId: jobA.id } });
    expect(membership).not.toBeNull();
  });

  it('blocks deactivated users', async () => {
    const { org } = await makeOrg();
    const { user } = await makeUser(org.id, ['SITE'], null);
    const { devCode } = await requestLoginCode(user.email, client);
    const { token } = await verifyLoginCode(user.email, devCode!, client);
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    await expect(authenticate(new Request('http://x', { headers: { authorization: `Bearer ${token}` } }))).rejects.toThrow(/access has been removed/);
  });

  it('account deletion anonymizes and ends sessions; last admin is protected', async () => {
    const { org } = await makeOrg();
    const { auth: soleAdmin } = await makeUser(org.id, ['ADMIN'], null);
    await expect(deleteOwnAccount(soleAdmin)).rejects.toThrow(/only admin/);

    const { user, auth } = await makeUser(org.id, ['SITE'], null);
    await deleteOwnAccount(auth);
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).not.toBe(user.email);
    expect(after.name).toBe('Deleted user');
    expect(after.active).toBe(false);
  });
});
