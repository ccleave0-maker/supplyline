import { createHmac } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { env } from '../src/lib/env';
import { getBilling, startCheckout, stripeWebhook, verifyStripeSignature } from '../src/services/billing';
import { listErrors, recordError, resolveError } from '../src/services/errors';
import { billingNotice, buildMe } from '../src/services/me';
import { createOrganization, listOrganizations, updateOrganization } from '../src/services/organizations';
import { dispatchPushes, registerPush, setPushSenderForTests } from '../src/services/push';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());
afterEach(() => setPushSenderForTests(null, false));

const sign = (body: string, secret: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

describe('subscriptions', () => {
  it('new customers get a 30-day trial; the owner can change plan and seats', async () => {
    const o = await makeOrg();
    const { auth: owner } = await makeUser(o.org.id, ['ADMIN'], null, [], { owner: true });
    const slug = `cust-${uid()}`.toLowerCase().slice(0, 30);
    const { id } = await createOrganization(owner, { name: 'Customer Co', slug, adminEmail: `${uid()}@example.com`, adminName: 'Admin' });
    let row = (await listOrganizations(owner)).find((x) => x.id === id)!;
    expect(row.plan).toBe('TRIAL');
    expect(new Date(row.trialEndsAt!).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    await updateOrganization(owner, id, { plan: 'CUSTOM', seats: 25, trialEndsAt: null, billingNotes: 'Invoiced yearly' });
    row = (await listOrganizations(owner)).find((x) => x.id === id)!;
    expect(row).toMatchObject({ plan: 'CUSTOM', seats: 25, trialEndsAt: null, billingNotes: 'Invoiced yearly' });
  });

  it('shows admins their plan and a notice when the trial is ending; online payments stay off without keys', async () => {
    const o = await makeOrg();
    const { auth: admin, user } = await makeUser(o.org.id, ['ADMIN'], null);
    const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id);
    await db.organization.update({ where: { id: o.org.id }, data: { plan: 'TRIAL', trialEndsAt: new Date(Date.now() + 3 * 86_400_000) } });
    const b = await getBilling(admin);
    expect(b).toMatchObject({ plan: 'TRIAL', trialDaysLeft: 3, seatsUsed: 2, onlinePayments: false, plans: [], canManage: false });
    await expect(getBilling(site)).rejects.toThrow(/permission|access/i);
    await expect(startCheckout(admin, 'STANDARD', 5)).rejects.toThrow(/aren’t set up/);
    expect((await buildMe(user.id)).billingNotice).toBe('Your Bowron trial ends in 3 days. Choose a plan under Account › Billing.');
    expect(billingNotice({ plan: 'TRIAL', trialEndsAt: new Date(Date.now() - 86_400_000), billingStatus: 'NONE' })).toMatch(/has ended/);
    expect(billingNotice({ plan: 'FREE', trialEndsAt: null, billingStatus: 'NONE' })).toBeNull();
  });

  it('accepts only correctly signed Stripe events and updates the subscription', async () => {
    const o = await makeOrg();
    const secret = 'whsec_test_secret';
    const e = env() as { STRIPE_WEBHOOK_SECRET: string };
    const before = e.STRIPE_WEBHOOK_SECRET;
    e.STRIPE_WEBHOOK_SECRET = secret;
    try {
      const done = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: o.org.id, customer: `cus_${uid()}`, subscription: `sub_${uid()}`, metadata: { plan: 'PRO' } } } });
      await expect(stripeWebhook(done, 'bad')).rejects.toThrow(/signature/i);
      await expect(stripeWebhook(done, sign(done, secret, Math.floor(Date.now() / 1000) - 3600))).rejects.toThrow(/signature/i); // too old
      await stripeWebhook(done, sign(done, secret));
      let org = await db.organization.findUniqueOrThrow({ where: { id: o.org.id } });
      expect(org).toMatchObject({ plan: 'PRO', billingStatus: 'ACTIVE', trialEndsAt: null });

      const failed = JSON.stringify({ id: 'evt_2', type: 'invoice.payment_failed', data: { object: { customer: org.stripeCustomerId } } });
      await stripeWebhook(failed, sign(failed, secret));
      expect((await db.organization.findUniqueOrThrow({ where: { id: o.org.id } })).billingStatus).toBe('PAST_DUE');

      const upd = JSON.stringify({ id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: org.stripeSubscriptionId, status: 'active', items: { data: [{ quantity: 40 }] }, metadata: {} } } });
      await stripeWebhook(upd, sign(upd, secret));
      org = await db.organization.findUniqueOrThrow({ where: { id: o.org.id } });
      expect(org).toMatchObject({ billingStatus: 'ACTIVE', seats: 40 });

      const del = JSON.stringify({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { id: org.stripeSubscriptionId, status: 'canceled', metadata: {} } } });
      await stripeWebhook(del, sign(del, secret));
      expect((await db.organization.findUniqueOrThrow({ where: { id: o.org.id } })).billingStatus).toBe('CANCELLED');
    } finally {
      e.STRIPE_WEBHOOK_SECRET = before;
    }
    expect(verifyStripeSignature('x', sign('x', 's'), '')).toBe(false);
  });
});

describe('error log', () => {
  it('groups the same error, shows it to the platform owner only, and can be marked fixed', async () => {
    const o = await makeOrg();
    const { auth: owner } = await makeUser(o.org.id, ['ADMIN'], null, [], { owner: true });
    const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
    // Letters only: digits are folded together when grouping, so a random number could match an older run.
    const tag = Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
    const msg = `Cannot read properties of undefined (reading '${tag}')`;
    for (const id of ['cmv1a2b3c4d5e6f7g8h9i0j1', 'cmv9z8y7x6w5v4u3t2s1r0q9']) {
      await recordError({ source: 'CLIENT', message: msg.replace(/[a-z0-9]{20,}$/, ''), stack: `TypeError\n    at render (/app/screens/order.tsx:12:5)\n    at load ${id}`, path: `/orders/view/?id=${id}`, organizationId: o.org.id, app: 'web' });
    }
    const list = await listErrors(owner);
    const mine = list.filter((e) => e.organizationName === o.org.name);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ count: 2, source: 'CLIENT', app: 'web' });
    await expect(listErrors(admin)).rejects.toThrow(/permission|access/i);
    await resolveError(owner, mine[0]!.id);
    expect((await listErrors(owner)).some((e) => e.id === mine[0]!.id)).toBe(false);
  });
});

describe('push notifications', () => {
  it('sends new notifications to registered browsers once, and forgets dead subscriptions', async () => {
    const o = await makeOrg();
    const { auth: a, user } = await makeUser(o.org.id, ['SITE'], o.a.id);
    // Older pending notifications from other tests are cleared first.
    await dispatchPushes();
    const sent: { endpoint: string; payload: string }[] = [];
    setPushSenderForTests(async (sub, payload) => {
      if (sub.endpoint.includes('dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload });
    }, true);
    await registerPush(a, { endpoint: `https://push.example.com/live/${uid()}`, keys: { p256dh: 'p', auth: 'a' } });
    await registerPush(a, { endpoint: `https://push.example.com/dead/${uid()}`, keys: { p256dh: 'p', auth: 'a' } });
    await db.notification.create({ data: { userId: user.id, type: 'bol_shipped', title: 'BOL #4 is on the way', body: 'JOB#2249', link: '/bols/view/?id=x' } });
    const r = await dispatchPushes();
    expect(r).toEqual({ sent: 1, gone: 1 });
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ title: 'BOL #4 is on the way', link: '/bols/view/?id=x', badge: 1 });
    expect(await db.deviceRegistration.count({ where: { userId: user.id } })).toBe(1);
    expect(await dispatchPushes()).toEqual({ sent: 0, gone: 0 }); // each goes once
  });
});

describe('PC app updates', () => {
  it('offers a newer published version to older PC apps only', async () => {
    const { publishDesktopRelease, updateFor } = await import('../src/services/app-updates');
    const o = await makeOrg();
    const { auth: owner } = await makeUser(o.org.id, ['ADMIN'], null, [], { owner: true });
    const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
    const exe = new File([new Uint8Array([77, 90, 1, 2, 3])], 'Bowron_9.0.0_x64-setup.exe', { type: 'application/x-msdownload' });
    const sig = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTV...';
    await expect(publishDesktopRelease(admin, { version: '9.0.0', notes: '' }, exe, sig)).rejects.toThrow(/permission|access/i);
    await expect(publishDesktopRelease(owner, { version: 'nine', notes: '' }, exe, sig)).rejects.toThrow(/0\.2\.0/);
    await publishDesktopRelease(owner, { version: '9.0.0', notes: 'Load builder' }, exe, sig);
    const u = await updateFor('windows', 'x86_64', '0.1.0', 'https://api.example.com');
    expect(u).toMatchObject({ version: '9.0.0', notes: 'Load builder', signature: sig });
    expect(u!.url).toMatch(/^https:\/\/api\.example\.com\/api\/v1\/files\/.+sig=/);
    expect(await updateFor('windows', 'x86_64', '9.0.0', 'https://x')).toBeNull();
    expect(await updateFor('darwin', 'aarch64', '0.1.0', 'https://x')).toBeNull();
    // Don't leave a 9.0.0 "release" offered to the local PC app.
    await db.platformSetting.delete({ where: { key: 'desktopRelease:windows-x86_64' } });
  });
});
