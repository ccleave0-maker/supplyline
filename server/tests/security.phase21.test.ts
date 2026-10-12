import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SECURITY } from '@supplyline/core/models';
import { authenticate } from '../src/lib/auth';
import { hashSecret, randomToken } from '../src/lib/crypto';
import { db } from '../src/lib/db';
import { resetRateLimits } from '../src/lib/rate-limit';
import { base32Encode, totpAt, stepAt, verifyTotp } from '../src/lib/totp';
import { buildMe } from '../src/services/me';
import { disableMfa, enableMfa, resetUserMfa, runSecurityAlerts, saveSecuritySettings, securityEvents, startMfaSetup, verifyMfa } from '../src/services/security';
import { makeOrg, makeUser } from './helpers';

afterAll(() => db.$disconnect());
beforeEach(() => resetRateLimits());

/** A real signed-in session (token) for a user. */
async function sessionFor(userId: string) {
  const token = randomToken();
  const s = await db.session.create({ data: { userId, tokenHash: hashSecret(token), expiresAt: new Date(Date.now() + 86_400_000) } });
  const req = (p = '/api/v1/sites', method = 'GET') => new Request(`http://localhost${p}`, { method, headers: { authorization: `Bearer ${token}` } });
  return { token, sessionId: s.id, req };
}

describe('authenticator codes (TOTP)', () => {
  it('matches the RFC 6238 test vector and allows one step of drift', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totpAt(secret, 1)).toBe('287082'); // T = 59 s
    expect(verifyTotp(secret, '287082', 59_000)).toBe(1);
    expect(verifyTotp(secret, totpAt(secret, stepAt() - 1))).toBe(stepAt() - 1);
    expect(verifyTotp(secret, totpAt(secret, stepAt() - 3))).toBeNull();
    expect(verifyTotp(secret, 'abc123')).toBeNull();
  });
});

describe('two-step sign-in', () => {
  it('admins must set it up before using the app; then each new session needs a code', async () => {
    const o = await makeOrg();
    const { auth, user } = await makeUser(o.org.id, ['ADMIN'], null);
    const s1 = await sessionFor(user.id);
    const a1 = await authenticate(s1.req());
    expect(a1.mfaPending).toBe('setup');
    expect((await buildMe(user.id, s1.sessionId)).mfa).toEqual({ enabled: false, required: true, pending: 'setup' });

    // The route wrapper blocks everything except the MFA screens and "me".
    const sites = await import('../app/api/v1/sites/route');
    const blocked = await sites.GET(s1.req(), { params: Promise.resolve({}) });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe('mfa_setup_required');
    const me = await import('../app/api/v1/me/route');
    expect((await me.GET(s1.req('/api/v1/me'), { params: Promise.resolve({}) })).status).toBe(200);

    const sAuth = { ...auth, sessionId: s1.sessionId };
    const { secret } = await startMfaSetup(sAuth);
    await expect(enableMfa(sAuth, '000000')).rejects.toThrow(/isn’t right/);
    const { recoveryCodes } = await enableMfa(sAuth, totpAt(secret, stepAt()));
    expect(recoveryCodes).toHaveLength(10);
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.mfaSecretEnc).not.toContain(secret); // encrypted at rest
    expect(stored.mfaRecoveryHashes[0]).not.toBe(recoveryCodes[0]); // hashed
    expect((await authenticate(s1.req())).mfaPending).toBeNull();
    expect((await sites.GET(s1.req(), { params: Promise.resolve({}) })).status).toBe(200);

    // New sign-in: needs the code; the same code can't be used twice; recovery codes work once.
    const s2 = await sessionFor(user.id);
    expect((await authenticate(s2.req())).mfaPending).toBe('verify');
    const a2 = { ...auth, sessionId: s2.sessionId };
    await expect(verifyMfa(a2, totpAt(secret, stepAt()))).rejects.toThrow(/already used/);
    await verifyMfa(a2, recoveryCodes[0]!);
    expect((await authenticate(s2.req())).mfaPending).toBeNull();
    const s3 = await sessionFor(user.id);
    await expect(verifyMfa({ ...auth, sessionId: s3.sessionId }, recoveryCodes[0]!)).rejects.toThrow(/isn’t right/);

    // Required for admins: can't be turned off by them; an admin reset signs them out everywhere.
    await expect(disableMfa(a2, totpAt(secret, stepAt() + 1))).rejects.toThrow(/must use/);
    const { auth: other } = await makeUser(o.org.id, ['ADMIN'], null);
    await resetUserMfa(other, user.id);
    await expect(authenticate(s2.req())).rejects.toThrow();
  });

  it('five wrong codes sign the session out', async () => {
    const o = await makeOrg();
    const { auth, user } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
    const s = await sessionFor(user.id);
    const a = { ...auth, sessionId: s.sessionId };
    const { secret } = await startMfaSetup(a);
    await enableMfa(a, totpAt(secret, stepAt()));
    const s2 = await sessionFor(user.id);
    const a2 = { ...auth, sessionId: s2.sessionId };
    for (let i = 0; i < 4; i++) await expect(verifyMfa(a2, '000000')).rejects.toThrow(/isn’t right/);
    await expect(verifyMfa(a2, '000000')).rejects.toThrow(/signed out/);
    await expect(authenticate(s2.req())).rejects.toThrow();
  });

  it('site users are not required unless the admin requires everyone; admins stay required', async () => {
    const o = await makeOrg();
    const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
    const { user } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
    const s = await sessionFor(user.id);
    expect((await authenticate(s.req())).mfaPending).toBeNull();
    await expect(saveSecuritySettings(admin, { ...DEFAULT_SECURITY, mfaRequiredRoles: ['PROCUREMENT'] })).rejects.toThrow(/Admins must/);
    await saveSecuritySettings(admin, { ...DEFAULT_SECURITY, mfaEveryone: true });
    expect((await authenticate(s.req())).mfaPending).toBe('setup');
  });
});

describe('security alerts from the audit trail', () => {
  it('a new admin and a security change are flagged to admins', async () => {
    const o = await makeOrg();
    const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
    await db.auditLog.create({ data: { organizationId: o.org.id, userId: admin.userId, action: 'org.nav_settings', entityType: 'Organization', entityId: o.org.id } });
    await runSecurityAlerts(); // first run sets the starting point
    await saveSecuritySettings(admin, { ...DEFAULT_SECURITY, mfaEveryone: true });
    await db.auditLog.create({ data: { organizationId: o.org.id, userId: admin.userId, action: 'user.update', entityType: 'User', entityId: 'x', before: { roles: ['SITE'] }, after: { roles: ['ADMIN'] } } });
    const events = await securityEvents(admin);
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['admin.granted', 'security.settings']));
    expect(await runSecurityAlerts()).toBeGreaterThanOrEqual(2);
    expect(await db.notification.count({ where: { userId: admin.userId, type: 'SECURITY' } })).toBe(1);
    expect(await runSecurityAlerts()).toBe(0); // not twice
  });
});

describe('server-side checks on every route', () => {
  const apiDir = path.resolve(import.meta.dirname, '../app/api/v1');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === 'route.ts') files.push(p);
    }
  };
  walk(apiDir);
  /** Open on purpose (sign-in, version info, branding on the sign-in page, client error reports, app updates). */
  const OPEN = ['auth/request-code', 'auth/verify-code', 'auth/google', 'meta', 'public/branding', 'errors', 'app-updates'];

  it('every route refuses requests without a sign-in (or its own key / signature)', async () => {
    expect(files.length).toBeGreaterThan(100);
    const open: string[] = [];
    for (const f of files) {
      const rel = path.relative(apiDir, path.dirname(f)).replace(/\\/g, '/');
      if (OPEN.includes(rel)) continue;
      const mod = (await import(pathToFileURL(f).href)) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        if (!mod[method]) continue;
        resetRateLimits();
        const url = `http://localhost/api/v1/${rel.replace(/\[(\w+)\]/g, 'x')}`;
        const res = await mod[method]!(new Request(url, { method, ...(method === 'GET' ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }) }), { params: Promise.resolve({ id: 'x', key: 'x', target: 'x', arch: 'x', version: 'x' }) });
        if (res.status < 400) open.push(`${method} ${rel} → ${res.status}`);
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      }
    }
    expect(open).toEqual([]);
  }, 120_000);

  it('sign-in endpoints are rate limited per address', async () => {
    const mod = await import('../app/api/v1/auth/request-code/route');
    let limited = 0;
    for (let i = 0; i < 35; i++) {
      const res = await mod.POST(new Request('http://localhost/api/v1/auth/request-code', { method: 'POST', body: JSON.stringify({ email: 'nobody@example.com' }), headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' } }), { params: Promise.resolve({}) });
      if (res.status === 429) limited++;
    }
    expect(limited).toBe(5);
  });
});

describe('CSV exports', () => {
  it('neutralize spreadsheet formulas but keep negative numbers', async () => {
    const { formulaSafe } = await import('../src/services/export-mappings');
    expect(formulaSafe('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(formulaSafe('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(formulaSafe('-100.50')).toBe('-100.50');
    expect(formulaSafe('Rebar 20M')).toBe('Rebar 20M');
  });
});
