'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { EQUIPMENT_IMPORT_FIELDS, type EquipmentImportField, type EquipmentImportResult, type EquipmentInput, type EquipmentItem, type LocationItem, type SheetPreview } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, cx, EmptyState, ErrorBanner, List, ListRow, Notice, PageHeader, PageLoading, SelectField, TextArea, TextField } from '../ui/components';
import { fieldError, useAction, useAsync, useDebounced, useWideScreen } from '../ui/hooks';
import { MapView, type MapPoint } from '../ui/map';
import { useAuthed } from '../ui/session';
import { applyRowOps, str, VoiceButton } from '../ui/voice';
import { LocationPicker } from './shipping';
import { PoListCard } from './purchasing';
import { ExportButtons, PdfButtons } from '../ui/export';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
const unitLabel = (e: { unitNumber: string; description: string }) => `${e.unitNumber} · ${e.description}`;

/** Units in the same place share one map pin. */
function pinsFor(units: EquipmentItem[], onPick: (locationKey: string) => void): MapPoint[] {
  const groups = new Map<string, EquipmentItem[]>();
  for (const u of units) if (u.lat != null && u.lng != null) groups.set(`${u.lat},${u.lng}`, [...(groups.get(`${u.lat},${u.lng}`) ?? []), u]);
  return [...groups].map(([key, list]) => ({
    id: key,
    lat: list[0]!.lat!,
    lng: list[0]!.lng!,
    color: list[0]!.themeColor,
    label: `${list[0]!.location?.name ?? ''}: ${list.length === 1 ? unitLabel(list[0]!) : `${list.length} units (${list.slice(0, 4).map((u) => u.unitNumber).join(', ')}${list.length > 4 ? '…' : ''})`}`,
    onClick: () => onPick(key),
  }));
}

// ---------------------------------------------------------------------------
// List + map
// ---------------------------------------------------------------------------
export function EquipmentListScreen() {
  const params = useSearchParams();
  const siteId = params.get('siteId') ?? undefined;
  const { api, me } = useAuthed();
  const wide = useWideScreen(900);
  const [q, setQ] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [pin, setPin] = useState<string | null>(null);
  const search = useDebounced(q.trim());
  const units = useAsync(() => api.equipment.list({ q: search || undefined, companyId: companyId || undefined, siteId }), [api, search, companyId, siteId]);
  const site = useAsync(() => (siteId ? api.sites.get(siteId) : Promise.resolve(null)), [api, siteId]);
  const shown = (units.data ?? []).filter((u) => !pin || `${u.lat},${u.lng}` === pin);
  const unplaced = (units.data ?? []).filter((u) => u.lat == null).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={siteId ? paths.site(siteId) : undefined}
        title={site.data ? `Equipment at ${site.data.name}` : 'Equipment'}
        subtitle="Every unit, where it is now, and where it has been."
        actions={
          can(me.user, 'equipment:edit') && (
            <>
              <ButtonLink href={paths.equipmentImport()} variant="secondary">
                Import list
              </ButtonLink>
              <ButtonLink href={paths.equipmentNew()}>+ Add unit</ButtonLink>
            </>
          )
        }
      />
      <ButtonLink href={paths.equipmentPlanning()} variant="secondary">
        Equipment planning (pre-job)
      </ButtonLink>
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Unit #, description, make, serial or location" />
        {me.companies.length > 1 ? (
          <SelectField label="Company" placeholder="All companies" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />
        ) : (
          <span />
        )}
        <div className="flex gap-2" role="tablist">
          {(['list', 'map'] as const).map((v) => (
            <Button key={v} role="tab" aria-selected={view === v} variant={view === v ? 'primary' : 'secondary'} onClick={() => setView(v)}>
              {v === 'list' ? 'List' : 'Map'}
            </Button>
          ))}
        </div>
      </div>
      <ErrorBanner error={units.error} onRetry={units.reload} />
      {view === 'map' && (
        <>
          <MapView label="Equipment map" height={wide ? 460 : 320} points={pinsFor(units.data ?? [], (k) => setPin((p) => (p === k ? null : k)))} />
          <p className="text-sm text-muted">
            Tap a pin to list the units there.{unplaced > 0 && ` ${unplaced} unit${unplaced === 1 ? ' isn’t' : 's aren’t'} on the map (no pinned location).`}
            {pin && (
              <Button variant="ghost" onClick={() => setPin(null)}>
                Show all
              </Button>
            )}
          </p>
        </>
      )}
      {units.loading && !units.data ? (
        <PageLoading />
      ) : shown.length ? (
        <List>
          {shown.map((u) => (
            <ListRow
              key={u.id}
              href={paths.equipmentView(u.id)}
              title={
                <>
                  <span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: u.themeColor }} aria-hidden="true" />
                  {unitLabel(u)}
                </>
              }
              subtitle={[u.location?.name ?? 'Location unknown', [u.year, u.make, u.model].filter(Boolean).join(' '), me.companies.length > 1 ? u.companyName : null].filter(Boolean).join(' · ')}
              right={u.pstExempt && <Badge>PST exempt</Badge>}
            />
          ))}
        </List>
      ) : (
        <EmptyState title="No equipment found">{can(me.user, 'equipment:edit') ? 'Add units one at a time, or import your company list from Excel.' : null}</EmptyState>
      )}
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <ExportButtons
            title={site.data ? `Equipment at ${site.data.name}` : 'Equipment'}
            columns={[
              { key: 'unit', label: 'Unit #' },
              { key: 'desc', label: 'Description', width: 2 },
              { key: 'make', label: 'Make / model', width: 1.5 },
              { key: 'year', label: 'Year', width: 0.6 },
              { key: 'serial', label: 'Serial / VIN', width: 1.3 },
              { key: 'loc', label: 'Location', width: 2 },
              { key: 'company', label: 'Company', width: 1.4 },
              { key: 'pst', label: 'PST exempt', width: 0.8 },
            ]}
            rows={shown.map((u) => ({ unit: u.unitNumber, desc: u.description, make: [u.make, u.model].filter(Boolean).join(' '), year: u.year, serial: u.serial, loc: u.location?.name ?? '', company: u.companyName, pst: u.pstExempt ? 'Yes' : '' }))}
          />
          <PdfButtons title="Equipment QR tags" fileName="Equipment-tags.pdf" load={() => api.equipment.tags(shown.map((u) => u.id))} label="QR tags" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One unit: details, PST, move, history
// ---------------------------------------------------------------------------
export function EquipmentScreen() {
  const id = useSearchParams().get('id') ?? '';
  const platform = usePlatform();
  const { api, me } = useAuthed();
  const unit = useAsync(() => api.equipment.get(id), [api, id]);
  const locs = useAsync(() => api.locations.list(), [api]);
  const [extra, setExtra] = useState<LocationItem[]>([]);
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState('');
  const [toText, setToText] = useState('');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [notes, setNotes] = useState('');
  const move = useAction(async () => {
    await api.equipment.move(id, { toLocationId: to || null, toText: to ? null : toText, movedAt: date, notes });
    setMoving(false);
    setTo('');
    setToText('');
    setNotes('');
    await unit.reload();
  });
  const pst = useAction(async (remove: boolean) => {
    if (remove) await api.equipment.removePstForm(id);
    else {
      const f = (await platform.files.pickFiles({ accept: 'application/pdf,image/*' }))[0];
      if (!f) return;
      await api.equipment.setPstForm(id, f.blob, f.name);
    }
    await unit.reload();
  });

  if (unit.error) return <ErrorBanner error={unit.error} onRetry={unit.reload} />;
  const u = unit.data;
  if (!u) return <PageLoading />;
  const locations = [...(locs.data ?? []), ...extra];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={paths.equipment()}
        title={unitLabel(u)}
        subtitle={[u.companyName, [u.year, u.make, u.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
        actions={
          <>
            {!u.active && <Badge>Inactive</Badge>}
            <PdfButtons title={`Tag ${u.unitNumber}`} fileName={`Tag-${u.unitNumber}.pdf`} load={() => api.equipment.tags([u.id])} label="QR tag" />
            {u.canEdit && (
              <ButtonLink href={paths.equipmentEdit(u.id)} variant="secondary">
                Edit
              </ButtonLink>
            )}
          </>
        }
      />
      <Card
        title="Where it is"
        actions={
          u.canMove &&
          !moving && (
            <Button onClick={() => setMoving(true)}>Record a move</Button>
          )
        }
      >
        <p className="text-lg font-semibold text-ink">{u.location?.name ?? 'Unknown'}</p>
        {u.lastMovedAt && <p className="text-sm text-muted">Since {when(u.lastMovedAt)}</p>}
        {u.location?.siteId && (
          <a href={paths.site(u.location.siteId)} className="text-sm font-semibold text-brand-ink">
            Open job / yard ›
          </a>
        )}
        {moving && (
          <div className="mt-3 rounded-lg bg-surface-2 p-3">
            <ErrorBanner error={move.error} />

            <div className="mb-2 flex justify-end">
              <VoiceButton
                label="Say where it went"
                target={{
                  screen: 'equipmentMove',
                  companyId: u.companyId,
                  schema: {
                    title: `Recording a move of unit ${u.unitNumber} (${u.description})`,
                    fields: [
                      { key: 'to', label: 'Moved to (a known location)', type: 'choice', options: locations.map((l) => ({ value: l.id, label: l.businessName + (l.city ? ` (${l.city})` : '') })) },
                      { key: 'toText', label: 'Moved to (anywhere else, in words)', type: 'text' },
                      { key: 'date', label: 'Date', type: 'date' },
                      { key: 'notes', label: 'Notes (trucking, hours, condition)', type: 'text' },
                    ],
                  },
                  current: () => ({ values: { to, toText, date, notes }, rows: [] }),
                  apply: (r) => {
                    if (r.set.to !== undefined) setTo(str(r.set.to));
                    if (r.set.toText !== undefined) setToText(str(r.set.toText));
                    if (r.set.date !== undefined) setDate(str(r.set.date));
                    if (r.set.notes !== undefined) setNotes(str(r.set.notes));
                  },
                  snapshot: () => ({ to, toText, date, notes }),
                  restore: (s) => {
                    setTo(s.to);
                    setToText(s.toText);
                    setDate(s.date);
                    setNotes(s.notes);
                  },
                }}
              />
            </div>
            <LocationPicker label="Moved to" value={to} onChange={setTo} locations={locations} onAdded={(l) => setExtra((x) => [...x, l])} />
            {!to && <TextField label="…or type where (shop, vendor for repair…)" value={toText} onChange={(e) => setToText(e.target.value)} />}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <TextField label="Notes (trucking, hours, condition)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="mt-2 flex gap-2">
              <Button busy={move.busy} disabled={!to && !toText.trim()} onClick={() => void move.run()}>
                Save move
              </Button>
              <Button variant="secondary" onClick={() => setMoving(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {u.lat != null && u.lng != null && (
          <div className="mt-3">
            <MapView label={`Map: ${u.unitNumber}`} points={[{ id: u.id, lat: u.lat, lng: u.lng, label: unitLabel(u), color: u.themeColor }]} />
          </div>
        )}
      </Card>

      <Card title="Details">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
          {(
            [
              ['Make', u.make],
              ['Model', u.model],
              ['Year', u.year],
              ['Serial / VIN', u.serial],
              ['Category', u.category],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm text-muted">{k}</dt>
              <dd className="text-ink">{v ?? '—'}</dd>
            </div>
          ))}
        </dl>
        {u.notes && <p className="mt-3 whitespace-pre-wrap text-ink">{u.notes}</p>}
      </Card>

      <Card title="PST">
        <p className="text-ink">
          {u.pstExempt ? 'PST exempt' : 'PST applies'}
          {u.pstExempt && u.pstExemptNumber && <span className="text-muted"> · #{u.pstExemptNumber}</span>}
        </p>
        <p className="text-sm text-muted">POs cut against this unit (Phase 6) follow this setting{u.pstExempt ? ' and attach the form' : ''}.</p>
        {u.pstExempt && (
          <div className="mt-2">
            {u.pstExemptionFile ? (
              <a href={api.fileUrl(u.pstExemptionFile.url)!} target="_blank" rel="noreferrer" className="font-semibold text-brand-ink">
                📄 {u.pstExemptionFile.fileName}
              </a>
            ) : (
              <p className="text-danger">No exemption form uploaded.</p>
            )}
            {u.canEdit && (
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" busy={pst.busy} onClick={() => void pst.run(false)}>
                  {u.pstExemptionFile ? 'Replace form' : 'Upload form'}
                </Button>
                {u.pstExemptionFile && (
                  <Button variant="ghost" busy={pst.busy} onClick={() => void pst.run(true)}>
                    Remove
                  </Button>
                )}
              </div>
            )}
            <ErrorBanner error={pst.error} />
          </div>
        )}
      </Card>

      {can(me.user, 'po:view') && <PoListCard equipmentId={u.id} />}

      <Card title="Movement history">
        {u.movements.length ? (
          <ol className="flex flex-col divide-y divide-line">
            {u.movements.map((m) => (
              <li key={m.id} className="py-2">
                <span className="block font-semibold text-ink">
                  {when(m.movedAt)}: {m.fromName ?? 'Unknown'} → {m.toName ?? 'Unknown'}
                </span>
                <span className="block text-sm text-muted">
                  Recorded by {m.recordedByName}
                  {m.notes && ` · ${m.notes}`}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted">No moves recorded yet.</p>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / edit
// ---------------------------------------------------------------------------
export function EquipmentEditScreen() {
  const id = useSearchParams().get('id');
  const router = useRouter();
  const { api, me } = useAuthed();
  const [f, setF] = useState<EquipmentInput>({ companyId: me.user.companyId ?? me.companies[0]?.id ?? '', unitNumber: '', description: '', make: '', model: '', year: null, serial: '', category: '', notes: '', pstExempt: false, pstExemptNumber: '', active: true });
  const [year, setYear] = useState('');
  const [loaded, setLoaded] = useState(!id);
  const [loadError, setLoadError] = useState<unknown>(null);
  const set = <K extends keyof EquipmentInput>(k: K, v: EquipmentInput[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (!id) return;
    api.equipment
      .get(id)
      .then((u) => {
        setF({ companyId: u.companyId, unitNumber: u.unitNumber, description: u.description, make: u.make ?? '', model: u.model ?? '', year: u.year, serial: u.serial ?? '', category: u.category ?? '', notes: u.notes ?? '', pstExempt: u.pstExempt, pstExemptNumber: u.pstExemptNumber ?? '', active: u.active });
        setYear(u.year ? String(u.year) : '');
        setLoaded(true);
      })
      .catch(setLoadError);
  }, [api, id]);
  const save = useAction(async () => {
    const input = { ...f, year: /^\d{4}$/.test(year.trim()) ? Number(year.trim()) : null };
    const r = id ? await api.equipment.update(id, input) : await api.equipment.create(input);
    router.replace(paths.equipmentView(r.id));
  });
  if (loadError) return <ErrorBanner error={loadError} />;
  if (!loaded) return <PageLoading />;
  const err = (k: string) => fieldError(save.error, k);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <PageHeader back={id ? paths.equipmentView(id) : paths.equipment()} title={id ? 'Edit unit' : 'Add a unit'} />
      <ErrorBanner error={save.error} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          {!id && me.companies.length > 1 && (
            <SelectField label="Company" value={f.companyId} onChange={(e) => set('companyId', e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />
          )}
          <TextField label="Unit #" required value={f.unitNumber} onChange={(e) => set('unitNumber', e.target.value)} error={err('unitNumber')} />
          <TextField label="Description" required value={f.description} onChange={(e) => set('description', e.target.value)} error={err('description')} placeholder="e.g. 320 excavator" />
          <TextField label="Make" value={f.make ?? ''} onChange={(e) => set('make', e.target.value)} />
          <TextField label="Model" value={f.model ?? ''} onChange={(e) => set('model', e.target.value)} />
          <TextField label="Year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
          <TextField label="Serial / VIN" value={f.serial ?? ''} onChange={(e) => set('serial', e.target.value)} />
          <TextField label="Category / type" value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Excavator, Crane, Pickup" />
          <div className="sm:col-span-2">
            <Checkbox label="PST exempt" description="POs against this unit are marked PST exempt (upload the form on the unit's page)." checked={!!f.pstExempt} onChange={(v) => set('pstExempt', v)} />
            {f.pstExempt && (
              <div className="mt-2 pl-9">
                <TextField label="PST exemption #" value={f.pstExemptNumber ?? ''} onChange={(e) => set('pstExemptNumber', e.target.value)} />
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <TextArea label="Notes" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {id && <Checkbox label="Active" description="Sold or scrapped units: untick to hide them." checked={f.active ?? true} onChange={(v) => set('active', v)} />}
        </div>
      </Card>
      <div className="flex gap-2">
        <Button type="submit" busy={save.busy}>
          {id ? 'Save changes' : 'Add unit'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Import from Excel / CSV
// ---------------------------------------------------------------------------
export function EquipmentImportScreen() {
  const platform = usePlatform();
  const { api, me } = useAuthed();
  const [companyId, setCompanyId] = useState(me.user.companyId ?? me.companies[0]?.id ?? '');
  const [sheet, setSheet] = useState<SheetPreview | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<EquipmentImportField, number>>>({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [result, setResult] = useState<EquipmentImportResult | null>(null);
  const read = useAction(async () => {
    const f = (await platform.files.pickFiles({ accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))[0];
    if (!f) return;
    setResult(null);
    const p = await api.equipment.previewImport(f.blob, f.name);
    setSheet(p);
    setMapping(p.suggested);
  });
  const run = useAction(async () => {
    if (!sheet) return;
    const m = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v != null)) as Record<string, number>;
    setResult(await api.equipment.import({ companyId, headers: sheet.headers, rows: sheet.rows, mapping: m, updateExisting }));
  });
  const columns = useMemo(() => (sheet?.headers ?? []).map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })), [sheet]);
  const preview = (sheet?.rows ?? []).slice(0, 5);
  const mapped = EQUIPMENT_IMPORT_FIELDS.filter((f) => mapping[f.key] != null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.equipment()} title="Import equipment" subtitle="From Excel (.xlsx) or CSV. Units are matched by Unit #, so you can re-import an updated list any time." />
      {me.companies.length > 1 && (
        <Card>
          <SelectField label="Import into" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />
        </Card>
      )}
      <div>
        <Button busy={read.busy} onClick={() => void read.run()}>
          {sheet ? 'Choose a different file' : 'Choose the file'}
        </Button>
      </div>
      <ErrorBanner error={read.error} />
      {sheet && (
        <>
          <Card title={`Match the columns — ${sheet.fileName} (${sheet.rows.length} rows)`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {EQUIPMENT_IMPORT_FIELDS.map((f) => (
                <SelectField
                  key={f.key}
                  label={`${f.label}${'required' in f && f.required ? ' *' : ''}`}
                  placeholder="(not in this sheet)"
                  value={mapping[f.key] == null ? '' : String(mapping[f.key])}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  options={columns}
                />
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">Current location is matched to your jobs, yards and locations by name or job number; anything else is kept as text.</p>
          </Card>
          <Card title="Preview">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    {mapped.map((f) => (
                      <th key={f.key} className="px-2 py-1">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      {mapped.map((f) => (
                        <td key={f.key} className="px-2 py-1 text-ink">
                          {r[mapping[f.key]!]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Checkbox label="Update units that already exist" description="Matched by Unit #. Untick to only add new units." checked={updateExisting} onChange={setUpdateExisting} />
          <ErrorBanner error={run.error} />
          <div>
            <Button busy={run.busy} disabled={mapping.unitNumber == null || mapping.description == null} onClick={() => void run.run()}>
              Import {sheet.rows.length} rows
            </Button>
          </div>
        </>
      )}
      {result && (
        <Card title="Done">
          <p className="text-ink">
            <strong>{result.created}</strong> added, <strong>{result.updated}</strong> updated
            {result.skipped.length > 0 && <>, <strong className={cx('text-danger')}>{result.skipped.length}</strong> skipped</>}.
          </p>
          {result.skipped.length > 0 && (
            <ul className="mt-2 list-disc pl-6 text-sm text-ink">
              {result.skipped.slice(0, 50).map((s) => (
                <li key={s.row}>
                  Row {s.row}: {s.reason}
                </li>
              ))}
            </ul>
          )}
          <ButtonLink href={paths.equipment()} className="mt-3">
            See the equipment list
          </ButtonLink>
        </Card>
      )}
      {!sheet && (
        <Notice>
          Tip: one row per unit, with a header row. Unit # and Description are required; Make, Model, Year, Serial, Category, Location and PST exempt (yes/no) are picked up if present.
        </Notice>
      )}
    </div>
  );
}
