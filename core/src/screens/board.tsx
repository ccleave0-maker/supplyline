'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { LOAD_PRIORITIES, type BoardLoad, type BoardSettings, type LoadPriority, type SuggestedRun } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, cx, EmptyState, ErrorBanner, Notice, PageHeader, PageLoading, SelectField, TextField } from '../ui/components';
import { GoogleMapView } from '../ui/google-map';
import { useAction, useAsync } from '../ui/hooks';
import { MapView, type MapPoint, type MapRoute } from '../ui/map';
import { useAuthed, useLive } from '../ui/session';

const color = (p: LoadPriority) => LOAD_PRIORITIES.find((x) => x.key === p)?.color ?? '#2563EB';
const label = (p: LoadPriority) => LOAD_PRIORITIES.find((x) => x.key === p)?.label ?? p;
const today = () => new Date().toISOString().slice(0, 10);
const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function LoadMap({ loads, settings, onPick }: { loads: BoardLoad[]; settings: BoardSettings | undefined; onPick: (id: string) => void }) {
  const { points, routes } = useMemo(() => {
    const points: MapPoint[] = [];
    const routes: MapRoute[] = [];
    for (const l of loads) {
      const located = l.stops.filter((s): s is typeof s & { lat: number; lng: number } => s.lat != null && s.lng != null);
      located.forEach((s, i) => points.push({ id: `${l.id}-${i}`, lat: s.lat, lng: s.lng, color: color(l.priority), label: `${l.title ?? l.label} · ${s.kind === 'PICKUP' ? 'Pick up' : 'Drop'}: ${s.name}${s.date ? ` · ${s.date}` : ''}`, onClick: () => onPick(l.id) }));
      if (located.length > 1) routes.push({ id: l.id, color: color(l.priority), points: located.map((s) => [s.lat, s.lng]), label: `${l.title ?? l.label} — ${label(l.priority)}`, dashed: l.status === 'DRAFT' });
    }
    return { points, routes };
  }, [loads, onPick]);
  if (settings?.mapProvider === 'google' && settings.googleMapsKey) return <GoogleMapView apiKey={settings.googleMapsKey} points={points} routes={routes} height={440} label="Load board map" />;
  return <MapView points={points} routes={routes} height={440} label="Load board map" />;
}

export function LoadBoardScreen() {
  const { api, me } = useAuthed();
  const platform = usePlatform();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(plus(21));
  const [companyId, setCompanyId] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const settings = useAsync(() => api.board.settings(), [api]);
  const loads = useAsync(() => api.board.list({ from, to, companyId: companyId || undefined }), [api, from, to, companyId]);
  useLive(() => void loads.reload());
  const prio = useAction(async (id: string, p: LoadPriority) => {
    await api.board.priority(id, p);
    await loads.reload();
  });
  const list = loads.data ?? [];
  const sel = list.find((l) => l.id === picked);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Load board"
        subtitle="Every open load on a map — red is an emergency, green is good to go anytime. Dashed lines are planned loads not issued yet."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(me.user, 'bol:create') && <Button onClick={() => setPosting((v) => !v)}>New load available</Button>}
            {can(me.user, 'loads:plan') && (
              <ButtonLink href={paths.optimizer()} variant="secondary">
                Optimize
              </ButtonLink>
            )}
            {can(me.user, 'loads:plan') && (
              <ButtonLink href={paths.loadBuilder()} variant="secondary">
                Load builder
              </ButtonLink>
            )}
          </div>
        }
      />
      {posting && <PostLoadCard onDone={() => (setPosting(false), void loads.reload())} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {me.companies.length > 1 && <SelectField label="Company" placeholder="All on the board" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {LOAD_PRIORITIES.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1 text-ink">
            <span className="h-3 w-3 rounded-full" style={{ background: p.color }} aria-hidden="true" />
            {p.label}
          </span>
        ))}
      </div>
      <ErrorBanner error={loads.error || prio.error} />
      <LoadMap loads={list} settings={settings.data} onPick={setPicked} />
      {list.some((l) => l.stops.some((s) => s.lat == null)) && <Notice>Some stops have no pin, so they’re not on the map. Open the location and paste a Google / Apple Maps link (or the address) to pin it.</Notice>}
      {loads.loading && !loads.data && <PageLoading />}
      {list.length === 0 && !loads.loading && <EmptyState title="No open loads in these dates" />}
      <ul className="flex flex-col gap-2">
        {(sel ? [sel, ...list.filter((l) => l !== sel)] : list).map((l) => (
          <li key={l.id}>
            <Card className={cx(l.id === picked && 'ring-2 ring-brand')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    <span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: color(l.priority) }} aria-hidden="true" />
                    {l.title ? `${l.title} · ` : ''}
                    {l.label} <span className="font-normal text-muted">· {l.companyName}</span>
                  </p>
                  <p className="text-sm text-muted">{l.stops.map((s) => `${s.kind === 'PICKUP' ? '↑' : '↓'} ${s.name}${s.date ? ` (${s.date})` : ''}`).join('  ')}</p>
                  <p className="text-sm text-muted">
                    {[l.lineCount ? `${l.lineCount} item${l.lineCount === 1 ? '' : 's'}` : 'No items yet', l.weightKg ? `~${l.weightKg.toLocaleString()} kg` : null, l.trailerName, l.carrierName ?? (l.needsTruck ? 'No truck booked' : null), l.needBy && `needed ${l.needBy}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  {l.canEdit && (
                    <div className="w-44">
                      <SelectField label="Urgency" value={l.priority} onChange={(e) => void prio.run(l.id, e.target.value as LoadPriority)} options={LOAD_PRIORITIES.map((p) => ({ value: p.key, label: p.label }))} />
                    </div>
                  )}
                  {l.directions && (
                    <>
                      <Button variant="secondary" onClick={() => void platform.openExternal(l.directions!.google)}>
                        Google directions
                      </Button>
                      <Button variant="ghost" onClick={() => void platform.openExternal(l.directions!.apple)}>
                        Apple
                      </Button>
                    </>
                  )}
                  <ButtonLink href={paths.bol(l.id)} variant="secondary">
                    Open
                  </ButtonLink>
                </div>
              </div>
              {l.needsTruck && <Badge tone="danger">Needs a truck</Badge>}
            </Card>
          </li>
        ))}
      </ul>
      {can(me.user, 'org:manage') && settings.data && <BoardSettingsCard value={settings.data} onSaved={() => void settings.reload()} />}
    </div>
  );
}

function PostLoadCard({ onDone }: { onDone: () => void }) {
  const { api, me } = useAuthed();
  const locs = useAsync(() => api.locations.list(), [api]);
  const [f, setF] = useState({ companyId: me.user.companyId ?? me.companies[0]?.id ?? '', title: '', priority: 'NORMAL' as LoadPriority, pickup: '', drop: '', pickupDate: today(), deliveryDate: '', notes: '' });
  const post = useAction(async () => {
    await api.board.post({ companyId: f.companyId, title: f.title, priority: f.priority, pickupLocationId: f.pickup, dropLocationId: f.drop, pickupDate: f.pickupDate || null, deliveryDate: f.deliveryDate || null, notes: f.notes || null });
    onDone();
  });
  const options = (locs.data ?? []).filter((l) => l.active).map((l) => ({ value: l.id, label: l.businessName }));
  return (
    <Card title="New load available">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {me.companies.length > 1 && <SelectField label="Company" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
        <TextField label="What" placeholder="e.g. Excavator move, rebar top-up" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <SelectField label="Urgency" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as LoadPriority })} options={LOAD_PRIORITIES.map((p) => ({ value: p.key, label: p.label }))} />
        <SelectField label="Pick up at" placeholder="Choose" value={f.pickup} onChange={(e) => setF({ ...f, pickup: e.target.value })} options={options} />
        <SelectField label="Deliver to" placeholder="Choose" value={f.drop} onChange={(e) => setF({ ...f, drop: e.target.value })} options={options} />
        <TextField label="Pickup date" type="date" value={f.pickupDate} onChange={(e) => setF({ ...f, pickupDate: e.target.value })} />
        <TextField label="Delivery date" type="date" value={f.deliveryDate} onChange={(e) => setF({ ...f, deliveryDate: e.target.value })} />
        <TextField label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
      <ErrorBanner error={post.error} />
      <Button className="mt-3" busy={post.busy} disabled={!f.title.trim() || !f.pickup || !f.drop} onClick={() => void post.run()}>
        Post to the board
      </Button>
    </Card>
  );
}

function BoardSettingsCard({ value, onSaved }: { value: BoardSettings; onSaved: () => void }) {
  const { api, me } = useAuthed();
  const [s, setS] = useState(value);
  useEffect(() => setS(value), [value]);
  const save = useAction(async () => {
    await api.board.saveSettings(s);
    onSaved();
  });
  return (
    <Card title="Board settings (admin)">
      <p className="text-sm text-muted">Which companies’ loads show here, and which map to use.</p>
      <div className="mt-2 grid gap-1 sm:grid-cols-3">
        <Checkbox label="All companies" checked={s.companyIds === null} onChange={(v) => setS({ ...s, companyIds: v ? null : me.companies.map((c) => c.id) })} />
        {s.companyIds !== null &&
          me.companies.map((c) => (
            <Checkbox key={c.id} label={c.name} checked={s.companyIds!.includes(c.id)} onChange={(v) => setS({ ...s, companyIds: v ? [...s.companyIds!, c.id] : s.companyIds!.filter((x) => x !== c.id) })} />
          ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Map"
          value={s.mapProvider}
          onChange={(e) => setS({ ...s, mapProvider: e.target.value as 'osm' })}
          options={[
            { value: 'osm', label: 'OpenStreetMap (no account needed)' },
            { value: 'google', label: 'Google Maps (needs a key)' },
          ]}
        />
        {s.mapProvider === 'google' && (
          <TextField
            label="Google Maps key"
            hint="From Google Cloud (Maps JavaScript API) on your own account. Restrict it to your SupplyLine address."
            value={s.googleMapsKey ?? ''}
            onChange={(e) => setS({ ...s, googleMapsKey: e.target.value || null })}
          />
        )}
      </div>
      <ErrorBanner error={save.error} />
      <Button className="mt-3" busy={save.busy} onClick={() => void save.run()}>
        Save board settings
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Optimizer
// ---------------------------------------------------------------------------
export function OptimizerScreen() {
  const { api, me } = useAuthed();
  const router = useRouter();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(plus(14));
  const [km, setKm] = useState('60');
  const [days, setDays] = useState('3');
  const [runs, setRuns] = useState<SuggestedRun[] | null>(null);
  const [done, setDone] = useState<Record<string, number>>({});
  const go = useAction(async () => setRuns(await api.board.optimize({ from, to, combineKm: Number(km) || 0, combineDays: Number(days) || 0 })));
  const plan = useAction(async (r: SuggestedRun) => {
    const res = await api.board.makeRun({ companyId: r.companyId, pickupLocationId: r.pickup.locationId, trailerId: r.trailerId, shipOn: r.shipOn, needBy: r.needBy, drops: r.drops.map((d) => ({ siteId: d.siteId, locationId: d.locationId, needBy: d.needBy })), plan: r.plan });
    setDone((d) => ({ ...d, [r.key]: res.ids.length }));
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={paths.loadBoard()}
        title="Load optimizer"
        subtitle="Looks at everything waiting to move across the province — with the dates from the order lists — and suggests how to move it: which jobs share a truck, which trailer, what order and when."
      />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="Needed from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="Needed by" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <TextField label="Combine jobs within (km)" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} />
          <TextField label="…due within (days)" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <ErrorBanner error={go.error} />
        <Button className="mt-3" busy={go.busy} onClick={() => void go.run()}>
          Suggest loads
        </Button>
        <p className="mt-2 text-sm text-muted">Uses your trailer library, the item sizes and weights, and the job pins. Nothing is booked until you press “Plan these loads”.</p>
      </Card>
      <ErrorBanner error={plan.error} />
      {runs?.length === 0 && <EmptyState title="Nothing waiting to move in those dates" />}
      {(runs ?? []).map((r) => (
        <Card key={r.key} title={`${r.pickup.name} → ${r.drops.map((d) => d.name).join(' → ')}`}>
          <p className="text-sm text-muted">
            {[r.companyName, `${r.loads} load${r.loads === 1 ? '' : 's'}`, r.trailerName, r.weightKg ? `~${r.weightKg.toLocaleString()} kg` : null, r.distanceKm ? `~${r.distanceKm} km` : null, r.shipOn && `ship ${r.shipOn}`].filter(Boolean).join(' · ')}
          </p>
          <ul className="mt-2 list-disc pl-6 text-sm text-ink">
            {r.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {r.flags.length > 0 && <p className="mt-1 text-sm text-danger">Check: {r.flags.join(', ').toLowerCase().replace(/_/g, ' ')}</p>}
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-brand-ink">What’s on it</summary>
            {r.drops.map((d) => (
              <div key={d.siteId} className="mt-1">
                <p className="text-sm font-semibold text-ink">
                  {d.name}
                  {d.needBy && <span className="font-normal text-muted"> · needed {d.needBy}</span>}
                </p>
                <ul className="pl-4 text-sm text-ink">
                  {d.items.map((i) => (
                    <li key={i.lotId}>
                      {i.qty} {i.uom} — {i.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
          {done[r.key] ? (
            <p className="mt-2 text-sm text-ink">
              ✔ {done[r.key]} planned load{done[r.key] === 1 ? '' : 's'} made —{' '}
              <Link href={paths.schedule()} className="underline">
                see the schedule
              </Link>
            </p>
          ) : (
            can(me.user, 'bol:create') && (
              <Button className="mt-2" busy={plan.busy} onClick={() => void plan.run(r)}>
                Plan these loads
              </Button>
            )
          )}
        </Card>
      ))}
      {runs && runs.length > 0 && (
        <Button variant="ghost" onClick={() => router.push(paths.loadBoard())}>
          Back to the load board
        </Button>
      )}
    </div>
  );
}
