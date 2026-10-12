'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { SiteListItem, SiteType } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, ButtonLink, Checkbox, cx, EmptyState, ErrorBanner, List, ListRow, PageHeader, PageLoading, TextField } from '../ui/components';
import { useAsync, useDebounced } from '../ui/hooks';
import { MapView } from '../ui/map';
import { useAuthed } from '../ui/session';

export function siteTitle(s: Pick<SiteListItem, 'type' | 'jobNumber' | 'name'>) {
  return s.type === 'JOB' ? `JOB#${s.jobNumber} · ${s.name}` : `${s.name} (Yard ${s.jobNumber})`;
}

export function SitesScreen() {
  const { api, me, activeCompany } = useAuthed();
  const router = useRouter();
  const params = useSearchParams();
  const type = (params.get('type') === 'YARD' ? 'YARD' : 'JOB') as SiteType;
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');

  const search = useDebounced(q.trim());
  const sites = useAsync(
    () => api.sites.list({ type, companyId: activeCompany?.id, includeInactive: showInactive, q: search || undefined }),
    [api, type, activeCompany?.id, showInactive, search],
  );
  const canCreate = can(me.user, 'site:create');
  const mapped = (sites.data ?? []).filter((s) => s.lat != null && s.lng != null);

  return (
    <div>
      <PageHeader
        title="Jobs / projects & yards"
        actions={canCreate && <ButtonLink href={paths.siteNew(type)}>{type === 'JOB' ? '+ New job / project' : '+ New yard'}</ButtonLink>}
      />

      <div role="tablist" aria-label="Show" className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-surface p-1">
        {(['JOB', 'YARD'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={type === t}
            onClick={() => router.replace(paths.sites(t))}
            className={cx('min-h-12 rounded-lg font-semibold', type === t ? 'bg-brand text-brand-fg' : 'text-ink')}
          >
            {t === 'JOB' ? 'Jobs / projects' : 'Yards'}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <TextField label="Search" type="search" placeholder="Job number, name or town" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <ButtonLinkToggle active={view === 'list'} onClick={() => setView('list')}>
            List
          </ButtonLinkToggle>
          <ButtonLinkToggle active={view === 'map'} onClick={() => setView('map')}>
            Map
          </ButtonLinkToggle>
        </div>
      </div>
      <Checkbox label="Show closed / inactive" checked={showInactive} onChange={setShowInactive} />

      <div className="mt-3">
        <ErrorBanner error={sites.error} onRetry={sites.reload} />
        {sites.loading && !sites.data ? (
          <PageLoading />
        ) : !sites.data?.length ? (
          <EmptyState title={type === 'JOB' ? 'No jobs found' : 'No yards found'}>
            {canCreate ? 'Create one with the button above.' : 'Ask your administrator to add you to a job.'}
          </EmptyState>
        ) : view === 'map' ? (
          <>
            <MapView
              label={type === 'JOB' ? 'Map of jobs' : 'Map of yards'}
              height={420}
              points={mapped.map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng!, label: siteTitle(s), onClick: () => router.push(paths.site(s.id)) }))}
            />
            {mapped.length < sites.data.length && (
              <p className="mt-2 text-sm text-muted">{sites.data.length - mapped.length} without a map pin aren't shown.</p>
            )}
          </>
        ) : (
          <List>
            {sites.data.map((s) => (
              <ListRow
                key={s.id}
                href={paths.site(s.id)}
                title={siteTitle(s)}
                subtitle={[s.companyName, [s.city, s.province].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || undefined}
                right={!s.active && <Badge>Inactive</Badge>}
              />
            ))}
          </List>
        )}
      </div>
    </div>
  );
}

function ButtonLinkToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx('min-h-12 rounded-lg border px-4 font-semibold', active ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-surface text-ink')}
    >
      {children}
    </button>
  );
}
