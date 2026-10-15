'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { formatCad } from '../domain/inventory';
import { DEFAULT_NOTIFY_EVENTS, NOTIFY_EVENTS } from '../domain/notify';
import {
  COMPLIANCE_KIND_LABELS,
  COMPLIANCE_KINDS,
  COMPLIANCE_STATE_LABELS,
  QC_DOC_TYPE_LABELS,
  QC_DOC_TYPES,
  RENTAL_RATE_LABELS,
  RENTAL_RATE_PER,
  SUBCONTRACT_DOC_TYPES,
  type ComplianceInput,
  type ComplianceState,
  type ComplianceSummary,
  type NotifyRuleView,
  type QcDocType,
  type RentalInput,
  type RentalItem,
  type RentalRatePer,
  type SiteDetail,
  type StoredFile,
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
  Notice,
  PageHeader,
  PageLoading,
  PhoneLink,
  SelectField,
  TextArea,
  TextField,
} from '../ui/components';
import { useAction, useAsync, useDebounced } from '../ui/hooks';
import { useAuthed } from '../ui/session';
import { ExportButtons } from '../ui/export';

const dayLabel = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const stateTone = (s: ComplianceState) => (s === 'OK' ? 'ok' : s === 'EXPIRING' ? 'neutral' : 'danger');

/** Opens a stored file (signed link to the server). */
function FileLink({ file, className }: { file: StoredFile; className?: string }) {
  const { api } = useAuthed();
  return (
    <a href={api.fileUrl(file.url)!} target="_blank" rel="noreferrer" className={cx('font-semibold break-all text-brand-ink underline-offset-2 hover:underline', className)}>
      📄 {file.fileName}
    </a>
  );
}

/** Pick one document (PDF, photo, Word…). */
function usePickDoc() {
  const platform = usePlatform();
  return async () => (await platform.files.pickFiles({ accept: 'application/pdf,image/*,.doc,.docx,.xls,.xlsx' }))[0] ?? null;
}

function JobHeader({ siteId, title }: { siteId: string; title: string }) {
  const { api } = useAuthed();
  const site = useAsync(() => api.sites.get(siteId), [api, siteId]);
  return (
    <PageHeader back={paths.site(siteId)} title={title} subtitle={site.data ? `JOB#${site.data.jobNumber} · ${site.data.name}` : undefined} />
  );
}

// ---------------------------------------------------------------------------
// Project card on the job page
// ---------------------------------------------------------------------------
export function ProjectCard({ site, onChanged }: { site: SiteDetail; onChanged: () => void }) {
  const { api, me } = useAuthed();
  const pick = usePickDoc();
  const upload = useAction(async () => {
    const f = await pick();
    if (!f) return;
    await api.sites.setPstForm(site.id, f.blob, f.name);
    onChanged();
  });
  const remove = useAction(async () => {
    await api.sites.removePstForm(site.id);
    onChanged();
  });
  const pm = site.projectManager;
  const tile = (href: string, label: string, count: string) => (
    <ButtonLink href={href} variant="secondary" className="flex-col !items-start py-2">
      <span>{label}</span>
      <span className="text-sm font-normal text-muted">{count}</span>
    </ButtonLink>
  );
  return (
    <Card title="Project" actions={site.canEdit && <ButtonLink href={paths.siteEdit(site.id)} variant="ghost">Edit</ButtonLink>}>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">Project manager</dt>
          <dd className="text-ink">
            {pm ? (
              <>
                <span className="font-semibold">{pm.name}</span>
                <span className="flex flex-wrap gap-x-4">
                  <PhoneLink number={pm.phone} />
                  <EmailLink email={pm.email} />
                </span>
              </>
            ) : (
              'Not set'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Client / owner</dt>
          <dd className="text-ink">{site.clientName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Start date</dt>
          <dd className="text-ink">{dayLabel(site.startDate)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Tax</dt>
          <dd className="text-ink">
            {site.taxLabel}
            {site.pstExempt && site.pstExemptNumber && <span className="text-muted"> · #{site.pstExemptNumber}</span>}
          </dd>
        </div>
      </dl>
      {site.pstExempt && (
        <div className="mt-3 rounded-lg bg-surface-2 p-3">
          <p className="mb-2 text-sm font-semibold text-ink">PST exemption form (attached to every PO for this job)</p>
          {site.pstExemptionFile ? <FileLink file={site.pstExemptionFile} /> : <p className="text-danger">No form uploaded yet.</p>}
          {site.canEdit && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" busy={upload.busy} onClick={() => void upload.run()}>
                {site.pstExemptionFile ? 'Replace form' : 'Upload form'}
              </Button>
              {site.pstExemptionFile && (
                <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run()}>
                  Remove
                </Button>
              )}
            </div>
          )}
          <ErrorBanner error={upload.error || remove.error} />
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tile(paths.siteRentals(site.id), 'Rentals', `${site.counts.rentalsOnRent} on rent`)}
        {tile(paths.siteQc(site.id), 'QC / MTRs', `${site.counts.qcDocs} document${site.counts.qcDocs === 1 ? '' : 's'}`)}
        {site.canSeeSubcontracts && tile(paths.siteSubcontracts(site.id), 'Subcontracts', `${site.counts.subcontractDocs} document${site.counts.subcontractDocs === 1 ? '' : 's'}`)}
        {tile(paths.equipment(site.id), 'Equipment', 'on this job')}
      </div>
      {can(me.user, 'compliance:edit') && (
        <p className="mt-3 text-sm">
          <Link href={paths.compliance()} className="font-semibold text-brand-ink">
            Vendor & subcontractor WCB / insurance ›
          </Link>
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rentals
// ---------------------------------------------------------------------------
const blankRental: RentalInput = { description: '', unitNumber: '', contactId: null, onRentDate: '', expectedOffDate: '', offRentDate: '', rate: null, ratePer: 'DAY', poNumber: '', insured: false, insuranceNotes: '', maintenanceNotes: '', notes: '' };

function RentalForm({ initial, onSave, onCancel, busy, error }: { initial: RentalInput; onSave: (r: RentalInput) => void; onCancel: () => void; busy: boolean; error: unknown }) {
  const { api } = useAuthed();
  const companies = useAsync(() => api.contacts.list({ type: 'RENTAL' }), [api]);
  const [f, setF] = useState<RentalInput>(initial);
  const [rate, setRate] = useState(initial.rate == null ? '' : String(initial.rate));
  const set = <K extends keyof RentalInput>(k: K, v: RentalInput[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...f, rate: rate.trim() ? Number(rate) : null });
      }}
    >
      <ErrorBanner error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="What's rented" required value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Light tower, 6” pump" />
        <TextField label="Unit # (theirs)" value={f.unitNumber ?? ''} onChange={(e) => set('unitNumber', e.target.value)} />
        <SelectField
          label="Rental company"
          placeholder="Choose (add them under Contacts as “Rental company”)"
          value={f.contactId ?? ''}
          onChange={(e) => set('contactId', e.target.value || null)}
          options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.businessName ? `${c.businessName} — ${c.name}` : c.name }))}
        />
        <TextField label="PO #" value={f.poNumber ?? ''} onChange={(e) => set('poNumber', e.target.value)} />
        <TextField label="On rent" type="date" value={f.onRentDate ?? ''} onChange={(e) => set('onRentDate', e.target.value)} />
        <TextField label="Expected off rent" type="date" value={f.expectedOffDate ?? ''} onChange={(e) => set('expectedOffDate', e.target.value)} />
        <TextField label="Off rent (returned)" type="date" value={f.offRentDate ?? ''} onChange={(e) => set('offRentDate', e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Rate ($)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          <SelectField label="Per" value={f.ratePer ?? 'DAY'} onChange={(e) => set('ratePer', e.target.value as RentalRatePer)} options={RENTAL_RATE_PER.map((p) => ({ value: p, label: RENTAL_RATE_LABELS[p] }))} />
        </div>
        <div className="sm:col-span-2">
          <Checkbox label="Insured" description="Covered by our insurance or the rental company's — attach the certificate below after saving." checked={!!f.insured} onChange={(v) => set('insured', v)} />
        </div>
        <TextArea label="Insurance details" value={f.insuranceNotes ?? ''} onChange={(e) => set('insuranceNotes', e.target.value)} />
        <TextArea label="Maintenance (service, hours, who to call)" value={f.maintenanceNotes ?? ''} onChange={(e) => set('maintenanceNotes', e.target.value)} />
        <div className="sm:col-span-2">
          <TextArea label="Notes" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" busy={busy}>
          Save rental
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RentalCard({ r, onChanged }: { r: RentalItem; onChanged: () => void }) {
  const { api, me } = useAuthed();
  const pick = usePickDoc();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const editable = can(me.user, 'rental:edit');
  const save = useAction(async (input: RentalInput) => {
    await api.rentals.update(r.id, input);
    setEditing(false);
    onChanged();
  });
  const addFile = useAction(async () => {
    const f = await pick();
    if (!f) return;
    await api.rentals.addFile(r.id, f.blob, f.name);
    onChanged();
  });
  const offRent = useAction(async () => {
    await api.rentals.update(r.id, { offRentDate: new Date().toLocaleDateString('en-CA') });
    onChanged();
  });
  const remove = useAction(async () => {
    await api.rentals.remove(r.id);
    onChanged();
  });
  if (editing)
    return (
      <Card title={`Edit: ${r.description}`}>
        <RentalForm
          initial={{ ...r, contactId: r.company?.id ?? null, onRentDate: r.onRentDate ?? '', expectedOffDate: r.expectedOffDate ?? '', offRentDate: r.offRentDate ?? '' }}
          onSave={(x) => void save.run(x)}
          onCancel={() => setEditing(false)}
          busy={save.busy}
          error={save.error}
        />
      </Card>
    );
  return (
    <Card
      className={cx(r.overdue && 'border-danger')}
      title={
        <>
          {r.description}
          {r.unitNumber && <span className="text-muted"> · #{r.unitNumber}</span>}
        </>
      }
      actions={
        <>
          {r.onRent ? <Badge tone={r.overdue ? 'danger' : 'brand'}>{r.overdue ? 'Past off-rent date' : 'On rent'}</Badge> : <Badge>Returned</Badge>}
          <Badge tone={r.insured ? 'ok' : 'danger'}>{r.insured ? 'Insured' : 'Not insured'}</Badge>
        </>
      }
    >
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted">Rental company</dt>
          <dd className="text-ink">
            {r.company ? (
              <>
                {r.company.businessName ?? r.company.name}
                {r.company.businessName && <span className="text-muted"> — {r.company.name}</span>}
                <span className="flex flex-wrap gap-x-4">
                  <PhoneLink number={r.company.cell ?? r.company.phone} />
                  <EmailLink email={r.company.email} />
                </span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Dates</dt>
          <dd className="text-ink">
            {dayLabel(r.onRentDate)} → {r.offRentDate ? dayLabel(r.offRentDate) : `due back ${dayLabel(r.expectedOffDate)}`}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Rate / PO</dt>
          <dd className="text-ink">
            {r.rate != null ? `${formatCad(r.rate)} ${r.ratePer ? RENTAL_RATE_LABELS[r.ratePer] : ''}` : '—'}
            {r.poNumber && ` · PO ${r.poNumber}`}
          </dd>
        </div>
      </dl>
      {r.insuranceNotes && <p className="mt-2 text-ink"><strong>Insurance:</strong> {r.insuranceNotes}</p>}
      {r.maintenanceNotes && <p className="mt-1 text-ink"><strong>Maintenance:</strong> {r.maintenanceNotes}</p>}
      {r.notes && <p className="mt-1 whitespace-pre-wrap text-muted">{r.notes}</p>}
      {r.files.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {r.files.map((f) => (
            <li key={f.id}>
              <FileLink file={f} />
            </li>
          ))}
        </ul>
      )}
      <ErrorBanner error={addFile.error || offRent.error || remove.error} />
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button variant="secondary" busy={addFile.busy} onClick={() => void addFile.run()}>
            Attach insurance / document
          </Button>
          {r.onRent && (
            <Button variant="secondary" busy={offRent.busy} onClick={() => void offRent.run()}>
              Mark off rent today
            </Button>
          )}
          {confirm ? (
            <Button variant="danger" busy={remove.busy} onClick={() => void remove.run()}>
              Yes, delete
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              Delete
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export function SiteRentalsScreen() {
  const id = useSearchParams().get('id') ?? '';
  const { api, me } = useAuthed();
  const rentals = useAsync(() => api.sites.rentals(id), [api, id]);
  const [adding, setAdding] = useState(false);
  const [showReturned, setShowReturned] = useState(false);
  const add = useAction(async (input: RentalInput) => {
    await api.sites.addRental(id, input);
    setAdding(false);
    await rentals.reload();
  });
  const list = (rentals.data ?? []).filter((r) => showReturned || r.onRent);
  return (
    <div className="flex flex-col gap-4">
      <JobHeader siteId={id} title="Rentals" />
      <div className="flex flex-wrap items-center gap-3">
        {can(me.user, 'rental:edit') && !adding && <Button onClick={() => setAdding(true)}>+ Add rental</Button>}
        <Checkbox label="Show returned" checked={showReturned} onChange={setShowReturned} />
      </div>
      {adding && (
        <Card title="New rental">
          <RentalForm initial={blankRental} onSave={(x) => void add.run(x)} onCancel={() => setAdding(false)} busy={add.busy} error={add.error} />
        </Card>
      )}
      <ErrorBanner error={rentals.error} onRetry={rentals.reload} />
      {list.length > 0 && (
        <ExportButtons
          title="Rentals"
          columns={[
            { key: 'desc', label: 'What', width: 2 },
            { key: 'unit', label: 'Unit #', width: 0.8 },
            { key: 'company', label: 'Rental company', width: 1.6 },
            { key: 'phone', label: 'Phone' },
            { key: 'on', label: 'On rent' },
            { key: 'due', label: 'Due off' },
            { key: 'off', label: 'Off rent' },
            { key: 'rate', label: 'Rate', align: 'right' },
            { key: 'po', label: 'PO #' },
            { key: 'ins', label: 'Insured', width: 0.6 },
          ]}
          rows={list.map((r) => ({
            desc: r.description,
            unit: r.unitNumber,
            company: r.company?.businessName ?? r.company?.name ?? '',
            phone: r.company?.cell ?? r.company?.phone ?? '',
            on: r.onRentDate,
            due: r.expectedOffDate,
            off: r.offRentDate,
            rate: r.rate == null ? '' : `${r.rate} ${r.ratePer ? RENTAL_RATE_LABELS[r.ratePer] : ''}`,
            po: r.poNumber,
            ins: r.insured ? 'Yes' : 'No',
          }))}
        />
      )}
      {rentals.loading && !rentals.data ? <PageLoading /> : list.length ? list.map((r) => <RentalCard key={r.id} r={r} onChanged={rentals.reload} />) : <EmptyState title="Nothing on rent" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// QC documents (MTRs, certificates)
// ---------------------------------------------------------------------------
export function SiteQcScreen() {
  const id = useSearchParams().get('id') ?? '';
  const { api, me } = useAuthed();
  const pick = usePickDoc();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const docs = useAsync(() => api.sites.qcDocs(id, search || undefined), [api, id, search]);
  const inv = useAsync(() => api.siteInventory(id), [api, id]);
  const [form, setForm] = useState<{ type: QcDocType; title: string; heatNumber: string; poNumber: string; vendorName: string; lines: string[] } | null>(null);
  const [file, setFile] = useState<{ blob: Blob; name: string } | null>(null);
  const [lineFilter, setLineFilter] = useState('');
  const choose = useAction(async () => {
    const f = await pick();
    if (f) {
      setFile({ blob: f.blob, name: f.name });
      setForm((x) => x ?? { type: 'MTR', title: f.name.replace(/\.[^.]+$/, ''), heatNumber: '', poNumber: '', vendorName: '', lines: [] });
    }
  });
  const save = useAction(async () => {
    if (!form || !file) throw new Error('Choose the file first.');
    await api.sites.uploadQcDoc(id, { type: form.type, title: form.title, heatNumber: form.heatNumber, poNumber: form.poNumber, vendorName: form.vendorName, orderLineIds: form.lines }, file.blob, file.name);
    setForm(null);
    setFile(null);
    await docs.reload();
  });
  const remove = useAction(async (docId: string) => {
    await api.qc.remove(docId);
    await docs.reload();
  });
  const lines = (inv.data ?? []).filter((l) => !lineFilter.trim() || `${l.orderLabel} ${l.description}`.toLowerCase().includes(lineFilter.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      <JobHeader siteId={id} title="QC / MTRs" />
      {can(me.user, 'qc:upload') && !form && (
        <div>
          <Button busy={choose.busy} onClick={() => void choose.run()}>
            + Upload MTR / certificate
          </Button>
        </div>
      )}
      {form && (
        <Card title={`Upload ${file?.name ?? ''}`}>
          <ErrorBanner error={save.error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as QcDocType })} options={QC_DOC_TYPES.map((t) => ({ value: t, label: QC_DOC_TYPE_LABELS[t] }))} />
            <TextField label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <TextField label="Heat # (MTRs)" value={form.heatNumber} onChange={(e) => setForm({ ...form, heatNumber: e.target.value })} />
            <TextField label="PO #" value={form.poNumber} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} />
            <TextField label="Vendor / mill" value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} />
          </div>
          <fieldset className="mt-3">
            <legend className="font-semibold text-ink">Which lines does it cover? (optional)</legend>
            <TextField label="Filter lines" type="search" value={lineFilter} onChange={(e) => setLineFilter(e.target.value)} />
            <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-line p-2">
              {lines.map((l) => (
                <Checkbox
                  key={l.orderLineId}
                  label={`${l.orderLabel} L${l.lineNo} — ${l.description}`}
                  checked={form.lines.includes(l.orderLineId)}
                  onChange={(v) => setForm({ ...form, lines: v ? [...form.lines, l.orderLineId] : form.lines.filter((x) => x !== l.orderLineId) })}
                />
              ))}
              {!lines.length && <p className="text-muted">No lines on this job yet.</p>}
            </div>
          </fieldset>
          <div className="mt-3 flex gap-2">
            <Button busy={save.busy} onClick={() => void save.run()}>
              Save document
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setForm(null);
                setFile(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}
      <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Heat #, PO #, vendor, title or item" />
      <ErrorBanner error={docs.error || remove.error} onRetry={docs.reload} />
      {(docs.data?.length ?? 0) > 0 && (
        <ExportButtons
          title="QC documents"
          columns={[
            { key: 'title', label: 'Title', width: 2 },
            { key: 'type', label: 'Type' },
            { key: 'heat', label: 'Heat #' },
            { key: 'po', label: 'PO #' },
            { key: 'vendor', label: 'Vendor / mill' },
            { key: 'lines', label: 'Covers', width: 3 },
            { key: 'date', label: 'Uploaded' },
          ]}
          rows={(docs.data ?? []).map((d) => ({ title: d.title, type: QC_DOC_TYPE_LABELS[d.type], heat: d.heatNumber, po: d.poNumber, vendor: d.vendorName, lines: d.lines.map((l) => `${l.label} ${l.description}`).join('; '), date: d.createdAt.slice(0, 10) }))}
        />
      )}
      {docs.loading && !docs.data ? (
        <PageLoading />
      ) : docs.data?.length ? (
        <ul className="flex flex-col gap-2">
          {docs.data.map((d) => (
            <li key={d.id} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span>
                  <span className="block font-bold text-ink">{d.title}</span>
                  <span className="block text-sm text-muted">
                    {QC_DOC_TYPE_LABELS[d.type]}
                    {d.heatNumber && ` · Heat ${d.heatNumber}`}
                    {d.poNumber && ` · PO ${d.poNumber}`}
                    {d.vendorName && ` · ${d.vendorName}`}
                  </span>
                </span>
                {can(me.user, 'qc:upload') && (
                  <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run(d.id)}>
                    Delete
                  </Button>
                )}
              </div>
              <FileLink file={d.file} />
              {d.lines.length > 0 && <p className="mt-1 text-sm text-ink">Covers: {d.lines.map((l) => `${l.label} ${l.description}`).join(' · ')}</p>}
              <p className="text-sm text-muted">
                Uploaded {new Date(d.createdAt).toLocaleDateString('en-CA')}
                {d.uploadedByName && ` by ${d.uploadedByName}`}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={search ? 'Nothing matches' : 'No QC documents yet'} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcontracts
// ---------------------------------------------------------------------------
export function SiteSubcontractsScreen() {
  const id = useSearchParams().get('id') ?? '';
  const { api } = useAuthed();
  const pick = usePickDoc();
  const docs = useAsync(() => api.sites.subcontracts(id), [api, id]);
  const subs = useAsync(() => api.contacts.list({ type: 'SUBCONTRACTOR' }), [api]);
  const [form, setForm] = useState<{ subcontractor: string; contactId: string; docType: string; title: string; effectiveDate: string } | null>(null);
  const [file, setFile] = useState<{ blob: Blob; name: string } | null>(null);
  const choose = useAction(async () => {
    const f = await pick();
    if (f) {
      setFile({ blob: f.blob, name: f.name });
      setForm((x) => x ?? { subcontractor: '', contactId: '', docType: SUBCONTRACT_DOC_TYPES[0], title: f.name.replace(/\.[^.]+$/, ''), effectiveDate: '' });
    }
  });
  const save = useAction(async () => {
    if (!form || !file) throw new Error('Choose the file first.');
    await api.sites.uploadSubcontract(id, { ...form, contactId: form.contactId || null }, file.blob, file.name);
    setForm(null);
    setFile(null);
    await docs.reload();
  });
  const remove = useAction(async (docId: string) => {
    await api.subcontracts.remove(docId);
    await docs.reload();
  });
  const groups = new Map<string, NonNullable<typeof docs.data>>();
  for (const d of docs.data ?? []) groups.set(d.subcontractor, [...(groups.get(d.subcontractor) ?? []), d]);

  return (
    <div className="flex flex-col gap-4">
      <JobHeader siteId={id} title="Subcontracts" />
      <ErrorBanner error={docs.error} onRetry={docs.reload} />
      {!docs.error && !form && (
        <div>
          <Button busy={choose.busy} onClick={() => void choose.run()}>
            + Upload subcontract document
          </Button>
        </div>
      )}
      {form && (
        <Card title={`Upload ${file?.name ?? ''}`}>
          <ErrorBanner error={save.error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Subcontractor (from contacts)"
              placeholder="Not in contacts — type the name instead"
              value={form.contactId}
              onChange={(e) => {
                const c = subs.data?.find((x) => x.id === e.target.value);
                setForm({ ...form, contactId: e.target.value, subcontractor: c ? (c.businessName ?? c.name) : form.subcontractor });
              }}
              options={(subs.data ?? []).map((c) => ({ value: c.id, label: c.businessName ?? c.name }))}
            />
            <TextField label="Subcontractor name" required value={form.subcontractor} onChange={(e) => setForm({ ...form, subcontractor: e.target.value })} />
            <SelectField label="Document type" value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })} options={SUBCONTRACT_DOC_TYPES.map((t) => ({ value: t, label: t }))} />
            <TextField label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <TextField label="Effective date" type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button busy={save.busy} onClick={() => void save.run()}>
              Save document
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setForm(null);
                setFile(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}
      <ErrorBanner error={remove.error} />
      {docs.loading && !docs.data ? (
        <PageLoading />
      ) : groups.size ? (
        [...groups].map(([name, list]) => (
          <Card key={name} title={name} actions={list[0]?.contactId && <SubComplianceBadge contactId={list[0].contactId} />}>
            <ul className="flex flex-col divide-y divide-line">
              {list.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="block font-semibold text-ink">{d.title}</span>
                    <span className="block text-sm text-muted">
                      {d.docType}
                      {d.effectiveDate && ` · effective ${dayLabel(d.effectiveDate)}`}
                    </span>
                    <FileLink file={d.file} />
                  </span>
                  <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run(d.id)}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ))
      ) : (
        !docs.error && <EmptyState title="No subcontract documents yet" />
      )}
    </div>
  );
}

function SubComplianceBadge({ contactId }: { contactId: string }) {
  const { api } = useAuthed();
  const c = useAsync(() => api.contacts.compliance(contactId), [api, contactId]);
  if (!c.data) return null;
  const s = c.data.summary;
  return (
    <Link href={paths.contactEdit(contactId)}>
      <Badge tone={stateTone(s.state)}>WCB / insurance: {COMPLIANCE_STATE_LABELS[s.state]}</Badge>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Compliance (WCB, insurance)
// ---------------------------------------------------------------------------
export function ComplianceScreen() {
  const { api } = useAuthed();
  const all = useAsync(() => api.compliance.overview(), [api]);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const list = (all.data ?? []).filter((c) => !onlyProblems || c.state !== 'OK');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="WCB & insurance" subtitle="Vendors and subcontractors: clearance letters and insurance certificates, with expiry warnings 30 days ahead." />
      <Checkbox label="Only show problems" checked={onlyProblems} onChange={setOnlyProblems} />
      <ErrorBanner error={all.error} onRetry={all.reload} />
      {list.length > 0 && (
        <ExportButtons
          title="WCB and insurance"
          subtitle={onlyProblems ? 'Problems only' : 'All vendors and subcontractors'}
          columns={[
            { key: 'name', label: 'Vendor / subcontractor', width: 2 },
            { key: 'type', label: 'Type' },
            { key: 'wcb', label: 'WCB' },
            { key: 'ins', label: 'Insurance' },
            { key: 'problems', label: 'Problems', width: 3 },
          ]}
          rows={list.map((c) => ({ name: c.businessName ?? c.name, type: c.type, wcb: COMPLIANCE_STATE_LABELS[c.wcb], ins: COMPLIANCE_STATE_LABELS[c.insurance], problems: c.problems.join('; ') }))}
        />
      )}
      {all.loading && !all.data ? (
        <PageLoading />
      ) : list.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {list.map((c) => (
            <li key={c.contactId}>
              <Link href={paths.contactEdit(c.contactId)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
                <span>
                  <span className="block font-semibold text-ink">{c.businessName ?? c.name}</span>
                  <span className="block text-sm text-muted">{c.problems.join(' · ') || 'WCB and insurance up to date'}</span>
                </span>
                <span className="flex gap-1">
                  <Badge tone={stateTone(c.wcb)}>WCB: {COMPLIANCE_STATE_LABELS[c.wcb]}</Badge>
                  <Badge tone={stateTone(c.insurance)}>Insurance: {COMPLIANCE_STATE_LABELS[c.insurance]}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={onlyProblems ? 'No problems — everyone is up to date' : 'No vendors or subcontractors yet'}>Add vendors and subcontractors under Contacts.</EmptyState>
      )}
    </div>
  );
}

/** On a contact's page: their WCB / insurance records. */
export function ComplianceCard({ contactId }: { contactId: string }) {
  const { api, me } = useAuthed();
  const pick = usePickDoc();
  const data = useAsync(() => api.contacts.compliance(contactId), [api, contactId]);
  const [form, setForm] = useState<ComplianceInput | null>(null);
  const [file, setFile] = useState<{ blob: Blob; name: string } | null>(null);
  const editable = can(me.user, 'compliance:edit');
  const choose = useAction(async () => {
    const f = await pick();
    if (f) setFile({ blob: f.blob, name: f.name });
  });
  const save = useAction(async () => {
    if (!form) return;
    await api.contacts.addCompliance(contactId, form, file?.blob ?? null, file?.name);
    setForm(null);
    setFile(null);
    await data.reload();
  });
  const remove = useAction(async (id: string) => {
    await api.compliance.remove(id);
    await data.reload();
  });
  const s = data.data?.summary;
  return (
    <Card
      title="WCB & insurance"
      actions={s && <Badge tone={stateTone(s.state)}>{COMPLIANCE_STATE_LABELS[s.state]}</Badge>}
    >
      <ErrorBanner error={data.error || remove.error} />
      {s && s.problems.length > 0 && <Notice>{s.problems.join(' · ')}</Notice>}
      <ul className="flex flex-col divide-y divide-line">
        {(data.data?.records ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="block font-semibold text-ink">
                {COMPLIANCE_KIND_LABELS[r.kind]} <Badge tone={stateTone(r.state)}>{r.expiresOn ? `expires ${dayLabel(r.expiresOn)}` : 'no expiry'}</Badge>
              </span>
              <span className="block text-sm text-muted">{[r.provider, r.reference && `#${r.reference}`, r.coverage].filter(Boolean).join(' · ')}</span>
              {r.file && <FileLink file={r.file} />}
            </span>
            {editable && (
              <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run(r.id)}>
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
      {editable &&
        (form ? (
          <div className="mt-3 rounded-lg bg-surface-2 p-3">
            <ErrorBanner error={save.error} />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="Type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ComplianceInput['kind'] })} options={COMPLIANCE_KINDS.map((k) => ({ value: k, label: COMPLIANCE_KIND_LABELS[k] }))} />
              <TextField label={form.kind === 'WCB' ? 'WCB account #' : 'Policy #'} value={form.reference ?? ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              <TextField label={form.kind === 'WCB' ? 'Board (e.g. WorkSafeBC)' : 'Insurer'} value={form.provider ?? ''} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
              <TextField label="Expires" type="date" value={form.expiresOn ?? ''} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} />
              {form.kind === 'INSURANCE' && <TextField label="Coverage (e.g. $5M CGL)" value={form.coverage ?? ''} onChange={(e) => setForm({ ...form, coverage: e.target.value })} />}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="secondary" busy={choose.busy} onClick={() => void choose.run()}>
                {file ? `📄 ${file.name}` : 'Attach letter / certificate'}
              </Button>
              <Button busy={save.busy} onClick={() => void save.run()}>
                Save
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setForm(null);
                  setFile(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" className="mt-3" onClick={() => setForm({ kind: 'WCB', reference: '', provider: '', coverage: '', expiresOn: '' })}>
            + Add WCB / insurance
          </Button>
        ))}
    </Card>
  );
}

/** Warning next to a vendor name on PO screens. */
export function VendorComplianceWarning({ companyId, vendorName }: { companyId: string; vendorName: string }) {
  const { api } = useAuthed();
  const name = useDebounced(vendorName.trim(), 500);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  useEffect(() => {
    let live = true;
    if (!name) return setSummary(null);
    api.compliance
      .forVendor(companyId, name)
      .then((r) => live && setSummary(r.summary))
      .catch(() => live && setSummary(null));
    return () => {
      live = false;
    };
  }, [api, companyId, name]);
  if (!summary || summary.state === 'OK') return null;
  return (
    <p className="text-sm font-semibold text-danger" role="status">
      ⚠ {summary.businessName ?? summary.name}: {summary.problems.join(' · ')}{' '}
      <Link href={paths.contactEdit(summary.contactId)} className="underline">
        Update
      </Link>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Job notifications: who hears about what
// ---------------------------------------------------------------------------
export function NotificationsCard({ siteId }: { siteId: string }) {
  const { api, me } = useAuthed();
  const setup = useAsync(() => api.sites.notifications(siteId), [api, siteId]);
  const people = useAsync(() => (can(me.user, 'user:manage') ? api.users.list() : Promise.resolve([])), [api, me.user]);
  const [rows, setRows] = useState<NotifyRuleView[] | null>(null);
  const [open, setOpen] = useState(false);
  const [addUser, setAddUser] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => setRows(setup.data?.rows ?? null), [setup.data]);
  const save = useAction(async () => {
    setSaved(false);
    const r = await api.sites.saveNotifications(siteId, {
      rows: (rows ?? []).map((x) => ({ userId: x.userId, email: x.userId ? null : x.email, name: x.userId ? null : x.name, events: x.events })),
    });
    setRows(r.rows);
    setSaved(true);
    setOpen(false);
    await setup.reload();
  });
  const toggle = (i: number, ev: string, on: boolean) =>
    setRows((all) => all!.map((r, j) => (j === i ? { ...r, events: on ? [...new Set([...r.events, ev])] : r.events.filter((e) => e !== ev) } : r)));
  const add = () => {
    if (addUser) {
      const u = people.data?.find((p) => p.id === addUser);
      if (u && !rows?.some((r) => r.userId === u.id)) setRows((all) => [...(all ?? []), { userId: u.id, email: u.email, name: u.name, isMember: false, events: [...DEFAULT_NOTIFY_EVENTS] }]);
      setAddUser('');
    } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addEmail.trim())) {
      const e = addEmail.trim().toLowerCase();
      if (!rows?.some((r) => r.email === e)) setRows((all) => [...(all ?? []), { userId: null, email: e, name: e, isMember: false, events: [...DEFAULT_NOTIFY_EVENTS] }]);
      setAddEmail('');
    }
  };
  const d = setup.data;
  return (
    <Card
      title="Notifications"
      actions={d?.canEdit && !open && <Button variant="secondary" onClick={() => setOpen(true)}>Change who's told</Button>}
    >
      <ErrorBanner error={setup.error || save.error} onRetry={setup.reload} />
      {saved && <Notice>Saved.</Notice>}
      {!rows ? (
        <PageLoading />
      ) : !open ? (
        <>
          {d?.usingDefaults && <p className="mb-2 text-sm text-muted">Standard setup: everyone on this job gets the delivery notices.</p>}
          <ul className="flex flex-col divide-y divide-line">
            {rows.filter((r) => r.events.length).map((r) => (
              <li key={r.userId ?? r.email} className="py-2">
                <span className="font-semibold text-ink">{r.name}</span> <span className="text-sm text-muted">{r.email}</span>
                <span className="block text-sm text-muted">{NOTIFY_EVENTS.filter((e) => r.events.includes(e.key)).map((e) => e.label).join(' · ')}</span>
              </li>
            ))}
            {!rows.some((r) => r.events.length) && <li className="py-2 text-muted">No one is set to be told anything.</li>}
          </ul>
        </>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">Tick what each person is told about this job. Notices come as an email and, for people in Bowron, in the app.</p>
          <div className="flex flex-col gap-3">
            {rows.map((r, i) => (
              <fieldset key={r.userId ?? r.email} className="rounded-lg border border-line p-3">
                <legend className="px-1 font-semibold text-ink">
                  {r.name} <span className="text-sm font-normal text-muted">{r.email}{r.isMember ? ' · on this job' : ''}</span>
                </legend>
                <div className="grid sm:grid-cols-2">
                  {NOTIFY_EVENTS.map((e) => (
                    <Checkbox key={e.key} label={e.label} checked={r.events.includes(e.key)} onChange={(v) => toggle(i, e.key, v)} />
                  ))}
                </div>
                {!r.isMember && (
                  <Button variant="ghost" onClick={() => setRows((all) => all!.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                )}
              </fieldset>
            ))}
          </div>
          <div className="mt-3 grid gap-2 rounded-lg bg-surface-2 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            {(people.data?.length ?? 0) > 0 ? (
              <SelectField
                label="Add a person"
                placeholder="Choose someone"
                value={addUser}
                onChange={(e) => setAddUser(e.target.value)}
                options={(people.data ?? []).filter((p) => !rows.some((r) => r.userId === p.id)).map((p) => ({ value: p.id, label: p.name }))}
              />
            ) : (
              <span />
            )}
            <TextField label="…or an email address" type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="e.g. owner's rep, inspector" />
            <Button variant="secondary" onClick={add} disabled={!addUser && !addEmail.trim()}>
              Add
            </Button>
          </div>
          <div className="mt-3 flex gap-2">
            <Button busy={save.busy} onClick={() => void save.run()}>
              Save
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setRows(setup.data?.rows ?? null);
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
