'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { EQUIPMENT_COVERAGE, type EquipmentCoverage, type EquipmentNeedView } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, PageHeader, PageLoading, SelectField, TextField } from '../ui/components';
import { ExportButtons } from '../ui/export';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';

const fmt = (n: number) => (n ? n.toLocaleString('en-CA', { maximumFractionDigits: 3 }) : '–');

// ---------------------------------------------------------------------------
// Inventory by job
// ---------------------------------------------------------------------------
export function JobMaterialsScreen() {
  const params = useSearchParams();
  const { api } = useAuthed();
  const [siteId, setSiteId] = useState(params.get('siteId') ?? '');
  const [openOnly, setOpenOnly] = useState(true);
  const jobs = useAsync(() => api.sites.list({ type: 'JOB' }), [api]);
  const data = useAsync(() => api.jobMaterials({ siteId: siteId || undefined, open: openOnly }), [api, siteId, openOnly]);
  const cols = [
    { key: 'ref', label: 'Order / line' },
    { key: 'description', label: 'Item', width: 2 },
    { key: 'ordered', label: 'Ordered', align: 'right' as const },
    { key: 'outstanding', label: 'Not arrived yet', align: 'right' as const },
    { key: 'inYard', label: 'In yard', align: 'right' as const },
    { key: 'stagedToShip', label: 'Staged / planned', align: 'right' as const },
    { key: 'inTransit', label: 'On the way', align: 'right' as const },
    { key: 'receivedAtSite', label: 'Received on site', align: 'right' as const },
    { key: 'uom', label: 'Unit' },
    { key: 'requiredOnSite', label: 'Needed' },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Inventory by job" subtitle="Where each job’s material is: not arrived yet, in the yard, staged or on a planned load, on the way, or received on site." />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Job" placeholder="All my jobs" value={siteId} onChange={(e) => setSiteId(e.target.value)} options={(jobs.data ?? []).map((j) => ({ value: j.id, label: `JOB#${j.jobNumber} ${j.name}` }))} />
        <div className="flex items-end">
          <Checkbox label="Only lines not fully on site" checked={openOnly} onChange={setOpenOnly} />
        </div>
      </div>
      <ErrorBanner error={data.error} />
      {data.loading && !data.data && <PageLoading />}
      {data.data?.length === 0 && <EmptyState title="No jobs" />}
      {(data.data ?? []).map((j) => (
        <Card
          key={j.siteId}
          title={j.siteLabel}
          actions={<ExportButtons title={`Inventory – ${j.siteLabel}`} columns={cols} rows={j.rows.map((r) => ({ ...r }))} />}
        >
          <p className="mb-2 text-sm text-muted">
            {j.totals.lines} lines · {j.totals.complete} fully on site · {fmt(j.totals.outstanding)} not arrived · {fmt(j.totals.inYard)} in yard · {fmt(j.totals.stagedToShip)} staged · {fmt(j.totals.inTransit)} on the way
          </p>
          {j.rows.length === 0 ? (
            <p className="text-muted">Everything is on site.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    {cols.map((c) => (
                      <th key={c.key} className={`px-2 py-1 ${c.align === 'right' ? 'text-right' : ''}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {j.rows.map((r) => (
                    <tr key={r.orderLineId} className="border-t border-line">
                      <td className="px-2 py-1 whitespace-nowrap">
                        <Link href={paths.order(r.orderId)} className="text-brand-ink underline">
                          {r.ref}
                        </Link>
                      </td>
                      <td className="px-2 py-1 text-ink">{r.description}</td>
                      <td className="px-2 py-1 text-right">{fmt(r.ordered)}</td>
                      <td className={`px-2 py-1 text-right ${r.outstanding ? 'font-semibold text-danger' : ''}`}>{fmt(r.outstanding)}</td>
                      <td className="px-2 py-1 text-right">{fmt(r.inYard)}</td>
                      <td className="px-2 py-1 text-right">{fmt(r.stagedToShip)}</td>
                      <td className="px-2 py-1 text-right">{fmt(r.inTransit)}</td>
                      <td className="px-2 py-1 text-right">{fmt(r.receivedAtSite)}</td>
                      <td className="px-2 py-1">{r.uom}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.requiredOnSite ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-job equipment planning
// ---------------------------------------------------------------------------
const STATUS: Record<EquipmentNeedView['status'], { label: string; tone: 'ok' | 'danger' | 'neutral' | 'brand' }> = {
  COVERED: { label: 'Covered', tone: 'ok' },
  CAN_COVER: { label: 'We have one free', tone: 'brand' },
  SHORT: { label: 'Short — rent or buy', tone: 'danger' },
  CONFLICT: { label: 'Two jobs, one unit', tone: 'danger' },
};

function NeedRow({ n, onChanged }: { n: EquipmentNeedView; onChanged: () => void }) {
  const { api } = useAuthed();
  const update = useAction(async (patch: { equipmentId?: string | null; coverage?: EquipmentCoverage }) => {
    await api.equipmentNeeds.update(n.id, { siteId: n.siteId, description: n.description, category: n.category, qty: n.qty, fromDate: n.fromDate, toDate: n.toDate, equipmentId: n.equipment?.id ?? null, coverage: n.coverage, notes: n.notes, ...patch });
    onChanged();
  });
  const remove = useAction(async () => {
    await api.equipmentNeeds.remove(n.id);
    onChanged();
  });
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">
            {n.qty > 1 ? `${n.qty} × ` : ''}
            {n.description} <Badge tone={STATUS[n.status].tone}>{STATUS[n.status].label}</Badge>
          </p>
          <p className="text-sm text-muted">
            {n.siteLabel} (priority {n.jobPriority}) · {n.fromDate} → {n.toDate}
            {n.equipment && ` · unit ${n.equipment.unitNumber}`}
          </p>
          {n.advice && <p className="text-sm text-ink">{n.advice}</p>}
          {n.competing.length > 0 && <p className="text-sm text-muted">Also wanted by: {n.competing.map((c) => `${c.siteLabel} (${c.fromDate}–${c.toDate})`).join('; ')}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-48">
            <SelectField label="Our unit" placeholder="None" value={n.equipment?.id ?? ''} onChange={(e) => void update.run({ equipmentId: e.target.value || null, coverage: e.target.value ? 'OWN' : 'NEEDED' })} options={[...(n.equipment ? [n.equipment] : []), ...n.freeUnits].map((u) => ({ value: u.id, label: `${u.unitNumber} · ${u.description}` }))} />
          </div>
          <div className="w-40">
            <SelectField label="Covered by" value={n.coverage} onChange={(e) => void update.run({ coverage: e.target.value as EquipmentCoverage })} options={EQUIPMENT_COVERAGE.map((c) => ({ value: c.key, label: c.label }))} />
          </div>
          <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run()}>
            Remove
          </Button>
        </div>
      </div>
      <ErrorBanner error={update.error || remove.error} />
    </li>
  );
}

/** On the job page: what this job will need, and whether it's covered. */
export function JobEquipmentPlanCard({ siteId }: { siteId: string }) {
  const { api } = useAuthed();
  const list = useAsync(() => api.equipmentNeeds.list({ siteId }), [api, siteId]);
  const [f, setF] = useState({ description: '', category: '', qty: '1', fromDate: '', toDate: '' });
  const add = useAction(async () => {
    await api.equipmentNeeds.create({ siteId, description: f.description, category: f.category || f.description, qty: Number(f.qty) || 1, fromDate: f.fromDate, toDate: f.toDate || f.fromDate, coverage: 'NEEDED' });
    setF({ description: '', category: '', qty: '1', fromDate: '', toDate: '' });
    await list.reload();
  });
  return (
    <Card title="Equipment plan" actions={<Link href={paths.equipmentPlanning()} className="text-sm text-brand-ink underline">All jobs</Link>}>
      <p className="text-sm text-muted">What this job will need before it starts — checked against our fleet and other jobs that want the same.</p>
      <ErrorBanner error={list.error} />
      <ul className="divide-y divide-line">
        {(list.data ?? []).map((n) => (
          <NeedRow key={n.id} n={n} onChanged={() => void list.reload()} />
        ))}
      </ul>
      <div className="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_5rem_9rem_9rem_auto] sm:items-end">
        <TextField label="Needs" placeholder="e.g. 320 excavator" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <TextField label="Kind (fleet category)" placeholder="Excavator" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <TextField label="How many" inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
        <TextField label="From" type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} />
        <TextField label="To" type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />
        <Button busy={add.busy} disabled={!f.description.trim() || !f.fromDate} onClick={() => void add.run()}>
          Add
        </Button>
      </div>
      <ErrorBanner error={add.error} />
    </Card>
  );
}

/** All jobs: who needs what when, what we own, who competes — and which job goes first. */
export function EquipmentPlanningScreen() {
  const { api, me } = useAuthed();
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10));
  const list = useAsync(() => api.equipmentNeeds.list({ from, to }), [api, from, to]);
  const jobs = [...new Map((list.data ?? []).map((n) => [n.siteId, { id: n.siteId, label: n.siteLabel, priority: n.jobPriority }])).values()].sort((a, b) => a.priority - b.priority);
  const prio = useAction(async (siteId: string, p: number) => {
    await api.equipmentNeeds.priority(siteId, p);
    await list.reload();
  });
  const problems = (list.data ?? []).filter((n) => n.status === 'SHORT' || n.status === 'CONFLICT').length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.equipment()} title="Equipment planning" subtitle="Each job’s equipment needs, checked against what we own and against each other. When two jobs want the same thing, the job with the lower priority number goes first." />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <ErrorBanner error={list.error || prio.error} />
      {problems > 0 && <p className="font-semibold text-danger">{problems} need{problems === 1 ? 's' : ''} short or double-booked.</p>}
      {me.user.roles.includes('ADMIN') && jobs.length > 1 && (
        <Card title="Job priority (who goes first)">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((j) => (
              <TextField key={j.id} label={j.label} inputMode="numeric" defaultValue={String(j.priority)} onBlur={(e) => Number(e.target.value) !== j.priority && void prio.run(j.id, Number(e.target.value) || 100)} />
            ))}
          </div>
        </Card>
      )}
      {list.loading && !list.data && <PageLoading />}
      {list.data?.length === 0 && <EmptyState title="No equipment needs in these dates">Add them on each job’s page (Equipment plan).</EmptyState>}
      <Card>
        <ul className="divide-y divide-line">
          {(list.data ?? []).map((n) => (
            <NeedRow key={n.id} n={n} onChanged={() => void list.reload()} />
          ))}
        </ul>
      </Card>
      {!can(me.user, 'equipment:edit') && <p className="text-sm text-muted">Changes are limited to jobs you manage.</p>}
    </div>
  );
}
