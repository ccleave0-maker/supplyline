import type { NavLayout, NavSettings, Role } from '../models';
import { paths } from '../routes';

/**
 * The standard areas, used until an admin sets their own (Admin › Access & menu).
 * Anything not listed goes to HQ; anything under /admin, /platform or billing goes to Admin.
 */
export const DEFAULT_AREAS: { id: string; name: string; icon: string; items: string[] }[] = [
  { id: 'project', name: 'Project', icon: '🏗', items: [paths.orders(), paths.procurement(), paths.compliance(), paths.sites(), paths.meetings(), paths.actionItems()] },
  { id: 'yard', name: 'Yard', icon: '🏭', items: [paths.yard(), paths.bols(), paths.loadBoard(), paths.loadBuilder(), paths.schedule(), paths.equipment(), paths.locations()] },
  { id: 'hq', name: 'HQ', icon: '🏢', items: [paths.reports(), paths.reportBuilder(), paths.activity(), paths.contacts(), paths.emails()] },
  { id: 'procurement', name: 'Procurement', icon: '🛒', items: [paths.pos(), paths.ap(), paths.ar()] },
  { id: 'admin', name: 'Admin', icon: '⚙', items: [] },
];
const isAdminHref = (href: string) => href.startsWith('/admin') || href.startsWith('/platform') || href.startsWith('/account/billing');

/** Put each menu item in its standard area. */
export function defaultAreas(items: NavLike[]): { id: string; name: string; icon: string; items: string[] }[] {
  const home = items[0]?.href;
  const out = DEFAULT_AREAS.map((a) => ({ ...a, items: [] as string[] }));
  const area = (id: string) => out.find((a) => a.id === id)!;
  for (const it of items) {
    if (it.href === home) continue;
    const listed = DEFAULT_AREAS.find((a) => a.items.includes(it.href));
    area(listed ? listed.id : isAdminHref(it.href) ? 'admin' : 'hq').items.push(it.href);
  }
  return out.filter((a) => a.items.length);
}

/** A symbol for an area the admin named themselves. */
export function areaIcon(name: string | null, icon?: string | null): string {
  if (icon) return icon;
  const n = (name ?? '').toLowerCase();
  return DEFAULT_AREAS.find((a) => n.includes(a.name.toLowerCase()))?.icon ?? (n.includes('field') || n.includes('site') ? '🦺' : n.includes('ship') ? '🚚' : n.includes('account') ? '🧾' : '▸');
}

export interface NavLike {
  href: string;
  label: string;
}

/**
 * Put the menu in the admin's areas and the person's own order. Items a role may
 * not have (Admin › Access & menu) are taken out — when ALL of the person's roles
 * hide them. Anything not placed in an area stays at the end, in its usual order.
 * Home is always first and can't be hidden.
 */
export function arrangeNav<T extends NavLike>(items: T[], settings: NavSettings | undefined, mine: NavLayout | null | undefined, roles: Role[]): { flat: T[]; groups: { name: string | null; icon: string | null; items: T[] }[] } {
  const s = settings ?? { groups: [], hiddenByRole: {}, allowPersonal: true };
  const byHref = new Map(items.map((i) => [i.href, i]));
  const adminHidden = (href: string) => roles.length > 0 && roles.every((r) => (s.hiddenByRole[r] ?? []).includes(href));
  const personal = s.allowPersonal && mine ? mine : null;
  const hidden = new Set([...(personal?.hidden ?? [])]);
  const layout: { name: string; icon?: string; items: string[] }[] = personal?.groups.length ? personal.groups : s.groups.length ? s.groups : defaultAreas(items);
  const home = items[0];
  const used = new Set<string>(home ? [home.href] : []);
  const groups: { name: string | null; icon: string | null; items: T[] }[] = [];
  if (home) groups.push({ name: null, icon: null, items: [home] });
  for (const g of layout) {
    const list: T[] = [];
    for (const href of g.items) {
      const it = byHref.get(href);
      if (!it || used.has(href) || adminHidden(href) || hidden.has(href)) continue;
      used.add(href);
      list.push(it);
    }
    if (list.length) groups.push({ name: g.name, icon: areaIcon(g.name, g.icon), items: list });
  }
  const rest = items.filter((i) => !used.has(i.href) && !adminHidden(i.href) && !hidden.has(i.href));
  if (rest.length) {
    if (groups.length > 1) groups.push({ name: 'More', icon: '⋯', items: rest });
    else groups[0] = { name: null, icon: null, items: [...(groups[0]?.items ?? []), ...rest] };
  }
  return { flat: groups.flatMap((g) => g.items), groups };
}
