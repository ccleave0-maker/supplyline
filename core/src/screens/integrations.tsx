'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import {
  DEFAULT_FILING,
  EXPORT_DATASETS,
  FILING_DOC_TYPES,
  IMPORT_DATASETS,
  type ExportDataset,
  type ExportMappingInput,
  type ExportMappingView,
  type FilingSettings,
  type GenericSheetPreview,
  type ImportDataset,
  type ImportResult,
} from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, EmptyState, ErrorBanner, Notice, PageHeader, PageLoading, SelectField, TextField } from '../ui/components';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';
import { ScheduleFields } from './report-builder';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

/** Links between the four data screens. */
function DataTabs({ here }: { here: string }) {
  const { me } = useAuthed();
  const tabs = can(me.user, 'integrations:manage')
    ? ([
        [paths.filingAdmin(), 'Network filing & Sync'],
        [paths.importsAdmin(), 'Import'],
        [paths.exportMappings(), 'Export mappings'],
        [paths.dataExport(), 'Export everything'],
      ] as const)
    : [];
  if (!tabs.length) return null;
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Data tools">
      {tabs.map(([href, label]) => (
        <ButtonLink key={href} href={href} variant={href === here ? 'primary' : 'secondary'}>
          {label}
        </ButtonLink>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Network filing & the Sync app
// ---------------------------------------------------------------------------
export function FilingAdminScreen() {
  const { api, me } = useAuthed();
  const [companyId, setCompanyId] = useState(me.companies[0]?.id ?? '');
  const loaded = useAsync(() => api.filing.settings(companyId), [api, companyId]);
  const [s, setS] = useState<FilingSettings>(DEFAULT_FILING);
  const [show, setShow] = useState<'pending' | 'failed' | 'done'>('pending');
  const jobs = useAsync(() => api.filing.jobs(show), [api, show]);
  const devices = useAsync(() => api.filing.devices(), [api]);
  const [msg, setMsg] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  useEffect(() => {
    if (loaded.data) setS(loaded.data);
  }, [loaded.data]);
  const set = <K extends keyof FilingSettings>(k: K, v: FilingSettings[K]) => setS((x) => ({ ...x, [k]: v }));

  const save = useAction(async () => {
    setS(await api.filing.save(companyId, s));
    setMsg('Saved. New documents will be copied into the folders from now on.');
  });
  const retry = useAction(async () => {
    const r = await api.filing.retry();
    setMsg(`Tried again: ${r.done} filed${r.failed ? `, ${r.failed} still can't be written (see the reason below)` : ''}.`);
    await jobs.reload();
  });
  const addDevice = useAction(async () => {
    const r = await api.filing.addDevice(deviceName);
    setNewKey(r.token);
    setDeviceName('');
    await devices.reload();
  });
  const removeDevice = useAction(async (id: string) => {
    await api.filing.removeDevice(id);
    await devices.reload();
  });
  if (!loaded.data && !loaded.error) return <PageLoading />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Network filing & Sync" subtitle="A copy of every document SupplyLine makes, saved into your own folders by company, job and type." />
      <DataTabs here={paths.filingAdmin()} />
      {me.companies.length > 1 && <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
      <ErrorBanner error={loaded.error || save.error || retry.error} />
      {msg && <Notice>{msg}</Notice>}

      <Card title="Filing">
        <Checkbox label="Save copies into our network folders" description="Off by default. Nothing is moved or deleted — these are extra copies." checked={s.enabled} onChange={(v) => set('enabled', v)} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SelectField
            label="How files get there"
            value={s.mode}
            onChange={(e) => set('mode', e.target.value as FilingSettings['mode'])}
            options={[
              { value: 'DIRECT', label: 'The SupplyLine server writes them (it is on our network)' },
              { value: 'SYNC', label: 'SupplyLine Sync app on one of our PCs' },
            ]}
          />
          <TextField label="Main folder" placeholder="P:\SupplyLine or \\server\share\SupplyLine" value={s.root} onChange={(e) => set('root', e.target.value)} hint={s.mode === 'SYNC' ? 'As that PC sees it.' : 'As the server sees it.'} />
        </div>
        <p className="mt-4 font-semibold text-ink">What to save, and where</p>
        <p className="text-sm text-muted">
          Folders go under the main folder. These are filled in for you: <code>{'{company}'}</code> (company code), <code>{'{job}'}</code> (e.g. “2249 Bridge”), <code>{'{vendor}'}</code>, <code>{'{year}'}</code>, <code>{'{month}'}</code>.
        </p>
        <div className="mt-2 flex flex-col gap-3">
          {FILING_DOC_TYPES.map((d) => (
            <div key={d.key} className="grid gap-2 sm:grid-cols-[16rem_1fr] sm:items-center">
              <Checkbox label={d.label} checked={s.types.includes(d.key)} onChange={(v) => set('types', v ? [...s.types, d.key] : s.types.filter((t) => t !== d.key))} />
              <TextField label="Folder" aria-label={`Folder for ${d.label}`} value={s.folders[d.key] ?? d.folder} disabled={!s.types.includes(d.key)} onChange={(e) => set('folders', { ...s.folders, [d.key]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button busy={save.busy} onClick={() => void save.run()}>
            Save
          </Button>
          <Button variant="secondary" onClick={() => setS({ ...s, folders: DEFAULT_FILING.folders })}>
            Reset folder names
          </Button>
        </div>
      </Card>

      <Card
        title="Copies"
        actions={
          <Button variant="secondary" busy={retry.busy} onClick={() => void retry.run()}>
            Try again now
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {(['pending', 'failed', 'done'] as const).map((k) => (
            <Button key={k} variant={show === k ? 'primary' : 'secondary'} onClick={() => setShow(k)}>
              {k === 'pending' ? 'Waiting' : k === 'failed' ? 'Failed' : 'Done'}
            </Button>
          ))}
        </div>
        <ErrorBanner error={jobs.error} />
        {jobs.data && jobs.data.length === 0 && <EmptyState title={show === 'pending' ? 'Nothing waiting' : show === 'failed' ? 'Nothing failed' : 'Nothing filed yet'} />}
        <ul className="flex flex-col divide-y divide-line">
          {(jobs.data ?? []).map((j) => (
            <li key={j.id} className="py-2">
              <p className="break-all text-ink">{j.relativePath.replaceAll('/', '\\')}</p>
              <p className="text-sm text-muted">
                {FILING_DOC_TYPES.find((d) => d.key === j.docType)?.label ?? j.docType} · {j.mode === 'SYNC' ? 'Sync app' : 'server'} · {j.deliveredAt ? `filed ${when(j.deliveredAt)}` : `queued ${when(j.createdAt)}`}
                {j.attempts > 0 && !j.deliveredAt ? ` · ${j.attempts} tries` : ''}
              </p>
              {j.error && <p className="text-sm text-danger">{j.error}</p>}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Sync app PCs">
        <p className="text-sm text-muted">
          When SupplyLine runs online it can’t reach your shared drives. Install the SupplyLine Sync app on a PC that can (it needs Node.js 22) — it files these copies and looks after the AP inbox folders. Setup steps are in its README.
        </p>
        <ErrorBanner error={devices.error || addDevice.error || removeDevice.error} />
        {newKey && (
          <div className="mt-3 rounded-lg border border-brand p-3">
            <p className="font-semibold text-ink">Copy this key into sync.config.json on that PC now — it won’t be shown again.</p>
            <p className="mt-1 select-all break-all font-mono text-sm text-ink">{newKey}</p>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(newKey)}>
                Copy
              </Button>
              <Button variant="ghost" onClick={() => setNewKey(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {(devices.data ?? []).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="text-ink">
                  {d.name} {d.revoked && <Badge tone="danger">Removed</Badge>}
                </p>
                <p className="text-sm text-muted">
                  Last seen {when(d.lastSeenAt)}
                  {d.lastVersion ? ` · ${d.lastVersion}` : ''}
                </p>
              </div>
              {!d.revoked && (
                <Button variant="ghost" busy={removeDevice.busy} onClick={() => void removeDevice.run(d.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextField label="Add a PC" placeholder="e.g. Office server" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          <Button busy={addDevice.busy} disabled={!deviceName.trim()} onClick={() => void addDevice.run()}>
            Make a key
          </Button>
        </div>
      </Card>
      <Notice>The AP inbox, review, approved, rejected and on-hold folders are set per company in AP & billing settings. With the Sync app, it watches those folders too.</Notice>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import tools
// ---------------------------------------------------------------------------
export function ImportsScreen() {
  const platform = usePlatform();
  const { api, me } = useAuthed();
  const [dataset, setDataset] = useState<ImportDataset>('jobs');
  const [companyId, setCompanyId] = useState(me.user.companyId ?? me.companies[0]?.id ?? '');
  const [sheet, setSheet] = useState<GenericSheetPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | undefined>>({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fields = IMPORT_DATASETS[dataset].fields;
  const read = useAction(async () => {
    const f = (await platform.files.pickFiles({ accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))[0];
    if (!f) return;
    setResult(null);
    const p = await api.imports.preview(dataset, f.blob, f.name);
    setSheet(p);
    setMapping(p.suggested);
  });
  const run = useAction(async () => {
    if (!sheet) return;
    const m = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v != null)) as Record<string, number>;
    setResult(await api.imports.run({ dataset, companyId, headers: sheet.headers, rows: sheet.rows, mapping: m, updateExisting }));
  });
  const columns = useMemo(() => (sheet?.headers ?? []).map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })), [sheet]);
  const mapped = fields.filter((f) => mapping[f.key] != null);
  const missing = fields.filter((f) => 'required' in f && f.required && mapping[f.key] == null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Import from a spreadsheet" subtitle="Bring in jobs, contacts, cost codes, customers or people from Excel (.xlsx) or CSV. Re-import an updated list any time." />
      <DataTabs here={paths.importsAdmin()} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="What are you importing?"
            value={dataset}
            onChange={(e) => {
              setDataset(e.target.value as ImportDataset);
              setSheet(null);
              setResult(null);
            }}
            options={(Object.keys(IMPORT_DATASETS) as ImportDataset[]).map((k) => ({ value: k, label: IMPORT_DATASETS[k].label }))}
          />
          {me.companies.length > 1 && <SelectField label="Into company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
        </div>
        <Button className="mt-3" busy={read.busy} onClick={() => void read.run()}>
          {sheet ? 'Choose a different file' : 'Choose the file'}
        </Button>
      </Card>
      <ErrorBanner error={read.error} />
      {sheet && (
        <>
          <Card title={`Match the columns — ${sheet.fileName} (${sheet.rows.length} rows)`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
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
            {dataset === 'people' && <p className="mt-2 text-sm text-muted">Each person gets an invitation email. Roles can be site, yard, procurement, AP or admin (several with commas); blank means site.</p>}
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
                  {sheet.rows.slice(0, 5).map((r, i) => (
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
          {dataset !== 'people' && <Checkbox label="Update ones that are already there" description="Untick to only add new ones." checked={updateExisting} onChange={setUpdateExisting} />}
          <ErrorBanner error={run.error} />
          <div>
            <Button busy={run.busy} disabled={missing.length > 0} onClick={() => void run.run()}>
              Import {sheet.rows.length} rows
            </Button>
            {missing.length > 0 && <p className="mt-1 text-sm text-muted">Choose the column for: {missing.map((f) => f.label).join(', ')}</p>}
          </div>
        </>
      )}
      {result && (
        <Card title="Done">
          <p className="text-ink">
            <strong>{result.created}</strong> added, <strong>{result.updated}</strong> updated
            {result.skipped.length > 0 && <>, <strong className="text-danger">{result.skipped.length}</strong> skipped</>}.
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
        </Card>
      )}
      {!sheet && <Notice>One row per item with a header row. Columns are matched by their names where we can; you can change any of them before importing. Equipment has its own import on the Equipment page.</Notice>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export mappings (Sage Intacct and other systems)
// ---------------------------------------------------------------------------
const blankMapping = (dataset: ExportDataset = 'PO_LINES'): ExportMappingInput => ({
  name: '',
  target: 'generic',
  schedule: null,
  recipients: [],
  fileToNetwork: false,
  dataset,
  companyId: null,
  format: 'csv',
  dateFormat: 'YYYY-MM-DD',
  columns: EXPORT_DATASETS[dataset].fields.map(([field, header]) => ({ field, header })),
});

export function ExportMappingsScreen() {
  const platform = usePlatform();
  const { api, me } = useAuthed();
  const list = useAsync(() => api.exportMappings.list(), [api]);
  const [editing, setEditing] = useState<{ id: string | null; m: ExportMappingInput } | null>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [msg, setMsg] = useState('');
  const canEdit = can(me.user, 'integrations:manage');

  const save = useAction(async () => {
    if (!editing) return;
    const m = editing.id ? await api.exportMappings.update(editing.id, editing.m) : await api.exportMappings.create(editing.m);
    setEditing(null);
    setMsg(`Saved “${m.name}”.`);
    await list.reload();
  });
  const remove = useAction(async (m: ExportMappingView) => {
    await api.exportMappings.remove(m.id);
    await list.reload();
  });
  const run = useAction(async (m: ExportMappingView) => {
    const blob = await api.exportMappings.run(m.id, from, to);
    const safe = m.name.replace(/[^\w\- ]+/g, ' ').trim().replace(/\s+/g, '-') || 'export';
    await platform.files.saveFile(`${safe}-${from}-to-${to}.${m.format}`, blob);
  });
  const setM = (patch: Partial<ExportMappingInput>) => setEditing((e) => (e ? { ...e, m: { ...e.m, ...patch } } : e));
  const cols = editing?.m.columns ?? [];
  const setCol = (i: number, patch: Partial<ExportMappingInput['columns'][number]>) => setM({ columns: cols.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...cols];
    const [c] = next.splice(i, 1);
    next.splice(i + d, 0, c!);
    setM({ columns: next });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Export mappings" subtitle="Set the columns, names and order your accounting system wants (e.g. Sage Intacct) once, then export any date range." />
      <DataTabs here={paths.exportMappings()} />
      <ErrorBanner error={list.error || remove.error || run.error} />
      {msg && <Notice>{msg}</Notice>}

      {!editing && (
        <Card
          title="Saved exports"
          actions={
            canEdit && (
              <Button variant="secondary" onClick={() => setEditing({ id: null, m: blankMapping() })}>
                + New export
              </Button>
            )
          }
        >
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {list.data && list.data.length === 0 && <EmptyState title="No exports set up yet">{canEdit ? 'Make one with “New export”.' : 'An admin can set these up.'}</EmptyState>}
          <ul className="flex flex-col divide-y divide-line">
            {(list.data ?? []).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-ink">{m.name}</p>
                  <p className="text-sm text-muted">
                    {EXPORT_DATASETS[m.dataset].label} · {m.columns.length} columns · {m.format.toUpperCase()} · dates {m.dateFormat}
                    {m.companyId ? ` · ${me.companies.find((c) => c.id === m.companyId)?.name ?? ''}` : ' · all companies'}
                    {m.schedule ? ` · runs ${m.schedule.frequency.toLowerCase()}${m.recipients.length ? ` to ${m.recipients.length} people` : ''}${m.fileToNetwork ? ', filed to the network folder' : ''}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button busy={run.busy} onClick={() => void run.run(m)}>
                    Export
                  </Button>
                  {canEdit && (
                    <>
                      <Button variant="secondary" onClick={() => setEditing({ id: m.id, m: { name: m.name, target: m.target, dataset: m.dataset, companyId: m.companyId ?? null, format: m.format, dateFormat: m.dateFormat, columns: m.columns, schedule: m.schedule ?? null, recipients: m.recipients, fileToNetwork: m.fileToNetwork } })}>
                        Edit
                      </Button>
                      <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run(m)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <Card title={editing.id ? 'Edit export' : 'New export'}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Name" placeholder="e.g. Sage Intacct – AP bills" value={editing.m.name} onChange={(e) => setM({ name: e.target.value })} />
            <TextField label="For (system)" placeholder="e.g. sage-intacct" value={editing.m.target} onChange={(e) => setM({ target: e.target.value })} />
            <SelectField
              label="What to export"
              value={editing.m.dataset}
              onChange={(e) => {
                const d = e.target.value as ExportDataset;
                setM({ dataset: d, columns: blankMapping(d).columns });
              }}
              options={(Object.keys(EXPORT_DATASETS) as ExportDataset[]).map((k) => ({ value: k, label: EXPORT_DATASETS[k].label }))}
            />
            <SelectField label="Company" value={editing.m.companyId ?? ''} onChange={(e) => setM({ companyId: e.target.value || null })} options={[{ value: '', label: 'All companies' }, ...me.companies.map((c) => ({ value: c.id, label: c.name }))]} />
            <SelectField label="File type" value={editing.m.format} onChange={(e) => setM({ format: e.target.value as 'csv' })} options={[{ value: 'csv', label: 'CSV' }, { value: 'xlsx', label: 'Excel (.xlsx)' }]} />
            <SelectField label="Dates as" value={editing.m.dateFormat} onChange={(e) => setM({ dateFormat: e.target.value as 'YYYY-MM-DD' })} options={['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'].map((f) => ({ value: f, label: f }))} />
          </div>
          <p className="mt-4 font-semibold text-ink">Columns (in order)</p>
          <p className="text-sm text-muted">Rename each column to what the other system expects. “Fixed value” puts the same text in every row (e.g. CAD).</p>
          <div className="mt-2 flex flex-col gap-2">
            {cols.map((c, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                <SelectField
                  label="From"
                  value={c.field}
                  onChange={(e) => setCol(i, { field: e.target.value, fixed: e.target.value === 'fixed' ? (c.fixed ?? '') : undefined })}
                  options={[...EXPORT_DATASETS[editing.m.dataset].fields.map(([f, l]) => ({ value: f as string, label: l as string })), { value: 'fixed', label: 'Fixed value' }]}
                />
                <TextField label="Column name" value={c.header} onChange={(e) => setCol(i, { header: e.target.value })} />
                {c.field === 'fixed' ? <TextField label="Value" value={c.fixed ?? ''} onChange={(e) => setCol(i, { fixed: e.target.value })} /> : <span />}
                <div className="flex gap-1">
                  <Button variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </Button>
                  <Button variant="ghost" aria-label="Move down" disabled={i === cols.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </Button>
                  <Button variant="ghost" aria-label="Remove column" onClick={() => setM({ columns: cols.filter((_, j) => j !== i) })}>
                    ✕
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="secondary" className="mt-2" onClick={() => setM({ columns: [...cols, { field: 'fixed', header: 'NEW COLUMN', fixed: '' }] })}>
            + Add a column
          </Button>
          <ScheduleFields value={editing.m.schedule} onChange={(schedule) => setM({ schedule })} recipients={editing.m.recipients} onRecipients={(recipients) => setM({ recipients })} />
          {editing.m.schedule && <Checkbox label="Also file it to the network folder (Exports)" description="Each run covers the last full week (or month, or 7 days for daily)." checked={editing.m.fileToNetwork} onChange={(fileToNetwork) => setM({ fileToNetwork })} />}
          <ErrorBanner error={save.error} />
          <div className="mt-4 flex gap-2">
            <Button busy={save.busy} disabled={!editing.m.name.trim() || cols.length === 0} onClick={() => void save.run()}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
      <Notice>A ready-made Sage Intacct layout will be added once we have your company’s import template. Until then, set the column names here to match it.</Notice>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export everything
// ---------------------------------------------------------------------------
export function DataExportScreen() {
  const platform = usePlatform();
  const { api } = useAuthed();
  const [includeFiles, setIncludeFiles] = useState(true);
  const [done, setDone] = useState('');
  const run = useAction(async () => {
    const blob = await api.dataExport(includeFiles);
    await platform.files.saveFile(`SupplyLine-export-${today()}.zip`, blob);
    setDone(`Saved (${(blob.size / 1_048_576).toFixed(1)} MB).`);
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Export everything" subtitle="All of your organization’s SupplyLine data in one ZIP file — yours to keep or move to another system." />
      <DataTabs here={paths.dataExport()} />
      <Card>
        <ul className="list-disc pl-6 text-ink">
          <li>Every table (jobs, order lists, POs, BOLs, inventory, AP/AR, contacts, people, history…) as JSON files that link together by id.</li>
          <li>Uploaded and generated files (PDFs, photos, invoices) by kind, if you include them. Very large libraries are capped at 300 MB per export; the rest are listed in the ZIP.</li>
          <li>Never included: sign-in codes, sessions, mailbox/storage connections and stored API keys.</li>
        </ul>
        <div className="mt-3">
          <Checkbox label="Include the files" description="Bigger and slower. Untick for the data only." checked={includeFiles} onChange={setIncludeFiles} />
        </div>
        <ErrorBanner error={run.error} />
        {done && <Notice>{done}</Notice>}
        <Button className="mt-3" busy={run.busy} onClick={() => void run.run()}>
          Make the ZIP
        </Button>
      </Card>
    </div>
  );
}
