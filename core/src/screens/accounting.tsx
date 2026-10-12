'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { taxProfile } from '../domain/tax';
import { formatCad } from '../domain/inventory';
import {
  AR_STATE_LABELS,
  APPROVER_LABELS,
  DEFAULT_ACCOUNTING,
  type AccountingExportRow,
  type AccountingSettings,
  type ArInvoiceDetail,
  type ArState,
  type CustomerInput,
  type CustomerItem,
} from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, cx, EmptyState, ErrorBanner, Notice, PageHeader, PageLoading, SelectField, TextArea, TextField } from '../ui/components';
import { ExportButtons, PdfButtons } from '../ui/export';
import { fieldError, useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';
import { DropZone } from '../ui/drop-zone';

const today = () => new Date().toLocaleDateString('en-CA');
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return x.toLocaleDateString('en-CA');
};
const arTone = (s: ArState) => (s === 'PAID' ? 'ok' : s === 'OVERDUE' ? 'danger' : s === 'VOID' ? 'neutral' : s === 'DRAFT' ? 'neutral' : 'brand');

// ---------------------------------------------------------------------------
// Settings: approvals, pay days, network folders, invoice numbers
// ---------------------------------------------------------------------------
export function AccountingSettingsScreen() {
  const params = useSearchParams();
  const { api, me } = useAuthed();
  const [companyId, setCompanyId] = useState(params.get('companyId') ?? me.companies[0]?.id ?? '');
  const loaded = useAsync(() => api.ap.settings(companyId), [api, companyId]);
  const people = useAsync(() => api.users.list(), [api]);
  const [s, setS] = useState<AccountingSettings>(DEFAULT_ACCOUNTING);
  const [payDays, setPayDays] = useState('15, 31');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    if (!loaded.data) return;
    setS(loaded.data);
    setPayDays(loaded.data.payDays.join(', '));
  }, [loaded.data]);
  const save = useAction(async () => {
    const days = payDays.split(/[,\s]+/).map((x) => Number(x)).filter((x) => x >= 1 && x <= 31);
    if (!days.length) throw new Error('Enter at least one pay day (1–31; 31 = month end).');
    await api.ap.saveSettings(companyId, { ...s, payDays: days });
    setSaved('Saved.');
  });
  const check = useAction(async () => {
    const r = await api.ap.scanFolders();
    setSaved(r.problems.length ? r.problems.join(' ') : `The network inbox folder works — ${r.imported} new invoice(s) brought in.`);
  });
  const userOptions = (people.data ?? []).filter((u) => u.active).map((u) => ({ value: u.id, label: u.name }));
  const set = <K extends keyof AccountingSettings>(k: K, v: AccountingSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  if (!loaded.data && !loaded.error) return <PageLoading />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.ap()} title="AP & billing settings" subtitle="Who approves vendor invoices, when you pay, the network folders, and customer invoice numbers." />
      {me.companies.length > 1 && <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
      <ErrorBanner error={loaded.error || save.error || check.error} />
      {saved && <Notice>{saved}</Notice>}

      <Card title="Approving vendor invoices">
        <p className="mb-2 text-sm text-muted">Clean invoices (matching the PO) go through these steps in order. Mismatches wait for AP first.</p>
        <Checkbox label="1. Procurement approves first" description="They can “pass” on one — the purchase was already approved on the PO." checked={s.procurementStep} onChange={(v) => set('procurementStep', v)} />
        <p className="mt-3 font-semibold text-ink">More approval steps (in order)</p>
        {s.extraSteps.map((st, i) => (
          <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <SelectField
              label={`Step ${i + (s.procurementStep ? 2 : 1)}`}
              value={st.type}
              onChange={(e) => set('extraSteps', s.extraSteps.map((x, j) => (j === i ? { ...x, type: e.target.value as 'PM' } : x)))}
              options={(['PM', 'OPS', 'ADMIN', 'USER'] as const).map((t) => ({ value: t, label: APPROVER_LABELS[t] }))}
            />
            {st.type === 'USER' ? (
              <SelectField label="Who" placeholder="Choose" value={st.userId ?? ''} onChange={(e) => set('extraSteps', s.extraSteps.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))} options={userOptions} />
            ) : (
              <span />
            )}
            <Button variant="ghost" onClick={() => set('extraSteps', s.extraSteps.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <Button variant="secondary" className="mt-2" onClick={() => set('extraSteps', [...s.extraSteps, { type: 'PM' }])}>
          + Add an approval step
        </Button>
        <p className="mt-4 font-semibold text-ink">Side reviews</p>
        <p className="text-sm text-muted">They see each invoice and can mark “looks OK” or flag a concern, but don’t hold it up.</p>
        {s.sideReviews.map((st, i) => (
          <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <SelectField
              label={`Reviewer ${i + 1}`}
              value={st.type}
              onChange={(e) => set('sideReviews', s.sideReviews.map((x, j) => (j === i ? { ...x, type: e.target.value as 'PM' } : x)))}
              options={(['PM', 'OPS', 'USER'] as const).map((t) => ({ value: t, label: APPROVER_LABELS[t] }))}
            />
            {st.type === 'USER' ? (
              <SelectField label="Who" placeholder="Choose" value={st.userId ?? ''} onChange={(e) => set('sideReviews', s.sideReviews.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))} options={userOptions} />
            ) : (
              <span />
            )}
            <Button variant="ghost" onClick={() => set('sideReviews', s.sideReviews.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <Button variant="secondary" className="mt-2" onClick={() => set('sideReviews', [...s.sideReviews, { type: 'PM' }])}>
          + Add a side review
        </Button>
        <p className="mt-4 font-semibold text-ink">Operations manager(s)</p>
        <div className="grid sm:grid-cols-2">
          {userOptions.map((u) => (
            <Checkbox key={u.value} label={u.label} checked={s.opsManagerIds.includes(u.value)} onChange={(v) => set('opsManagerIds', v ? [...s.opsManagerIds, u.value] : s.opsManagerIds.filter((x) => x !== u.value))} />
          ))}
        </div>
      </Card>

      <Card title="Paying">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Pay days of the month" value={payDays} onChange={(e) => setPayDays(e.target.value)} hint="e.g. 15, 31 (31 = month end)" />
          <TextField label="Default terms (days)" inputMode="numeric" value={String(s.defaultTermsDays)} onChange={(e) => set('defaultTermsDays', Number(e.target.value.replace(/\D/g, '')) || 0)} />
          <TextField label="Allowed price difference vs PO (%)" inputMode="decimal" value={String(s.priceTolerancePct)} onChange={(e) => set('priceTolerancePct', Number(e.target.value) || 0)} />
        </div>
      </Card>

      <Card title="Network folders">
        <p className="mb-2 text-sm text-muted">
          AP drops invoices into the inbox folder; SupplyLine picks them up every 2 minutes and moves each file along as it goes. Use a full path the server can reach, e.g. <code>P:\AP\Inbox</code> or <code>\\server\share\AP\Inbox</code>. (Once SupplyLine is online, the SupplyLine Sync app on your network does this.)
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['inbox', 'Inbox (AP drops invoices here)'],
              ['inReview', 'In review'],
              ['approved', 'Approved'],
              ['rejected', 'Rejected'],
              ['held', 'On hold (more information needed)'],
            ] as const
          ).map(([k, label]) => (
            <TextField key={k} label={label} value={s.folders[k]} onChange={(e) => set('folders', { ...s.folders, [k]: e.target.value })} />
          ))}
        </div>
        <Button variant="secondary" className="mt-2" busy={check.busy} onClick={() => void check.run()}>
          Check the folder now
        </Button>
      </Card>

      <Card title="Customer invoice numbers">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Prefix" value={s.arPrefix} onChange={(e) => set('arPrefix', e.target.value)} hint="e.g. INV-" />
          <TextField label="Next number" inputMode="numeric" value={String(s.arNextNumber)} onChange={(e) => set('arNextNumber', Number(e.target.value.replace(/\D/g, '')) || 1)} />
        </div>
      </Card>
      <div>
        <Button busy={save.busy} onClick={() => void save.run()}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
const blankCustomer = (companyId: string): CustomerInput => ({ companyId, name: '', contactName: '', email: '', phone: '', address: '', city: '', province: '', postalCode: '', gstNumber: '', termsDays: 30, notes: '' });

export function CustomersScreen() {
  const { api, me } = useAuthed();
  const [q, setQ] = useState('');
  const list = useAsync(() => api.customers.list({ q: q.trim() || undefined }), [api, q]);
  const [editing, setEditing] = useState<{ id: string | null; f: CustomerInput } | null>(null);
  const save = useAction(async () => {
    if (!editing) return;
    if (editing.id) await api.customers.update(editing.id, editing.f);
    else await api.customers.create(editing.f);
    setEditing(null);
    await list.reload();
  });
  const set = (k: keyof CustomerInput, v: string | number) => setEditing((e) => (e ? { ...e, f: { ...e.f, [k]: v } } : e));
  const open = (c: CustomerItem) => setEditing({ id: c.id, f: { companyId: c.companyId, name: c.name, contactName: c.contactName ?? '', email: c.email ?? '', phone: c.phone ?? '', address: c.address ?? '', city: c.city ?? '', province: c.province ?? '', postalCode: c.postalCode ?? '', gstNumber: c.gstNumber ?? '', termsDays: c.termsDays, notes: c.notes ?? '', active: c.active } });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Customers" subtitle="Who you bill." actions={<Button onClick={() => setEditing({ id: null, f: blankCustomer(me.user.companyId ?? me.companies[0]?.id ?? '') })}>+ New customer</Button>} />
      {editing && (
        <Card title={editing.id ? 'Customer' : 'New customer'}>
          <ErrorBanner error={save.error} />
          <div className="grid gap-3 sm:grid-cols-2">
            {!editing.id && me.companies.length > 1 && <SelectField label="Company" value={editing.f.companyId} onChange={(e) => set('companyId', e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
            <TextField label="Name" required value={editing.f.name} onChange={(e) => set('name', e.target.value)} error={fieldError(save.error, 'name')} />
            <TextField label="Contact" value={editing.f.contactName ?? ''} onChange={(e) => set('contactName', e.target.value)} />
            <TextField label="Email (invoices go here)" type="email" value={editing.f.email ?? ''} onChange={(e) => set('email', e.target.value)} error={fieldError(save.error, 'email')} />
            <TextField label="Phone" value={editing.f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
            <TextField label="Address" value={editing.f.address ?? ''} onChange={(e) => set('address', e.target.value)} />
            <TextField label="City" value={editing.f.city ?? ''} onChange={(e) => set('city', e.target.value)} />
            <TextField label="Province" value={editing.f.province ?? ''} onChange={(e) => set('province', e.target.value)} />
            <TextField label="Postal code" value={editing.f.postalCode ?? ''} onChange={(e) => set('postalCode', e.target.value)} />
            <TextField label="Payment terms (days)" inputMode="numeric" value={String(editing.f.termsDays)} onChange={(e) => set('termsDays', Number(e.target.value.replace(/\D/g, '')) || 0)} />
            <TextField label="Their GST #" value={editing.f.gstNumber ?? ''} onChange={(e) => set('gstNumber', e.target.value)} />
          </div>
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
      <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorBanner error={list.error} onRetry={list.reload} />
      {list.data?.length ? (
        <>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
            {list.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <button type="button" className="text-left" onClick={() => open(c)}>
                  <span className="block font-semibold text-ink">{c.name}</span>
                  <span className="block text-sm text-muted">{[c.contactName, c.email, c.phone, me.companies.length > 1 ? c.companyName : null].filter(Boolean).join(' · ')}</span>
                </button>
                <span className="flex items-center gap-2">
                  {c.outstanding > 0 && <Badge tone="brand">{formatCad(c.outstanding)} owing</Badge>}
                  <ButtonLink href={`${paths.arNew()}?customerId=${encodeURIComponent(c.id)}`} variant="secondary">
                    Invoice
                  </ButtonLink>
                </span>
              </li>
            ))}
          </ul>
          <ExportButtons title="Customers" columns={[{ key: 'name', label: 'Customer', width: 2 }, { key: 'contact', label: 'Contact' }, { key: 'email', label: 'Email', width: 1.6 }, { key: 'phone', label: 'Phone' }, { key: 'owing', label: 'Owing', align: 'right' }]} rows={list.data.map((c) => ({ name: c.name, contact: c.contactName, email: c.email, phone: c.phone, owing: c.outstanding }))} />
        </>
      ) : (
        !list.loading && <EmptyState title="No customers yet" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer invoices
// ---------------------------------------------------------------------------
export function ArInvoicesScreen() {
  const { api } = useAuthed();
  const [state, setState] = useState<ArState | 'OPEN' | ''>('OPEN');
  const list = useAsync(() => api.ar.list({ state: state || undefined }), [api, state]);
  const tabs: [ArState | 'OPEN' | '', string][] = [
    ['OPEN', 'Owing'],
    ['OVERDUE', 'Overdue'],
    ['DRAFT', 'Drafts'],
    ['PAID', 'Paid'],
    ['', 'All'],
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Billing (AR)"
        subtitle="Invoices to customers against projects."
        actions={
          <>
            <ButtonLink href={paths.customers()} variant="secondary">
              Customers
            </ButtonLink>
            <ButtonLink href={paths.arNew()}>+ New invoice</ButtonLink>
          </>
        }
      />
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map(([k, label]) => (
          <Button key={label} role="tab" aria-selected={state === k} variant={state === k ? 'primary' : 'secondary'} onClick={() => setState(k)}>
            {label}
          </Button>
        ))}
      </div>
      <ErrorBanner error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? (
        <PageLoading />
      ) : list.data?.length ? (
        <>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
            {list.data.map((i) => (
              <li key={i.id}>
                <Link href={paths.arInvoice(i.id)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
                  <span>
                    <span className="block font-semibold text-ink">
                      {i.invoiceNumber} · {i.customerName}
                    </span>
                    <span className="block text-sm text-muted">{[i.siteLabel, `dated ${i.invoiceDate}`, `due ${i.dueDate}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{formatCad(i.total)}</span>
                    {i.balance > 0 && i.state !== 'DRAFT' && <Badge>{formatCad(i.balance)} owing</Badge>}
                    <Badge tone={arTone(i.state)}>{AR_STATE_LABELS[i.state]}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <ExportButtons
            title="Customer invoices"
            columns={[
              { key: 'no', label: 'Invoice #' },
              { key: 'customer', label: 'Customer', width: 1.6 },
              { key: 'job', label: 'Project', width: 1.6 },
              { key: 'date', label: 'Date' },
              { key: 'due', label: 'Due' },
              { key: 'total', label: 'Total', align: 'right' },
              { key: 'holdback', label: 'Holdback', align: 'right' },
              { key: 'paid', label: 'Paid', align: 'right' },
              { key: 'balance', label: 'Balance', align: 'right' },
              { key: 'state', label: 'Status' },
            ]}
            rows={list.data.map((i) => ({ no: i.invoiceNumber, customer: i.customerName, job: i.siteLabel, date: i.invoiceDate, due: i.dueDate, total: i.total, holdback: i.holdbackAmount, paid: i.amountPaid, balance: i.balance, state: AR_STATE_LABELS[i.state] }))}
          />
        </>
      ) : (
        <EmptyState title="No invoices here" />
      )}
    </div>
  );
}

type ArLine = { description: string; qty: string; uom: string; unitPrice: string; costCode: string };

export function ArInvoiceEditScreen() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const { api, me } = useAuthed();
  const [companyId, setCompanyId] = useState(me.user.companyId ?? me.companies[0]?.id ?? '');
  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [siteId, setSiteId] = useState(params.get('siteId') ?? '');
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(today());
  const [due, setDue] = useState(addDays(today(), 30));
  const [description, setDescription] = useState('');
  const [gst, setGst] = useState('5');
  const [pst, setPst] = useState('0');
  const [holdbackOn, setHoldbackOn] = useState(false);
  const [holdback, setHoldback] = useState('10');
  const [lines, setLines] = useState<ArLine[]>([{ description: '', qty: '1', uom: 'LS', unitPrice: '', costCode: '' }]);
  const [loaded, setLoaded] = useState(!id);
  const customers = useAsync(() => api.customers.list({ companyId }), [api, companyId]);
  const jobs = useAsync(() => api.sites.list({ type: 'JOB', companyId }), [api, companyId]);
  useEffect(() => {
    if (id || !companyId) return;
    api.ar.nextNumber(companyId).then((r) => setNumber(r.invoiceNumber)).catch(() => undefined);
  }, [api, companyId, id]);
  useEffect(() => {
    const job = jobs.data?.find((j) => j.id === siteId);
    if (!id && job) setGst(String(Math.round((taxProfile(job.province).hstRate || 0.05) * 1000) / 10));
  }, [siteId, jobs.data, id]);
  useEffect(() => {
    const c = customers.data?.find((x) => x.id === customerId);
    if (!id && c) setDue(addDays(date, c.termsDays));
  }, [customerId, customers.data, date, id]);
  useEffect(() => {
    if (!id) return;
    api.ar.get(id).then((i) => {
      setCompanyId(i.companyId);
      setCustomerId(i.customerId);
      setSiteId(i.siteId ?? '');
      setNumber(i.invoiceNumber);
      setDate(i.invoiceDate);
      setDue(i.dueDate);
      setDescription(i.description ?? '');
      setGst(String(i.gstRate * 100));
      setPst(String(i.pstRate * 100));
      setHoldbackOn(!!i.holdbackPct);
      setHoldback(String(i.holdbackPct ?? 10));
      setLines(i.lines.map((l) => ({ description: l.description, qty: String(l.qty), uom: l.uom, unitPrice: String(l.unitPrice), costCode: l.costCode ?? '' })));
      setLoaded(true);
    });
  }, [api, id]);
  const subtotal = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice.replace(/[$,]/g, '')) || 0), 0);
  const save = useAction(async () => {
    const input = {
      companyId,
      customerId,
      siteId: siteId || null,
      invoiceNumber: number,
      invoiceDate: date,
      dueDate: due,
      description: description || null,
      gstRate: (Number(gst) || 0) / 100,
      pstRate: (Number(pst) || 0) / 100,
      holdbackPct: holdbackOn ? Number(holdback) || null : null,
      lines: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, qty: Number(l.qty) || 0, uom: l.uom || 'EA', unitPrice: Number(l.unitPrice.replace(/[$,]/g, '')) || 0, costCode: l.costCode || null })),
    };
    const r = id ? await api.ar.update(id, input) : await api.ar.create(input);
    router.replace(paths.arInvoice(r.id));
  });
  if (!loaded) return <PageLoading />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.ar()} title={id ? `Edit invoice ${number}` : 'New customer invoice'} />
      <ErrorBanner error={save.error} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          {!id && me.companies.length > 1 && <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
          <SelectField label="Customer" placeholder="Choose (add them under Customers)" value={customerId} onChange={(e) => setCustomerId(e.target.value)} options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <SelectField label="Project" placeholder="(none)" value={siteId} onChange={(e) => setSiteId(e.target.value)} options={(jobs.data ?? []).map((j) => ({ value: j.id, label: `JOB#${j.jobNumber} ${j.name}` }))} />
          <TextField label="Invoice #" value={number} onChange={(e) => setNumber(e.target.value)} />
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <TextField label="GST / HST %" inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} />
          <TextField label="PST %" inputMode="decimal" value={pst} onChange={(e) => setPst(e.target.value)} hint="Usually 0 for construction work — check with your accountant." />
          <div className="sm:col-span-2">
            <TextArea label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Checkbox label="Holdback on this invoice" description="Off unless your accountant says to use it." checked={holdbackOn} onChange={setHoldbackOn} />
            {holdbackOn && <TextField label="Holdback %" inputMode="decimal" value={holdback} onChange={(e) => setHoldback(e.target.value)} />}
          </div>
        </div>
      </Card>
      <Card title="Lines">
        {lines.map((l, i) => (
          <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_5rem_4rem_8rem_6rem_auto] sm:items-end">
            <TextField label="Description" value={l.description} onChange={(e) => setLines((a) => a.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <TextField label="Qty" inputMode="decimal" value={l.qty} onChange={(e) => setLines((a) => a.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            <TextField label="Unit" value={l.uom} onChange={(e) => setLines((a) => a.map((x, j) => (j === i ? { ...x, uom: e.target.value } : x)))} />
            <TextField label="Price ($)" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLines((a) => a.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} />
            <TextField label="Cost code" value={l.costCode} onChange={(e) => setLines((a) => a.map((x, j) => (j === i ? { ...x, costCode: e.target.value } : x)))} />
            <Button variant="ghost" disabled={lines.length === 1} onClick={() => setLines((a) => a.filter((_, j) => j !== i))}>
              ✕
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" onClick={() => setLines((a) => [...a, { description: '', qty: '1', uom: 'LS', unitPrice: '', costCode: '' }])}>
            + Line
          </Button>
          <span className="font-semibold text-ink">Subtotal {formatCad(subtotal)} + tax</span>
        </div>
      </Card>
      <div>
        <Button busy={save.busy} disabled={!customerId} onClick={() => void save.run()}>
          Save
        </Button>
      </div>
    </div>
  );
}

export function ArInvoiceScreen() {
  const id = useSearchParams().get('id') ?? '';
  const { api } = useAuthed();
  const loaded = useAsync(() => api.ar.get(id), [api, id]);
  const [inv, setInv] = useState<ArInvoiceDetail | null>(null);
  useEffect(() => setInv(loaded.data ?? null), [loaded.data]);
  const [email, setEmail] = useState(true);
  const [msg, setMsg] = useState('');
  const [payOn, setPayOn] = useState(today());
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [hbRelease, setHbRelease] = useState(false);
  const act = useAction(async (fn: () => Promise<ArInvoiceDetail>) => setInv(await fn()));
  if (loaded.error) return <ErrorBanner error={loaded.error} onRetry={loaded.reload} />;
  if (!inv) return <PageLoading />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.ar()} title={`Invoice ${inv.invoiceNumber}`} subtitle={[inv.customerName, inv.siteLabel].filter(Boolean).join(' · ')} actions={<Badge tone={arTone(inv.state)}>{AR_STATE_LABELS[inv.state]}</Badge>} />
      <ErrorBanner error={act.error} />
      {msg && <Notice>{msg}</Notice>}
      <div className="flex flex-wrap gap-2">
        <PdfButtons title={`Invoice ${inv.invoiceNumber}`} fileName={`Invoice-${inv.invoiceNumber}.pdf`} load={() => api.ar.pdf(inv.id)} />
        {inv.state === 'DRAFT' && (
          <ButtonLink href={paths.arEdit(inv.id)} variant="secondary">
            Edit
          </ButtonLink>
        )}
        {inv.state !== 'VOID' && inv.amountPaid === 0 && (
          <Button variant="ghost" busy={act.busy} onClick={() => void act.run(() => api.ar.void(inv.id))}>
            Void
          </Button>
        )}
      </div>
      {inv.state !== 'VOID' && inv.state !== 'PAID' && (
        <Card title={inv.state === 'DRAFT' ? 'Send it' : 'Send again'}>
          <Checkbox label={`Email it to ${inv.customer.email ?? '(no email on file)'}`} description="Waits in Emails to review first, if your company set that." checked={email && !!inv.customer.email} onChange={setEmail} />
          <Button
            className="mt-2"
            busy={act.busy}
            onClick={() =>
              void act.run(async () => {
                const r = await api.ar.send(inv.id, email && !!inv.customer.email);
                setMsg(r.state === 'HELD' ? 'Marked sent; the email is waiting in Emails to review.' : r.state === 'SENT' ? 'Sent to the customer.' : 'Marked as sent.');
                return r.invoice;
              })
            }
          >
            {inv.state === 'DRAFT' ? 'Mark sent' : 'Send'}
          </Button>
        </Card>
      )}
      <Card title="Amounts">
        <dl className="grid max-w-md grid-cols-2 gap-y-1 text-ink">
          <dt>Subtotal</dt>
          <dd className="text-right">{formatCad(inv.subtotal)}</dd>
          <dt>GST / HST</dt>
          <dd className="text-right">{formatCad(inv.gst)}</dd>
          {inv.pst > 0 && (
            <>
              <dt>PST</dt>
              <dd className="text-right">{formatCad(inv.pst)}</dd>
            </>
          )}
          <dt className="font-bold">Total</dt>
          <dd className="text-right font-bold">{formatCad(inv.total)}</dd>
          {inv.holdbackAmount > 0 && (
            <>
              <dt>Holdback {inv.holdbackPct}%</dt>
              <dd className="text-right">{formatCad(inv.holdbackAmount)}</dd>
            </>
          )}
          <dt>Paid</dt>
          <dd className="text-right">{formatCad(inv.amountPaid)}</dd>
          <dt className="font-bold">Balance</dt>
          <dd className={cx('text-right font-bold', inv.state === 'OVERDUE' && 'text-danger')}>{formatCad(inv.balance)}</dd>
        </dl>
        <p className="mt-2 text-sm text-muted">
          Dated {inv.invoiceDate} · due {inv.dueDate}
        </p>
      </Card>
      <Card title="Lines">
        <ul className="flex flex-col divide-y divide-line text-sm">
          {inv.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-2 py-1">
              <span>{l.description}</span>
              <span>
                {l.qty} {l.uom} × {formatCad(l.unitPrice)} = <strong>{formatCad(l.amount)}</strong>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {['SENT', 'PARTIAL', 'OVERDUE'].includes(inv.state) && (
        <Card title="Record a payment">
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="Date" type="date" value={payOn} onChange={(e) => setPayOn(e.target.value)} />
            <TextField label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(inv.balance)} />
            <TextField label="Reference" value={ref} onChange={(e) => setRef(e.target.value)} />
            {inv.holdbackAmount > 0 && <Checkbox label="This is the holdback release" checked={hbRelease} onChange={setHbRelease} />}
            <Button busy={act.busy} onClick={() => void act.run(() => api.ar.pay(inv.id, { paidOn: payOn, amount: Number(amount.replace(/[$,]/g, '')) || inv.balance, reference: ref || null, holdbackRelease: hbRelease }))}>
              Record
            </Button>
          </div>
        </Card>
      )}
      <Card title={`Backup documents (${inv.backups.length})`}>
        <DropZone
          title="Drop backup documents here"
          hint={
            inv.backupFolder ? (
              <>
                Delivery tickets, timesheets, receiving reports… Each one is filed to <strong>{inv.backupFolder}</strong> and goes out with the invoice.
              </>
            ) : (
              <>
                Delivery tickets, timesheets, receiving reports… They go out with the invoice. To also file them to your network, choose a folder for “Billing backup documents” in{' '}
                <a className="underline" href={paths.filingAdmin()}>
                  Network filing
                </a>
                .
              </>
            )
          }
          multiple
          busy={act.busy}
          onFiles={(files) =>
            void act.run(async () => {
              let d = inv;
              for (const f of files) d = await api.ar.addBackup(inv.id, f.blob, f.name);
              return d;
            })
          }
        />
        {inv.backups.length > 0 && (
          <ul className="mt-3 divide-y divide-line">
            {inv.backups.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                <a href={api.fileUrl(b.url) ?? undefined} target="_blank" rel="noreferrer" className="text-ink underline">
                  {b.fileName}
                </a>
                <Button variant="ghost" onClick={() => void act.run(() => api.ar.removeBackup(inv.id, b.id))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {inv.payments.length > 0 && (
        <Card title="Payments">
          <ul className="text-sm">
            {inv.payments.map((p) => (
              <li key={p.id}>
                {p.paidOn} · {formatCad(p.amount)}
                {p.reference && ` · ${p.reference}`}
                {p.holdbackRelease && ' · holdback release'}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports for the accountant
// ---------------------------------------------------------------------------
export function AccountingExportsScreen() {
  const { api, me } = useAuthed();
  const firstOfMonth = `${today().slice(0, 7)}-01`;
  const [kind, setKind] = useState<'ap' | 'ar' | 'tax'>('ap');
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today());
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<AccountingExportRow[] | null>(null);
  const load = useAction(async () => setRows(await api.accountingExport(kind, from, to, companyId || undefined)));
  const cols = useMemo(() => (rows?.[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), align: typeof rows[0]![k] === 'number' ? ('right' as const) : undefined })) : []), [rows]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.ap()} title="Exports for the accountant" subtitle="Clean AP, AR and GST/PST data to post in their own software. (SupplyLine doesn't do year-end posting.)" />
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <SelectField
            label="What"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as 'ap');
              setRows(null);
            }}
            options={[
              { value: 'ap', label: 'Vendor invoices (AP register)' },
              { value: 'ar', label: 'Customer invoices (AR register)' },
              { value: 'tax', label: 'GST / PST summary by month' },
            ]}
          />
          <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          {me.companies.length > 1 ? <SelectField label="Company" placeholder="All" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} /> : <span />}
        </div>
        <Button className="mt-3" busy={load.busy} onClick={() => void load.run()}>
          Show
        </Button>
        <ErrorBanner error={load.error} />
      </Card>
      {rows && (rows.length ? <ExportButtons title={kind === 'ap' ? 'AP register' : kind === 'ar' ? 'AR register' : 'GST PST summary'} subtitle={`${from} to ${to}`} companyId={companyId || null} columns={cols} rows={rows} /> : <EmptyState title="Nothing in those dates" />)}
      {rows && rows.length > 0 && <p className="text-sm text-muted">{rows.length} row(s). Download as Excel for your accountant, or PDF to print.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project area: subcontractor holdback and the job budget
// ---------------------------------------------------------------------------
export function SubHoldbackCard({ siteId }: { siteId: string }) {
  const { api } = useAuthed();
  const data = useAsync(() => api.projectMoney.holdback(siteId), [api, siteId]);
  const subs = useAsync(() => api.contacts.list({ type: 'SUBCONTRACTOR' }), [api]);
  const [editing, setEditing] = useState(false);
  const [def, setDef] = useState('');
  const [over, setOver] = useState<{ contactId: string; pct: string }[]>([]);
  const save = useAction(async () => {
    await api.projectMoney.saveHoldback(siteId, { defaultPct: def.trim() ? Number(def) : null, overrides: over.filter((o) => o.contactId && o.pct.trim()).map((o) => ({ contactId: o.contactId, pct: Number(o.pct) })) });
    setEditing(false);
    await data.reload();
  });
  if (data.error) return null; // not for this person
  const d = data.data;
  return (
    <Card
      title="Subcontractor holdback"
      actions={
        d &&
        !editing && (
          <Button
            variant="secondary"
            onClick={() => {
              setDef(d.defaultPct == null ? '' : String(d.defaultPct));
              setOver(d.overrides.map((o) => ({ contactId: o.contactId, pct: String(o.pct) })));
              setEditing(true);
            }}
          >
            Set up
          </Button>
        )
      }
    >
      {!d ? (
        <PageLoading />
      ) : editing ? (
        <>
          <ErrorBanner error={save.error} />
          <TextField label="Holdback % on subcontractor invoices for this job" inputMode="decimal" value={def} onChange={(e) => setDef(e.target.value)} hint="Empty = no holdback. Applied to invoices from contacts of type Subcontractor." />
          <p className="mt-2 font-semibold text-ink">Different % for a subcontractor</p>
          {over.map((o, i) => (
            <div key={i} className="mt-1 grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
              <SelectField label="Subcontractor" placeholder="Choose" value={o.contactId} onChange={(e) => setOver((a) => a.map((x, j) => (j === i ? { ...x, contactId: e.target.value } : x)))} options={(subs.data ?? []).map((c) => ({ value: c.id, label: c.businessName ?? c.name }))} />
              <TextField label="%" inputMode="decimal" value={o.pct} onChange={(e) => setOver((a) => a.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
              <Button variant="ghost" onClick={() => setOver((a) => a.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={() => setOver((a) => [...a, { contactId: '', pct: '' }])}>
              + Subcontractor
            </Button>
            <Button busy={save.busy} onClick={() => void save.run()}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-ink">{d.defaultPct == null ? 'No holdback set for this job.' : `${d.defaultPct}% held back on subcontractor invoices.`}</p>
          {d.overrides.length > 0 && <p className="text-sm text-muted">{d.overrides.map((o) => `${o.name}: ${o.pct}%`).join(' · ')}</p>}
          {d.owing.length > 0 && (
            <ul className="mt-2 flex flex-col divide-y divide-line text-sm">
              {d.owing.map((o) => (
                <li key={o.name} className="flex justify-between py-1">
                  <span>{o.name}</span>
                  <span>
                    held {formatCad(o.held)}
                    {o.released > 0 && ` · released ${formatCad(o.released)}`} · <strong>owing {formatCad(o.owing)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

export function BudgetCard({ siteId }: { siteId: string }) {
  const { api } = useAuthed();
  const data = useAsync(() => api.projectMoney.budget(siteId), [api, siteId]);
  const [editing, setEditing] = useState<{ costCode: string; amount: string }[] | null>(null);
  const save = useAction(async () => {
    await api.projectMoney.saveBudget(siteId, { rows: (editing ?? []).filter((r) => r.costCode.trim()).map((r) => ({ costCode: r.costCode.trim(), amount: Number(r.amount.replace(/[$,]/g, '')) || 0 })) });
    setEditing(null);
    await data.reload();
  });
  if (data.error) return null;
  const d = data.data;
  return (
    <Card
      title="Budget vs committed vs actual"
      actions={
        d?.canEdit &&
        !editing && (
          <Button variant="secondary" onClick={() => setEditing(d.rows.filter((r) => r.costCode !== 'Uncoded').map((r) => ({ costCode: r.costCode, amount: r.budget ? String(r.budget) : '' })))}>
            Edit budget
          </Button>
        )
      }
    >
      {!d ? (
        <PageLoading />
      ) : editing ? (
        <>
          <ErrorBanner error={save.error} />
          {editing.map((r, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <TextField label="Cost code" value={r.costCode} onChange={(e) => setEditing((a) => a!.map((x, j) => (j === i ? { ...x, costCode: e.target.value } : x)))} />
              <TextField label="Budget ($)" inputMode="decimal" value={r.amount} onChange={(e) => setEditing((a) => a!.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <Button variant="ghost" onClick={() => setEditing((a) => a!.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing((a) => [...(a ?? []), { costCode: '', amount: '' }])}>
              + Cost code
            </Button>
            <Button busy={save.busy} onClick={() => void save.run()}>
              Save budget
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </>
      ) : d.rows.length ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-1">Cost code</th>
                  <th className="px-2 py-1 text-right">Budget</th>
                  <th className="px-2 py-1 text-right">Committed (POs)</th>
                  <th className="px-2 py-1 text-right">Actual (invoices)</th>
                  <th className="px-2 py-1 text-right">Left</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.costCode} className={cx('border-t border-line', r.over && 'text-danger')}>
                    <td className="px-2 py-1">
                      {r.costCode}
                      {r.description && <span className="text-muted"> {r.description}</span>}
                    </td>
                    <td className="px-2 py-1 text-right">{formatCad(r.budget)}</td>
                    <td className="px-2 py-1 text-right">{formatCad(r.committed)}</td>
                    <td className="px-2 py-1 text-right">{formatCad(r.actual)}</td>
                    <td className="px-2 py-1 text-right font-semibold">
                      {formatCad(r.remaining)}
                      {r.over && ' ⚠'}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line font-bold">
                  <td className="px-2 py-1">Total</td>
                  <td className="px-2 py-1 text-right">{formatCad(d.totals.budget)}</td>
                  <td className="px-2 py-1 text-right">{formatCad(d.totals.committed)}</td>
                  <td className="px-2 py-1 text-right">{formatCad(d.totals.actual)}</td>
                  <td className="px-2 py-1" />
                </tr>
              </tbody>
            </table>
          </div>
          <ExportButtons
            className="mt-3"
            title="Job budget"
            columns={[
              { key: 'code', label: 'Cost code' },
              { key: 'desc', label: 'Description', width: 2 },
              { key: 'budget', label: 'Budget', align: 'right' },
              { key: 'committed', label: 'Committed', align: 'right' },
              { key: 'actual', label: 'Actual', align: 'right' },
              { key: 'left', label: 'Left', align: 'right' },
            ]}
            rows={d.rows.map((r) => ({ code: r.costCode, desc: r.description, budget: r.budget, committed: r.committed, actual: r.actual, left: r.remaining }))}
          />
        </>
      ) : (
        <p className="text-muted">No budget or spending yet.</p>
      )}
    </Card>
  );
}

export const accountingCan = can;
