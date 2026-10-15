'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { REPORTS, SEARCH_KIND_LABELS, type HealthSettings, type ReportKey, type ReportResult, type SearchHit, type SearchKind } from '../models';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, cx, EmptyState, ErrorBanner, Notice, PageHeader, PageLoading, SelectField, TextField } from '../ui/components';
import { ExportButtons } from '../ui/export';
import { useAction, useAsync, useDebounced } from '../ui/hooks';
import { useAuthed, useLive, useSession } from '../ui/session';
import { PushToggle } from './golive';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
};
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Home pieces: dashboard tiles and the latest activity
// ---------------------------------------------------------------------------
export function DashboardTiles() {
  const { api } = useAuthed();
  const tiles = useAsync(() => api.dashboard(), [api]);
  useLive(() => void tiles.reload());
  if (!tiles.data?.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.data.map((t) => (
        <Link key={t.key} href={t.link} className={cx('rounded-xl border bg-surface p-3', t.warn && t.value > 0 ? 'border-danger' : 'border-line')}>
          <p className={cx('text-2xl font-bold', t.warn && t.value > 0 ? 'text-danger' : 'text-ink')}>{t.value}</p>
          <p className="text-sm text-muted">{t.label}</p>
        </Link>
      ))}
    </div>
  );
}

export function ActivityCard({ siteId, limit = 8 }: { siteId?: string; limit?: number }) {
  const { api } = useAuthed();
  const feed = useAsync(() => api.activity({ siteId, limit }), [api, siteId, limit]);
  useLive(() => void feed.reload());
  return (
    <Card title="What’s happening" actions={<ButtonLink href={paths.activity()} variant="secondary">More</ButtonLink>}>
      <ErrorBanner error={feed.error} />
      {feed.data?.length === 0 && <p className="text-muted">Nothing yet.</p>}
      <ActivityList items={feed.data ?? []} />
    </Card>
  );
}

function ActivityList({ items }: { items: { id: string; at: string; text: string; siteLabel: string | null; link: string | null; icon: string }[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3 py-2">
          <span aria-hidden="true" className="w-6 text-center text-lg">
            {a.icon}
          </span>
          <div className="min-w-0">
            {a.link ? (
              <Link href={a.link} className="text-ink hover:underline">
                {a.text}
              </Link>
            ) : (
              <p className="text-ink">{a.text}</p>
            )}
            <p className="text-sm text-muted">{[a.siteLabel, ago(a.at)].filter(Boolean).join(' · ')}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ActivityScreen() {
  const { api } = useAuthed();
  const [siteId, setSiteId] = useState('');
  const jobs = useAsync(() => api.sites.list({}), [api]);
  const feed = useAsync(() => api.activity({ siteId: siteId || undefined, limit: 100 }), [api, siteId]);
  useLive(() => void feed.reload());
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="What’s happening" subtitle="Lists submitted, POs issued, loads shipped and received, minutes sent — on the jobs you work on." />
      <SelectField label="Job" placeholder="All my jobs" value={siteId} onChange={(e) => setSiteId(e.target.value)} options={(jobs.data ?? []).map((j) => ({ value: j.id, label: j.type === 'JOB' ? `JOB#${j.jobNumber} ${j.name}` : j.name }))} />
      <ErrorBanner error={feed.error} />
      {feed.loading && !feed.data && <PageLoading />}
      {feed.data?.length === 0 && <EmptyState title="Nothing yet" />}
      <Card>
        <ActivityList items={feed.data ?? []} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification centre
// ---------------------------------------------------------------------------
export function NotificationsScreen() {
  const { api } = useAuthed();
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useAsync(() => api.notifications.list(unreadOnly), [api, unreadOnly]);
  useLive(() => void list.reload());
  const readAll = useAction(async () => {
    await api.notifications.read('all');
    await list.reload();
  });
  const open = useAction(async (id: string, link: string | null) => {
    await api.notifications.read([id]);
    if (link) router.push(link);
    else await list.reload();
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Notifications"
        subtitle={list.data ? `${list.data.unread} unread` : undefined}
        actions={
          <Button variant="secondary" busy={readAll.busy} disabled={!list.data?.unread} onClick={() => void readAll.run()}>
            Mark all read
          </Button>
        }
      />
      <Checkbox label="Only unread" checked={unreadOnly} onChange={setUnreadOnly} />
      <PushToggle />
      <ErrorBanner error={list.error || open.error} />
      {list.loading && !list.data && <PageLoading />}
      {list.data?.items.length === 0 && <EmptyState title="You’re all caught up" />}
      <Card>
        <ul className="divide-y divide-line">
          {(list.data?.items ?? []).map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => void open.run(n.id, n.link)} className="flex w-full min-h-12 items-start gap-3 py-2 text-left">
                <span aria-hidden="true" className={cx('mt-2 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand')} />
                <span className="min-w-0">
                  <span className={cx('block text-ink', !n.read && 'font-semibold')}>{n.title}</span>
                  {n.body && <span className="block text-sm text-muted">{n.body}</span>}
                  <span className="block text-xs text-muted">{ago(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------
export function SearchScreen() {
  const params = useSearchParams();
  const { api } = useAuthed();
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => setQ(params.get('q') ?? ''), [params]);
  const term = useDebounced(q, 300);
  const hits = useAsync(async () => (term.trim().length >= 2 ? api.search(term) : []), [api, term]);
  const groups = new Map<SearchKind, SearchHit[]>();
  for (const h of hits.data ?? []) groups.set(h.kind, [...(groups.get(h.kind) ?? []), h]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Search" />
      <TextField label="Search" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job #, list (2249 list 3), PO #, BOL #, material, vendor, person, unit #…" />
      <ErrorBanner error={hits.error} />
      {term.trim().length >= 2 && hits.data?.length === 0 && !hits.loading && <EmptyState title="Nothing found">Try a job number, PO number, or part of a description.</EmptyState>}
      {[...groups.entries()].map(([kind, list]) => (
        <Card key={kind} title={SEARCH_KIND_LABELS[kind]}>
          <ul className="divide-y divide-line">
            {list.map((h) => (
              <li key={`${h.kind}-${h.id}`}>
                <Link href={h.link} className="block min-h-12 py-2 hover:bg-surface-2">
                  <span className="block text-ink">{h.title}</span>
                  {h.subtitle && <span className="block text-sm text-muted">{h.subtitle}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health checks (admin)
// ---------------------------------------------------------------------------
export function HealthScreen() {
  const { api } = useAuthed();
  const data = useAsync(() => api.health.get(), [api]);
  const [s, setS] = useState<HealthSettings | null>(null);
  const [emails, setEmails] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!data.data) return;
    setS(data.data.settings);
    setEmails(data.data.settings.alertEmails.join(', '));
  }, [data.data]);
  const save = useAction(async () => {
    if (!s) return;
    await api.health.save({ ...s, alertEmails: emails.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean) });
    setMsg('Saved.');
  });
  const run = useAction(async () => {
    await api.health.run();
    await data.reload();
  });
  if (!data.data || !s) return data.error ? <ErrorBanner error={data.error} /> : <PageLoading />;
  const last = data.data.runs[0];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Health checks"
        subtitle="Bowron checks itself on a timer and emails you when something breaks — and again when it’s fixed."
        actions={
          <Button busy={run.busy} onClick={() => void run.run()}>
            Check now
          </Button>
        }
      />
      <ErrorBanner error={save.error || run.error} />
      {msg && <Notice>{msg}</Notice>}
      {last && (
        <Card title={last.ok ? '✔ Everything is working' : '✖ Something needs a look'} actions={<span className="text-sm text-muted">{ago(last.at)}</span>}>
          <ul className="divide-y divide-line">
            {last.results.map((r) => (
              <li key={r.key} className="flex items-start gap-3 py-2">
                <Badge tone={!r.ok ? 'danger' : r.warn ? 'neutral' : 'ok'}>{!r.ok ? 'Problem' : r.warn ? 'Note' : 'OK'}</Badge>
                <div>
                  <p className="font-semibold text-ink">{r.label}</p>
                  <p className="text-sm text-muted">{r.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Settings">
        <Checkbox label="Run health checks" checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SelectField
            label="How often"
            value={String(s.intervalMinutes)}
            onChange={(e) => setS({ ...s, intervalMinutes: Number(e.target.value) })}
            options={[5, 15, 30, 60, 240, 1440].map((m) => ({ value: String(m), label: m < 60 ? `Every ${m} minutes` : m === 60 ? 'Every hour' : m === 1440 ? 'Once a day' : `Every ${m / 60} hours` }))}
          />
          <TextField label="Send alerts to" hint="Leave empty for all admins and the platform owner. Separate with commas." value={emails} onChange={(e) => setEmails(e.target.value)} />
        </div>
        <Button className="mt-3" busy={save.busy} onClick={() => void save.run()}>
          Save
        </Button>
      </Card>
      <Card title="History">
        <ul className="divide-y divide-line">
          {data.data.runs.map((r) => (
            <li key={r.id} className="flex justify-between py-1 text-sm">
              <span className={r.ok ? 'text-ink' : 'text-danger'}>{r.ok ? '✔ OK' : `✖ ${r.results.filter((x) => !x.ok).map((x) => x.label).join(', ')}`}</span>
              <span className="text-muted">
                {new Date(r.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}
                {r.alerted ? ' · alert sent' : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export function ReportsScreen() {
  const { api, me } = useAuthed();
  const [key, setKey] = useState<ReportKey>('spend-by-job');
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const [companyId, setCompanyId] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const run = useAction(async () => setResult(await api.reports.run(key, { from, to, companyId: companyId || undefined })));
  const def = REPORTS.find((r) => r.key === key)!;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" subtitle="Ready-made reports. Export any of them to Excel or PDF." />
      <ButtonLink href={paths.reportBuilder()} variant="secondary">
        Build your own report (pick the data and fields, send it on a schedule)
      </ButtonLink>
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Report"
            value={key}
            onChange={(e) => {
              setKey(e.target.value as ReportKey);
              setResult(null);
            }}
            options={REPORTS.map((r) => ({ value: r.key, label: r.label }))}
          />
          <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          {me.companies.length > 1 && <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={[{ value: '', label: 'All companies' }, ...me.companies.map((c) => ({ value: c.id, label: c.name }))]} />}
        </div>
        <p className="mt-2 text-sm text-muted">{def.help}</p>
        <ErrorBanner error={run.error} />
        <Button className="mt-3" busy={run.busy} onClick={() => void run.run()}>
          Run report
        </Button>
      </Card>
      {result && (
        <Card title={result.title} actions={<ExportButtons title={result.title} companyId={companyId || null} columns={result.columns} rows={result.rows} />}>
          {result.rows.length === 0 ? (
            <p className="text-muted">Nothing in that date range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key} className={cx('px-2 py-1', c.align === 'right' && 'text-right')}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      {result.columns.map((c) => (
                        <td key={c.key} className={cx('px-2 py-1 text-ink', c.align === 'right' && 'text-right tabular-nums')}>
                          {r[c.key] == null ? '—' : typeof r[c.key] === 'number' ? (r[c.key] as number).toLocaleString('en-CA') : r[c.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Look & feel (admin): background picture, fade, logo decal
// ---------------------------------------------------------------------------
export function AppearanceScreen() {
  const platform = usePlatform();
  const { api, me, activeCompany } = useAuthed();
  const { refreshMe } = useSession();
  const [companyId, setCompanyId] = useState(activeCompany?.id ?? me.companies[0]?.id ?? '');
  const company = me.companies.find((c) => c.id === companyId);
  const [fade, setFade] = useState(company?.appearance?.fade ?? 85);
  const [decal, setDecal] = useState(company?.appearance?.decal ?? false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    setFade(company?.appearance?.fade ?? 85);
    setDecal(company?.appearance?.decal ?? false);
  }, [company]);
  const save = useAction(async (opts: { pick?: boolean; clear?: boolean } = {}) => {
    let file: { blob: Blob; name: string } | undefined;
    if (opts.pick) {
      file = (await platform.files.pickFiles({ accept: 'image/png,image/jpeg,image/webp' }))[0];
      if (!file) return;
    }
    await api.appearance(companyId, { fade, decal, clearBackground: opts.clear }, file?.blob ?? null, file?.name);
    await refreshMe();
    setMsg('Saved.');
  });
  const bg = company?.appearance?.backgroundUrl ? api.fileUrl(company.appearance.backgroundUrl) : null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Look & feel" subtitle="A background picture behind every screen (faded so everything stays easy to read) and your logo as a faint decal." />
      {me.companies.length > 1 && <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
      <ErrorBanner error={save.error} />
      {msg && <Notice>{msg}</Notice>}
      <Card title="Background picture">
        <div className="relative h-40 overflow-hidden rounded-lg border border-line bg-surface-2">
          {bg && <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bg}")` }} />}
          <div className="absolute inset-0 bg-surface-2" style={{ opacity: fade / 100 }} />
          <div className="relative m-4 max-w-xs rounded-lg border border-line bg-surface p-3 text-ink">How a card looks on top of it</div>
        </div>
        <label className="mt-3 block">
          <span className="font-semibold text-ink">Fade: {fade}%</span>
          <input type="range" min={0} max={95} step={5} value={fade} onChange={(e) => setFade(Number(e.target.value))} className="mt-1 block w-full" aria-label="Fade" />
          <span className="text-sm text-muted">Higher = lighter picture. 80–90% keeps text easy to read outdoors.</span>
        </label>
        <div className="mt-3">
          <Checkbox label="Show our logo as a faint decal in the corner" checked={decal} onChange={setDecal} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button busy={save.busy} onClick={() => void save.run({ pick: true })}>
            {bg ? 'Choose a different picture' : 'Choose a picture'}
          </Button>
          <Button variant="secondary" busy={save.busy} onClick={() => void save.run()}>
            Save fade & decal
          </Button>
          {bg && (
            <Button variant="ghost" onClick={() => void save.run({ clear: true })}>
              Remove picture
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
