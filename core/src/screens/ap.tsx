'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { formatCad } from '../domain/inventory';
import { AP_STATUS_LABELS, type ApInvoiceDetail, type ApStatus, type ApInvoiceSummary } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, cx, EmptyState, ErrorBanner, Notice, PageHeader, PageLoading, SelectField, TextArea, TextField } from '../ui/components';
import { ExportButtons } from '../ui/export';
import { useAction, useAsync, useDebounced } from '../ui/hooks';
import { useAuthed, useLive } from '../ui/session';

const tone = (s: ApStatus) => (s === 'APPROVED' || s === 'PAID' ? 'ok' : s === 'REJECTED' || s === 'NEEDS_REVIEW' ? 'danger' : s === 'IN_APPROVAL' ? 'brand' : 'neutral');
const dayLabel = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[$,]/g, '')));

const TABS = [
  ['inbox', 'To check'],
  ['mine', 'Waiting on me'],
  ['approval', 'In approval'],
  ['approved', 'To pay'],
  ['rejected', 'Rejection Area'],
  ['hold', 'On hold'],
  ['paid', 'Paid'],
  ['all', 'All'],
] as const;
type Tab = (typeof TABS)[number][0];

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
export function ApInboxScreen() {
  const params = useSearchParams();
  const { api, me } = useAuthed();
  const platform = usePlatform();
  const [show, setShow] = useState<Tab>((params.get('show') as Tab) ?? (can(me.user, 'ap:work') ? 'inbox' : 'mine'));
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [companyId, setCompanyId] = useState(me.user.companyId ?? me.companies[0]?.id ?? '');
  const list = useAsync(() => api.ap.list({ show, q: search || undefined }), [api, show, search]);
  const dash = useAsync(() => api.ap.dashboard(), [api]);
  useLive(() => {
    void list.reload();
    void dash.reload();
  });
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState('');
  const isAp = can(me.user, 'ap:work');

  const upload = useAction(async (files: { blob: Blob; name: string }[]) => {
    setNote('');
    let n = 0;
    for (const f of files) {
      await api.ap.upload(companyId, f.blob, f.name);
      n++;
    }
    setNote(`${n} invoice${n === 1 ? '' : 's'} brought in — read, matched and sent on where clean.`);
    await list.reload();
    await dash.reload();
  });
  const pick = async () => {
    const files = await platform.files.pickFiles({ accept: 'application/pdf,image/*', multiple: true });
    if (files.length) void upload.run(files.map((f) => ({ blob: f.blob, name: f.name })));
  };
  const scan = useAction(async () => {
    const r = await api.ap.scanFolders();
    setNote(r.problems.length ? r.problems.join(' ') : `Network folder checked: ${r.imported} new invoice${r.imported === 1 ? '' : 's'}.`);
    await list.reload();
    await dash.reload();
  });
  const d = dash.data;
  const count = (t: Tab) =>
    d ? { inbox: d.needsReview, mine: d.waitingOnMe, approval: d.inApproval, approved: d.approvedUnpaid, rejected: d.rejected, hold: d.onHold, paid: 0, all: 0 }[t] : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Vendor invoices (AP)"
        subtitle="Dropped in here or into the network folder: read, matched to the PO, approved, paid."
        actions={
          isAp && (
            <>
              <ButtonLink href={paths.payRuns()} variant="secondary">
                Pay runs
              </ButtonLink>
              <ButtonLink href={paths.accountingExports()} variant="secondary">
                Exports
              </ButtonLink>
            </>
          )
        }
      />
      {d?.folderProblem && <Notice>⚠ {d.folderProblem}</Notice>}
      {d && d.overdue > 0 && <Notice>{d.overdue} invoice{d.overdue === 1 ? ' is' : 's are'} past the due date and not paid yet.</Notice>}

      {isAp && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const files = [...e.dataTransfer.files].filter((f) => /pdf|image/.test(f.type));
            if (files.length) void upload.run(files.map((f) => ({ blob: f, name: f.name })));
          }}
          className={cx('rounded-xl border-2 border-dashed p-6 text-center', dragging ? 'border-brand bg-surface-2' : 'border-line bg-surface')}
        >
          <p className="text-lg font-semibold text-ink">Drop invoices here</p>
          <p className="text-sm text-muted">PDFs or photos. Credits and revised invoices too — they find their original.</p>
          <div className="mt-3 flex flex-wrap items-end justify-center gap-2">
            {me.companies.length > 1 && (
              <div className="w-60 text-left">
                <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />
              </div>
            )}
            <Button busy={upload.busy} onClick={() => void pick()}>
              Choose files
            </Button>
            <Button variant="secondary" busy={scan.busy} onClick={() => void scan.run()}>
              Check the network folder now
            </Button>
          </div>
          <ErrorBanner error={upload.error || scan.error} />
          {note && <p className="mt-2 text-ink">{note}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.filter(([k]) => isAp || ['mine', 'approval', 'all'].includes(k)).map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={show === k} variant={show === k ? 'primary' : 'secondary'} onClick={() => setShow(k)}>
            {label}
            {count(k) > 0 && ` (${count(k)})`}
          </Button>
        ))}
      </div>
      <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice #, vendor or PO #" />
      <ErrorBanner error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <PageLoading /> : list.data?.length ? <ApList rows={list.data} title={TABS.find((t) => t[0] === show)?.[1] ?? 'Invoices'} /> : <EmptyState title="Nothing here" />}
    </div>
  );
}

function ApList({ rows, title }: { rows: ApInvoiceSummary[]; title: string }) {
  return (
    <>
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={paths.apInvoice(r.id)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
              <span className="min-w-0">
                <span className="block font-semibold text-ink">
                  {r.kind === 'CREDIT' && 'Credit · '}
                  {r.vendorName ?? 'Vendor not read yet'} · {r.invoiceNumber ?? 'no number'}
                </span>
                <span className="block text-sm text-muted">
                  {[r.poNumber && `PO ${r.poNumber}`, r.target, `due ${dayLabel(r.dueDate)}`, r.receivedVia === 'FOLDER' && 'from network folder', r.waitingOn && `waiting on ${r.waitingOn}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {r.total != null && <span className="font-semibold text-ink">{formatCad(r.total)}</span>}
                {(r.holdbackAmount ?? 0) > 0 && <Badge>holdback {formatCad(r.holdbackAmount)}</Badge>}
                {r.issueCount > 0 && <Badge tone="danger">{r.issueCount} issue{r.issueCount === 1 ? '' : 's'}</Badge>}
                {r.waitingOnMe && <Badge tone="danger">Needs you</Badge>}
                <Badge tone={tone(r.status)}>{AP_STATUS_LABELS[r.status]}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <ExportButtons
        title={`Vendor invoices – ${title}`}
        columns={[
          { key: 'vendor', label: 'Vendor', width: 1.6 },
          { key: 'invoice', label: 'Invoice #' },
          { key: 'date', label: 'Date' },
          { key: 'due', label: 'Due' },
          { key: 'po', label: 'PO #' },
          { key: 'target', label: 'For', width: 1.6 },
          { key: 'total', label: 'Total', align: 'right' },
          { key: 'holdback', label: 'Holdback', align: 'right' },
          { key: 'payable', label: 'To pay', align: 'right' },
          { key: 'status', label: 'Status', width: 1.3 },
        ]}
        rows={rows.map((r) => ({ vendor: r.vendorName, invoice: r.invoiceNumber, date: r.invoiceDate, due: r.dueDate, po: r.poNumber, target: r.target, total: r.total, holdback: r.holdbackAmount, payable: r.payable, status: AP_STATUS_LABELS[r.status] }))}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// One invoice
// ---------------------------------------------------------------------------
type LineForm = { description: string; qty: string; uom: string; unitPrice: string; amount: string };

function EditDetails({ inv, onSaved }: { inv: ApInvoiceDetail; onSaved: (v: ApInvoiceDetail) => void }) {
  const { api } = useAuthed();
  const [f, setF] = useState({
    vendorName: inv.vendorName ?? '',
    invoiceNumber: inv.invoiceNumber ?? '',
    invoiceDate: inv.invoiceDate ?? '',
    dueDate: inv.dueDate ?? '',
    poNumberText: inv.poNumber ?? '',
    subtotal: inv.subtotal == null ? '' : String(inv.subtotal),
    gst: inv.gst == null ? '' : String(inv.gst),
    pst: inv.pst == null ? '' : String(inv.pst),
    total: inv.total == null ? '' : String(inv.total),
    costCode: inv.costCode ?? '',
    refInvoiceNumber: inv.refInvoiceNumber ?? '',
    kind: inv.kind,
  });
  const [lines, setLines] = useState<LineForm[]>(inv.lines.map((l) => ({ description: l.description, qty: l.qty == null ? '' : String(l.qty), uom: l.uom ?? '', unitPrice: l.unitPrice == null ? '' : String(l.unitPrice), amount: l.amount == null ? '' : String(l.amount) })));
  const save = useAction(async () =>
    onSaved(
      await api.ap.edit(inv.id, {
        kind: f.kind,
        vendorName: f.vendorName,
        invoiceNumber: f.invoiceNumber,
        invoiceDate: f.invoiceDate || null,
        dueDate: f.dueDate || null,
        poNumberText: f.poNumberText,
        subtotal: num(f.subtotal),
        gst: num(f.gst),
        pst: num(f.pst),
        total: num(f.total),
        costCode: f.costCode,
        refInvoiceNumber: f.refInvoiceNumber,
        lines: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, qty: num(l.qty), uom: l.uom || null, unitPrice: num(l.unitPrice), amount: num(l.amount) })),
      }),
    ),
  );
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Card title="Invoice details" actions={<span className="text-sm text-muted">Fix anything read wrong, then save — it re-checks against the PO.</span>}>
      <ErrorBanner error={save.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Type" value={f.kind} onChange={(e) => set('kind', e.target.value)} options={[{ value: 'INVOICE', label: 'Invoice' }, { value: 'CREDIT', label: 'Credit note' }]} />
        <TextField label="Vendor" value={f.vendorName} onChange={(e) => set('vendorName', e.target.value)} />
        <TextField label="Invoice #" value={f.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} />
        <TextField label="Invoice date" type="date" value={f.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} />
        <TextField label="Due date" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        <TextField label="PO #" value={f.poNumberText} onChange={(e) => set('poNumberText', e.target.value)} />
        <TextField label="Subtotal" inputMode="decimal" value={f.subtotal} onChange={(e) => set('subtotal', e.target.value)} />
        <TextField label="GST" inputMode="decimal" value={f.gst} onChange={(e) => set('gst', e.target.value)} />
        <TextField label="PST" inputMode="decimal" value={f.pst} onChange={(e) => set('pst', e.target.value)} />
        <TextField label="Total" inputMode="decimal" value={f.total} onChange={(e) => set('total', e.target.value)} />
        <TextField label="Cost code (no PO)" value={f.costCode} onChange={(e) => set('costCode', e.target.value)} />
        <TextField label="Revises / credits invoice #" value={f.refInvoiceNumber} onChange={(e) => set('refInvoiceNumber', e.target.value)} />
      </div>
      <p className="mt-3 font-semibold text-ink">Lines</p>
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_5rem_4rem_7rem_7rem_auto] sm:items-end">
            <TextField label="Description" value={l.description} onChange={(e) => setLines((all) => all.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <TextField label="Qty" inputMode="decimal" value={l.qty} onChange={(e) => setLines((all) => all.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            <TextField label="Unit" value={l.uom} onChange={(e) => setLines((all) => all.map((x, j) => (j === i ? { ...x, uom: e.target.value } : x)))} />
            <TextField label="Price" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLines((all) => all.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} />
            <TextField label="Amount" inputMode="decimal" value={l.amount} onChange={(e) => setLines((all) => all.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            <Button variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((all) => all.filter((_, j) => j !== i))}>
              ✕
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={() => setLines((all) => [...all, { description: '', qty: '', uom: '', unitPrice: '', amount: '' }])}>
          + Line
        </Button>
        <Button busy={save.busy} onClick={() => void save.run()}>
          Save and re-check
        </Button>
      </div>
    </Card>
  );
}

export function ApInvoiceScreen() {
  const id = useSearchParams().get('id') ?? '';
  const { api } = useAuthed();
  const loaded = useAsync(() => api.ap.get(id), [api, id]);
  const [inv, setInv] = useState<ApInvoiceDetail | null>(null);
  const platform = usePlatform();
  useEffect(() => setInv(loaded.data ?? null), [loaded.data]);
  const [note, setNote] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toLocaleDateString('en-CA'));
  const [payRef, setPayRef] = useState('');
  const [rejectTo, setRejectTo] = useState('');
  const act = useAction(async (fn: () => Promise<ApInvoiceDetail>) => {
    setInv(await fn());
    setNote('');
  });
  if (loaded.error) return <ErrorBanner error={loaded.error} onRetry={loaded.reload} />;
  if (!inv) return <PageLoading />;
  const mine = inv.approvals.filter((a) => a.mine);
  const needNote = () => {
    if (!note.trim()) {
      throw new Error('Add a note first (it explains the decision).');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={paths.ap()}
        title={`${inv.kind === 'CREDIT' ? 'Credit' : 'Invoice'} ${inv.invoiceNumber ?? '(no number)'}`}
        subtitle={[inv.vendorName, inv.poNumber && `PO ${inv.poNumber}`, inv.target].filter(Boolean).join(' · ')}
        actions={<Badge tone={tone(inv.status)}>{AP_STATUS_LABELS[inv.status]}</Badge>}
      />
      {inv && inv.receivingReports.length > 0 && (
        <Card title={`Receiving reports (${inv.receivingReports.length})`}>
          <p className="text-sm text-muted">What actually arrived for this PO — check before approving.</p>
          <ul className="mt-1">
            {inv.receivingReports.map((r) => (
              <li key={r.id}>
                <a href={api.fileUrl(r.url) ?? undefined} target="_blank" rel="noreferrer" className="text-brand-ink underline">
                  {r.label}
                </a>{' '}
                <span className="text-sm text-muted">{new Date(r.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="mt-2" onClick={async () => platform.files.saveFile(`Invoice-${inv.invoiceNumber ?? 'invoice'}-with-receiving-reports.pdf`, await api.ap.pack(inv.id))}>
            Invoice + receiving reports (PDF)
          </Button>
        </Card>
      )}
      <ErrorBanner error={act.error} />
      {inv.issues.length > 0 && (
        <Card title="Doesn't match yet" className="border-danger">
          <ul className="list-disc pl-6 text-ink">
            {inv.issues.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Card>
      )}
      {inv.replaces && (
        <Notice>
          This replaces <Link href={paths.apInvoice(inv.replaces.id)} className="underline">invoice {inv.replaces.invoiceNumber}</Link> (taken out of the Rejection Area).
        </Notice>
      )}
      {inv.replacedBy && (
        <Notice>
          Replaced by <Link href={paths.apInvoice(inv.replacedBy.id)} className="underline">{inv.replacedBy.invoiceNumber}</Link>.
        </Notice>
      )}

      {mine.length > 0 && (
        <Card title="Your turn" className="border-brand">
          <TextArea label="Note (needed to reject or hold)" value={note} onChange={(e) => setNote(e.target.value)} />
          {mine.map((a) => (
            <div key={a.id} className="mt-2 flex flex-wrap gap-2">
              {a.kind === 'MAIN' ? (
                <>
                  <Button busy={act.busy} onClick={() => void act.run(() => api.ap.decide(inv.id, { approvalId: a.id, decision: 'APPROVED', note: note || null }))}>
                    Approve
                  </Button>
                  {a.approverType === 'PROCUREMENT' && (
                    <Button variant="secondary" busy={act.busy} onClick={() => void act.run(() => api.ap.decide(inv.id, { approvalId: a.id, decision: 'PASSED', note: note || 'Approved at time of purchase' }))}>
                      Pass (approved on the PO)
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    busy={act.busy}
                    onClick={() =>
                      void act.run(async () => {
                        needNote();
                        return api.ap.decide(inv.id, { approvalId: a.id, decision: 'HOLD', note });
                      })
                    }
                  >
                    Hold for info
                  </Button>
                  <Button
                    variant="danger"
                    busy={act.busy}
                    onClick={() =>
                      void act.run(async () => {
                        needNote();
                        return api.ap.decide(inv.id, { approvalId: a.id, decision: 'REJECTED', note });
                      })
                    }
                  >
                    Reject
                  </Button>
                </>
              ) : (
                <>
                  <span className="self-center text-sm text-muted">Side review ({a.who}):</span>
                  <Button variant="secondary" busy={act.busy} onClick={() => void act.run(() => api.ap.decide(inv.id, { approvalId: a.id, decision: 'REVIEWED', note: note || null }))}>
                    Looks OK
                  </Button>
                  <Button
                    variant="secondary"
                    busy={act.busy}
                    onClick={() =>
                      void act.run(async () => {
                        needNote();
                        return api.ap.decide(inv.id, { approvalId: a.id, decision: 'FLAGGED', note });
                      })
                    }
                  >
                    Flag a concern
                  </Button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Amounts">
          <dl className="grid grid-cols-2 gap-y-1 text-ink">
            <dt>Subtotal</dt>
            <dd className="text-right">{formatCad(inv.subtotal)}</dd>
            <dt>GST</dt>
            <dd className="text-right">{formatCad(inv.gst)}</dd>
            <dt>PST</dt>
            <dd className="text-right">{formatCad(inv.pst)}</dd>
            <dt className="font-bold">Total</dt>
            <dd className="text-right font-bold">{formatCad(inv.total)}</dd>
            {(inv.holdbackAmount ?? 0) > 0 && (
              <>
                <dt>Holdback ({inv.holdbackPct}% — subcontractor)</dt>
                <dd className="text-right">−{formatCad(inv.holdbackAmount)}</dd>
                <dt className="font-bold">To pay now</dt>
                <dd className="text-right font-bold">{formatCad(inv.payable)}</dd>
              </>
            )}
          </dl>
          <p className="mt-2 text-sm text-muted">
            Dated {dayLabel(inv.invoiceDate)} · due {dayLabel(inv.dueDate)}
            {inv.paidAt && ` · paid ${dayLabel(inv.paidAt)}${inv.paymentRef ? ` (${inv.paymentRef})` : ''}`}
            {inv.holdbackReleasedAt && ' · holdback released'}
          </p>
          {inv.file && (
            <a href={api.fileUrl(inv.file.url)!} target="_blank" rel="noreferrer" className="mt-2 inline-block font-semibold text-brand-ink">
              📄 Open the invoice ({inv.file.fileName})
            </a>
          )}
          {inv.folderState && <p className="text-sm text-muted">Network folder: {inv.folderState.replace('_', ' ').toLowerCase()}</p>}
        </Card>
        <Card title="Approvals">
          {inv.approvals.length ? (
            <ol className="flex flex-col gap-1">
              {inv.approvals.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="font-semibold text-ink">
                    {a.kind === 'SIDE' ? 'Side review' : `Step ${a.step}`}: {a.who}
                  </span>{' '}
                  <Badge tone={a.decision === 'PENDING' ? 'neutral' : ['REJECTED', 'FLAGGED'].includes(a.decision) ? 'danger' : 'ok'}>{a.decision.toLowerCase()}</Badge>
                  {a.decidedByName && <span className="text-muted"> — {a.decidedByName}</span>}
                  {a.note && <span className="block text-muted">“{a.note}”</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted">Not sent for approval yet.</p>
          )}
          {inv.holdReason && <p className="mt-2 text-ink">On hold: {inv.holdReason}</p>}
          {inv.rejectedReason && <p className="mt-2 text-danger">Rejected: {inv.rejectedReason}</p>}
        </Card>
      </div>

      <Card title="Lines">
        {inv.lines.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {inv.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1 text-sm">
                <span>
                  {l.lineNo}. {l.description}
                  <span className="block text-muted">{l.poLineLabel ? `PO line: ${l.poLineLabel}` : 'Not matched to a PO line'}</span>
                </span>
                <span className="text-ink">
                  {l.qty ?? ''} {l.uom ?? ''} × {formatCad(l.unitPrice)} = <strong>{formatCad(l.amount)}</strong>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No lines read.</p>
        )}
      </Card>

      {inv.can.sendRejection && (
        <Card title="Send the rejection to the vendor" className="border-danger">
          {inv.rejectionSentTo ? (
            <p className="text-ink">
              {inv.rejectionSentAt ? 'Sent' : 'Waiting in Emails to review'} — {inv.rejectionSentTo}
            </p>
          ) : (
            <p className="text-ink">{inv.vendorApContact ? `Goes to ${inv.vendorApContact.name}${inv.vendorApContact.email ? ` (${inv.vendorApContact.email})` : ' — no email on file'}.` : 'No accounts contact for this vendor yet. Add one in Contacts (tick “Send invoice rejections to this person”), or type an email.'}</p>
          )}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <TextField label="Send to (optional)" type="email" value={rejectTo} onChange={(e) => setRejectTo(e.target.value)} placeholder={inv.vendorApContact?.email ?? 'accounts@vendor.com'} />
            <Button busy={act.busy} onClick={() => void act.run(() => api.ap.sendRejection(inv.id, { to: rejectTo.trim() || null }))}>
              Send rejection
            </Button>
            <Button variant="secondary" busy={act.busy} onClick={() => void act.run(() => api.ap.sendRejection(inv.id, { handledManually: true }))}>
              Mailed / handled by hand
            </Button>
          </div>
        </Card>
      )}

      {(inv.can.sendToApproval || inv.can.reject || inv.can.hold || inv.can.markPaid || inv.can.releaseHoldback) && (
        <Card title="AP actions">
          {(inv.can.sendToApproval || inv.can.reject || inv.can.hold) && <TextArea label="Note" value={note} onChange={(e) => setNote(e.target.value)} hint="Needed to send a mismatch on, reject or hold." />}
          <div className="mt-2 flex flex-wrap gap-2">
            {inv.can.sendToApproval && (
              <Button busy={act.busy} onClick={() => void act.run(() => api.ap.action(inv.id, { action: inv.status === 'ON_HOLD' ? 'RELEASE_HOLD' : 'SEND_TO_APPROVAL', note: note || null }))}>
                {inv.status === 'ON_HOLD' ? 'Release hold & re-check' : inv.issues.length ? 'Send to approval anyway' : 'Send to approval'}
              </Button>
            )}
            {['RECEIVED', 'NEEDS_REVIEW'].includes(inv.status) && (
              <Button variant="secondary" busy={act.busy} onClick={() => void act.run(() => api.ap.action(inv.id, { action: 'REMATCH' }))}>
                Re-check against the PO
              </Button>
            )}
            {inv.can.hold && (
              <Button variant="secondary" busy={act.busy} onClick={() => void act.run(() => api.ap.action(inv.id, { action: 'HOLD', note: note || null }))}>
                Hold for info
              </Button>
            )}
            {inv.can.reject && (
              <Button variant="danger" busy={act.busy} onClick={() => void act.run(() => api.ap.action(inv.id, { action: 'REJECT', note: note || null }))}>
                Reject
              </Button>
            )}
          </div>
          {(inv.can.markPaid || inv.can.releaseHoldback) && (
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-surface-2 p-3">
              <TextField label="Paid on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              <TextField label="Cheque / EFT reference" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
              {inv.can.markPaid && (
                <Button busy={act.busy} onClick={() => void act.run(() => api.ap.action(inv.id, { action: 'MARK_PAID', paidOn, paymentRef: payRef || null }))}>
                  Mark paid ({formatCad(inv.payable)})
                </Button>
              )}
              {inv.can.releaseHoldback && (
                <Button variant="secondary" busy={act.busy} onClick={() => void act.run(() => api.ap.action(inv.id, { action: 'RELEASE_HOLDBACK', paymentRef: payRef || null }))}>
                  Release holdback ({formatCad(inv.holdbackAmount)})
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {inv.can.edit && <EditDetails key={`${inv.id}-${inv.issues.length}-${inv.status}`} inv={inv} onSaved={setInv} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pay runs
// ---------------------------------------------------------------------------
export function PayRunsScreen() {
  const { api, me } = useAuthed();
  const [companyId, setCompanyId] = useState(me.user.companyId ?? me.companies[0]?.id ?? '');
  const runs = useAsync(() => (companyId ? api.ap.payRuns(companyId) : Promise.resolve([])), [api, companyId]);
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.ap()} title="Pay runs" subtitle="What's coming due on each pay day: approved invoices, invoices still in approval, and what open POs will bring in." />
      {me.companies.length > 1 && <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
      <ErrorBanner error={runs.error} onRetry={runs.reload} />
      {runs.loading && !runs.data ? (
        <PageLoading />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-muted">
                <tr>
                  <th className="px-3 py-2">Pay day</th>
                  <th className="px-3 py-2 text-right">Approved &amp; due</th>
                  <th className="px-3 py-2 text-right">Still in approval</th>
                  <th className="px-3 py-2 text-right">Expected from open POs</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).map((r) => (
                  <tr key={r.date} className={cx('border-t border-line', r.date < today && 'text-muted')}>
                    <td className="px-3 py-2 font-semibold">{dayLabel(r.date)}</td>
                    <td className="px-3 py-2 text-right">
                      {formatCad(r.approvedDue)} <span className="text-muted">({r.approvedCount})</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCad(r.pending)} <span className="text-muted">({r.pendingCount})</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCad(r.forecast)} <span className="text-muted">({r.forecastCount})</span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold">{formatCad(r.total)}</td>
                    <td className="px-3 py-2 text-right">{r.paid ? formatCad(r.paid) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ExportButtons
            title="Pay run forecast"
            companyId={companyId}
            columns={[
              { key: 'date', label: 'Pay day' },
              { key: 'approved', label: 'Approved & due', align: 'right' },
              { key: 'pending', label: 'In approval', align: 'right' },
              { key: 'forecast', label: 'From open POs', align: 'right' },
              { key: 'total', label: 'Total', align: 'right' },
              { key: 'paid', label: 'Paid', align: 'right' },
            ]}
            rows={(runs.data ?? []).map((r) => ({ date: r.date, approved: r.approvedDue, pending: r.pending, forecast: r.forecast, total: r.total, paid: r.paid }))}
          />
        </>
      )}
    </div>
  );
}
