'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_ACCESS, ROLE_LABELS, ROLES, type AccessSettings, type NavLayout, type NavSettings, type Role } from '../models';
import { paths } from '../routes';
import { useMenuCatalog } from '../ui/app-shell';
import { Button, Card, Checkbox, ErrorBanner, Notice, PageHeader, PageLoading } from '../ui/components';
import { useAction, useAsync } from '../ui/hooks';
import { NavEditor } from '../ui/nav-editor';
import { useAuthed, useSession } from '../ui/session';

// ---------------------------------------------------------------------------
// Admin › Access & menu
// ---------------------------------------------------------------------------
export function AccessAdminScreen() {
  const { api, me } = useAuthed();
  const { refreshMe } = useSession();
  const catalog = useMenuCatalog();
  const loaded = useAsync(() => api.access.get(), [api]);
  const [a, setA] = useState<AccessSettings>(DEFAULT_ACCESS);
  const [nav, setNav] = useState<NavSettings>(me.nav?.settings ?? { groups: [], hiddenByRole: {}, allowPersonal: true });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (loaded.data) setA(loaded.data);
  }, [loaded.data]);
  const saveAccess = useAction(async () => {
    setA(await api.access.save(a));
    await refreshMe();
    setMsg('Access rules saved.');
  });
  const saveNav = useAction(async () => {
    await api.nav.save(nav);
    await refreshMe();
    setMsg('Menu saved. Everyone gets it the next time their app loads.');
  });
  const hidden = (r: Role, href: string) => (nav.hiddenByRole[r] ?? []).includes(href);
  const toggleHidden = (r: Role, href: string, v: boolean) => setNav((n) => ({ ...n, hiddenByRole: { ...n.hiddenByRole, [r]: v ? [...(n.hiddenByRole[r] ?? []), href] : (n.hiddenByRole[r] ?? []).filter((x) => x !== href) } }));
  if (!loaded.data && !loaded.error) return <PageLoading />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Access & menu" subtitle="How business units are kept apart, and what the menu looks like for everyone." />
      <ErrorBanner error={loaded.error || saveAccess.error || saveNav.error} />
      {msg && <Notice>{msg}</Notice>}

      <Card title="Business units (companies)">
        <Checkbox
          label="Keep business units apart"
          description="People who work in more than one company see only the company they've switched to (top of the screen) in lists and pickers. Admins, the load builder and the schedule still see across companies."
          checked={a.isolateUnits}
          onChange={(v) => setA({ ...a, isolateUnits: v })}
        />
        <div className="mt-2">
          <Checkbox
            label="Purchase orders only for the company you're working in"
            description="“Procurement is king” — and you decide how far: give a buyer more companies under People & access, and they switch company to buy for it."
            checked={a.poOwnUnitOnly}
            onChange={(v) => setA({ ...a, poOwnUnitOnly: v })}
          />
        </div>
        <p className="mt-2 text-sm text-muted">
          Which companies each person works in, and whether a buyer may order for jobs, equipment or both, is set on each person under{' '}
          <a href={paths.users()} className="underline">
            People & access
          </a>
          . Who sees costs is set per company (Companies › Who sees prices) — project managers see their job’s costs; site people don’t.
        </p>
        <Button className="mt-3" busy={saveAccess.busy} onClick={() => void saveAccess.run()}>
          Save access rules
        </Button>
      </Card>

      <Card title="Menu areas">
        <p className="mb-3 text-sm text-muted">Drag items into areas and into order (or use ↑ ↓ and “Area”). Name the areas whatever suits you, e.g. “Field”, “Office”, “Admin”.</p>
        <NavEditor catalog={catalog} mode="admin" value={{ groups: nav.groups, hidden: [] }} onChange={(v) => setNav((n) => ({ ...n, groups: v.groups }))} />
        <div className="mt-3">
          <Checkbox label="People may arrange their own menu" description="Within what they're allowed. They can always go back to this layout." checked={nav.allowPersonal} onChange={(v) => setNav({ ...nav, allowPersonal: v })} />
        </div>
      </Card>

      <Card title="What each role may have">
        <p className="mb-2 text-sm text-muted">Untick to take an item out of that role's menu (on top of what their permissions already allow). People with several roles keep an item if any of their roles may have it.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-2 py-1">Menu item</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-2 py-1 text-center">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.slice(1).map((c) => (
                <tr key={c.href} className="border-t border-line">
                  <td className="px-2 py-1 text-ink">
                    {c.icon} {c.label}
                  </td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2 py-1 text-center">
                      <input type="checkbox" className="h-5 w-5" aria-label={`${ROLE_LABELS[r]} may have ${c.label}`} checked={!hidden(r, c.href)} onChange={(e) => toggleHidden(r, c.href, !e.target.checked)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div>
        <Button busy={saveNav.busy} onClick={() => void saveNav.run()}>
          Save menu
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account › My menu
// ---------------------------------------------------------------------------
export function MyMenuScreen() {
  const { api, me } = useAuthed();
  const { refreshMe } = useSession();
  const catalog = useMenuCatalog();
  const org = me.nav?.settings;
  const [layout, setLayout] = useState<NavLayout>(me.nav?.mine ?? { groups: org?.groups.length ? org.groups : [{ id: 'mine', name: 'My menu', items: catalog.slice(1).map((c) => c.href) }], hidden: [] });
  const [msg, setMsg] = useState('');
  const save = useAction(async () => {
    await api.nav.saveMine(layout);
    await refreshMe();
    setMsg('Saved.');
  });
  const reset = useAction(async () => {
    await api.nav.resetMine();
    await refreshMe();
    setMsg('Back to your organization’s menu.');
  });
  if (org && !org.allowPersonal)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader back={paths.account()} title="My menu" />
        <Notice>Your administrator has set the menu for everyone.</Notice>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.account()} title="My menu" subtitle="Drag items into the order you like, or hide ones you don't use." />
      <ErrorBanner error={save.error || reset.error} />
      {msg && <Notice>{msg}</Notice>}
      <NavEditor catalog={catalog} mode="personal" value={layout} onChange={setLayout} />
      <div className="flex flex-wrap gap-2">
        <Button busy={save.busy} onClick={() => void save.run()}>
          Save my menu
        </Button>
        <Button variant="secondary" busy={reset.busy} onClick={() => void reset.run()}>
          Use the organization's menu
        </Button>
      </div>
    </div>
  );
}
