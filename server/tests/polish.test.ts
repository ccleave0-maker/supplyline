import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_FILING, DEFAULT_HEALTH, emptyDraftRow } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { saveFilingSettings } from '../src/services/filing';
import { getHealthSettings, listHealthRuns, runHealth, runHealthNow, saveHealthSettings } from '../src/services/health';
import { buildMe } from '../src/services/me';
import { createDraft, saveDraft, submitOrder } from '../src/services/orders';
import { activityFeed, dashboard, listNotifications, markNotificationsRead, saveAppearance, search } from '../src/services/polish';
import { createPo, issuePo } from '../src/services/purchasing';
import { runReport } from '../src/services/reports';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

const row = (description: string, quantity: string) => ({ ...emptyDraftRow('JS'), description, quantity, uom: 'EA' });

async function setup() {
  const o = await makeOrg();
  const { auth: admin, user: adminUser } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: siteB } = await makeUser(o.org.id, ['SITE'], o.b.id, [o.jobB.id]);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  return { ...o, admin, adminUser, site, siteB, buyer };
}

describe('notification centre, feed, search, dashboard', () => {
  it('lists notifications with an unread count and marks them read', async () => {
    const s = await setup();
    await db.notification.createMany({ data: [1, 2, 3].map((i) => ({ userId: s.site.userId, type: 'test', title: `Note ${i}`, body: '', link: '/x/' })) });
    let n = await listNotifications(s.site);
    expect(n.unread).toBe(3);
    expect(n.items).toHaveLength(3);
    await markNotificationsRead(s.site, [n.items[0]!.id]);
    expect((await listNotifications(s.site)).unread).toBe(2);
    // Someone else's ids do nothing.
    await markNotificationsRead(s.buyer, n.items.map((i) => i.id));
    expect((await listNotifications(s.site)).unread).toBe(2);
    await markNotificationsRead(s.site, 'all');
    n = await listNotifications(s.site, { unread: true });
    expect(n).toEqual({ items: [], unread: 0 });
  });

  it('shows a status feed only for the jobs you can see, and finds things by search', async () => {
    const s = await setup();
    const { id } = await createDraft(s.site, s.jobA.id);
    await saveDraft(s.site, id, { rows: [row('Rebar 20M', '10')] });
    await submitOrder(s.site, id);
    const { id: idB } = await createDraft(s.siteB, s.jobB.id);
    await saveDraft(s.siteB, idB, { rows: [row('Culvert pipe', '2')] });
    await submitOrder(s.siteB, idB);
    const po = await issuePo(s.buyer, (await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Coastal Steel', siteId: s.jobA.id, deliverToYardId: s.yard.id, lines: [{ description: 'Pile', qty: 1, uom: 'EA', unitCost: 10 }] })).id);

    const feedA = await activityFeed(s.site);
    // 2 lines: the PO's off-list "Pile" joined the job's latest list. POs themselves are hidden from site users.
    expect(feedA.map((f) => f.text)).toEqual([expect.stringMatching(/submitted JOB#2249 LIST#1 \(2 lines\)$/)]);
    const feedBuyer = await activityFeed(s.buyer);
    expect(feedBuyer.map((f) => f.text)).toEqual([expect.stringMatching(new RegExp(`issued PO ${po.poNumber} to Coastal Steel$`)), expect.stringMatching(/submitted JOB#2249 LIST#1/)]);
    expect((await activityFeed(s.admin)).length).toBe(3);
    expect(await activityFeed(s.admin, { siteId: s.jobB.id })).toHaveLength(1);

    expect((await search(s.site, 'rebar')).map((h) => [h.kind, h.title])).toEqual([['LINE', 'Rebar 20M']]);
    expect(await search(s.site, 'culvert')).toEqual([]); // other company's job
    expect((await search(s.site, '2249 list 1')).map((h) => h.kind)).toEqual(['ORDER']);
    expect((await search(s.site, '2249')).map((h) => h.kind)).toEqual(['JOB']);
    expect((await search(s.buyer, po.poNumber)).some((h) => h.kind === 'PO')).toBe(true);
    expect((await search(s.site, po.poNumber)).some((h) => h.kind === 'PO')).toBe(false);
    expect(await search(s.site, 'x')).toEqual([]);

    const tiles = await dashboard(s.buyer);
    expect(tiles.find((t) => t.key === 'to-buy')).toMatchObject({ value: 1, warn: true }); // the rebar line waits to be bought
  });
});

describe('appearance', () => {
  it('saves a background picture, fade and decal for the company, shown in the app', async () => {
    const s = await setup();
    const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253, 227, 85, 242, 156, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])], 'bg.png', { type: 'image/png' });
    await expect(saveAppearance(s.site, s.a.id, { fade: 50, decal: true }, png)).rejects.toThrow(/permission|access/i);
    await expect(saveAppearance(s.admin, s.a.id, { fade: 50, decal: true }, new File([new Uint8Array([1])], 'x.gif', { type: 'image/gif' }))).rejects.toThrow(/JPG, PNG/);
    await saveAppearance(s.admin, s.a.id, { fade: 70, decal: true }, png);
    let me = await buildMe(s.adminUser.id);
    let a = me.companies.find((c) => c.id === s.a.id)!.appearance!;
    expect(a.fade).toBe(70);
    expect(a.decal).toBe(true);
    expect(a.backgroundUrl).toMatch(/\/api\/v1\/files\//);
    // Changing the fade keeps the picture; "clear" removes it.
    await saveAppearance(s.admin, s.a.id, { fade: 90, decal: false }, null);
    me = await buildMe(s.adminUser.id);
    expect(me.companies.find((c) => c.id === s.a.id)!.appearance).toMatchObject({ fade: 90, decal: false, backgroundUrl: a.backgroundUrl });
    await saveAppearance(s.admin, s.a.id, { fade: 90, decal: false, clearBackground: true }, null);
    a = (await buildMe(s.adminUser.id)).companies.find((c) => c.id === s.a.id)!.appearance!;
    expect(a.backgroundUrl).toBeNull();
    expect((await buildMe(s.adminUser.id)).companies.find((c) => c.id === s.b.id)!.appearance).toEqual({ backgroundUrl: null, fade: 85, decal: false });
  });
});

describe('health checks', () => {
  it('runs the checks, alerts only when the status changes, and keeps history', async () => {
    const s = await setup();
    expect(await getHealthSettings(s.admin)).toEqual(DEFAULT_HEALTH);
    await expect(getHealthSettings(s.site)).rejects.toThrow(/permission|access/i);
    await saveHealthSettings(s.admin, { enabled: true, intervalMinutes: 30, alertEmails: ['owner@example.com'] });

    const r1 = await runHealthNow(s.admin);
    expect(r1.ok).toBe(true);
    expect(r1.results.map((r) => r.key)).toEqual(['database', 'email', 'storage', 'ai', 'filing', 'sync', 'ap-folders', 'work']);
    expect(r1.alerted).toBe(false); // first run, all good → no email

    // A filing folder that doesn't exist → failing, alert sent once.
    await saveFilingSettings(s.admin, s.a.id, { ...DEFAULT_FILING, enabled: true, root: path.join(mkdtempSync(path.join(tmpdir(), 'sl-h-')), 'missing', 'deeper') });
    const r2 = await runHealth(s.org.id);
    expect(r2.ok).toBe(false);
    expect(r2.results.find((r) => r.key === 'filing')!.detail).toMatch(/can't open/);
    expect(r2.alerted).toBe(true);
    const mail = await db.emailOutbox.findFirstOrThrow({ where: { relatedType: 'health', relatedId: s.org.id }, orderBy: { createdAt: 'desc' } });
    expect(mail.to).toEqual(['owner@example.com']);
    expect(mail.subject).toMatch(/needs a look: Network filing/);
    expect((await runHealth(s.org.id)).alerted).toBe(false); // still failing, same problem → no repeat

    await saveFilingSettings(s.admin, s.a.id, { ...DEFAULT_FILING, enabled: false, root: '' });
    const r4 = await runHealth(s.org.id);
    expect(r4).toMatchObject({ ok: true, alerted: true }); // fixed → "healthy again"
    expect((await listHealthRuns(s.admin)).map((r) => r.ok)).toEqual([true, false, false, true]);
    expect((await dashboard(s.admin)).some((t) => t.key === 'health')).toBe(false);
  });
});

describe('reports', () => {
  it('spend by job and vendor invoice aging', async () => {
    const s = await setup();
    await issuePo(s.buyer, (await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Coastal Steel', siteId: s.jobA.id, deliverToYardId: s.yard.id, lines: [{ description: 'Pile', qty: 4, uom: 'EA', unitCost: 250 }] })).id);
    const today = new Date().toISOString().slice(0, 10);
    const r = await runReport(s.buyer, 'spend-by-job', { from: '2020-01-01', to: today });
    expect(r.rows).toEqual([{ job: '2249 Job A', pos: 1, committed: 1000, received: 0, invoiced: 0 }]);
    expect(r.columns[0]).toEqual({ key: 'job', label: 'Job' });
    await expect(runReport(s.site, 'spend-by-job', { from: '2020-01-01', to: today })).rejects.toThrow(/permission|access/i);
    const aging = await runReport(s.admin, 'ap-aging', { from: '2020-01-01', to: today });
    expect(aging.rows).toEqual([]);
    await expect(runReport(s.admin, 'deliveries', { from: 'bad', to: today })).rejects.toThrow(/from and to/);
  });
});
