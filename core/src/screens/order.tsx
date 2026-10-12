'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { formatCad, formatQty } from '../domain/inventory';
import { formatLineNo } from '../domain/numbering';
import { checkDraftRows } from '../domain/order-validation';
import { canCancelLine, LINE_STATUS_LABELS, ORDER_STATUS_LABELS, type LineStatus } from '../domain/status';
import { emptyDraftRow, isBlankRow, type DraftRow, type OrderDetail, type OrderEmailStatus, type OrderLineView, type RowErrors } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, ErrorBanner, Notice, PageHeader, PageLoading, TextArea, TextField, cx } from '../ui/components';
import { useAction, useWideScreen } from '../ui/hooks';
import { DraftGrid, withTrailingBlank } from '../ui/order-grid';
import { useAuthed, useLive } from '../ui/session';
import { useItemSuggestions } from '../ui/suggest';
import { DropZone } from '../ui/drop-zone';
import { applyRowOps, str, VoiceButton } from '../ui/voice';
import { ExportButtons } from '../ui/export';
import { ShipmentList } from './schedule';

function showCustom(v: string | number | boolean | null | undefined): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return v == null ? '' : String(v);
}

export function statusTone(s: LineStatus | OrderDetail['status']): 'neutral' | 'brand' | 'ok' | 'danger' {
  if (s === 'CANCELLED') return 'danger';
  if (s === 'RECEIVED_ON_SITE' || s === 'COMPLETE' || s === 'RETURNED') return 'ok';
  if (s === 'DRAFT') return 'neutral';
  return 'brand';
}

export function OrderScreen() {
  const id = useSearchParams().get('id') ?? '';
  const { api } = useAuthed();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [lastEmail, setLastEmail] = useState<OrderEmailStatus | null>(null);
  const editingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setOrder(await api.orders.get(id));
    } catch (e) {
      setLoadError(e);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Another device changed this list: refresh (but never under someone who is typing in a draft).
  useLive((e) => {
    if (e.orderId === id && !editingRef.current) void load();
  });

  if (loadError) return <ErrorBanner error={loadError} onRetry={load} />;
  if (!order) return <PageLoading />;

  return order.status === 'DRAFT' ? (
    <DraftEditor
      order={order}
      editingRef={editingRef}
      onSubmitted={(o, email) => {
        setOrder(o);
        setLastEmail(email);
      }}
    />
  ) : (
    <SubmittedOrder order={order} onChanged={setOrder} lastEmail={lastEmail} />
  );
}

function PdfButtons({ order }: { order: OrderDetail }) {
  const { api } = useAuthed();
  const platform = usePlatform();
  const fileName = `${order.label.replace(/[#\s]+/g, '-')}.pdf`;
  const save = useAction(async () => platform.files.saveFile(fileName, await api.orders.pdf(order.id)));
  const print = useAction(async () => platform.print.printPdf(await api.orders.pdf(order.id), order.label));
  return (
    <>
      <Button variant="secondary" busy={save.busy} onClick={() => void save.run()}>
        Save PDF
      </Button>
      <Button variant="secondary" busy={print.busy} onClick={() => void print.run()}>
        Print
      </Button>
      {(save.error || print.error) && <ErrorBanner error={save.error ?? print.error} />}
    </>
  );
}

function DraftEditor({
  order,
  editingRef,
  onSubmitted,
}: {
  order: OrderDetail;
  editingRef: React.MutableRefObject<boolean>;
  onSubmitted: (o: OrderDetail, email: OrderEmailStatus) => void;
}) {
  const router = useRouter();
  const { api, me } = useAuthed();
  const initials = me.user.initials;
  const [rows, setRows] = useState<DraftRow[]>(() => withTrailingBlank(order.draftRows, initials));
  const [notes, setNotes] = useState(order.notes ?? '');
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<RowErrors>({});
  const [importNote, setImportNote] = useState('');
  const [typing, setTyping] = useState('');
  const itemSuggestions = useItemSuggestions(typing, { siteId: order?.siteId });
  const importing = useAction(async (f: { blob: Blob; name: string }) => {
    setImportNote('');
    const r = await api.importOrderSheet(order.siteId, f.blob, f.name);
    const kept = rows.filter((x) => x.description.trim() || x.quantity.trim());
    setRows(withTrailingBlank([...kept, ...r.rows], initials));
    setDirty(true);
    setImportNote(`Added ${r.rows.length} line${r.rows.length === 1 ? '' : 's'} from ${f.name}.${r.note ? ` ${r.note}` : ''}`);
  });
  const [confirming, setConfirming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const codes = order.costCodes.map((c) => c.code);
  const check = useMemo(() => checkDraftRows(rows, codes), [rows, codes.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineCount = rows.filter((r) => !isBlankRow(r)).length;
  const errors = showErrors ? { ...serverErrors, ...check.errors } : {};

  const toSave = useCallback(() => ({ rows: rows.slice(0, -1), notes: notes.trim() || null }), [rows, notes]);

  const flush = useCallback(async () => {
    setSaveState('saving');
    try {
      await api.orders.saveDraft(order.id, toSave());
      setDirty(false);
      editingRef.current = false;
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
      throw e;
    }
  }, [api, order.id, toSave, editingRef]);

  // Autosave about a second after typing stops.
  useEffect(() => {
    if (!dirty) return;
    editingRef.current = true;
    const t = setTimeout(() => void flush().catch(() => undefined), 1000);
    return () => clearTimeout(t);
  }, [dirty, rows, notes, flush, editingRef]);

  const submit = useAction(async () => {
    await flush();
    try {
      const result = await api.orders.submit(order.id);
      onSubmitted(result.order, result.email);
      window.scrollTo({ top: 0 });
    } catch (e) {
      const rowsErr = (e as { details?: { rows?: RowErrors } }).details?.rows;
      if (rowsErr) setServerErrors(rowsErr);
      setConfirming(false);
      throw e;
    }
  });

  const remove = useAction(async () => {
    await api.orders.remove(order.id);
    router.replace(paths.orders(order.siteId));
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={paths.orders(order.siteId)}
        title={order.label}
        subtitle={`${order.siteName} · ${order.companyName}`}
        actions={<Badge>Draft — not yet numbered</Badge>}
      />

      <p aria-live="polite" className="text-sm text-muted">
        {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? "Couldn't save — check your connection" : dirty ? 'Unsaved changes' : 'All changes saved'}
        {order.costCodes.length === 0 && ' · No cost code list set up: any code is accepted.'}
      </p>

      {showErrors && check.message && <ErrorBanner error={check.message} />}
      <ErrorBanner error={submit.error && !(submit.error as { details?: unknown }).details ? submit.error : null} />

      <div className="flex justify-end">
        <VoiceButton
          target={{
            screen: 'order',
            siteId: order.siteId,
            companyId: order.companyId,
            schema: {
              title: 'Order list (draft): lines of materials to order for the job',
              fields: [{ key: 'notes', label: 'Notes for procurement', type: 'text' }],
              rows: {
                label: 'order lines',
                canAdd: true,
                canRemove: true,
                fields: [
                  { key: 'description', label: 'Description', type: 'text' },
                  { key: 'quantity', label: 'Quantity', type: 'number' },
                  { key: 'uom', label: 'Unit', type: 'text', hint: 'EA, M, ROLL, SHEET, T, M3…' },
                  order.costCodes.length
                    ? { key: 'costCode', label: 'Cost code', type: 'choice', options: order.costCodes.map((c) => ({ value: c.code, label: c.description ? `${c.code} ${c.description}` : c.code })) }
                    : { key: 'costCode', label: 'Cost code', type: 'text' },
                  { key: 'requiredOnSite', label: 'Needed on site by', type: 'date' },
                ],
              },
            },
            current: () => ({ values: { notes }, rows: rows.slice(0, -1).filter((r) => !isBlankRow(r)) }),
            apply: (r) => {
              const map = (v: Record<string, string | number | boolean | null>) => ({
                ...(v.description !== undefined ? { description: str(v.description) } : {}),
                ...(v.quantity !== undefined ? { quantity: str(v.quantity) } : {}),
                ...(v.uom !== undefined ? { uom: str(v.uom).toUpperCase() } : {}),
                ...(v.costCode !== undefined ? { costCode: str(v.costCode) } : {}),
                ...(v.requiredOnSite !== undefined ? { requiredOnSite: str(v.requiredOnSite) } : {}),
              });
              if (r.set.notes !== undefined) setNotes(str(r.set.notes));
              const base = rows.slice(0, -1).filter((x) => !isBlankRow(x));
              setRows(withTrailingBlank(applyRowOps(base, r.rowOps, (row, v) => ({ ...row, ...map(v) }), (v) => ({ ...emptyDraftRow(initials), ...map(v) })), initials));
              setDirty(true);
            },
            snapshot: () => ({ rows, notes }),
            restore: (s) => {
              setRows(s.rows);
              setNotes(s.notes);
              setDirty(true);
            },
          }}
        />
      </div>

      <DropZone
        title="Import your own order list"
        hint="Excel or CSV in any layout — Description, Qty, Unit, Cost code and Required date are picked up wherever they are. The lines are added below for you to check."
        accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        busy={importing.busy}
        onFiles={(files) => void importing.run(files[0]!)}
      />
      <ErrorBanner error={importing.error} />
      {importNote && <Notice>{importNote}</Notice>}

      <DraftGrid
        rows={rows}
        onChange={(r) => {
          setRows(r);
          setDirty(true);
          setServerErrors({});
        }}
        errors={errors}
        costCodes={order.costCodes}
        items={itemSuggestions}
        onTyping={setTyping}
        initials={initials}
      />

      <Card>
        <TextArea
          label="Notes for procurement (optional)"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
        />
      </Card>

      {confirming ? (
        <Card title="Submit this order list?">
          <p className="mb-3 text-ink">
            {lineCount} line{lineCount === 1 ? '' : 's'} will be numbered as the next list for JOB#{order.jobNumber}. Procurement will be emailed the list for processing, the
            yard will be asked to check stock, and every line will be added to the site inventory.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button busy={submit.busy} onClick={() => void submit.run()}>
              Yes, submit
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          {order.canSubmit && (
            <Button
              onClick={() => {
                setShowErrors(true);
                if (check.ok) setConfirming(true);
              }}
            >
              Finalize / Submit
            </Button>
          )}
          <PdfButtons order={order} />
          {order.canEdit &&
            (confirmDelete ? (
              <>
                <Button variant="danger" busy={remove.busy} onClick={() => void remove.run()}>
                  Delete this draft
                </Button>
                <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete draft…
              </Button>
            ))}
        </div>
      )}
      <ErrorBanner error={remove.error} />
    </div>
  );
}

function SubmittedOrder({ order, onChanged, lastEmail }: { order: OrderDetail; onChanged: (o: OrderDetail) => void; lastEmail: OrderEmailStatus | null }) {
  const { me } = useAuthed();
  const wide = useWideScreen(900);
  const email = lastEmail ?? order.email;
  const total = order.lines.reduce((s, l) => s + (l.extendedCost ?? 0), 0);
  const anyCost = order.lines.some((l) => l.extendedCost != null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={paths.orders(order.siteId)}
        title={order.label}
        subtitle={`${order.siteName} · ${order.companyName} · submitted ${order.submittedAt ? new Date(order.submittedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : ''} by ${order.submittedByName ?? ''}`}
        actions={<Badge tone={statusTone(order.status)}>{ORDER_STATUS_LABELS[order.status]}</Badge>}
      />

      {lastEmail && (
        <div role="status" className="rounded-lg border border-ok bg-surface p-3 text-ink">
          <strong className="text-ok">Submitted.</strong> {lastEmail.sent} email{lastEmail.sent === 1 ? '' : 's'} sent to procurement and the yard. Lines were added to the site
          inventory.
        </div>
      )}
      {email?.warnings.map((w) => <Notice key={w}>{w}</Notice>)}
      {order.nextDelivery && (
        <div className="rounded-lg border border-brand bg-surface p-3 text-ink">
          <strong>Next delivery:</strong>{' '}
          {new Date(`${order.nextDelivery.date}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' })}
          {order.nextDelivery.time && ` at ${order.nextDelivery.time}`} ·{' '}
          <a href={paths.bol(order.nextDelivery.bolId)} className="font-semibold text-brand-ink underline">
            {order.nextDelivery.bolLabel}
          </a>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <PdfButtons order={order} />
        <ExportButtons
          title={order.label}
          subtitle={`${order.siteName} · ${order.companyName}`}
          companyId={order.companyId}
          columns={[
            { key: 'l', label: 'L#', width: 0.4 },
            { key: 'desc', label: 'Description', width: 3 },
            { key: 'qty', label: 'Qty', align: 'right' },
            { key: 'uom', label: 'Unit', width: 0.6 },
            { key: 'cc', label: 'Cost code' },
            { key: 'by', label: 'By', width: 0.5 },
            { key: 'req', label: 'Required' },
            { key: 'status', label: 'Status' },
            { key: 'po', label: 'PO #' },
            { key: 'vendor', label: 'Vendor', width: 1.3 },
            { key: 'eta', label: 'Vendor ETA' },
            { key: 'unit', label: 'Unit cost', align: 'right' },
            { key: 'ext', label: 'Extended', align: 'right' },
          ]}
          rows={order.lines.map((l) => ({ l: l.lineNo, desc: l.description, qty: l.quantity, uom: l.uom, cc: l.costCode, by: l.orderedByInitials, req: l.requiredOnSite, status: LINE_STATUS_LABELS[l.status], po: l.poNumbers.join(', '), vendor: l.vendorNames.join(', '), eta: l.vendorEta, unit: l.unitCost, ext: l.extendedCost }))}
        />
        <ButtonLink variant="secondary" href={paths.siteInventory(order.siteId)}>
          Site inventory
        </ButtonLink>
        {can(me.user, 'procurement:work') && (
          <ButtonLink href={paths.procurementOrder(order.id)}>Open in Buying</ButtonLink>
        )}
      </div>

      {wide ? <LinesTable order={order} onChanged={onChanged} /> : <LineCards order={order} onChanged={onChanged} />}

      {anyCost && <p className="text-right text-lg font-bold text-ink">Total (CAD): {formatCad(total)}</p>}
      {order.notes && (
        <Card title="Notes">
          <p className="whitespace-pre-wrap text-ink">{order.notes}</p>
        </Card>
      )}
    </div>
  );
}

function CancelLine({ order, line, onChanged }: { order: OrderDetail; line: OrderLineView; onChanged: (o: OrderDetail) => void }) {
  const { api } = useAuthed();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useAction(async () => onChanged(await api.orders.cancelLine(order.id, line.id, reason.trim() || null)));
  if (!order.canCancelLines || !canCancelLine(line.status)) return null;
  if (!open)
    return (
      <Button variant="ghost" onClick={() => setOpen(true)} aria-label={`Cancel ${formatLineNo(line.lineNo)}`}>
        Cancel
      </Button>
    );
  return (
    <div className="flex flex-col gap-2 py-2">
      <ErrorBanner error={cancel.error} />
      <TextField label={`Why cancel ${formatLineNo(line.lineNo)}? (optional)`} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button variant="danger" busy={cancel.busy} onClick={() => void cancel.run()}>
          Cancel line
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function LinesTable({ order, onChanged }: { order: OrderDetail; onChanged: (o: OrderDetail) => void }) {
  const head = ['L#', 'Description', 'Qty', 'Unit', 'Cost code', 'By', 'Required', 'Status', 'Shipping', 'PO #', 'Vendor', 'Vendor ETA', 'Unit cost', 'Extended', ...order.customColumns.map((c) => c.name), ''];
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-left text-base">
        <thead className="bg-surface-2 text-sm text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                {h || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.id} className={cx('border-t border-line align-top', l.status === 'CANCELLED' && 'text-muted line-through')}>
              <th scope="row" className="px-3 py-2 font-mono text-sm">
                {formatLineNo(l.lineNo)}
              </th>
              <td className="min-w-64 px-3 py-2">
                {l.description}
                {l.offListReason && <span className="block text-xs text-muted">Off-list: {l.offListReason}</span>}
              </td>
              <td className="px-3 py-2 text-right">{formatQty(l.quantity)}</td>
              <td className="px-3 py-2">{l.uom}</td>
              <td className="px-3 py-2">{l.costCode}</td>
              <td className="px-3 py-2">{l.orderedByInitials}</td>
              <td className="px-3 py-2 whitespace-nowrap">{l.requiredOnSite}</td>
              <td className="px-3 py-2 no-underline">
                <Badge tone={statusTone(l.status)}>{LINE_STATUS_LABELS[l.status]}</Badge>
              </td>
              <td className="min-w-48 px-3 py-2 no-underline">
                <ShipmentList shipments={l.shipments} uom={l.uom} />
              </td>
              <td className="px-3 py-2">
                <PoRefs line={l} />
              </td>
              <td className="px-3 py-2">{l.vendorNames.join(', ')}</td>
              <td className="px-3 py-2 whitespace-nowrap">{l.vendorEta}</td>
              <td className="px-3 py-2 text-right">{formatCad(l.unitCost)}</td>
              <td className="px-3 py-2 text-right">{formatCad(l.extendedCost)}</td>
              {order.customColumns.map((c) => (
                <td key={c.id} className="px-3 py-2">
                  {showCustom(l.custom[c.id])}
                </td>
              ))}
              <td className="px-1">
                <CancelLine order={order} line={l} onChanged={onChanged} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineCards({ order, onChanged }: { order: OrderDetail; onChanged: (o: OrderDetail) => void }) {
  return (
    <ul className="flex flex-col gap-3">
      {order.lines.map((l) => (
        <li key={l.id} className={cx('rounded-xl border border-line bg-surface p-3', l.status === 'CANCELLED' && 'opacity-70')}>
          <div className="flex items-start justify-between gap-2">
            <span className="font-bold text-ink">{formatLineNo(l.lineNo)}</span>
            <Badge tone={statusTone(l.status)}>{LINE_STATUS_LABELS[l.status]}</Badge>
          </div>
          <p className="mt-1 text-lg text-ink">{l.description}</p>
          {l.offListReason && <p className="text-sm text-muted">Off-list: {l.offListReason}</p>}
          <p className="text-ink">
            <strong>
              {formatQty(l.quantity)} {l.uom}
            </strong>
            {l.costCode && ` · ${l.costCode}`} · by {l.orderedByInitials}
            {l.requiredOnSite && ` · needed ${l.requiredOnSite}`}
          </p>
          {(l.poNumbers.length > 0 || l.vendorEta) && (
            <p className="text-sm text-muted">
              {l.poNumbers.length > 0 && (
                <>
                  PO <PoRefs line={l} /> · {l.vendorNames.join(', ')}
                </>
              )}
              {l.vendorEta && ` · ETA ${l.vendorEta}`}
            </p>
          )}
          <ShipmentList shipments={l.shipments} uom={l.uom} />
          {order.customColumns.some((c) => l.custom[c.id] != null) && (
            <p className="text-sm text-muted">
              {order.customColumns
                .filter((c) => l.custom[c.id] != null)
                .map((c) => `${c.name}: ${showCustom(l.custom[c.id])}`)
                .join(' · ')}
            </p>
          )}
          <CancelLine order={order} line={l} onChanged={onChanged} />
        </li>
      ))}
    </ul>
  );
}

/** PO numbers on a line — links to view / download for the job's PM and people who can see POs. */
function PoRefs({ line }: { line: { poNumbers: string[]; poLinks: { id: string; poNumber: string }[] | null } }) {
  const { api } = useAuthed();
  const platform = usePlatform();
  if (!line.poLinks?.length) return <>{line.poNumbers.join(', ')}</>;
  return (
    <>
      {line.poLinks.map((p, i) => (
        <span key={p.id}>
          {i > 0 && ', '}
          <Link href={paths.po(p.id)} className="text-brand-ink underline">
            {p.poNumber}
          </Link>{' '}
          <button
            type="button"
            className="text-xs text-muted underline"
            aria-label={`Download PO ${p.poNumber}`}
            onClick={async () => platform.files.saveFile(`PO-${p.poNumber}.pdf`, await api.purchaseOrders.pdf(p.id))}
          >
            PDF
          </button>
        </span>
      ))}
    </>
  );
}
