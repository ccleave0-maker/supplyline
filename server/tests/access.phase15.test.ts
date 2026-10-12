import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_ACCESS, emptyDraftRow } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import type { AuthContext } from '../src/lib/auth';
import { getAccessSettings, saveAccessSettings, saveMyNav, saveNavSettings, setUserAccess } from '../src/services/access-admin';
import { accessibleCompanyIds, siteWhereFor } from '../src/services/access';
import { buildMe } from '../src/services/me';
import { createDraft, listOrders, saveDraft, submitOrder } from '../src/services/orders';
import { createPo } from '../src/services/purchasing';
import { listSchedule } from '../src/services/schedule';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());

/** What the server builds from a request: their settings, plus the unit the app says they're in. */
async function ctx(base: AuthContext, active: string | null): Promise<AuthContext> {
  const u = await db.user.findUniqueOrThrow({ where: { id: base.userId }, include: { organization: true } });
  const { accessOf } = await import('../src/lib/auth');
  return { ...base, extraCompanyIds: u.extraCompanyIds, procurementScope: u.procurementScope as 'ALL', access: accessOf(u.organization.settings), activeCompanyId: active };
}

describe('business units', () => {
  it('a person in two units sees only the unit they are working in (when isolation is on), admins see all', async () => {
    const o = await makeOrg();
    const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
    const { auth: buyer0, user } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
    expect(await getAccessSettings(admin)).toEqual(DEFAULT_ACCESS); // on by default
    await setUserAccess(admin, user.id, { extraCompanyIds: [o.b.id], procurementScope: 'ALL' });
    expect((await buildMe(user.id)).companies.map((c) => c.code).sort()).toEqual(['AAA', 'BBB']);

    const inA = await ctx(buyer0, o.a.id);
    expect(await accessibleCompanyIds(inA)).toEqual([o.a.id]);
    expect(await accessibleCompanyIds(inA, { crossUnit: true })).toEqual(expect.arrayContaining([o.a.id, o.b.id]));
    const jobs = await db.site.findMany({ where: { AND: [await siteWhereFor(inA), { type: 'JOB' }] } });
    expect(jobs.map((j) => j.id)).toEqual([o.jobA.id]);
    const inB = await ctx(buyer0, o.b.id);
    expect((await db.site.findMany({ where: { AND: [await siteWhereFor(inB), { type: 'JOB' }] } })).map((j) => j.id)).toEqual([o.jobB.id]);

    // Off: both units' jobs show together.
    await saveAccessSettings(admin, { isolateUnits: false, poOwnUnitOnly: true });
    const off = await ctx(buyer0, o.a.id);
    expect((await db.site.findMany({ where: { AND: [await siteWhereFor(off), { type: 'JOB' }] } })).length).toBe(2);
    // Admins always cross units.
    expect(await accessibleCompanyIds({ ...(await ctx(admin, o.a.id)), access: DEFAULT_ACCESS })).toEqual(expect.arrayContaining([o.a.id, o.b.id]));
    // The schedule works across units.
    await saveAccessSettings(admin, DEFAULT_ACCESS);
    await expect(listSchedule(await ctx(buyer0, o.a.id), { from: '2026-10-01', to: '2026-10-31' })).resolves.toBeDefined();
    await expect(saveAccessSettings(buyer0, DEFAULT_ACCESS)).rejects.toThrow(/permission|access/i);
  });

  it('POs only for the unit you are in, and each buyer only for what they may order', async () => {
    const o = await makeOrg();
    const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
    const { auth: b0, user } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
    await setUserAccess(admin, user.id, { extraCompanyIds: [o.b.id], procurementScope: 'ALL' });
    const po = (companyId: string, siteId: string) => ({ companyId, poNumber: `P-${uid()}`, vendorName: 'Coastal Steel', siteId, deliverToYardId: o.yard.id, lines: [{ description: 'Pile', qty: 1, uom: 'EA', unitCost: 1 }] });
    const inA = await ctx(b0, o.a.id);
    await expect(createPo(inA, po(o.b.id, o.jobB.id))).rejects.toThrow(/Switch to Beta Co/);
    await expect(createPo(await ctx(b0, o.b.id), po(o.b.id, o.jobB.id))).resolves.toBeDefined();
    // Admin can switch this off.
    await saveAccessSettings(admin, { isolateUnits: false, poOwnUnitOnly: false });
    await expect(createPo(await ctx(b0, o.a.id), po(o.b.id, o.jobB.id))).resolves.toBeDefined();

    // An equipment-only buyer can't buy for a job.
    await setUserAccess(admin, user.id, { extraCompanyIds: [], procurementScope: 'EQUIPMENT' });
    await expect(createPo(await ctx(b0, o.a.id), po(o.a.id, o.jobA.id))).rejects.toThrow(/only buy for equipment/);
    await setUserAccess(admin, user.id, { extraCompanyIds: [], procurementScope: 'JOBS' });
    await expect(createPo(await ctx(b0, o.a.id), po(o.a.id, o.jobA.id))).resolves.toBeDefined();
  });

  it('site people only see and create order lists for their own sites', async () => {
    const o = await makeOrg();
    const { auth: siteA } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
    const { auth: siteB } = await makeUser(o.org.id, ['SITE'], o.a.id, []);
    const { id } = await createDraft(siteA, o.jobA.id);
    await saveDraft(siteA, id, { rows: [{ ...emptyDraftRow('JS'), description: 'Rebar', quantity: '5', uom: 'EA' }] });
    await submitOrder(siteA, id);
    expect((await listOrders(siteA, {})).length).toBe(1);
    expect(await listOrders(siteB, {})).toEqual([]);
    await expect(createDraft(siteB, o.jobA.id)).rejects.toThrow(/not found|access|permission/i);
  });
});

describe('menu', () => {
  it('admin sets areas and what roles may have; people keep their own order unless the admin turns that off', async () => {
    const o = await makeOrg();
    const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
    const { auth: site, user } = await makeUser(o.org.id, ['SITE'], o.a.id);
    await expect(saveNavSettings(site, { groups: [], hiddenByRole: {}, allowPersonal: true })).rejects.toThrow(/permission|access/i);
    await saveNavSettings(admin, { groups: [{ id: 'field', name: 'Field', items: ['/orders/', '/bols/'] }], hiddenByRole: { SITE: ['/reports/'] }, allowPersonal: true });
    await saveMyNav(site, { groups: [{ id: 'field', name: 'Field', items: ['/bols/', '/orders/'] }], hidden: [] });
    const me = await buildMe(user.id);
    expect(me.nav!.settings.hiddenByRole.SITE).toEqual(['/reports/']);
    expect(me.nav!.mine!.groups[0]!.items).toEqual(['/bols/', '/orders/']);
    await saveNavSettings(admin, { ...me.nav!.settings, allowPersonal: false });
    await expect(saveMyNav(site, { groups: [], hidden: [] })).rejects.toThrow(/set the menu for everyone/);
    await saveMyNav(site, null); // going back to the organization's menu is always allowed
    expect((await buildMe(user.id)).nav!.mine).toBeNull();
  });
});
