'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  fmtLength,
  fmtWeight,
  fromKg,
  fromMetres,
  LOAD_FLAG_LABELS,
  toKg,
  toMetres,
  TRAILER_KINDS,
  type LoadFlag,
  type LoadItem,
  type LoadPlan,
  type TrailerInput,
  type TrailerKind,
  type TrailerView,
  type UnitSystem,
} from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, cx, EmptyState, ErrorBanner, Notice, PageHeader, PageLoading, SelectField, TextField } from '../ui/components';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';
import { useUnits } from '../ui/units';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const r2 = (n: number) => String(Math.round(n * 100) / 100);

function UnitToggle({ units, setUnits }: { units: UnitSystem; setUnits: (u: UnitSystem) => void }) {
  return (
    <div className="flex gap-2" role="group" aria-label="Units">
      <Button variant={units === 'imperial' ? 'primary' : 'secondary'} onClick={() => setUnits('imperial')}>
        ft / lb
      </Button>
      <Button variant={units === 'metric' ? 'primary' : 'secondary'} onClick={() => setUnits('metric')}>
        m / kg
      </Button>
    </div>
  );
}

function Bar({ value, label }: { value: number; label: string }) {
  const over = value > 1.0001;
  return (
    <div>
      <div className="flex justify-between text-sm text-muted">
        <span>{label}</span>
        <span className={cx(over && 'font-semibold text-danger')}>{pct(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-surface-2" aria-hidden>
        <div className={cx('h-full', over ? 'bg-danger' : 'bg-brand')} style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );
}

function Flags({ flags }: { flags: LoadFlag[] }) {
  const shown = flags.filter((f) => f !== 'NO_SIZE');
  if (!shown.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {shown.map((f) => (
        <Badge key={f} tone={f === 'OVERHANG' ? 'neutral' : 'danger'}>
          {LOAD_FLAG_LABELS[f]}
        </Badge>
      ))}
    </div>
  );
}

/** "12,300 lb of 46,000 — 27%" with warnings, for a BOL. */
export function LoadCheckLine({ check, payloadKg }: { check: { weightKg: number; weightPct: number; loadsNeeded: number; flags: LoadFlag[]; unsized: number }; payloadKg: number }) {
  const [units] = useUnits();
  return (
    <span className="block text-sm">
      <span className={cx(check.weightPct > 1 ? 'font-semibold text-danger' : 'text-muted')}>
        Est. {fmtWeight(check.weightKg, units)} of {fmtWeight(payloadKg, units)} ({pct(check.weightPct)})
        {check.loadsNeeded > 1 ? ` · needs ${check.loadsNeeded} loads` : ''}
        {check.unsized ? ` · ${check.unsized} item(s) without a weight` : ''}
      </span>
      <Flags flags={check.flags} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Trailer library
// ---------------------------------------------------------------------------
const kindDefaults = (k: TrailerKind) => TRAILER_KINDS.find((x) => x.key === k)!;
const blankTrailer = (k: TrailerKind = 'FLATDECK'): TrailerInput => {
  const d = kindDefaults(k);
  return { name: d.label, kind: k, unitNumber: null, carrierContactId: null, deckLengthM: d.deckLengthM, deckWidthM: d.deckWidthM, deckHeightM: d.deckHeightM, maxHeightM: 4.15, maxWidthM: 2.6, maxPayloadKg: d.maxPayloadKg, notes: null };
};

/** Number field in the shown unit, stored in metres / kg. */
function MeasureField({ label, value, kind, units, onChange }: { label: string; value: number | null; kind: 'len' | 'kg'; units: UnitSystem; onChange: (v: number | null) => void }) {
  const shown = value == null ? '' : r2(kind === 'kg' ? fromKg(value, units) : fromMetres(value, units));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const unit = kind === 'kg' ? (units === 'metric' ? 'kg' : 'lb') : units === 'metric' ? 'm' : 'ft';
  return (
    <TextField
      label={`${label} (${unit})`}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = text.trim() === '' ? null : Number(text);
        if (v != null && (!Number.isFinite(v) || v < 0)) return setText(shown);
        onChange(v == null ? null : kind === 'kg' ? toKg(v, units) : toMetres(v, units));
      }}
    />
  );
}

export function TrailersScreen() {
  const { api, me } = useAuthed();
  const [units, setUnits] = useUnits();
  const list = useAsync(() => api.trailers.list(true), [api]);
  const carriers = useAsync(() => api.contacts.list({ type: 'TRUCKING' }), [api]);
  const [editing, setEditing] = useState<{ id: string | null; t: TrailerInput } | null>(null);
  const canEdit = can(me.user, 'trailer:manage');
  const set = (patch: Partial<TrailerInput>) => setEditing((e) => (e ? { ...e, t: { ...e.t, ...patch } } : e));
  const save = useAction(async () => {
    if (!editing) return;
    if (editing.id) await api.trailers.update(editing.id, editing.t);
    else await api.trailers.create(editing.t);
    setEditing(null);
    await list.reload();
  });
  const toggle = useAction(async (t: TrailerView) => {
    await api.trailers.update(t.id, { ...t, active: !t.active });
    await list.reload();
  });
  if (!list.data && !list.error) return <PageLoading />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.loadBuilder()} title="Trailers" subtitle="Your trailer library for the load builder: deck size, height and how much each can carry." actions={<UnitToggle units={units} setUnits={setUnits} />} />
      <ErrorBanner error={list.error || toggle.error} />
      {!editing && (
        <Card
          actions={
            canEdit && (
              <Button variant="secondary" onClick={() => setEditing({ id: null, t: blankTrailer() })}>
                + Add a trailer
              </Button>
            )
          }
        >
          {list.data?.length === 0 && <EmptyState title="No trailers yet">{canEdit ? 'Add the trailers you use (or rent) most — the typical sizes are filled in for you.' : 'Yard or admin can add them.'}</EmptyState>}
          <ul className="flex flex-col divide-y divide-line">
            {(list.data ?? []).map((t) => (
              <li key={t.id} className={cx('flex flex-wrap items-center justify-between gap-2 py-2', !t.active && 'opacity-60')}>
                <div>
                  <p className="text-ink">
                    {t.name}
                    {t.unitNumber ? ` #${t.unitNumber}` : ''} {!t.active && <Badge>Not in use</Badge>}
                  </p>
                  <p className="text-sm text-muted">
                    {TRAILER_KINDS.find((k) => k.key === t.kind)?.label} · deck {fmtLength(t.deckLengthM, units)} × {fmtLength(t.deckWidthM, units)}, {fmtLength(t.deckHeightM, units)} high · carries {fmtWeight(t.maxPayloadKg, units)}
                    {t.carrierName ? ` · ${t.carrierName}` : ''}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setEditing({ id: t.id, t: { ...t } })}>
                      Edit
                    </Button>
                    <Button variant="ghost" busy={toggle.busy} onClick={() => void toggle.run(t)}>
                      {t.active ? 'Stop using' : 'Use again'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && (
        <Card title={editing.id ? 'Edit trailer' : 'Add a trailer'}>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Type"
              value={editing.t.kind}
              onChange={(e) => {
                const k = e.target.value as TrailerKind;
                const d = blankTrailer(k);
                // New trailers take the type's typical sizes.
                set(editing.id ? { kind: k } : { ...d, unitNumber: editing.t.unitNumber, carrierContactId: editing.t.carrierContactId });
              }}
              options={TRAILER_KINDS.map((k) => ({ value: k.key, label: k.label }))}
            />
            <TextField label="Name" value={editing.t.name} onChange={(e) => set({ name: e.target.value })} />
            <TextField label="Unit # (optional)" hint="Give a unit # to warn when the same trailer is booked twice in a day." value={editing.t.unitNumber ?? ''} onChange={(e) => set({ unitNumber: e.target.value || null })} />
            <SelectField label="Owned by" placeholder="Us" value={editing.t.carrierContactId ?? ''} onChange={(e) => set({ carrierContactId: e.target.value || null })} options={(carriers.data ?? []).map((c) => ({ value: c.id, label: c.businessName ?? c.name }))} />
            <MeasureField label="Deck length" kind="len" units={units} value={editing.t.deckLengthM} onChange={(v) => v && set({ deckLengthM: v })} />
            <MeasureField label="Deck width" kind="len" units={units} value={editing.t.deckWidthM} onChange={(v) => v && set({ deckWidthM: v })} />
            <MeasureField label="Deck height off the road" kind="len" units={units} value={editing.t.deckHeightM} onChange={(v) => set({ deckHeightM: v ?? 0 })} />
            <MeasureField label="Can carry" kind="kg" units={units} value={editing.t.maxPayloadKg} onChange={(v) => v && set({ maxPayloadKg: v })} />
            <MeasureField label="Legal height overall" kind="len" units={units} value={editing.t.maxHeightM} onChange={(v) => v && set({ maxHeightM: v })} />
            <MeasureField label="Legal width" kind="len" units={units} value={editing.t.maxWidthM} onChange={(v) => v && set({ maxWidthM: v })} />
          </div>
          <p className="mt-2 text-sm text-muted">Legal limits default to BC without a permit: 4.15 m (13′ 7″) high and 2.6 m (8′ 6″) wide overall.</p>
          <ErrorBanner error={save.error} />
          <div className="mt-3 flex gap-2">
            <Button busy={save.busy} onClick={() => void save.run()}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Load builder
// ---------------------------------------------------------------------------
type Row = LoadItem & { on: boolean; take: string };

export function LoadBuilderScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { api, me } = useAuthed();
  const [units, setUnits] = useUnits();
  const [companyId, setCompanyId] = useState(me.user.companyId ?? me.companies[0]?.id ?? '');
  const [locationId, setLocationId] = useState(params.get('locationId') ?? '');
  const [siteId, setSiteId] = useState(params.get('siteId') ?? '');
  const [trailerId, setTrailerId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [plan, setPlan] = useState<LoadPlan | null>(null);
  const [compare, setCompare] = useState<{ trailerId: string; name: string; loads: number; flagged: number }[] | null>(null);
  const [dropId, setDropId] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const locs = useAsync(() => api.locations.list(), [api]);
  const jobs = useAsync(() => api.sites.list({ type: 'JOB', companyId }), [api, companyId]);
  const trailers = useAsync(() => api.trailers.list(), [api]);
  const carriers = useAsync(() => api.contacts.list({ type: 'TRUCKING' }), [api]);
  const canMake = can(me.user, 'bol:create');

  useEffect(() => {
    if (!trailerId && trailers.data?.[0]) setTrailerId(trailers.data[0].id);
  }, [trailers.data, trailerId]);
  useEffect(() => {
    if (!locationId && locs.data) setLocationId(locs.data.find((l) => l.siteType === 'YARD')?.id ?? '');
  }, [locs.data, locationId]);
  // The drop-off defaults to the job's own location.
  useEffect(() => {
    if (siteId && locs.data) setDropId(locs.data.find((l) => l.siteId === siteId)?.id ?? '');
  }, [siteId, locs.data]);

  const items = useAsync(async () => (locationId ? api.loads.items({ locationId, siteId: siteId || undefined, companyId }) : []), [api, locationId, siteId, companyId]);
  useEffect(() => {
    setRows((items.data ?? []).map((i) => ({ ...i, on: true, take: String(i.qty) })));
    setPlan(null);
    setCompare(null);
  }, [items.data]);

  const chosen = rows.filter((r) => r.on && Number(r.take) > 0).map((r) => ({ key: r.key, qty: Math.min(Number(r.take), r.qty) }));
  const run = useAction(async () => {
    if (!trailerId) throw new Error('Pick a trailer (add some under Trailers).');
    if (!chosen.length) throw new Error('Tick what you want to load.');
    setPlan(await api.loads.plan(trailerId, chosen));
  });
  const cmp = useAction(async () => setCompare(await api.loads.compare(chosen)));
  const saveSize = useAction(async (r: Row, patch: Partial<LoadItem>) => {
    const next = { ...r, ...patch };
    setRows((rs) => rs.map((x) => (x.orderLineId === r.orderLineId ? { ...x, ...patch } : x)));
    if (!r.orderLineId) throw new Error('Sizes are kept on order-list lines; this is equipment stock.');
    await api.loads.setSize(r.orderLineId, { unitWeightKg: next.unitWeightKg, lengthM: next.lengthM, widthM: next.widthM, heightM: next.heightM, stackable: next.stackable });
    setPlan(null);
  });
  const make = useAction(async () => {
    if (!plan) return;
    if (!dropId) throw new Error('Choose where it’s going.');
    const r = await api.loads.make({
      trailerId,
      companyId,
      pickupLocationId: locationId,
      dropLocationId: dropId,
      pickupDate: pickupDate || null,
      deliveryDate: deliveryDate || pickupDate || null,
      carrierContactId: carrierId || null,
      loads: plan.loads.map((l) => l.lines.map((x) => ({ lotId: x.key, qty: x.qty }))),
    });
    router.push(r.ids.length === 1 ? paths.bol(r.ids[0]!) : paths.schedule());
  });
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const trailer = trailers.data?.find((t) => t.id === trailerId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Load builder"
        subtitle="Pick the material and a trailer: SupplyLine works out how many loads, what goes on each, and what’s oversize or overweight. Approximate — the driver has the final say."
        actions={
          <div className="flex flex-wrap gap-2">
            <UnitToggle units={units} setUnits={setUnits} />
            <ButtonLink href={paths.trailers()} variant="secondary">
              Trailers
            </ButtonLink>
          </div>
        }
      />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {me.companies.length > 1 && <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
          <SelectField label="Material at" placeholder="Choose" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={(locs.data ?? []).filter((l) => l.active).map((l) => ({ value: l.id, label: l.businessName }))} />
          <SelectField label="For job" placeholder="All jobs" value={siteId} onChange={(e) => setSiteId(e.target.value)} options={(jobs.data ?? []).map((j) => ({ value: j.id, label: `JOB#${j.jobNumber} ${j.name}` }))} />
          <SelectField label="Trailer" placeholder={trailers.data?.length ? 'Choose' : 'Add one under Trailers'} value={trailerId} onChange={(e) => setTrailerId(e.target.value)} options={(trailers.data ?? []).map((t) => ({ value: t.id, label: `${t.name}${t.unitNumber ? ` #${t.unitNumber}` : ''}` }))} />
        </div>
        {trailer && (
          <p className="mt-2 text-sm text-muted">
            Deck {fmtLength(trailer.deckLengthM, units)} × {fmtLength(trailer.deckWidthM, units)} · carries {fmtWeight(trailer.maxPayloadKg, units)} · room for {fmtLength(trailer.maxHeightM - trailer.deckHeightM, units)} of height
          </p>
        )}
      </Card>
      <ErrorBanner error={items.error || saveSize.error} />

      <Card title={`Material (${rows.length})`}>
        {items.loading && <p className="text-muted">Loading…</p>}
        {!items.loading && rows.length === 0 && <EmptyState title="Nothing ready to load here">Material shows once it’s in stock at this location.</EmptyState>}
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => {
            const flags = plan?.itemFlags[r.key] ?? [];
            return (
              <li key={r.key} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Checkbox label={`${r.label}`} description={`${r.ref} · ${r.qty} ${r.uom} here`} checked={r.on} onChange={(v) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, on: v } : x)))} />
                  <TextField label={`Load (${r.uom})`} inputMode="decimal" className="w-28" value={r.take} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, take: e.target.value } : x)))} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <MeasureField label={`Weight / ${r.uom}`} kind="kg" units={units} value={r.unitWeightKg} onChange={(v) => void saveSize.run(r, { unitWeightKg: v })} />
                  <MeasureField label="Length" kind="len" units={units} value={r.lengthM} onChange={(v) => void saveSize.run(r, { lengthM: v })} />
                  <MeasureField label="Width" kind="len" units={units} value={r.widthM} onChange={(v) => void saveSize.run(r, { widthM: v })} />
                  <MeasureField label="Height" kind="len" units={units} value={r.heightM} onChange={(v) => void saveSize.run(r, { heightM: v })} />
                  <div className="flex items-end">
                    <Checkbox label="Stacks" checked={r.stackable} onChange={(v) => void saveSize.run(r, { stackable: v })} />
                  </div>
                </div>
                {flags.includes('NO_SIZE') && <p className="mt-1 text-sm text-muted">No size or weight yet — it goes on the first load but isn’t counted.</p>}
                <Flags flags={flags} />
              </li>
            );
          })}
        </ul>
        <ErrorBanner error={run.error || cmp.error} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button busy={run.busy} disabled={!chosen.length} onClick={() => void run.run()}>
            Work out the loads
          </Button>
          <Button variant="secondary" busy={cmp.busy} disabled={!chosen.length || !trailers.data?.length} onClick={() => void cmp.run()}>
            Compare trailers
          </Button>
        </div>
        {compare && (
          <ul className="mt-3 text-sm text-ink">
            {compare.map((c) => (
              <li key={c.trailerId}>
                <button type="button" className="underline" onClick={() => setTrailerId(c.trailerId)}>
                  {c.name}
                </button>
                : {c.loads} load{c.loads === 1 ? '' : 's'}
                {c.flagged ? ` (${c.flagged} with warnings)` : ''}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {plan && (
        <>
          <Notice>
            {plan.loads.length} load{plan.loads.length === 1 ? '' : 's'} · about {fmtWeight(plan.totalWeightKg, units)} in all
            {plan.unsized.length ? ` · ${plan.unsized.length} item(s) have no size or weight` : ''}
          </Notice>
          <div className="grid gap-3 lg:grid-cols-2">
            {plan.loads.map((l) => (
              <Card key={l.no} title={`Load ${l.no} — ${fmtWeight(l.weightKg, units)}`}>
                <div className="flex flex-col gap-2">
                  <Bar value={l.weightPct} label="Weight" />
                  <Bar value={l.areaPct} label="Deck space" />
                </div>
                <Flags flags={l.flags} />
                <ul className="mt-2 text-sm text-ink">
                  {l.lines.map((x) => {
                    const it = byKey.get(x.key);
                    return (
                      <li key={x.key}>
                        {x.qty} {it?.uom} — {it?.label} <span className="text-muted">({it?.ref})</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
          </div>
          {canMake && (
            <Card title="Put these loads on the schedule">
              <p className="mb-2 text-sm text-muted">Makes one planned load (draft BOL) per truckload. You can still change them before issuing.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SelectField label="Going to" placeholder="Choose" value={dropId} onChange={(e) => setDropId(e.target.value)} options={(locs.data ?? []).filter((l) => l.active && l.id !== locationId).map((l) => ({ value: l.id, label: l.businessName }))} />
                <TextField label="Pickup date" type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
                <TextField label="Delivery date" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                <SelectField label="Trucking company" placeholder="Our own / not set" value={carrierId} onChange={(e) => setCarrierId(e.target.value)} options={(carriers.data ?? []).map((c) => ({ value: c.id, label: c.businessName ?? c.name }))} />
              </div>
              <ErrorBanner error={make.error} />
              <Button className="mt-3" busy={make.busy} onClick={() => void make.run()}>
                Make {plan.loads.length} planned load{plan.loads.length === 1 ? '' : 's'}
              </Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
