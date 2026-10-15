'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SupplierImportPreview } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Button, Card, Checkbox, ErrorBanner, Notice, SelectField, TextField } from '../ui/components';
import { DropZone } from '../ui/drop-zone';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';

const size = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Job page: documents for this project (drawings, subcontract agreement…), picked per PO. */
export function ProjectDocumentsCard({ siteId }: { siteId: string }) {
  const { api, me } = useAuthed();
  const docs = useAsync(() => api.sites.documents(siteId), [api, siteId]);
  const canEdit = can(me.user, 'site:edit');
  const [linkName, setLinkName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const add = useAction(async (files: { blob: Blob; name: string }[]) => {
    for (const f of files) await api.sites.addDocument(siteId, f.blob, f.name, files.length === 1 ? linkName.trim() || null : null);
    setLinkName('');
    await docs.reload();
  });
  const rename = useAction(async () => {
    if (!renaming) return;
    await api.projectDocuments.rename(renaming.id, renaming.name);
    setRenaming(null);
    await docs.reload();
  });
  const remove = useAction(async (id: string) => {
    await api.projectDocuments.remove(id);
    await docs.reload();
  });
  return (
    <Card title="Project documents">
      <p className="text-sm text-muted">Attach them here once; when cutting a PO, pick which ones go with it (e.g. the subcontract agreement over $50,000, or a drawing). They show on the PO by their link name and are added at the end of the PO.</p>
      <ErrorBanner error={docs.error || remove.error} />
      <ul className="mt-2 flex flex-col divide-y divide-line">
        {(docs.data ?? []).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            {renaming?.id === d.id ? (
              <div className="flex flex-1 flex-wrap items-end gap-2">
                <TextField label="Link name" value={renaming.name} onChange={(e) => setRenaming({ id: d.id, name: e.target.value })} />
                <Button busy={rename.busy} onClick={() => void rename.run()}>
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <span>
                  <a href={api.fileUrl(d.url) ?? undefined} target="_blank" rel="noreferrer" className="text-brand-ink underline">
                    {d.linkName}
                  </a>{' '}
                  <span className="text-sm text-muted">
                    {d.fileName} · {size(d.sizeBytes)}
                    {d.onPos ? ` · on ${d.onPos} PO${d.onPos === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
                {canEdit && (
                  <span className="flex gap-1">
                    <Button variant="ghost" onClick={() => setRenaming({ id: d.id, name: d.linkName })}>
                      Rename
                    </Button>
                    <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run(d.id)}>
                      Remove
                    </Button>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
        {docs.data?.length === 0 && <li className="py-2 text-sm text-muted">No documents yet.</li>}
      </ul>
      {canEdit && (
        <div className="mt-3 flex flex-col gap-2">
          <TextField label="Link name (optional)" hint="What shows on the PO, e.g. “Subcontract agreement” or “Drawing S-201 rev C”. Blank = the file name." value={linkName} onChange={(e) => setLinkName(e.target.value)} />
          <DropZone title="Drop documents here (or pick from the network)" hint="PDF, pictures, Word, Excel, drawings — up to 50 MB each." accept="*/*" multiple busy={add.busy} onFiles={(f) => void add.run(f)} />
          <ErrorBanner error={add.error} />
        </div>
      )}
    </Card>
  );
}

/** PO editor: pick which project documents go with this PO. */
export function PoDocumentPicker({ siteId, value, onChange }: { siteId: string; value: string[]; onChange: (ids: string[]) => void }) {
  const { api } = useAuthed();
  const docs = useAsync(() => api.sites.documents(siteId), [api, siteId]);
  if (!docs.data?.length) return null;
  return (
    <Card title="Attach project documents">
      <p className="text-sm text-muted">Tick the ones that go with this PO — they’re added at the end and show as links. (Add more on the job’s page.)</p>
      {docs.data.map((d) => (
        <Checkbox key={d.id} label={d.linkName} description={d.fileName} checked={value.includes(d.id)} onChange={(on) => onChange(on ? [...value, d.id] : value.filter((x) => x !== d.id))} />
      ))}
    </Card>
  );
}

/** Orders page (a job picked): drop an Excel order list to make the next order list. */
export function OrderListDropZone({ siteId }: { siteId: string }) {
  const { api } = useAuthed();
  const router = useRouter();
  const [note, setNote] = useState('');
  const run = useAction(async (files: { blob: Blob; name: string }[]) => {
    const f = files[0];
    if (!f) return;
    const r = await api.importOrderSheet(siteId, f.blob, f.name);
    const { id } = await api.orders.create(siteId);
    await api.orders.saveDraft(id, { rows: r.rows, notes: `Imported from ${f.name}` });
    setNote(r.note ?? '');
    router.push(paths.order(id));
  });
  return (
    <div className="mt-3">
      <DropZone
        title="Or drop your Excel order list here"
        hint="It becomes the next order list on this job (as a draft you check and submit). Any layout with a description and quantity column."
        accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        busy={run.busy}
        onFiles={(f) => void run.run(f)}
      />
      <ErrorBanner error={run.error} />
      {note && <Notice>{note}</Notice>}
    </div>
  );
}

/** Contacts page: import a supplier list (e.g. exported from Sage). */
export function SupplierImportCard() {
  const { api, me, activeCompany } = useAuthed();
  const [file, setFile] = useState<{ blob: Blob; name: string } | null>(null);
  const [preview, setPreview] = useState<SupplierImportPreview | null>(null);
  const [companyId, setCompanyId] = useState(activeCompany?.id ?? me.companies[0]?.id ?? '');
  const [done, setDone] = useState('');
  const look = useAction(async (files: { blob: Blob; name: string }[]) => {
    const f = files[0];
    if (!f) return;
    setDone('');
    setFile(f);
    setPreview(await api.contacts.importSuppliers(f.blob, f.name, null, true));
  });
  const go = useAction(async () => {
    if (!file) return;
    const r = await api.contacts.importSuppliers(file.blob, file.name, companyId, false);
    setDone(`Imported ${r.total} suppliers: ${r.created} new, ${r.updated} filled in${r.skipped ? `, ${r.skipped} duplicate rows skipped` : ''}.`);
    setPreview(null);
    setFile(null);
  });
  if (!can(me.user, 'contact:edit')) return null;
  return (
    <Card title="Import suppliers" className="mb-4">
      <DropZone title="Drop a supplier list (Excel or CSV)" hint="e.g. the vendor list exported from Sage. Headings like Vendor ID, Vendor Name, Contact, Email, Phone, Address are found automatically." accept=".xlsx,.xlsm,.csv,text/csv" busy={look.busy} onFiles={(f) => void look.run(f)} />
      <ErrorBanner error={look.error || go.error} />
      {done && <Notice>{done}</Notice>}
      {preview && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-ink">
            Found <b>{preview.total}</b> suppliers ({preview.newCount} new). Columns used: {Object.entries(preview.columns).map(([k, v]) => `${v} → ${k}`).join(', ')}.
          </p>
          <div className="max-h-64 overflow-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-1">Vendor ID</th>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Contact</th>
                  <th className="px-2 py-1">Email</th>
                  <th className="px-2 py-1">Phone</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2 py-1">{r.vendorId ?? '—'}</td>
                    <td className="px-2 py-1 text-ink">{r.name}</td>
                    <td className="px-2 py-1">{r.contactName ?? '—'}</td>
                    <td className="px-2 py-1">{r.email ?? '—'}</td>
                    <td className="px-2 py-1">{r.phone ?? r.cell ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {me.companies.length > 1 && <SelectField label="Suppliers for" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
          <p className="text-sm text-muted">New suppliers are added; ones already in Bowron only get their blank fields filled in.</p>
          <div className="flex gap-2">
            <Button busy={go.busy} disabled={!companyId} onClick={() => void go.run()}>
              Import {preview.total} suppliers
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
