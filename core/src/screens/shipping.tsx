'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { formatQty, parseQty } from '../domain/inventory';
import { formatLineNo } from '../domain/numbering';
import {
  BOL_STATUS_LABELS,
  DELETED_TYPE_LABELS,
  INVENTORY_STATUS_LABELS,
  type AvailableLot,
  type BolDetail,
  type BolInput,
  type BolStatus,
  type LocationInput,
  type LocationItem,
} from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  cx,
  EmailLink,
  EmptyState,
  ErrorBanner,
  List,
  ListRow,
  Notice,
  PageHeader,
  PageLoading,
  PhoneLink,
  SelectField,
  TextArea,
  TextField,
} from '../ui/components';
import { fieldError, useAction, useAsync, useDebounced } from '../ui/hooks';
import { useAuthed, useLive } from '../ui/session';
import { DropZone } from '../ui/drop-zone';
import { ScanButton } from '../ui/scan-button';
import { LoadCheckLine } from './loads';
import { applyRowOps, str, VoiceButton } from '../ui/voice';
import { ExportButtons } from '../ui/export';

const statusTone = (s: BolStatus) => (s === 'RECEIVED' ? 'ok' : s === 'CANCELLED' ? 'danger' : s === 'DRAFT' ? 'neutral' : 'brand');
const dateLabel = (iso: string) => new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
const locLine = (l: LocationItem) => [l.address, l.city, l.province].filter(Boolean).join(', ');
/** "Tue, Oct 14" (+ " 07:30") */
const dayLabel = (d: string | null, t?: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) + (t ? ` ${t}` : '') : null;
const datesLabel = (b: { scheduledDate: string | null; deliveryDate: string | null }) =>
  [b.scheduledDate && `Pickup ${dayLabel(b.scheduledDate)}`, b.deliveryDate && `Delivery ${dayLabel(b.deliveryDate)}`].filter(Boolean).join(' → ');

type Photo = { name: string; blob: Blob; url: string };
const toPhoto = (p: { name?: string; blob: Blob }): Photo => ({ name: p.name || 'photo.jpg', blob: p.blob, url: URL.createObjectURL(p.blob) });

/** Thumbnails with a remove button, shared by the receiving screens. */
function PhotoStrip({ photos, onRemove }: { photos: Photo[]; onRemove: (url: string) => void }) {
  if (!photos.length) return null;
  return (
    <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
      {photos.map((p, i) => (
        <li key={p.url} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-lg object-cover" />
          <button
            type="button"
            aria-label={`Remove photo ${i + 1}`}
            onClick={() => onRemove(p.url)}
            className="absolute top-1 right-1 h-10 w-10 rounded-full bg-black/60 font-bold text-white"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// BOL list
// ---------------------------------------------------------------------------
export function BolsScreen() {
  const { api, me } = useAuthed();
  const siteId = useSearchParams().get('siteId') ?? undefined;
  const [status, setStatus] = useState<'open' | 'draft' | 'done'>('open');
  const bols = useAsync(() => api.bols.list({ status, siteId }), [api, status, siteId]);
  useLive(() => void bols.reload());

  return (
    <div>
      <PageHeader
        title="Shipping"
        subtitle="Bills of lading: what's loaded, where it's going, and what arrived."
        actions={
          <>
            {can(me.user, 'bol:receive') && (
              <ButtonLink href={paths.bolReceive()} variant="secondary">
                Receive a BOL
              </ButtonLink>
            )}
            {can(me.user, 'bol:create') && <ButtonLink href={paths.bolNew()}>+ New BOL</ButtonLink>}
          </>
        }
      />
      <ScanButton />
      <div className="mb-4 flex gap-2" role="tablist">
        {(
          [
            ['open', 'On the way'],
            ['draft', 'Drafts'],
            ['done', 'Done'],
          ] as const
        ).map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={status === k} variant={status === k ? 'primary' : 'secondary'} onClick={() => setStatus(k)}>
            {label}
          </Button>
        ))}
      </div>
      <ErrorBanner error={bols.error} onRetry={bols.reload} />
      {(bols.data?.length ?? 0) > 0 && (
        <ExportButtons
          title="Bills of lading"
          subtitle={status === 'open' ? 'On the way' : status === 'draft' ? 'Drafts' : 'Done'}
          columns={[
            { key: 'bol', label: 'BOL' },
            { key: 'status', label: 'Status' },
            { key: 'route', label: 'Route', width: 3 },
            { key: 'pickup', label: 'Pickup' },
            { key: 'delivery', label: 'Delivery' },
            { key: 'items', label: 'Items', align: 'right', width: 0.6 },
            { key: 'company', label: 'Company', width: 1.4 },
          ]}
          rows={(bols.data ?? []).map((b) => ({ bol: b.label, status: BOL_STATUS_LABELS[b.status], route: b.route, pickup: b.scheduledDate, delivery: b.deliveryDate, items: b.lineCount, company: b.companyName }))}
        />
      )}
      {bols.loading && !bols.data ? (
        <PageLoading />
      ) : bols.data?.length ? (
        <List>
          {bols.data.map((b) => (
            <ListRow
              key={b.id}
              href={paths.bol(b.id)}
              title={
                <>
                  {b.label}
                  {b.direction === 'RETURN' && <span className="text-muted"> · Return</span>}
                </>
              }
              subtitle={[b.route, datesLabel(b), `${b.lineCount} item${b.lineCount === 1 ? '' : 's'}`, b.companyName].filter(Boolean).join(' · ')}
              right={<Badge tone={statusTone(b.status)}>{BOL_STATUS_LABELS[b.status]}</Badge>}
            />
          ))}
        </List>
      ) : (
        <EmptyState title={status === 'draft' ? 'No draft BOLs' : status === 'done' ? 'Nothing finished yet' : 'Nothing on the way'} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pick a location (or add one on the spot)
// ---------------------------------------------------------------------------
export function LocationPicker({
  label,
  value,
  onChange,
  locations,
  onAdded,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  locations: LocationItem[];
  onAdded: (l: LocationItem) => void;
}) {
  const { api } = useAuthed();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<LocationInput>({ businessName: '', address: '', city: '', province: '' });
  const add = useAction(async () => {
    const l = await api.locations.create(form, true);
    onAdded(l);
    onChange(l.id);
    setAdding(false);
    setForm({ businessName: '', address: '', city: '', province: '' });
  });
  const groups = (t: LocationItem['siteType']) => locations.filter((l) => l.siteType === t);
  const label2 = (l: LocationItem) => l.businessName + (l.city ? ` — ${l.city}` : '');
  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label={label}
        placeholder="Choose a location"
        value={value}
        onChange={(e) => (e.target.value === '__new' ? setAdding(true) : onChange(e.target.value))}
        options={[
          ...groups('YARD').map((l) => ({ value: l.id, label: `Yard: ${label2(l)}` })),
          ...groups('JOB').map((l) => ({ value: l.id, label: `Job: ${label2(l)}` })),
          ...groups(null).map((l) => ({ value: l.id, label: label2(l) })),
          { value: '__new', label: '+ Add a new location…' },
        ]}
      />
      {adding && (
        <div className="rounded-lg border border-line bg-surface-2 p-3">
          <ErrorBanner error={add.error} />
          <div className="grid gap-2 sm:grid-cols-2">
            <TextField label="Name" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} error={fieldError(add.error, 'businessName')} />
            <TextField label="Address" value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <TextField label="City" value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <TextField label="Province" value={form.province ?? ''} onChange={(e) => setForm({ ...form, province: e.target.value })} />
          </div>
          <div className="mt-2 flex gap-2">
            <Button type="button" busy={add.busy} onClick={() => void add.run()}>
              Add location
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build / edit a BOL
// ---------------------------------------------------------------------------
type StopDraft = { key: string; kind: 'PICKUP' | 'DROP'; locationId: string; plannedDate: string; plannedTime: string };
type Pick = { on: boolean; qty: string; dropKey: string };
let keySeq = 0;
const newKey = () => `s${Date.now().toString(36)}${keySeq++}`;
const newStop = (kind: StopDraft['kind'], date = '', time = ''): StopDraft => ({ key: newKey(), kind, locationId: '', plannedDate: date, plannedTime: time });

export function BolEditScreen() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const { api, me } = useAuthed();
  const [companyId, setCompanyId] = useState(params.get('companyId') ?? me.user.companyId ?? me.companies[0]?.id ?? '');
  const [stops, setStops] = useState<StopDraft[]>([newStop('PICKUP'), newStop('DROP')]);
  // One date/time for the whole trip (most loads), or a date per stop.
  const [sameDate, setSameDate] = useState(true);
  const [tripDate, setTripDate] = useState(params.get('date') ?? '');
  const [tripTime, setTripTime] = useState('');
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  /** Items typed in by hand (milk runs, extras not in inventory), each for a job and a drop stop */
  const [extras, setExtras] = useState<{ key: string; description: string; qty: string; uom: string; siteId: string; dropKey: string }[]>([]);
  const [addJob, setAddJob] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [truckUnit, setTruckUnit] = useState('');
  const [trailerId, setTrailerId] = useState('');
  const [notes, setNotes] = useState('');
  const [extraLocations, setExtraLocations] = useState<LocationItem[]>([]);
  const [allLots, setAllLots] = useState<Record<string, AvailableLot[]>>({});
  const [loaded, setLoaded] = useState(!id);
  const [loadError, setLoadError] = useState<unknown>(null);

  const locs = useAsync(() => api.locations.list(), [api]);
  const carriers = useAsync(() => api.contacts.list({ type: 'TRUCKING' }), [api]);
  const trailers = useAsync(() => api.trailers.list(), [api]);
  const locations = useMemo(() => [...(locs.data ?? []), ...extraLocations.filter((x) => !locs.data?.some((l) => l.id === x.id))], [locs.data, extraLocations]);
  const drops = stops.filter((s) => s.kind === 'DROP');

  // Editing a draft: load it into the form.
  useEffect(() => {
    if (!id) return;
    api.bols
      .get(id)
      .then((b) => {
        if (!b.canEdit) throw new Error('This BOL has been issued and can no longer be edited.');
        setCompanyId(b.companyId);
        setStops(b.stops.map((s) => ({ key: s.id, kind: s.kind, locationId: s.location.id, plannedDate: s.plannedDate ?? '', plannedTime: s.plannedTime ?? '' })));
        const same = b.stops.every((s) => s.plannedDate === b.stops[0]?.plannedDate && s.plannedTime === b.stops[0]?.plannedTime);
        setSameDate(same);
        setTripDate(same ? (b.stops[0]?.plannedDate ?? '') : '');
        setTripTime(same ? (b.stops[0]?.plannedTime ?? '') : '');
        setPicks(Object.fromEntries(b.lines.filter((l) => l.lotId).map((l) => [l.lotId!, { on: true, qty: String(l.qty), dropKey: l.dropStopId }])));
        setExtras(b.lines.filter((l) => l.manual).map((l) => ({ key: l.id, description: l.description, qty: String(l.qty), uom: l.uom, siteId: l.finalSiteId ?? '', dropKey: l.dropStopId })));
        setCarrierId(b.carrier?.id ?? '');
        setDriverName(b.driverName ?? '');
        setTruckUnit(b.truckUnit ?? '');
        setTrailerId(b.trailer?.id ?? '');
        setNotes(b.notes ?? '');
        setLoaded(true);
      })
      .catch(setLoadError);
  }, [api, id]);

  // What's sitting at each pickup location, for every company you work in (a BOL carries one company's material).
  const pickupLocs = [...new Set(stops.filter((s) => s.kind === 'PICKUP' && s.locationId).map((s) => s.locationId))];
  const pickupKey = pickupLocs.join(',');
  useEffect(() => {
    let live = true;
    Promise.all(pickupLocs.map(async (l) => [l, await api.bols.available(l)] as const))
      .then((r) => live && setAllLots(Object.fromEntries(r)))
      .catch(setLoadError);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, pickupKey]);
  const lots = useMemo(
    () => Object.fromEntries(Object.entries(allLots).map(([loc, list]) => [loc, list.filter((l) => l.companyId === companyId)])),
    [allLots, companyId],
  );
  /** Other companies with material waiting at these pickups: companyId → item count */
  const otherCompanies = useMemo(() => {
    const m = new Map<string, number>();
    for (const list of Object.values(allLots)) for (const l of list) if (l.companyId !== companyId) m.set(l.companyId, (m.get(l.companyId) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [allLots, companyId]);
  // Nothing picked yet and nothing here for this company? Switch to the company that has material here.
  useEffect(() => {
    const mine = Object.values(lots).reduce((a, l) => a + l.length, 0);
    if (!id && mine === 0 && otherCompanies.length && !Object.values(picks).some((p) => p.on)) setCompanyId(otherCompanies[0]![0]);
  }, [id, lots, otherCompanies, picks]);
  const companyName = (cid: string) => me.companies.find((c) => c.id === cid)?.name ?? 'another company';

  // Default drop: the stop at the lot's own job, otherwise the last drop.
  const defaultDrop = (lot: AvailableLot) => {
    const own = drops.find((d) => locations.find((l) => l.id === d.locationId)?.siteId === lot.finalSiteId);
    return (own ?? drops[drops.length - 1])?.key ?? '';
  };

  const buildInput = (): BolInput => {
    const lines: BolInput['lines'] = [];
    for (const s of stops.filter((x) => x.kind === 'PICKUP')) {
      for (const lot of lots[s.locationId] ?? []) {
        const p = picks[lot.lotId];
        if (!p?.on) continue;
        const qty = parseQty(p.qty);
        if (qty == null || qty <= 0) throw new Error(`Enter a quantity for ${lot.description}.`);
        if (lines.some((x) => x.lotId === lot.lotId)) continue;
        lines.push({ lotId: lot.lotId, qty, pickupKey: s.key, dropKey: p.dropKey || defaultDrop(lot) });
      }
    }
    const firstPickup = stops.find((x) => x.kind === 'PICKUP')?.key ?? '';
    for (const x of extras) {
      if (!x.description.trim()) continue;
      const qty = parseQty(x.qty);
      if (qty == null || qty <= 0) throw new Error(`Enter a quantity for ${x.description}.`);
      const jobDrop = drops.find((d) => locations.find((l) => l.id === d.locationId)?.siteId === x.siteId)?.key;
      lines.push({ manual: { description: x.description.trim(), uom: x.uom.trim() || 'EA', siteId: x.siteId || null }, qty, pickupKey: firstPickup, dropKey: x.dropKey || jobDrop || drops[drops.length - 1]?.key || '' });
    }
    if (stops.some((s) => !s.locationId)) throw new Error('Choose a location for every stop.');
    return {
      companyId,
      carrierContactId: carrierId || null,
      driverName: driverName.trim() || null,
      truckUnit: truckUnit.trim() || null,
      trailerId: trailerId || null,
      notes: notes.trim() || null,
      stops: stops.map((s) => ({
        key: s.key,
        kind: s.kind,
        locationId: s.locationId,
        plannedDate: (sameDate ? tripDate : s.plannedDate) || null,
        plannedTime: (sameDate ? tripTime : s.plannedTime) || null,
      })),
      lines,
    };
  };

  const save = useAction(async (issue: boolean) => {
    const input = buildInput();
    const b = id ? await api.bols.update(id, input) : await api.bols.create(input);
    if (issue) await api.bols.issue(b.id);
    router.replace(paths.bol(b.id));
  });

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!loaded || (locs.loading && !locs.data)) return <PageLoading />;

  const setStop = (key: string, patch: Partial<StopDraft>) => setStops((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const moveStop = (i: number, d: -1 | 1) =>
    setStops((all) => {
      const next = [...all];
      const [s] = next.splice(i, 1);
      next.splice(i + d, 0, s!);
      return next;
    });
  const pick = (lot: AvailableLot, patch: Partial<Pick>) =>
    setPicks((p) => ({ ...p, [lot.lotId]: { on: false, qty: String(lot.qtyAvailable), dropKey: defaultDrop(lot), ...p[lot.lotId], ...patch } }));
  const stopName = (s: StopDraft) => locations.find((l) => l.id === s.locationId)?.businessName ?? 'Not chosen yet';
  const loadAll = (here: AvailableLot[], on: boolean) =>
    setPicks((p) => {
      const next = { ...p };
      for (const lot of here) next[lot.lotId] = { qty: String(lot.qtyAvailable), dropKey: defaultDrop(lot), ...p[lot.lotId], on };
      return next;
    });
  const dropAllAt = (here: AvailableLot[], dropKey: string) =>
    setPicks((p) => {
      const next = { ...p };
      for (const lot of here) if (p[lot.lotId]?.on) next[lot.lotId] = { ...p[lot.lotId]!, dropKey };
      return next;
    });
  const toggleSameDate = (v: boolean) => {
    if (!v) setStops((all) => all.map((s) => ({ ...s, plannedDate: s.plannedDate || tripDate, plannedTime: s.plannedTime || tripTime })));
    else {
      setTripDate((d) => d || stops.find((s) => s.plannedDate)?.plannedDate || '');
      setTripTime((t) => t || stops.find((s) => s.plannedTime)?.plannedTime || '');
    }
    setSameDate(v);
  };
  const picked = Object.values(picks).filter((p) => p.on).length + extras.filter((x) => x.description.trim()).length;

  return (
    <div className="flex flex-col gap-4 pb-28">
      <PageHeader back={id ? paths.bol(id) : paths.bols()} title={id ? 'Edit draft BOL' : 'New BOL'} />
      <div className="flex justify-end">
        <VoiceButton
          target={{
            screen: 'bol',
            companyId,
            schema: {
              title: 'Building a bill of lading: which items to load, the truck and the date',
              fields: [
                { key: 'driverName', label: 'Driver', type: 'text' },
                { key: 'truckUnit', label: 'Truck / unit #', type: 'text' },
                { key: 'date', label: 'Date (all stops)', type: 'date' },
                { key: 'time', label: 'Time (HH:MM)', type: 'text' },
                { key: 'carrierId', label: 'Trucking company', type: 'choice', options: (carriers.data ?? []).map((c) => ({ value: c.id, label: c.businessName ?? c.name })) },
                { key: 'notes', label: 'Notes for the driver', type: 'text' },
              ],
              rows: { label: 'items waiting at the pickups', canAdd: false, canRemove: false, fields: [{ key: 'load', label: 'Load it', type: 'boolean' }, { key: 'qty', label: 'How many', type: 'number' }] },
            },
            current: () => ({
              values: { driverName, truckUnit, date: tripDate, time: tripTime, carrierId, notes },
              rows: Object.values(lots).flat().map((l) => ({ description: l.description, waiting: `${l.qtyAvailable} ${l.uom}`, forJob: l.finalSiteLabel, load: !!picks[l.lotId]?.on, qty: picks[l.lotId]?.qty ?? '' })),
            }),
            apply: (r) => {
              const all = Object.values(lots).flat();
              if (r.set.driverName !== undefined) setDriverName(str(r.set.driverName));
              if (r.set.truckUnit !== undefined) setTruckUnit(str(r.set.truckUnit));
              if (r.set.date !== undefined) {
                setSameDate(true);
                setTripDate(str(r.set.date));
              }
              if (r.set.time !== undefined) setTripTime(str(r.set.time));
              if (r.set.carrierId !== undefined) setCarrierId(str(r.set.carrierId));
              if (r.set.notes !== undefined) setNotes(str(r.set.notes));
              for (const op of r.rowOps) {
                const lot = op.index != null ? all[op.index] : undefined;
                if (op.op !== 'update' || !lot || !op.values) continue;
                pick(lot, { on: op.values.load != null ? !!op.values.load : true, ...(op.values.qty != null ? { qty: str(op.values.qty) } : {}) });
              }
            },
            snapshot: () => ({ picks, driverName, truckUnit, tripDate, tripTime, carrierId, notes }),
            restore: (s) => {
              setPicks(s.picks);
              setDriverName(s.driverName);
              setTruckUnit(s.truckUnit);
              setTripDate(s.tripDate);
              setTripTime(s.tripTime);
              setCarrierId(s.carrierId);
              setNotes(s.notes);
            },
          }}
        />
      </div>
      <ErrorBanner error={locs.error} />
      {me.companies.length > 1 && (
        <Card>
          <SelectField
            label="Company"
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setPicks({});
            }}
            options={me.companies.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Card>
      )}

      <Card title="Stops" actions={<span className="text-sm text-muted">In driving order</span>}>
        <div className="mb-3 rounded-lg bg-surface-2 p-3">
          <Checkbox
            label="Same date for every stop"
            description="Untick to set a different pickup / delivery date for each stop."
            checked={sameDate}
            onChange={toggleSameDate}
          />
          {sameDate && (
            <div className="mt-2 grid grid-cols-2 gap-2 pl-9">
              <TextField label="Date" type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} />
              <TextField label="Time (optional)" type="time" value={tripTime} onChange={(e) => setTripTime(e.target.value)} />
            </div>
          )}
        </div>
        <ol className="flex flex-col gap-3">
          {stops.map((s, i) => (
            <li key={s.key} className="rounded-lg border border-line p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-ink">
                  Stop {i + 1}: {s.kind === 'PICKUP' ? 'Pick up' : 'Drop off'}
                </span>
                <span className="flex gap-1">
                  <Button type="button" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => moveStop(i, -1)}>
                    ↑
                  </Button>
                  <Button type="button" variant="ghost" aria-label="Move down" disabled={i === stops.length - 1} onClick={() => moveStop(i, 1)}>
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Remove stop"
                    disabled={stops.filter((x) => x.kind === s.kind).length < 2}
                    onClick={() => setStops((all) => all.filter((x) => x.key !== s.key))}
                  >
                    ✕
                  </Button>
                </span>
              </div>
              <LocationPicker
                label="Location"
                value={s.locationId}
                onChange={(v) => setStop(s.key, { locationId: v })}
                locations={locations}
                onAdded={(l) => setExtraLocations((x) => [...x, l])}
              />
              {!sameDate && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <TextField
                    label={s.kind === 'PICKUP' ? 'Pickup date' : 'Delivery date'}
                    type="date"
                    value={s.plannedDate}
                    onChange={(e) => setStop(s.key, { plannedDate: e.target.value })}
                  />
                  <TextField label="Time (optional)" type="time" value={s.plannedTime} onChange={(e) => setStop(s.key, { plannedTime: e.target.value })} />
                </div>
              )}
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setStops((all) => [...all, newStop('PICKUP', all.at(-1)?.plannedDate, all.at(-1)?.plannedTime)])}>
            + Pickup stop
          </Button>
          <Button type="button" variant="secondary" onClick={() => setStops((all) => [...all, newStop('DROP', all.at(-1)?.plannedDate, all.at(-1)?.plannedTime)])}>
            + Drop-off stop
          </Button>
        </div>
      </Card>

      <FromPoCard
        companyId={companyId}
        onAdd={async (add) => {
          // Make sure each pickup location is a stop, the job is a drop, then tick the items.
          const missing = add.locations.filter((l) => !locations.some((x) => x.id === l));
          if (missing.length) {
            const got = await Promise.all(missing.map((l) => api.locations.get(l)));
            setExtraLocations((x) => [...x, ...got]);
          }
          const jobLoc = add.siteId ? (locations.find((l) => l.siteId === add.siteId)?.id ?? null) : null;
          setStops((all) => {
            let next = [...all];
            for (const locId of add.locations) {
              if (next.some((x) => x.kind === 'PICKUP' && x.locationId === locId)) continue;
              const empty = next.find((x) => x.kind === 'PICKUP' && !x.locationId);
              if (empty) next = next.map((x) => (x.key === empty.key ? { ...x, locationId: locId } : x));
              else next = [newStop('PICKUP', tripDate, tripTime) as StopDraft, ...next].map((x, i) => (i === 0 ? { ...x, locationId: locId } : x));
            }
            if (jobLoc && !next.some((x) => x.kind === 'DROP' && x.locationId === jobLoc)) {
              const emptyDrop = next.find((x) => x.kind === 'DROP' && !x.locationId);
              if (emptyDrop) next = next.map((x) => (x.key === emptyDrop.key ? { ...x, locationId: jobLoc } : x));
              else next = [...next, { ...newStop('DROP', tripDate, tripTime), locationId: jobLoc }];
            }
            return next;
          });
          setPicks((p) => ({ ...p, ...Object.fromEntries(add.lots.map((l) => [l.lotId, { on: true, qty: String(l.qty), dropKey: '' }])) }));
        }}
      />

      {stops
        .filter((s) => s.kind === 'PICKUP' && s.locationId)
        .map((s) => {
          const here = lots[s.locationId];
          return (
            <Card
              key={s.key}
              title={`Load at ${stopName(s)}`}
              actions={
                here &&
                here.length > 0 &&
                (here.every((l) => picks[l.lotId]?.on) ? (
                  <Button type="button" variant="secondary" onClick={() => loadAll(here, false)}>
                    Clear all
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => loadAll(here, true)}>
                    Load all ({here.length})
                  </Button>
                ))
              }
            >
              {here && drops.length > 1 && here.some((l) => picks[l.lotId]?.on) && (
                <div className="mb-3 rounded-lg bg-surface-2 p-3">
                  <SelectField
                    label="Drop everything ticked here at"
                    placeholder="Choose a stop (or set each item below)"
                    value=""
                    onChange={(e) => e.target.value && dropAllAt(here, e.target.value)}
                    options={drops.map((d) => ({ value: d.key, label: `Stop ${stops.indexOf(d) + 1}: ${stopName(d)}` }))}
                  />
                </div>
              )}
              {!here ? (
                <PageLoading />
              ) : here.length === 0 ? (
                <div>
                  <p className="text-muted">Nothing for {companyName(companyId)} is waiting here.</p>
                  {otherCompanies.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {otherCompanies.map(([cid, count]) => (
                        <Button
                          key={cid}
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setCompanyId(cid);
                            setPicks({});
                          }}
                        >
                          Switch to {companyName(cid)} ({count} item{count === 1 ? '' : 's'})
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {here.map((lot) => {
                    const p = picks[lot.lotId];
                    return (
                      <li key={lot.lotId} className="py-3">
                        <Checkbox
                          label={`${lot.description} — ${formatQty(lot.qtyAvailable)} ${lot.uom}`}
                          description={[lot.orderLabel ? `${lot.orderLabel} ${formatLineNo(lot.lineNo ?? 0)}` : null, lot.finalSiteLabel ? `for ${lot.finalSiteLabel}` : lot.equipmentLabel ? `stock for ${lot.equipmentLabel}` : null, lot.poNumber && `PO ${lot.poNumber}`, INVENTORY_STATUS_LABELS[lot.status]]
                            .filter(Boolean)
                            .join(' · ')}
                          checked={!!p?.on}
                          onChange={(v) => pick(lot, { on: v })}
                        />
                        {p?.on && (
                          <div className="mt-2 grid gap-2 pl-9 sm:grid-cols-2">
                            <TextField label={`Qty (${lot.uom})`} inputMode="decimal" value={p.qty} onChange={(e) => pick(lot, { qty: e.target.value })} />
                            {drops.length > 1 && (
                              <SelectField
                                label="Drop at"
                                value={p.dropKey}
                                onChange={(e) => pick(lot, { dropKey: e.target.value })}
                                options={drops.map((d) => ({ value: d.key, label: `Stop ${stops.indexOf(d) + 1}: ${stopName(d)}` }))}
                              />
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}

      <Card title="Milk run: jobs on this load">
        <p className="text-sm text-muted">Add each job the truck drops at. Its material shows under the pickups above (and “Add from a purchase order”); anything not in inventory can be typed in below. The BOL prints a section for each job.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <SelectField
            label="Add a job"
            placeholder="Choose a job"
            value={addJob}
            onChange={(e) => setAddJob(e.target.value)}
            options={locations.filter((l) => l.siteType === 'JOB' && !drops.some((d) => d.locationId === l.id)).map((l) => ({ value: l.id, label: l.businessName }))}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!addJob}
            onClick={() => {
              setStops((all) => {
                const empty = all.find((x) => x.kind === 'DROP' && !x.locationId);
                return empty ? all.map((x) => (x.key === empty.key ? { ...x, locationId: addJob } : x)) : [...all, { ...newStop('DROP', tripDate, tripTime), locationId: addJob }];
              });
              setAddJob('');
            }}
          >
            Add drop-off
          </Button>
        </div>
        <p className="mt-4 font-semibold text-ink">Typed-in items (not from inventory)</p>
        {extras.map((x, i) => (
          <div key={x.key} className="mt-2 grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[2fr_6rem_5rem_1fr_auto] sm:items-end">
            <TextField label="Item" value={x.description} onChange={(e) => setExtras((all) => all.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
            <TextField label="Qty" inputMode="decimal" value={x.qty} onChange={(e) => setExtras((all) => all.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
            <TextField label="Unit" value={x.uom} onChange={(e) => setExtras((all) => all.map((y, j) => (j === i ? { ...y, uom: e.target.value } : y)))} />
            <SelectField
              label="For job"
              placeholder="Choose"
              value={x.siteId}
              onChange={(e) => setExtras((all) => all.map((y, j) => (j === i ? { ...y, siteId: e.target.value, dropKey: '' } : y)))}
              options={drops.map((d) => locations.find((l) => l.id === d.locationId)).filter((l): l is LocationItem => !!l?.siteId).map((l) => ({ value: l.siteId!, label: l.businessName }))}
            />
            <Button type="button" variant="ghost" aria-label="Remove item" onClick={() => setExtras((all) => all.filter((_, j) => j !== i))}>
              ✕
            </Button>
          </div>
        ))}
        <Button type="button" variant="secondary" className="mt-2" onClick={() => setExtras((all) => [...all, { key: newKey(), description: '', qty: '', uom: 'EA', siteId: '', dropKey: '' }])}>
          + Type in an item
        </Button>
      </Card>

      <Card title="Truck">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Trucking company"
            placeholder="Our own truck / not set"
            value={carrierId}
            onChange={(e) => setCarrierId(e.target.value)}
            options={(carriers.data ?? []).map((c) => ({ value: c.id, label: c.businessName ? `${c.businessName} — ${c.name}` : c.name }))}
          />
          <TextField label="Driver" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
          <TextField label="Truck / unit #" value={truckUnit} onChange={(e) => setTruckUnit(e.target.value)} />
          <SelectField
            label="Trailer"
            placeholder="Not set"
            hint="Checks the weight and size of what’s on it once saved."
            value={trailerId}
            onChange={(e) => setTrailerId(e.target.value)}
            options={(trailers.data ?? []).map((t) => ({ value: t.id, label: `${t.name}${t.unitNumber ? ` #${t.unitNumber}` : ''}` }))}
          />
          <div className="sm:col-span-2">
            <TextArea label="Notes for the driver (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </Card>

      <div className="safe-bottom fixed inset-x-0 bottom-16 z-10 border-t border-line bg-surface p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <ErrorBanner error={save.error} />
        <div className="flex flex-wrap items-center gap-2">
          <Button busy={save.busy} disabled={!picked} onClick={() => void save.run(true)}>
            Issue BOL
          </Button>
          <Button variant="secondary" busy={save.busy} onClick={() => void save.run(false)}>
            {picked ? 'Save draft' : 'Save as planned load'}
          </Button>
          <span className="text-sm text-muted">
            {picked ? `${picked} item${picked === 1 ? '' : 's'} loaded` : 'No items yet: save it as a planned load to book the truck, add items later.'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One BOL
// ---------------------------------------------------------------------------
export function BolScreen() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const platform = usePlatform();
  const { api } = useAuthed();
  const bol = useAsync(() => api.bols.get(id), [api, id]);
  useLive(() => void bol.reload());
  const [confirmCancel, setConfirmCancel] = useState(false);

  const fileName = (b: BolDetail) => `${b.label.replace(/[#\s]+/g, '-')}.pdf`;
  const savePdf = useAction(async (b: BolDetail) => platform.files.saveFile(fileName(b), await api.bols.pdf(b.id)));
  const printPdf = useAction(async (b: BolDetail) => platform.print.printPdf(await api.bols.pdf(b.id), b.label));
  const issue = useAction(async (ship: boolean) => {
    await api.bols.issue(id, ship);
    await bol.reload();
  });
  const ship = useAction(async () => {
    await api.bols.ship(id);
    await bol.reload();
  });
  const cancel = useAction(async () => {
    await api.bols.cancel(id);
    setConfirmCancel(false);
    await bol.reload();
  });
  const remove = useAction(async () => {
    await api.bols.remove(id);
    router.replace(paths.bols());
  });

  if (bol.error) return <ErrorBanner error={bol.error} onRetry={bol.reload} />;
  const b = bol.data;
  if (!b) return <PageLoading />;
  const actionError = savePdf.error || printPdf.error || issue.error || ship.error || cancel.error || remove.error;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={paths.bols()}
        title={
          <>
            {b.label} {b.direction === 'RETURN' && <span className="text-muted">(return)</span>}
          </>
        }
        subtitle={[b.companyName, b.route, datesLabel(b)].filter(Boolean).join(' · ')}
        actions={
          <>
            {b.shippedAt && <Badge tone="ok">Shipped {new Date(b.shippedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</Badge>}
            <Badge tone={statusTone(b.status)}>{BOL_STATUS_LABELS[b.status]}</Badge>
          </>
        }
      />
      <ErrorBanner error={actionError} />

      <div className="flex flex-wrap gap-2">
        {b.status !== 'DRAFT' && (
          <>
            <Button variant="secondary" busy={savePdf.busy} onClick={() => void savePdf.run(b)}>
              Save PDF
            </Button>
            <Button variant="secondary" busy={printPdf.busy} onClick={() => void printPdf.run(b)}>
              Print
            </Button>
          </>
        )}
        {b.canEdit && (
          <ButtonLink href={paths.bolEdit(b.id)} variant="secondary">
            Edit
          </ButtonLink>
        )}
        {b.canIssue && (
          <>
            <Button busy={issue.busy} onClick={() => void issue.run(true)}>
              Issue & mark shipped
            </Button>
            <Button variant="secondary" busy={issue.busy} onClick={() => void issue.run(false)}>
              Issue only (not left yet)
            </Button>
          </>
        )}
        {b.canShip && (
          <Button busy={ship.busy} onClick={() => void ship.run()}>
            🚚 Mark shipped – truck has left
          </Button>
        )}
        {b.canEdit && b.status === 'DRAFT' && (
          <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run()}>
            Delete draft
          </Button>
        )}
        {b.canCancel &&
          (confirmCancel ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-danger">Cancel this BOL and put the stock back?</span>
              <Button variant="danger" busy={cancel.busy} onClick={() => void cancel.run()}>
                Yes, cancel it
              </Button>
              <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
                No
              </Button>
            </span>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
              Cancel BOL
            </Button>
          ))}
      </div>

      <Card title="Truck">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">Trucking company</dt>
            <dd className="text-ink">
              {b.carrier ? (
                <>
                  {b.carrier.businessName ?? b.carrier.name}
                  {b.carrier.businessName && <span className="text-muted"> — {b.carrier.name}</span>}
                  <span className="mt-1 flex flex-wrap gap-x-4">
                    <PhoneLink number={b.carrier.cell ?? b.carrier.phone} />
                    <EmailLink email={b.carrier.email} />
                  </span>
                </>
              ) : (
                'Not set'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Driver / truck</dt>
            <dd className="text-ink">{[b.driverName, b.truckUnit && `Unit ${b.truckUnit}`].filter(Boolean).join(' · ') || '—'}</dd>
          </div>
          {b.trailer && (
            <div>
              <dt className="text-sm text-muted">Trailer</dt>
              <dd className="text-ink">
                {b.trailer.name}
                {b.loadCheck && <LoadCheckLine check={b.loadCheck} payloadKg={b.trailer.maxPayloadKg} />}
              </dd>
            </div>
          )}
          {b.issuedAt && (
            <div>
              <dt className="text-sm text-muted">Issued</dt>
              <dd className="text-ink">{dateLabel(b.issuedAt)}</dd>
            </div>
          )}
        </dl>
        {b.notes && <p className="mt-3 whitespace-pre-wrap text-ink">{b.notes}</p>}
      </Card>

      {b.stops.map((s) => {
        const lines = b.lines.filter((l) => (s.kind === 'PICKUP' ? l.pickupStopId : l.dropStopId) === s.id);
        return (
          <Card
            key={s.id}
            title={`${s.seq}. ${s.kind === 'PICKUP' ? 'Pick up at' : 'Drop at'} ${s.location.businessName}`}
            actions={
              <>
                {s.completedAt && <Badge tone="ok">Done</Badge>}
                {s.canReceive && <ButtonLink href={paths.bolReceive(b.id, s.id)}>Receive here</ButtonLink>}
              </>
            }
          >
            {s.plannedDate && (
              <p className="font-semibold text-ink">
                {s.kind === 'PICKUP' ? 'Pickup' : 'Delivery'}: {dayLabel(s.plannedDate, s.plannedTime)}
              </p>
            )}
            {locLine(s.location) && <p className="text-muted">{locLine(s.location)}</p>}
            {(s.location.phone || s.location.cell) && (
              <p className="flex flex-wrap gap-x-4">
                <PhoneLink number={s.location.phone} />
                <PhoneLink number={s.location.cell} />
              </p>
            )}
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{l.description}</span>
                    <span className="block text-sm text-muted">
                      {l.orderLabel ? `${l.orderLabel} ${formatLineNo(l.orderLineNo ?? 0)}` : 'Added item'}{l.finalSiteLabel && ` · for ${l.finalSiteLabel}`}
                      {l.poNumber && ` · PO ${l.poNumber}`}
                    </span>
                  </span>
                  <span className="text-ink">
                    <strong>
                      {formatQty(l.qty)} {l.uom}
                    </strong>
                    {s.kind === 'DROP' && l.received > 0 && <span className="text-sm text-muted"> ({formatQty(l.received)} in)</span>}
                  </span>
                </li>
              ))}
            </ul>
            {s.receipts.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {s.receipts.map((r) => (
                  <li key={r.id}>
                    <Link href={paths.bolReceipt(r.id)} className="font-semibold text-brand-ink">
                      Received {dateLabel(r.receivedAt)} by {r.receivedByName}
                      {r.photoCount > 0 && ` · ${r.photoCount} photo${r.photoCount === 1 ? '' : 's'}`}
                      {r.problems > 0 && ` · ${r.problems} problem${r.problems === 1 ? '' : 's'}`} ›
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Receive a BOL: snap a photo of the paperwork (or type the number)
// ---------------------------------------------------------------------------
type LineState = { got: boolean; qty: string; damaged: boolean; note: string };

export function ReceiveBolScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const platform = usePlatform();
  const { api } = useAuthed();
  const [bolId, setBolId] = useState(params.get('id') ?? '');
  const [stopId, setStopId] = useState(params.get('stopId') ?? '');
  const [bol, setBol] = useState<BolDetail | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState<Record<string, LineState>>({});
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [scanNote, setScanNote] = useState('');
  const [progress, setProgress] = useState('');
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  const load = useAction(async (id: string) => {
    const b = await api.bols.get(id);
    setBol(b);
    setBolId(b.id);
    const open = b.stops.filter((s) => s.canReceive);
    const chosen = open.find((s) => s.id === stopId) ?? (open.length === 1 ? open[0] : undefined);
    setStopId(chosen?.id ?? '');
  });
  useEffect(() => {
    if (bolId) void load.run(bolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fill in the line checklist when the stop changes.
  useEffect(() => {
    if (!bol || !stopId) return;
    const s: Record<string, LineState> = {};
    for (const l of bol.lines.filter((x) => x.dropStopId === stopId)) {
      const left = Math.max(0, l.qty - l.received);
      s[l.id] = { got: left > 0, qty: String(left), damaged: false, note: '' };
    }
    setState(s);
  }, [bol, stopId]);

  // Photo of the BOL → find it (QR code first, then the printed BOL number). The photo is kept with the receipt.
  const scan = useAction(async () => {
    setScanNote('');
    const p = await platform.camera.takePhoto();
    if (!p) return;
    const photo = toPhoto(p);
    setPhotos((prev) => [...prev, photo]);
    const r = await api.bols.scan(photo.blob, photo.name);
    if (r.match?.bolId) await load.run(r.match.bolId);
    else setScanNote(r.textSample ? `Couldn't find a BOL number in that photo. It read: “${r.textSample.slice(0, 120)}…” Type the number below instead.` : 'Couldn’t read that photo. Try again closer, with good light, or type the BOL number below.');
  });
  const find = useAction(async () => {
    const r = await api.bols.lookup(q.trim());
    await load.run(r.id);
  });
  const addPhotos = useAction(async (camera: boolean) => {
    const picked = camera ? [await platform.camera.takePhoto()].filter((x) => x != null) : await platform.camera.pickImages({ multiple: true });
    setPhotos((prev) => [...prev, ...picked.map((x) => toPhoto(x!))]);
  });

  const save = useAction(async () => {
    if (!bol || !stopId) return;
    const lines = bol.lines
      .filter((l) => l.dropStopId === stopId && state[l.id])
      .map((l) => {
        const s = state[l.id]!;
        const qty = s.got ? (s.qty.trim() === '0' ? 0 : parseQty(s.qty)) : 0;
        if (qty == null) throw new Error(`Enter the quantity received for ${l.description}.`);
        return { bolLineId: l.id, qtyReceived: qty, damaged: s.damaged, note: s.damaged || !s.got ? s.note.trim() || null : null };
      });
    setProgress('Saving…');
    const r = await api.bols.receive(bol.id, { stopId, notes: notes.trim() || null, lines });
    for (let i = 0; i < photos.length; i++) {
      setProgress(`Uploading photo ${i + 1} of ${photos.length}…`);
      await api.bols.addReceiptPhoto(r.receiptId, photos[i]!.blob, photos[i]!.name);
    }
    setProgress('');
    router.replace(`${paths.bolReceipt(r.receiptId)}&saved=1`);
  });

  const upd = (id: string, patch: Partial<LineState>) => setState((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }));
  const openStops = bol?.stops.filter((s) => s.canReceive) ?? [];
  const lines = bol?.lines.filter((l) => l.dropStopId === stopId) ?? [];

  return (
    <div className="flex flex-col gap-4 pb-24">
      <PageHeader back={bol ? paths.bol(bol.id) : paths.bols()} title="Receive a BOL" />
      {bol && stopId && (
        <div className="flex justify-end">
          <VoiceButton
            target={{
              screen: 'bolReceive',
              companyId: bol.companyId,
              schema: {
                title: `Receiving ${bol.label}: what arrived on each line`,
                fields: [{ key: 'notes', label: 'Notes', type: 'text' }],
                rows: {
                  label: 'BOL lines',
                  canAdd: false,
                  canRemove: false,
                  fields: [
                    { key: 'received', label: 'Arrived', type: 'boolean' },
                    { key: 'qty', label: 'Quantity received', type: 'number' },
                    { key: 'damaged', label: 'Damaged', type: 'boolean' },
                    { key: 'note', label: 'Note', type: 'text' },
                  ],
                },
              },
              current: () => ({
                values: { notes },
                rows: bol.lines.filter((l) => l.dropStopId === stopId).map((l) => ({ description: l.description, onTruck: `${Math.max(0, l.qty - l.received)} ${l.uom}`, received: state[l.id]?.got ?? false, qty: state[l.id]?.qty ?? '', damaged: state[l.id]?.damaged ?? false, note: state[l.id]?.note ?? '' })),
              }),
              apply: (r) => {
                const here = bol.lines.filter((l) => l.dropStopId === stopId);
                if (r.set.notes !== undefined) setNotes(str(r.set.notes));
                setState((prev) => {
                  const next = { ...prev };
                  for (const op of r.rowOps) {
                    const l = op.index != null ? here[op.index] : undefined;
                    if (op.op !== 'update' || !l || !op.values || !next[l.id]) continue;
                    const v = op.values;
                    next[l.id] = {
                      ...next[l.id]!,
                      ...(v.received != null ? { got: !!v.received } : {}),
                      ...(v.qty != null ? { qty: str(v.qty), got: true } : {}),
                      ...(v.damaged != null ? { damaged: !!v.damaged } : {}),
                      ...(v.note != null ? { note: str(v.note) } : {}),
                    };
                  }
                  return next;
                });
              },
              snapshot: () => ({ state, notes }),
              restore: (s) => {
                setState(s.state);
                setNotes(s.notes);
              },
            }}
          />
        </div>
      )}

      {!bol && (
        <>
          <Card>
            <p className="mb-3 text-ink">Take a photo of the driver's BOL. We'll read the QR code or BOL number and open it for you.</p>
            <Button className="min-h-16 w-full text-lg" busy={scan.busy || load.busy} onClick={() => void scan.run()}>
              📷 Scan BOL
            </Button>
            <ErrorBanner error={scan.error} />
            {scanNote && <Notice>{scanNote}</Notice>}
          </Card>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void find.run();
            }}
          >
            <div className="flex-1">
              <TextField label="Or type the BOL number" inputMode="numeric" placeholder="e.g. 12" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Button type="submit" variant="secondary" busy={find.busy} disabled={!q.trim()}>
              Find
            </Button>
          </form>
          <ErrorBanner error={find.error || load.error} />
        </>
      )}

      {bol && (
        <>
          <Card title={bol.label} actions={<Badge tone={statusTone(bol.status)}>{BOL_STATUS_LABELS[bol.status]}</Badge>}>
            <p className="text-muted">
              {bol.companyName} · {bol.route}
            </p>
            {openStops.length === 0 && <Notice>There's nothing left to receive on this BOL{bol.status === 'DRAFT' ? ' — it hasn’t been issued yet' : ''}.</Notice>}
            {openStops.length > 1 && (
              <SelectField
                label="Where are you?"
                placeholder="Choose the drop-off"
                value={stopId}
                onChange={(e) => setStopId(e.target.value)}
                options={openStops.map((s) => ({ value: s.id, label: [`Stop ${s.seq}: ${s.location.businessName}`, dayLabel(s.plannedDate, s.plannedTime)].filter(Boolean).join(' · ') }))}
              />
            )}
            {!scan.busy && (
              <Button
                variant="ghost"
                className="mt-2"
                onClick={() => {
                  setBol(null);
                  setBolId('');
                  setStopId('');
                }}
              >
                Wrong BOL? Scan another
              </Button>
            )}
          </Card>

          {stopId &&
            lines.map((l) => {
              const s = state[l.id];
              if (!s) return null;
              const left = Math.max(0, l.qty - l.received);
              const qty = parseQty(s.qty) ?? 0;
              const short = (s.got ? qty : 0) < left - 1e-6;
              return (
                <Card key={l.id} className={cx((s.damaged || short) && 'border-danger')}>
                  <p className="text-sm font-semibold text-muted">
                    {l.orderLabel ? `${l.orderLabel} ${formatLineNo(l.orderLineNo ?? 0)}` : 'Added item'}{l.finalSiteLabel && ` · for ${l.finalSiteLabel}`}
                  </p>
                  <p className="text-lg font-semibold text-ink">{l.description}</p>
                  <p className="mb-2 text-ink">
                    On the truck: <strong>{formatQty(left)} {l.uom}</strong>
                  </p>
                  <Checkbox label="Received" checked={s.got} onChange={(v) => upd(l.id, { got: v })} />
                  {s.got && (
                    <TextField
                      label={`Quantity received (${l.uom})`}
                      inputMode="decimal"
                      value={s.qty}
                      onChange={(e) => upd(l.id, { qty: e.target.value })}
                      hint={short ? `Short by ${formatQty(left - qty)} — the yard and procurement will be told.` : undefined}
                    />
                  )}
                  <Checkbox label="Damaged" checked={s.damaged} onChange={(v) => upd(l.id, { damaged: v })} />
                  {(s.damaged || short) && <TextField label="Note (what's wrong?)" value={s.note} onChange={(e) => upd(l.id, { note: e.target.value })} />}
                </Card>
              );
            })}

          {stopId && lines.length > 0 && (
            <>
              <Card title="Photos">
                <p className="mb-3 text-muted">The BOL photo you scanned is attached. Add photos of the load or any damage.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" busy={addPhotos.busy} onClick={() => void addPhotos.run(true)}>
                    Take photo
                  </Button>
                  <Button variant="secondary" onClick={() => void addPhotos.run(false)}>
                    Add from gallery
                  </Button>
                </div>
                <ErrorBanner error={addPhotos.error} />
                <PhotoStrip photos={photos} onRemove={(url) => setPhotos((prev) => prev.filter((x) => x.url !== url))} />
              </Card>
              <Card>
                <TextArea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Card>
              <div className="safe-bottom fixed inset-x-0 bottom-16 z-10 border-t border-line bg-surface p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
                <ErrorBanner error={save.error} />
                {progress && <p className="mb-2 text-muted" aria-live="polite">{progress}</p>}
                <Button className="w-full lg:w-auto" busy={save.busy} onClick={() => void save.run()}>
                  Save delivery
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A saved site receipt
// ---------------------------------------------------------------------------
export function BolReceiptScreen() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const platform = usePlatform();
  const { api } = useAuthed();
  const r = useAsync(() => api.bols.receipt(id), [api, id]);
  const addPhoto = useAction(async () => {
    const p = await platform.camera.takePhoto();
    if (!p) return;
    await api.bols.addReceiptPhoto(id, p.blob, p.name || 'photo.jpg');
    await r.reload();
  });

  if (r.error) return <ErrorBanner error={r.error} onRetry={r.reload} />;
  const d = r.data;
  if (!d) return <PageLoading />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.bol(d.bolId)} title={`${d.bolLabel} received`} subtitle={`${d.locationName} · ${dateLabel(d.receivedAt)} · ${d.receivedByName}`} />
      {params.get('saved') && <Notice>Saved. Anything short or damaged has been emailed to the yard and procurement.</Notice>}
      <Card title="Items">
        <ul className="flex flex-col divide-y divide-line">
          {d.lines.map((l, i) => (
            <li key={i} className="py-2">
              <span className="block font-semibold text-ink">{l.description}</span>
              <span className="block text-sm text-muted">
                {l.orderLabel} {formatLineNo(l.lineNo)}
              </span>
              <span className="text-ink">
                {formatQty(l.received)} of {formatQty(l.expected)} {l.uom}
              </span>
              {l.short > 0 && <Badge tone="danger">Short {formatQty(l.short)}</Badge>}
              {l.damaged && <Badge tone="danger">Damaged</Badge>}
              {l.note && <p className="text-sm text-muted">{l.note}</p>}
            </li>
          ))}
        </ul>
        {d.notes && <p className="mt-3 whitespace-pre-wrap text-ink">{d.notes}</p>}
      </Card>
      <Card
        title="Photos"
        actions={
          <Button variant="secondary" busy={addPhoto.busy} onClick={() => void addPhoto.run()}>
            Add photo
          </Button>
        }
      >
        <ErrorBanner error={addPhoto.error} />
        {d.photos.length ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {d.photos.map((p) => (
              <li key={p.id}>
                <a href={api.fileUrl(p.url)!} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={api.fileUrl(p.url)!} alt={p.fileName} className="aspect-square w-full rounded-lg object-cover" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No photos.</p>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Return material from a job to a yard
// ---------------------------------------------------------------------------
export function ReturnScreen() {
  const siteId = useSearchParams().get('siteId') ?? '';
  const router = useRouter();
  const { api } = useAuthed();
  const site = useAsync(() => api.sites.get(siteId), [api, siteId]);
  const lots = useAsync(() => api.bols.lotsAtSite(siteId), [api, siteId]);
  const yards = useAsync(() => api.sites.list({ type: 'YARD' }), [api]);
  const carriers = useAsync(() => api.contacts.list({ type: 'TRUCKING' }), [api]);
  const [yardId, setYardId] = useState('');
  const [picks, setPicks] = useState<Record<string, { on: boolean; qty: string }>>({});
  const [carrierId, setCarrierId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [notes, setNotes] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');

  const myYards = (yards.data ?? []).filter((y) => site.data?.companyId && y.yardCompanyIds.includes(site.data.companyId));
  useEffect(() => {
    if (!yardId && myYards[0]) setYardId(myYards[0].id);
  }, [myYards, yardId]);

  const send = useAction(async () => {
    const lines = (lots.data ?? [])
      .filter((l) => picks[l.lotId]?.on)
      .map((l) => {
        const qty = parseQty(picks[l.lotId]!.qty);
        if (qty == null || qty <= 0) throw new Error(`Enter a quantity for ${l.description}.`);
        return { lotId: l.lotId, qty };
      });
    const b = await api.bols.createReturn({ siteId, yardId, pickupDate: pickupDate || null, deliveryDate: deliveryDate || pickupDate || null, carrierContactId: carrierId || null, driverName: driverName.trim() || null, notes: notes.trim() || null, lines });
    router.replace(paths.bol(b.id));
  });

  const error = site.error || lots.error || yards.error;
  if (error) return <ErrorBanner error={error} />;
  if (!site.data || !lots.data) return <PageLoading />;
  const count = Object.values(picks).filter((p) => p.on).length;

  return (
    <div className="flex flex-col gap-4 pb-24">
      <PageHeader back={paths.site(siteId)} title="Return items to the yard" subtitle={`JOB#${site.data.jobNumber} ${site.data.name}`} />
      {(lots.data?.length ?? 0) > 0 && (
        <div className="flex justify-end">
          <VoiceButton
            target={{
              screen: 'return',
              siteId,
              schema: {
                title: 'Returning items from the job to the yard',
                fields: [
                  { key: 'driverName', label: 'Driver', type: 'text' },
                  { key: 'pickupDate', label: 'Pickup date', type: 'date' },
                  { key: 'notes', label: 'Why it is going back', type: 'text' },
                ],
                rows: { label: 'items on site', canAdd: false, canRemove: false, fields: [{ key: 'returning', label: 'Going back', type: 'boolean' }, { key: 'qty', label: 'How many', type: 'number' }] },
              },
              current: () => ({ values: { driverName, pickupDate, notes }, rows: (lots.data ?? []).map((l) => ({ description: l.description, onSite: `${l.qtyAvailable} ${l.uom}`, returning: !!picks[l.lotId]?.on, qty: picks[l.lotId]?.qty ?? '' })) }),
              apply: (r) => {
                if (r.set.driverName !== undefined) setDriverName(str(r.set.driverName));
                if (r.set.pickupDate !== undefined) setPickupDate(str(r.set.pickupDate));
                if (r.set.notes !== undefined) setNotes(str(r.set.notes));
                setPicks((prev) => {
                  const next = { ...prev };
                  for (const op of r.rowOps) {
                    const l = op.index != null ? lots.data?.[op.index] : undefined;
                    if (op.op !== 'update' || !l || !op.values) continue;
                    const cur = next[l.lotId] ?? { on: false, qty: String(l.qtyAvailable) };
                    next[l.lotId] = { on: op.values.returning != null ? !!op.values.returning : op.values.qty != null ? true : cur.on, qty: op.values.qty != null ? str(op.values.qty) : cur.qty };
                  }
                  return next;
                });
              },
              snapshot: () => ({ picks, driverName, pickupDate, notes }),
              restore: (s) => {
                setPicks(s.picks);
                setDriverName(s.driverName);
                setPickupDate(s.pickupDate);
                setNotes(s.notes);
              },
            }}
          />
        </div>
      )}
      {lots.data.length === 0 ? (
        <EmptyState title="Nothing on site to return">Items show up here once a BOL has been received at this job.</EmptyState>
      ) : (
        <>
          <Card title="What's going back?">
            <ul className="flex flex-col divide-y divide-line">
              {lots.data.map((l) => {
                const p = picks[l.lotId];
                return (
                  <li key={l.lotId} className="py-3">
                    <Checkbox
                      label={`${l.description} — ${formatQty(l.qtyAvailable)} ${l.uom} on site`}
                      description={l.orderLabel ? `${l.orderLabel} ${formatLineNo(l.lineNo ?? 0)}` : (l.equipmentLabel ?? '')}
                      checked={!!p?.on}
                      onChange={(v) => setPicks((x) => ({ ...x, [l.lotId]: { qty: String(l.qtyAvailable), ...x[l.lotId], on: v } }))}
                    />
                    {p?.on && (
                      <div className="mt-2 pl-9">
                        <TextField
                          label={`Qty going back (${l.uom})`}
                          inputMode="decimal"
                          value={p.qty}
                          onChange={(e) => setPicks((x) => ({ ...x, [l.lotId]: { ...p, qty: e.target.value } }))}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Truck">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="Back to" value={yardId} onChange={(e) => setYardId(e.target.value)} options={myYards.map((y) => ({ value: y.id, label: y.name }))} />
              <SelectField
                label="Trucking company"
                placeholder="Our own truck / not set"
                value={carrierId}
                onChange={(e) => setCarrierId(e.target.value)}
                options={(carriers.data ?? []).map((c) => ({ value: c.id, label: c.businessName ? `${c.businessName} — ${c.name}` : c.name }))}
              />
              <TextField label="Driver" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
              <TextField label="Pickup date" type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
              <TextField label="Delivery date (if different)" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              <div className="sm:col-span-2">
                <TextArea label="Why is it going back? (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </Card>
          <div className="safe-bottom fixed inset-x-0 bottom-16 z-10 border-t border-line bg-surface p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
            <ErrorBanner error={send.error} />
            <Button className="w-full lg:w-auto" busy={send.busy} disabled={!count || !yardId} onClick={() => void send.run()}>
              Create return BOL ({count})
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shipping locations library
// ---------------------------------------------------------------------------
export function LocationsScreen() {
  const { api, me } = useAuthed();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const locs = useAsync(() => api.locations.list({ q: search || undefined }), [api, search]);
  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle="Yards, jobs, laydown areas and other drop-off spots used on BOLs."
        actions={can(me.user, 'location:edit') && <ButtonLink href={paths.locationNew()}>+ New location</ButtonLink>}
      />
      <div className="mb-4">
        <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, address or city" />
      </div>
      {can(me.user, 'location:edit') && <KmlImport onDone={() => void locs.reload()} />}
      <ErrorBanner error={locs.error} onRetry={locs.reload} />
      {(locs.data?.length ?? 0) > 0 && (
        <ExportButtons
          title="Locations"
          columns={[
            { key: 'name', label: 'Name', width: 2 },
            { key: 'kind', label: 'Type', width: 0.6 },
            { key: 'address', label: 'Address', width: 2 },
            { key: 'city', label: 'City' },
            { key: 'prov', label: 'Prov.', width: 0.5 },
            { key: 'phone', label: 'Phone' },
            { key: 'notes', label: 'Notes', width: 2 },
          ]}
          rows={(locs.data ?? []).map((l) => ({ name: l.businessName, kind: l.siteType === 'YARD' ? 'Yard' : l.siteType === 'JOB' ? 'Job' : '', address: l.address, city: l.city, prov: l.province, phone: l.phone ?? l.cell, notes: l.notes }))}
        />
      )}
      {locs.loading && !locs.data ? (
        <PageLoading />
      ) : locs.data?.length ? (
        <List>
          {locs.data.map((l) => (
            <ListRow
              key={l.id}
              href={l.siteId ? paths.site(l.siteId) : paths.locationEdit(l.id)}
              title={l.businessName}
              subtitle={[l.siteType === 'YARD' ? 'Yard' : l.siteType === 'JOB' ? 'Job' : null, locLine(l)].filter(Boolean).join(' · ')}
            />
          ))}
        </List>
      ) : (
        <EmptyState title="No locations found" />
      )}
    </div>
  );
}

const blankLocation: LocationInput = { businessName: '', address: '', city: '', province: '', postalCode: '', phone: '', cell: '', notes: '', active: true };

export function LocationEditScreen() {
  const id = useSearchParams().get('id');
  const router = useRouter();
  const { api, me } = useAuthed();
  const [form, setForm] = useState<LocationInput>(blankLocation);
  const [loaded, setLoaded] = useState(!id);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = can(me.user, 'location:edit');
  const set = <K extends keyof LocationInput>(k: K, v: LocationInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!id) return;
    api.locations
      .get(id)
      .then((l) => {
        setForm({
          businessName: l.businessName,
          address: l.address ?? '',
          city: l.city ?? '',
          province: l.province ?? '',
          postalCode: l.postalCode ?? '',
          phone: l.phone ?? '',
          cell: l.cell ?? '',
          notes: l.notes ?? '',
          active: l.active,
        });
        setLoaded(true);
      })
      .catch(setLoadError);
  }, [api, id]);

  const save = useAction(async () => {
    if (id) await api.locations.update(id, form);
    else await api.locations.create(form);
    router.replace(paths.locations());
  });
  const remove = useAction(async () => {
    await api.locations.remove(id!);
    router.replace(paths.locations());
  });

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!loaded) return <PageLoading />;
  const err = (f: string) => fieldError(save.error, f);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
      className="flex flex-col gap-4"
    >
      <PageHeader back={paths.locations()} title={id ? 'Location' : 'New location'} />
      {id && <PinFromLink locationId={id} />}
      <div className="flex justify-end">
        <VoiceButton
          target={{
            screen: 'location',
            schema: {
              title: 'Shipping location (a drop-off / pickup place)',
              fields: [
                { key: 'businessName', label: 'Name', type: 'text' },
                { key: 'address', label: 'Street address', type: 'text' },
                { key: 'city', label: 'City', type: 'text' },
                { key: 'province', label: 'Province (2-letter code)', type: 'text' },
                { key: 'postalCode', label: 'Postal code', type: 'text' },
                { key: 'phone', label: 'Phone', type: 'text' },
                { key: 'cell', label: 'Cell', type: 'text' },
                { key: 'notes', label: 'Notes (gate codes, hours)', type: 'text' },
              ],
            },
            current: () => ({ values: { ...form }, rows: [] }),
            apply: (r) => setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(r.set).map(([k, v]) => [k, str(v)])) })),
            snapshot: () => form,
            restore: setForm,
          }}
        />
      </div>
      <ErrorBanner error={save.error || remove.error} />
      <Card>
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" required value={form.businessName} onChange={(e) => set('businessName', e.target.value)} error={err('businessName')} />
          <TextField label="Address" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          <TextField label="City" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
          <TextField label="Province" value={form.province ?? ''} onChange={(e) => set('province', e.target.value)} />
          <TextField label="Postal code" value={form.postalCode ?? ''} onChange={(e) => set('postalCode', e.target.value)} />
          <TextField label="Phone" type="tel" inputMode="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          <TextField label="Cell" type="tel" inputMode="tel" value={form.cell ?? ''} onChange={(e) => set('cell', e.target.value)} />
          <div className="sm:col-span-2">
            <TextArea label="Notes (gate codes, hours, where to drop)" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {id && <Checkbox label="Active" checked={form.active ?? true} onChange={(v) => set('active', v)} />}
        </fieldset>
      </Card>
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={save.busy}>
            {id ? 'Save changes' : 'Add location'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          {id &&
            (confirmDelete ? (
              <Button type="button" variant="danger" busy={remove.busy} onClick={() => void remove.run()}>
                Yes, delete it
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ))}
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Recycle bin (admins)
// ---------------------------------------------------------------------------
export function RecycleBinScreen() {
  const { api } = useAuthed();
  const items = useAsync(() => api.recycleBin.list(), [api]);
  const [restored, setRestored] = useState('');
  const restore = useAction(async (id: string, label: string) => {
    await api.recycleBin.restore(id);
    setRestored(label);
    await items.reload();
  });
  return (
    <div>
      <PageHeader back={paths.home()} title="Recycle bin" subtitle="Deleted drafts, PO lines, columns, contacts and locations. Restore anything deleted by mistake." />
      {restored && <Notice>Restored “{restored}”.</Notice>}
      <ErrorBanner error={items.error || restore.error} onRetry={items.reload} />
      {items.loading && !items.data ? (
        <PageLoading />
      ) : items.data?.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {items.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block font-semibold break-words text-ink">{d.label}</span>
                <span className="block text-sm text-muted">
                  {DELETED_TYPE_LABELS[d.entityType] ?? d.entityType} · deleted {dateLabel(d.deletedAt)}
                  {d.deletedByName && ` by ${d.deletedByName}`}
                </span>
              </span>
              <Button variant="secondary" busy={restore.busy} onClick={() => void restore.run(d.id, d.label)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="The recycle bin is empty" />
      )}
    </div>
  );
}

/** Pull a purchase order onto the BOL: what's in a yard, or pick it up at the vendor. */
function FromPoCard({ companyId, onAdd }: { companyId: string; onAdd: (add: { locations: string[]; lots: { lotId: string; qty: number }[]; siteId: string | null }) => Promise<void> }) {
  const { api } = useAuthed();
  const [open, setOpen] = useState(false);
  const [poId, setPoId] = useState('');
  const pos = useAsync(async () => (open && companyId ? api.bols.poOptions(companyId) : []), [api, open, companyId]);
  const po = useAsync(async () => (poId ? api.bols.fromPo(poId) : null), [api, poId]);
  const [take, setTake] = useState<Record<string, string>>({});
  useEffect(() => setTake({}), [poId]);
  const add = useAction(async () => {
    const view = po.data;
    if (!view) return;
    const lots: { lotId: string; qty: number }[] = [];
    const locs = new Set<string>();
    const vendor: { poLineId: string; qty: number }[] = [];
    for (const l of view.lines) {
      for (const x of [...l.inYards, ...l.atVendor]) {
        const q = Number(take[x.lotId] ?? x.qtyAvailable);
        if (take[x.lotId] === '' || !(q > 0)) continue;
        lots.push({ lotId: x.lotId, qty: Math.min(q, x.qtyAvailable) });
        locs.add(x.locationId);
      }
      const v = Number(take[`v:${l.poLineId}`] ?? 0);
      if (v > 0) vendor.push({ poLineId: l.poLineId, qty: Math.min(v, l.canPickUpAtVendor) });
    }
    if (vendor.length) {
      const r = await api.bols.vendorPickup(view.po.id, vendor);
      locs.add(r.locationId);
      lots.push(...r.lots.map((x) => ({ lotId: x.lotId, qty: x.qty })));
    }
    if (!lots.length) throw new Error('Enter how much to load from this PO.');
    await onAdd({ locations: [...locs], lots, siteId: view.po.siteId });
    setOpen(false);
    setPoId('');
  });
  if (!open)
    return (
      <div>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          + Add from a purchase order
        </Button>
      </div>
    );
  const view = po.data;
  return (
    <Card title="Add from a purchase order" actions={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>}>
      <SelectField label="PO" placeholder={pos.loading ? 'Loading…' : 'Choose a PO'} value={poId} onChange={(e) => setPoId(e.target.value)} options={(pos.data ?? []).map((p) => ({ value: p.id, label: `PO ${p.poNumber} · ${p.vendorName}${p.siteLabel ? ` · ${p.siteLabel}` : ''}` }))} />
      <ErrorBanner error={pos.error || po.error || add.error} />
      {view && (
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {view.lines.map((l) => (
            <li key={l.poLineId} className="py-2">
              <p className="font-semibold text-ink">
                {l.lineNo ? `L${l.lineNo} ` : ''}
                {l.description} <span className="font-normal text-muted">({l.ordered} {l.uom} ordered)</span>
              </p>
              {[...l.inYards, ...l.atVendor].map((x) => (
                <div key={x.lotId} className="mt-1 grid grid-cols-[1fr_8rem] items-end gap-2">
                  <span className="text-sm text-muted">
                    {x.qtyAvailable} {l.uom} at {x.locationName}
                  </span>
                  <TextField label="Load" inputMode="decimal" value={take[x.lotId] ?? String(x.qtyAvailable)} onChange={(e) => setTake((t) => ({ ...t, [x.lotId]: e.target.value }))} />
                </div>
              ))}
              {l.canPickUpAtVendor > 0 && (
                <div className="mt-1 grid grid-cols-[1fr_8rem] items-end gap-2">
                  <span className="text-sm text-muted">
                    {l.canPickUpAtVendor} {l.uom} not received yet — pick up at {view.po.vendorName}?
                  </span>
                  <TextField label="Pick up" inputMode="decimal" placeholder="0" value={take[`v:${l.poLineId}`] ?? ''} onChange={(e) => setTake((t) => ({ ...t, [`v:${l.poLineId}`]: e.target.value }))} />
                </div>
              )}
              {!l.linkedToOrderList && <p className="text-sm text-muted">Not on an order list (equipment or stock PO) — add it by hand.</p>}
              {l.inYards.length === 0 && l.atVendor.length === 0 && l.canPickUpAtVendor === 0 && l.linkedToOrderList && <p className="text-sm text-muted">Nothing left to ship.</p>}
            </li>
          ))}
        </ul>
      )}
      <Button type="button" className="mt-3" busy={add.busy} disabled={!view} onClick={() => void add.run()}>
        Add to this BOL
      </Button>
    </Card>
  );
}

/** Pin a location by pasting a Google / Apple Maps link (or geo:, coordinates, an address). */
function PinFromLink({ locationId }: { locationId: string }) {
  const { api } = useAuthed();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const pin = useAction(async () => {
    const r = await api.board.pin(locationId, text);
    setMsg(`Pinned at ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}${r.how === 'address' ? ' (from the address)' : ''}. It shows on the load board map now.`);
    setText('');
  });
  return (
    <Card title="Pin on the map">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <TextField label="Paste a map link or address" hint="Google Maps or Apple Maps “Share › Copy link”, a link from an email, “49.28, -123.12”, or the street address." value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="button" busy={pin.busy} disabled={text.trim().length < 3} onClick={() => void pin.run()}>
          Pin it
        </Button>
      </div>
      <ErrorBanner error={pin.error} />
      {msg && <p className="mt-1 text-sm text-ink">{msg}</p>}
    </Card>
  );
}

/** Pins from Google Earth / Google My Maps (KML) become locations. */
function KmlImport({ onDone }: { onDone: () => void }) {
  const { api } = useAuthed();
  const [msg, setMsg] = useState('');
  const run = useAction(async (f: { blob: Blob; name: string }) => {
    const r = await api.board.importKml(f.blob, f.name);
    setMsg(`${r.created} new location${r.created === 1 ? '' : 's'}, ${r.updated} re-pinned.`);
    onDone();
  });
  return (
    <div className="mb-4">
      <DropZone title="Import pins (KML)" hint="From Google My Maps or Google Earth: export the map as KML and drop it here. Pins become locations (matched by name)." accept=".kml,application/vnd.google-earth.kml+xml" busy={run.busy} onFiles={(files) => void run.run(files[0]!)} />
      <ErrorBanner error={run.error} />
      {msg && <p className="mt-1 text-sm text-ink">{msg}</p>}
    </div>
  );
}
