'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { usePlatform } from '@supplyline/platform';
import { BRANDING } from '../branding';
import { compareVersions } from '../domain/version';
import { can } from '../permissions';
import { paths } from '../routes';
import { ColorModeToggle } from './color-mode';
import { VoiceNavButton } from './voice';
import { AssistantButton } from './assistant';
import { MfaGate } from '../screens/security';
import { CompanyMark, cx, Spinner } from './components';
import { arrangeNav } from './nav-arrange';
import { ScanButton } from './scan-button';
import { useLive, useSession } from './session';
import { useTheme } from './theme';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  match: (p: string) => boolean;
}

/**
 * side: everything (PC sidebar). bottom: the phone tab bar — Home, Orders, the
 * tab for your main job (Yard / Buying / Jobs) and More. more: the rest, listed
 * on the More page.
 */
/** Every menu item this person's permissions allow, in the standard order (before the admin's layout). */
function useNavCatalog(): NavItem[] {
  const { me } = useSession();
  const home: NavItem = { href: paths.home(), label: 'Home', icon: '⌂', match: (p) => p === '/' };
  const orders: NavItem = { href: paths.orders(), label: 'Orders', icon: '☰', match: (p) => p.startsWith('/orders') };
  const jobs: NavItem = { href: paths.sites(), label: 'Jobs / projects & yards', icon: '▦', match: (p) => p.startsWith('/sites') };
  const yard: NavItem = { href: paths.yard(), label: 'Yard', icon: '⛟', match: (p) => p.startsWith('/yard') };
  const buying: NavItem = { href: paths.procurement(), label: 'Buying', icon: '$', match: (p) => p.startsWith('/procurement') };

  const side: NavItem[] = [home, orders];
  if (me && can(me.user, 'procurement:work')) side.push(buying);
  if (me && can(me.user, 'ap:work')) side.push({ href: paths.ap(), label: 'Vendor invoices (AP)', icon: '🧾', match: (p) => p.startsWith('/ap') || p.startsWith('/accounting') });
  if (me && can(me.user, 'ar:work')) side.push({ href: paths.ar(), label: 'Billing (AR)', icon: '💲', match: (p) => p.startsWith('/ar') || p.startsWith('/customers') });
  if (me && can(me.user, 'po:view')) side.push({ href: paths.pos(), label: 'Purchase orders', icon: '₱', match: (p) => p.startsWith('/purchase-orders') });
  if (me && can(me.user, 'yard:view')) side.push(yard);
  side.push(jobs, { href: paths.bols(), label: 'Shipping (BOLs)', icon: '⇄', match: (p) => p.startsWith('/bols') || p.startsWith('/returns') });
  if (me && can(me.user, 'reports:view')) side.push({ href: paths.reports(), label: 'Reports', icon: '📊', match: (p) => p.startsWith('/reports') });
  else if (me) side.push({ href: paths.reportBuilder(), label: 'My reports', icon: '📊', match: (p) => p.startsWith('/reports') });
  side.push({ href: paths.activity(), label: 'What’s happening', icon: '⟳', match: (p) => p.startsWith('/activity') });
  if (me && can(me.user, 'meeting:run')) {
    side.push({ href: paths.meetings(), label: 'Meetings', icon: '◷', match: (p) => p.startsWith('/meetings') || p.startsWith('/admin/meeting-templates') });
    side.push({ href: paths.actionItems(), label: 'Action items', icon: '☑', match: (p) => p.startsWith('/actions') });
  }
  if (me && can(me.user, 'bol:view')) side.push({ href: paths.loadBoard(), label: 'Load board', icon: '🗺', match: (p) => p.startsWith('/load-board') || p.startsWith('/loads/optimize') });
  if (me && can(me.user, 'loads:plan')) side.push({ href: paths.loadBuilder(), label: 'Load builder', icon: '▦', match: (p) => p.startsWith('/loads') || p.startsWith('/trailers') });
  if (me && can(me.user, 'bol:view')) side.push({ href: paths.schedule(), label: 'Schedule', icon: '▤', match: (p) => p.startsWith('/schedule') });
  side.push({ href: paths.contacts(), label: 'Contacts', icon: '☎', match: (p) => p.startsWith('/contacts') });
  side.push({ href: paths.equipment(), label: 'Equipment', icon: '⚙', match: (p) => p.startsWith('/equipment') });
  side.push({ href: paths.locations(), label: 'Locations', icon: '⚑', match: (p) => p.startsWith('/locations') });
  if (me && can(me.user, 'email:review')) side.push({ href: paths.emails(), label: 'Emails to review', icon: '✉', match: (p) => p.startsWith('/emails') || p.startsWith('/admin/email-templates') });
  // Scan is in the top bar on every screen (and on the yard / job pages), not a tab of its own.
  if (me && can(me.user, 'compliance:edit')) side.push({ href: paths.compliance(), label: 'WCB & insurance', icon: '✔', match: (p) => p.startsWith('/compliance') });
  if (me && can(me.user, 'org:manage')) {
    side.push({ href: paths.companies(), label: 'Companies', icon: '◆', match: (p) => p.startsWith('/admin/companies') });
    side.push({ href: paths.users(), label: 'People & access', icon: '☺', match: (p) => p.startsWith('/admin/users') });
    side.push({ href: paths.accessAdmin(), label: 'Access & menu', icon: '🔒', match: (p) => p.startsWith('/admin/access') });
    side.push({ href: paths.securityAdmin(), label: 'Security', icon: '🛡', match: (p) => p.startsWith('/admin/security') });
  }
  if (me && can(me.user, 'company:edit')) side.push({ href: paths.accountingSettings(), label: 'AP & billing settings', icon: '⚙', match: (p) => p.startsWith('/admin/accounting') });
  if (me && can(me.user, 'integrations:manage')) side.push({ href: paths.filingAdmin(), label: 'Data, filing & imports', icon: '🗂', match: (p) => ['/admin/filing', '/admin/imports', '/admin/export-mappings', '/admin/data-export'].some((x) => p.startsWith(x)) });
  else if (me && can(me.user, 'export:run')) side.push({ href: paths.exportMappings(), label: 'Export mappings', icon: '⇩', match: (p) => p.startsWith('/admin/export-mappings') });
  if (me && can(me.user, 'health:view')) side.push({ href: paths.health(), label: 'Health checks', icon: '♥', match: (p) => p.startsWith('/admin/health') });
  if (me && can(me.user, 'company:edit')) side.push({ href: paths.appearance(), label: 'Look & feel', icon: '🎨', match: (p) => p.startsWith('/admin/appearance') });
  if (me && can(me.user, 'org:manage')) side.push({ href: paths.aiAdmin(), label: 'AI & voice', icon: '🎤', match: (p) => p.startsWith('/admin/ai') });
  if (me && can(me.user, 'org:manage')) side.push({ href: paths.assistantAdmin(), label: 'Assistant', icon: '💬', match: (p) => p.startsWith('/admin/assistant') });
  if (me && can(me.user, 'org:manage')) side.push({ href: paths.insights(), label: 'Insights', icon: '💡', match: (p) => p.startsWith('/admin/insights') });
  if (me && can(me.user, 'recycle:manage')) {
    side.push({ href: paths.recycleBin(), label: 'Recycle bin', icon: '♻', match: (p) => p.startsWith('/admin/deleted') });
  }
  if (me && can(me.user, 'org:manage')) side.push({ href: paths.billing(), label: 'Billing', icon: '💳', match: (p) => p.startsWith('/account/billing') });
  if (me && can(me.user, 'platform:manage')) {
    side.push({ href: paths.platformErrors(), label: 'Error log', icon: '⚠', match: (p) => p.startsWith('/platform/errors') });
    side.push({ href: paths.platform(), label: 'Platform', icon: '✦', match: (p) => p.startsWith('/platform') });
  }

  return side;
}

function useNav(): { side: NavItem[]; bottom: NavItem[]; more: NavItem[]; groups: { name: string | null; icon: string | null; items: NavItem[] }[] } {
  const { me } = useSession();
  const catalog = useNavCatalog();
  const roles = me?.user.roles ?? [];
  // The admin's areas and role rules, then this person's own order (Admin › Access & menu, Account › My menu).
  const { flat: side, groups } = arrangeNav(catalog, me?.nav?.settings, me?.nav?.mine, roles);
  const home = side[0]!;
  const find = (href: string) => side.find((i) => i.href === href);
  const orders = find(paths.orders()) ?? side[1]!;
  const jobs = find(paths.sites());
  const yard = find(paths.yard());
  const buying = find(paths.procurement());
  const main = (roles.includes('ADMIN') ? jobs : roles.includes('YARD') ? yard : roles.includes('PROCUREMENT') ? buying : jobs) ?? side[2] ?? home;
  const more = side.filter((i) => i !== home && i !== orders && i !== main);
  const moreTab: NavItem = {
    href: paths.account(),
    label: 'More',
    icon: '≡',
    match: (p) => p.startsWith('/account') || more.some((a) => a.match(p)),
  };
  return { side, bottom: [home, orders, main, moreTab], more, groups };
}

function normalize(pathname: string | null) {
  if (!pathname) return '/';
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-2 text-brand-ink">
      <Spinner label="Starting SupplyLine" />
    </div>
  );
}

/** Bell with the number of unread notifications (checks every minute and on live updates). */
function Bell() {
  const { api } = useSession();
  const [n, setN] = useState(0);
  const pathname = usePathname();
  useEffect(() => {
    let live = true;
    const load = () =>
      api.notifications
        .count()
        .then((r) => live && setN(r.unread))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [api, pathname]);
  useLive(() => void api.notifications.count().then((r) => setN(r.unread)).catch(() => undefined));
  return (
    <Link href={paths.notifications()} aria-label={n ? `Notifications: ${n} unread` : 'Notifications'} className="sl-icon-btn relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl text-ink hover:bg-surface-2">
      <span aria-hidden="true">🔔</span>
      {n > 0 && <span className="absolute top-1 right-1 min-w-5 rounded-full bg-danger px-1 text-center text-xs font-bold text-danger-fg">{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}

/** Search box (PC) / search button (phone). */
function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState('');
  return (
    <>
      <form
        role="search"
        className="hidden md:block"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(paths.search(q.trim()));
        }}
      >
        <label className="sr-only" htmlFor="sl-search">
          Search
        </label>
        <input id="sl-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jobs, POs, BOLs, people…" className="min-h-12 w-64 rounded-lg border border-line bg-surface px-3 text-ink" />
      </form>
      <Link href={paths.search()} aria-label="Search" className="sl-icon-btn flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl text-ink hover:bg-surface-2 md:hidden">
        <span aria-hidden="true">⌕</span>
      </Link>
    </>
  );
}

/** No connection: say so, and how old the copy on screen is. */
function OfflineBanner() {
  const { api } = useSession();
  const [off, setOff] = useState<{ since: number; savedAt: number | null } | null>(null);
  useEffect(() => api.offline.onChange(setOff), [api]);
  if (!off) return null;
  return (
    <div role="status" className="bg-warn-bg px-4 py-2 text-center text-warn-ink">
      You’re offline — showing what was saved on this device{off.savedAt ? ` (${new Date(off.savedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })})` : ''}. Changes can’t be saved until you’re back online.
    </div>
  );
}

function BillingBanner() {
  const { me } = useSession();
  if (!me?.billingNotice) return null;
  return (
    <div role="status" className="bg-warn-bg px-4 py-2 text-center text-warn-ink">
      {me.billingNotice}{' '}
      <Link href={paths.billing()} className="font-semibold underline">
        Billing
      </Link>
    </div>
  );
}

function UpdateBanner() {
  const { api } = useSession();
  const platform = usePlatform();
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    api
      .meta()
      .then((m) => setOutdated(compareVersions(platform.info.version, m.minClientVersion[platform.info.app] ?? '0.0.0') < 0))
      .catch(() => undefined);
  }, [api, platform]);
  if (!outdated) return null;
  return (
    <div role="alert" className="bg-warn-bg px-4 py-2 text-center text-warn-ink">
      A newer version of SupplyLine is required. Please update the app.
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = normalize(usePathname());
  const router = useRouter();
  const platform = usePlatform();
  const { status, me, activeCompany, setActiveCompany, api } = useSession();
  const { side: allNav, bottom: bottomNav, groups: navGroups } = useNav();
  const isLogin = pathname === '/login';
  // Public pages (website, privacy, terms) open without signing in.
  const isPublic = pathname === '/welcome' || pathname.startsWith('/pricing') || pathname.startsWith('/legal');

  useTheme(activeCompany?.themeColor);

  useEffect(() => {
    document.documentElement.classList.add(platform.info.app);
  }, [platform]);

  useEffect(() => {
    if (status === 'anonymous' && !isLogin && !isPublic) router.replace(paths.login());
  }, [status, isLogin, isPublic, router]);

  // Crashes go to the error log (Platform › Errors).
  useEffect(() => {
    const report = (message: string, stack?: string | null) => void api.reportError({ message: message.slice(0, 2000), stack: stack?.slice(0, 8000) ?? null, path: window.location.pathname + window.location.search });
    const onError = (e: ErrorEvent) => report(e.message || 'Error', e.error instanceof Error ? e.error.stack : null);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string; status?: number } | undefined;
      if (r && typeof r.status === 'number') return; // API errors are shown on screen already
      report(r?.message ?? String(e.reason), r?.stack ?? null);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [api]);

  if (isLogin || isPublic) return <>{children}</>;
  if (status !== 'authenticated' || !me) return <Splash />;
  // Two-step sign-in not finished: nothing else until it is.
  if (me.mfa?.pending) return <MfaGate />;

  const look = activeCompany?.appearance;
  const bg = look?.backgroundUrl ? api.fileUrl(look.backgroundUrl) : null;
  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Company background picture, faded so screens stay readable, and the logo "decal". */}
      {bg && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bg}")` }} />
          <div className="absolute inset-0 bg-surface-2" style={{ opacity: (look?.fade ?? 85) / 100 }} />
        </div>
      )}
      {look?.decal && activeCompany?.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img aria-hidden="true" alt="" src={api.fileUrl(activeCompany.logoUrl) ?? undefined} className="pointer-events-none fixed right-4 bottom-20 -z-10 h-24 w-auto opacity-10 lg:bottom-6" />
      )}
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-3">
        Skip to content
      </a>
      <header className="safe-top safe-x sticky top-0 z-20 border-b border-line bg-surface">
        {/* Phones: logo, business unit, alerts and account on top; the tools wrap to a second row. */}
        <div className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1 sm:flex-nowrap sm:gap-3 sm:px-4 sm:py-0">
          {activeCompany ? (
            <CompanyMark name={activeCompany.name} code={activeCompany.code} logoUrl={api.fileUrl(activeCompany.logoUrl)} size={36} />
          ) : (
            <span className="font-black text-brand-ink">{BRANDING.productName}</span>
          )}
          <div className="min-w-0 flex-1">
            {me.companies.length > 1 ? (
              <label className="block">
                <span className="sr-only">Company</span>
                <select
                  value={activeCompany?.id ?? ''}
                  onChange={(e) => setActiveCompany(e.target.value)}
                  className="min-h-12 w-full max-w-md truncate rounded-lg border border-line bg-surface px-2 font-semibold text-ink"
                >
                  {me.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="truncate font-semibold text-ink">{activeCompany?.name ?? me.organization.name}</p>
            )}
          </div>
          <div className="order-last flex w-full items-center justify-around border-t border-line pt-1 sm:order-none sm:w-auto sm:justify-end sm:gap-3 sm:border-0 sm:pt-0">
            <SearchBox />
            <ScanButton variant="icon" />
            <AssistantButton />
            <VoiceNavButton destinations={allNav.map((n) => ({ path: n.href, label: n.label }))} />
            <ColorModeToggle />
          </div>
          <Bell />
          <Link
            href={paths.account()}
            aria-label={`Account: ${me.user.name}`}
            className="sl-icon-btn flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand font-bold text-brand-fg"
          >
            {me.user.initials}
          </Link>
        </div>
        <UpdateBanner />
        <OfflineBanner />
        <BillingBanner />
      </header>

      <div className="flex flex-1">
        <AreaNav groups={navGroups} pathname={pathname} />

        {/* Switching business unit reloads the screen for that unit. */}
        <main key={activeCompany?.id ?? 'none'} id="main" className="sl-page mx-auto w-full max-w-5xl min-w-0 flex-1 pt-4 lg:pb-8">
          {children}
        </main>
      </div>

      <nav aria-label="Main" className="safe-bottom safe-x fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface lg:hidden">
        <ul className="grid grid-cols-4">
          {bottomNav.map((item) => {
            const active = item.match(pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx('sl-nav flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-center text-xs leading-tight font-semibold sm:text-sm', active ? 'text-brand-ink' : 'text-muted')}
                >
                  <span aria-hidden="true" className="sl-nav-icon text-xl leading-none">
                    {item.icon}
                  </span>
                  <span className="line-clamp-2 break-words">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** Links that aren't in the phone tab bar (listed on the More page). */
export function useAdminNav() {
  return useNav().more;
}

/** The full menu catalogue (for the menu editors). */
export function useMenuCatalog() {
  return useNavCatalog().map((i) => ({ href: i.href, label: i.label, icon: i.icon }));
}

const AREA_KEY = 'sl-nav-area';

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  return (
    <Link
      href={item.href}
      aria-current={item.match(pathname) ? 'page' : undefined}
      className={cx('sl-nav flex min-h-12 items-center gap-3 rounded-lg px-3 font-semibold', item.match(pathname) ? 'bg-brand text-brand-fg' : 'text-ink hover:bg-surface-2')}
    >
      <span aria-hidden="true" className="sl-nav-icon w-5 text-center">
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

/**
 * The sidebar by area: Home, then one button per area (Project, Yard, HQ, Procurement,
 * Admin). Pick an area and the menu shortens to just that area's items.
 */
function AreaNav({ groups, pathname }: { groups: { name: string | null; icon: string | null; items: NavItem[] }[]; pathname: string }) {
  const top = groups.filter((g) => !g.name).flatMap((g) => g.items);
  const areas = groups.filter((g) => g.name);
  const here = areas.find((g) => g.items.some((i) => i.match(pathname)))?.name ?? null;
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AREA_KEY);
    } catch {
      return null;
    }
  });
  // Going to a screen opens its area.
  useEffect(() => {
    if (here) setPicked(here);
  }, [here]);
  const choose = (name: string | null) => {
    setPicked(name);
    try {
      if (name) localStorage.setItem(AREA_KEY, name);
      else localStorage.removeItem(AREA_KEY);
    } catch {
      /* private window */
    }
  };
  const area = areas.find((g) => g.name === picked) ?? null;
  return (
    <nav aria-label="Main" className="hidden w-60 shrink-0 border-r border-line bg-surface p-3 lg:block">
      <ul className="flex flex-col gap-1">
        {top.map((item) => (
          <li key={item.href}>
            <NavLink item={item} pathname={pathname} />
          </li>
        ))}
      </ul>
      {areas.length > 0 && !area && (
        <ul className="mt-3 flex flex-col gap-2" aria-label="Areas">
          {areas.map((g) => (
            <li key={g.name}>
              <button
                type="button"
                onClick={() => choose(g.name)}
                className={cx('sl-btn flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left font-bold', g.name === here ? 'border-brand bg-brand/10 text-ink' : 'border-line bg-surface-2 text-ink hover:border-brand')}
              >
                <span aria-hidden="true" className="text-2xl">
                  {g.icon}
                </span>
                <span className="flex-1">{g.name}</span>
                <span aria-hidden="true" className="text-muted">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {area && (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-2">
            <button type="button" onClick={() => choose(null)} className="sl-btn flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-muted hover:bg-surface-2" aria-label="Back to all areas">
              ‹ Areas
            </button>
            <span className="flex flex-1 items-center gap-2 rounded-lg bg-surface-2 px-2 py-1 font-bold text-ink">
              <span aria-hidden="true" className="text-xl">
                {area.icon}
              </span>
              {area.name}
            </span>
          </div>
          {/* The other areas, as small buttons, to jump across without going back. */}
          <div className="mb-2 flex flex-wrap gap-1" aria-label="Other areas">
            {areas
              .filter((g) => g.name !== area.name)
              .map((g) => (
                <button key={g.name} type="button" title={g.name ?? ''} aria-label={g.name ?? ''} onClick={() => choose(g.name)} className="sl-btn flex h-10 w-10 items-center justify-center rounded-lg border border-line text-lg hover:border-brand">
                  {g.icon}
                </button>
              ))}
          </div>
          <ul className="flex flex-col gap-1">
            {area.items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} pathname={pathname} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
