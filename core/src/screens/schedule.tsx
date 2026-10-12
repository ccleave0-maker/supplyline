'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type DragEvent } from 'react';
import { formatQty } from '../domain/inventory';
import { SHIPMENT_STATE_LABELS, type LineShipment, type ScheduleLoad } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, cx, EmptyState, ErrorBanner, PageHeader, PageLoading, SelectField, TextField } from '../ui/components';
import { useAction, useAsync, useWideScreen } from '../ui/hooks';
import { useAuthed, useLive } from '../ui/session';
import { ExportButtons } from '../ui/export';

// ---------------------------------------------------------------------------
// Dates (local, YYYY-MM-DD)
// ---------------------------------------------------------------------------
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => new Date(`${s}T12:00:00`);
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
const todayIso = () => iso(new Date());
const mondayOf = (s: string) => addDays(s, -((parse(s).getDay() + 6) % 7));
const dayName = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  parse(s).toLocaleDateString('en-CA', opts);

const STATE: Record<ScheduleLoad['status'], { label: string; tone: 'neutral' | 'brand' | 'ok' | 'danger' }> = {
  DRAFT: { label: 'Planned', tone: 'neutral' },
  ISSUED: { label: 'On the way', tone: 'brand' },
  PARTIALLY_RECEIVED: { label: 'Partly delivered', tone: 'brand' },
  RECEIVED: { label: 'Delivered', tone: 'ok' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};

const route = (l: ScheduleLoad) => {
  const names = l.stops.map((s) => s.locationName).filter((n, i, all) => all[i - 1] !== n);
  return names.join(' → ');
};
const firstTime = (l: ScheduleLoad) => l.stops.find((s) => s.plannedDate === l.firstDate && s.plannedTime)?.plannedTime ?? null;

// ---------------------------------------------------------------------------
// One load as a card
// ---------------------------------------------------------------------------
function LoadCard({ load, onMove, compact }: { load: ScheduleLoad; onMove?: (l: ScheduleLoad) => void; compact?: boolean }) {
  const st = STATE[load.status];
  const truck = [load.carrierName, load.driverName, load.truckUnit && `#${load.truckUnit}`, load.trailerName].filter(Boolean).join(' · ');
  const drag = (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', load.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    <div
      draggable={load.canMove}
      onDragStart={drag}
      className={cx('rounded-lg border border-line bg-surface p-2 shadow-sm', load.canMove && 'cursor-grab active:cursor-grabbing', load.conflicts.length > 0 && 'border-danger')}
      style={{ borderLeft: `5px solid ${load.themeColor}` }}
    >
      <Link href={paths.bol(load.id)} className="block">
        <span className="flex flex-wrap items-center justify-between gap-1">
          <span className="font-bold text-ink">
            {firstTime(load) && <span className="text-brand-ink">{firstTime(load)} </span>}
            {load.label}
          </span>
          <Badge tone={st.tone}>{st.label}</Badge>
        </span>
        <span className={cx('block text-sm text-ink', compact && 'line-clamp-2')}>{route(load)}</span>
        {load.lastDate && load.firstDate && load.lastDate !== load.firstDate && (
          <span className="block text-sm text-muted">Arrives {dayName(load.lastDate)}</span>
        )}
        <span className="block text-sm text-muted">
          {load.lineCount ? `${load.lineCount} item${load.lineCount === 1 ? '' : 's'}` : 'No items yet'}
          {truck && ` · ${truck}`}
        </span>
        {!compact && load.notes && <span className="block text-sm text-muted italic">{load.notes}</span>}
      </Link>
      {load.conflicts.map((c) => (
        <p key={c} className="mt-1 text-sm font-semibold text-danger">
          ⚠ {c}
        </p>
      ))}
      {onMove && load.canMove && (
        <Button variant="ghost" className="mt-1 min-h-10 px-2 text-sm" onClick={() => onMove(load)}>
          Move to another day
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------
export function ScheduleScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { api, me } = useAuthed();
  const wide = useWideScreen(1024);
  const week = mondayOf(params.get('week') ?? todayIso());
  const to = addDays(week, 6);
  const [companyId, setCompanyId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const sites = useAsync(() => api.sites.list(), [api]);
  const carriers = useAsync(() => api.contacts.list({ type: 'TRUCKING' }), [api]);
  const loads = useAsync(
    () => api.schedule.list({ from: week, to, includeUndated: true, companyId: companyId || undefined, siteId: siteId || undefined, carrierId: carrierId || undefined }),
    [api, week, to, companyId, siteId, carrierId],
  );
  useLive(() => void loads.reload());

  // Moving: drafts move straight away; loads already on their way ask first (the job gets an email).
  const [pending, setPending] = useState<{ load: ScheduleLoad; date: string } | null>(null);
  const [picking, setPicking] = useState<ScheduleLoad | null>(null);
  const [pickDate, setPickDate] = useState('');
  const move = useAction(async (load: ScheduleLoad, date: string) => {
    setPending(null);
    setPicking(null);
    if (load.firstDate === date) return;
    await api.bols.reschedule(load.id, load.firstDate ? { shiftDays: daysBetween(load.firstDate, date), notify: true } : { setDate: date, notify: true });
    await loads.reload();
  });
  const requestMove = (load: ScheduleLoad, date: string) => {
    if (!load.canMove || load.firstDate === date) return;
    if (load.status === 'DRAFT') void move.run(load, date);
    else setPending({ load, date });
  };
  const dropOn = (date: string) => (e: DragEvent) => {
    e.preventDefault();
    const load = (loads.data ?? []).find((l) => l.id === e.dataTransfer.getData('text/plain'));
    if (load) requestMove(load, date);
  };
  const allowDrop = (e: DragEvent) => e.preventDefault();

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = todayIso();
  const on = (d: string) => (loads.data ?? []).filter((l) => l.firstDate === d);
  const undated = (loads.data ?? []).filter((l) => !l.firstDate);
  const canPlan = can(me.user, 'bol:create');
  const go = (w: string) => router.replace(paths.schedule(w));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Schedule"
        subtitle={`${dayName(week, { month: 'long', day: 'numeric' })} – ${dayName(to, { month: 'long', day: 'numeric', year: 'numeric' })}`}
        actions={canPlan && <ButtonLink href={paths.bolNew()}>+ Plan a load</ButtonLink>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => go(addDays(week, -7))} aria-label="Previous week">
          ‹ Prev
        </Button>
        <Button variant="secondary" onClick={() => go(mondayOf(today))}>
          This week
        </Button>
        <Button variant="secondary" onClick={() => go(addDays(week, 7))} aria-label="Next week">
          Next ›
        </Button>
        <span className="text-sm text-muted">{can(me.user, 'schedule:edit') ? (wide ? 'Drag a load to another day to move it.' : 'Tap “Move to another day” on a load to move it.') : ''}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {me.companies.length > 1 && (
          <SelectField label="Company" placeholder="All companies" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />
        )}
        <SelectField
          label="Job or yard"
          placeholder="All jobs & yards"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          options={(sites.data ?? []).map((s) => ({ value: s.id, label: s.type === 'JOB' ? `JOB#${s.jobNumber} ${s.name}` : `${s.name} (Yard)` }))}
        />
        <SelectField
          label="Trucking company"
          placeholder="All trucks"
          value={carrierId}
          onChange={(e) => setCarrierId(e.target.value)}
          options={(carriers.data ?? []).map((c) => ({ value: c.id, label: c.businessName ?? c.name }))}
        />
      </div>

      <ErrorBanner error={loads.error || move.error} onRetry={loads.reload} />
      {(loads.data?.length ?? 0) > 0 && (
        <ExportButtons
          title="Load schedule"
          subtitle={`${dayName(week, { month: 'long', day: 'numeric' })} – ${dayName(to, { month: 'long', day: 'numeric', year: 'numeric' })}`}
          columns={[
            { key: 'date', label: 'Date' },
            { key: 'time', label: 'Time', width: 0.6 },
            { key: 'load', label: 'Load' },
            { key: 'status', label: 'Status' },
            { key: 'route', label: 'Route', width: 3 },
            { key: 'truck', label: 'Truck / driver', width: 1.8 },
            { key: 'items', label: 'Items', align: 'right', width: 0.6 },
            { key: 'company', label: 'Company', width: 1.4 },
          ]}
          rows={(loads.data ?? []).map((l) => ({
            date: l.firstDate ?? 'Not scheduled',
            time: firstTime(l),
            load: l.label,
            status: STATE[l.status].label,
            route: route(l),
            truck: [l.carrierName, l.driverName, l.truckUnit, l.trailerName].filter(Boolean).join(' · '),
            items: l.lineCount,
            company: l.companyName,
          }))}
        />
      )}
      {pending && (
        <div role="alertdialog" className="flex flex-wrap items-center gap-2 rounded-lg border border-brand bg-surface p-3">
          <span className="font-semibold text-ink">
            {pending.load.label} is already on its way. Move it to {dayName(pending.date)}? The people at the job will be emailed.
          </span>
          <Button busy={move.busy} onClick={() => void move.run(pending.load, pending.date)}>
            Yes, move it
          </Button>
          <Button variant="secondary" onClick={() => setPending(null)}>
            No
          </Button>
        </div>
      )}
      {picking && (
        <Card title={`Move ${picking.label}`}>
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="New date" type="date" value={pickDate} onChange={(e) => setPickDate(e.target.value)} />
            <Button disabled={!pickDate} busy={move.busy} onClick={() => requestMove(picking, pickDate)}>
              Move
            </Button>
            <Button variant="secondary" onClick={() => setPicking(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {loads.loading && !loads.data ? (
        <PageLoading />
      ) : wide ? (
        <div className="grid grid-cols-7 gap-2">
          {days.map((d) => (
            <section
              key={d}
              onDragOver={allowDrop}
              onDrop={dropOn(d)}
              aria-label={dayName(d, { weekday: 'long', month: 'long', day: 'numeric' })}
              className={cx('flex min-h-64 flex-col gap-2 rounded-xl border p-2', d === today ? 'border-brand bg-surface' : 'border-line bg-surface-2')}
            >
              <header className="flex items-center justify-between">
                <span className={cx('font-bold', d === today ? 'text-brand-ink' : 'text-ink')}>{dayName(d)}</span>
                {canPlan && (
                  <Link href={paths.bolNew(d)} className="rounded px-2 text-lg font-bold text-brand-ink hover:bg-surface" aria-label={`Plan a load on ${dayName(d)}`}>
                    +
                  </Link>
                )}
              </header>
              {on(d).map((l) => (
                <LoadCard key={l.id} load={l} compact />
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((d) => {
            const list = on(d);
            if (!list.length && d !== today) return null;
            return (
              <section key={d}>
                <h2 className={cx('mb-2 text-lg font-bold', d === today ? 'text-brand-ink' : 'text-ink')}>
                  {d === today ? 'Today · ' : ''}
                  {dayName(d, { weekday: 'long', month: 'short', day: 'numeric' })}
                </h2>
                {list.length ? (
                  <div className="flex flex-col gap-2">
                    {list.map((l) => (
                      <LoadCard
                        key={l.id}
                        load={l}
                        onMove={(x) => {
                          setPicking(x);
                          setPickDate(x.firstDate ?? today);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted">No loads today.</p>
                )}
              </section>
            );
          })}
          {(loads.data ?? []).every((l) => !l.firstDate) && <EmptyState title="No loads this week" />}
        </div>
      )}

      {undated.length > 0 && (
        <Card title="Not scheduled yet">
          <p className="mb-2 text-sm text-muted">{wide ? 'Drag one onto a day to schedule it.' : 'Tap “Move to another day” to give it a date.'}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {undated.map((l) => (
              <LoadCard
                key={l.id}
                load={l}
                onMove={
                  wide
                    ? undefined
                    : (x) => {
                        setPicking(x);
                        setPickDate(today);
                      }
                }
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces used on other screens
// ---------------------------------------------------------------------------
/** "Planned · Planned load · Tue, Oct 14 to Job A" chips for a line on the materials list / site inventory. */
export function ShipmentList({ shipments, uom }: { shipments: LineShipment[]; uom: string }) {
  if (!shipments.length) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {shipments.map((s, i) => (
        <li key={i} className="text-sm">
          <Link href={paths.bol(s.bolId)} className={cx('font-semibold underline-offset-2 hover:underline', s.state === 'DELIVERED' ? 'text-ok' : 'text-brand-ink')}>
            {SHIPMENT_STATE_LABELS[s.state]}
          </Link>
          <span className="text-ink">
            {' '}
            {formatQty(s.qty)} {uom} · {s.bolLabel}
            {s.date && ` · ${dayName(s.date)}${s.time ? ` ${s.time}` : ''}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Next couple of weeks of loads touching one job or yard (job page, yard home). */
export function UpcomingLoadsCard({ siteId, title = 'Upcoming deliveries', days = 14 }: { siteId?: string; title?: string; days?: number }) {
  const { api } = useAuthed();
  const from = todayIso();
  const to = addDays(from, days);
  const loads = useAsync(() => api.schedule.list({ from, to, siteId }), [api, from, to, siteId]);
  useLive(() => void loads.reload());
  const open = (loads.data ?? []).filter((l) => l.status !== 'RECEIVED');
  return (
    <Card title={title} actions={<ButtonLink href={paths.schedule()} variant="secondary">Schedule</ButtonLink>}>
      <ErrorBanner error={loads.error} onRetry={loads.reload} />
      {loads.loading && !loads.data ? (
        <PageLoading />
      ) : open.length ? (
        <ul className="flex flex-col gap-2">
          {open.map((l) => {
            const here = siteId ? l.stops.find((s) => s.siteId === siteId) : undefined;
            const when = here?.plannedDate ?? l.firstDate;
            return (
              <li key={l.id}>
                <p className="mb-1 text-sm font-semibold text-muted">
                  {when ? dayName(when, { weekday: 'long', month: 'short', day: 'numeric' }) : ''}
                  {here?.plannedTime ? ` · ${here.plannedTime}` : ''}
                  {here && ` · ${here.kind === 'PICKUP' ? 'pickup' : 'delivery'}`}
                </p>
                <LoadCard load={l} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted">Nothing planned in the next {days} days.</p>
      )}
    </Card>
  );
}

/** Today's loads count (yard home tile). */
export function useLoadsToday(siteId?: string) {
  const { api } = useAuthed();
  const d = todayIso();
  return useAsync(() => api.schedule.list({ from: d, to: d, siteId }), [api, d, siteId]);
}
