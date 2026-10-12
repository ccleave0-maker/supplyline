import { describe, expect, it } from 'vitest';
import { arrangeNav } from './nav-arrange';

const items = ['/', '/orders/', '/bols/', '/reports/', '/contacts/'].map((href) => ({ href, label: href }));

describe('menu arranging', () => {
  it('uses the admin areas, then the rest under More; Home stays first', () => {
    const r = arrangeNav(items, { groups: [{ id: 'f', name: 'Field', items: ['/bols/', '/orders/'] }], hiddenByRole: {}, allowPersonal: true }, null, ['SITE']);
    expect(r.groups.map((g) => [g.name, g.items.map((i) => i.href)])).toEqual([
      [null, ['/']],
      ['Field', ['/bols/', '/orders/']],
      ['More', ['/reports/', '/contacts/']],
    ]);
  });
  it('hides what every one of the person’s roles may not have, and the person’s own hidden items', () => {
    const settings = { groups: [], hiddenByRole: { SITE: ['/reports/'], YARD: [] }, allowPersonal: true };
    expect(arrangeNav(items, settings, null, ['SITE']).flat.map((i) => i.href)).not.toContain('/reports/');
    expect(arrangeNav(items, settings, null, ['SITE', 'YARD']).flat.map((i) => i.href)).toContain('/reports/');
    const mine = { groups: [{ id: 'm', name: 'Mine', items: ['/contacts/', '/orders/'] }], hidden: ['/bols/'] };
    const r = arrangeNav(items, settings, mine, ['SITE']);
    expect(r.flat.map((i) => i.href)).toEqual(['/', '/contacts/', '/orders/']);
    // Personal layouts are ignored when the admin turned them off.
    expect(arrangeNav(items, { ...settings, allowPersonal: false }, mine, ['SITE']).flat.map((i) => i.href)).toEqual(['/', '/orders/', '/bols/', '/contacts/']);
  });
  it('with no areas set, uses the standard areas (Project, Yard, HQ…) as buttons', () => {
    const r = arrangeNav([...items, { href: '/admin/users/', label: 'People' }], undefined, null, ['ADMIN']);
    expect(r.groups.map((g) => [g.name, g.icon, g.items.map((i) => i.href)])).toEqual([
      [null, null, ['/']],
      ['Project', '🏗', ['/orders/']],
      ['Yard', '🏭', ['/bols/']],
      ['HQ', '🏢', ['/reports/', '/contacts/']],
      ['Admin', '⚙', ['/admin/users/']],
    ]);
  });
});
