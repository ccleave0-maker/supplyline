'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';
import { formatCad, formatQty, parseQty } from '../domain/inventory';
import { formatLineNo } from '../domain/numbering';
import { LINE_STATUS_LABELS, ORDER_STATUS_LABELS } from '../domain/status';
import { CUSTOM_COLUMN_TYPES, type CustomColumn, type CustomValue, type ProcurementLine, type ProcurementOrder } from '../models';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, cx, EmptyState, ErrorBanner, List, ListRow, PageHeader, PageLoading, SelectField, TextField } from '../ui/components';
import { fieldError, useAction, useAsync } from '../ui/hooks';
import { VendorComplianceWarning } from './projects';
import { useAuthed, useLive } from '../ui/session';
import { applyRowOps, str, VoiceButton } from '../ui/voice';
import { statusTone } from './order';

// ---------------------------------------------------------------------------
// What needs buying
// ---------------------------------------------------------------------------
export function ProcurementListScreen() {
  const { api, activeCompany } = useAuthed();
  const [show, setShow] = useState<'todo' | 'onorder' | 'all'>('todo');
  const list = useAsync(() => api.procurement.orders({ show, companyId: activeCompany?.id }), [api, show, activeCompany?.id]);
  useLive(() => void list.reload());
  const tabs = [
    ['todo', 'To buy'],
    ['onorder', 'On order'],
    ['all', 'All'],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Buying"
        subtitle={activeCompany?.name}
        actions={
          <>
            <ButtonLink href={paths.pos()} variant="secondary">
              All POs
            </ButtonLink>
            <ButtonLink href={paths.poNew()}>+ New PO</ButtonLink>
          </>
        }
      />
      <div role="tablist" aria-label="Show" className="grid grid-cols-3 gap-2 rounded-xl bg-surface p-1">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={show === k} onClick={() => setShow(k)} className={cx('min-h-12 rounded-lg font-semibold', show === k ? 'bg-brand text-brand-fg' : 'text-ink')}>
            {label}
          </button>
        ))}
      </div>
      <ErrorBanner error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? (
        <PageLoading />
      ) : list.data?.length ? (
        <List>
          {list.data.map((o) => (
            <ListRow
              key={o.orderId}
              href={paths.procurementOrder(o.orderId)}
              title={`${o.label} · ${o.siteName}`}
              subtitle={[
                `${o.lineCount} line${o.lineCount === 1 ? '' : 's'}`,
                o.toBuy ? `${o.toBuy} to buy` : null,
                o.onOrder ? `${o.onOrder} on order` : null,
                o.awaitingYardCheck ? `${o.awaitingYardCheck} awaiting yard check` : null,
                o.submittedAt ? `submitted ${new Date(o.submittedAt).toLocaleDateString('en-CA')}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              right={<Badge tone={statusTone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</Badge>}
            />
          ))}
        </List>
      ) : (
        <EmptyState title={show === 'todo' ? 'Nothing left to buy' : 'Nothing here'} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One order list
// ---------------------------------------------------------------------------
function CustomCell({ column, value, onSave, label }: { column: CustomColumn; value: CustomValue; onSave: (v: CustomValue) => Promise<void>; label: string }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);
  const commit = async (v: CustomValue) => {
    setState('saving');
    try {
      await onSave(v);
      setState('idle');
    } catch {
      setState('error');
    }
  };
  const cls = cx('min-h-11 w-full rounded-md border bg-transparent px-2 text-ink', state === 'error' ? 'border-danger' : 'border-transparent hover:border-line focus:border-line');
  if (column.dataType === 'BOOLEAN')
    return <input type="checkbox" aria-label={label} className="h-6 w-6 accent-[var(--brand)]" checked={value === true} onChange={(e) => void commit(e.target.checked)} />;
  return (
    <input
      aria-label={label}
      title={state === 'error' ? "Couldn't save — check the value" : undefined}
      type={column.dataType === 'DATE' ? 'date' : 'text'}
      inputMode={column.dataType === 'NUMBER' ? 'decimal' : undefined}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (column.dataType === 'DATE') void commit(e.target.value || null);
      }}
      onBlur={() => {
        if (column.dataType === 'DATE') return;
        const cur = value == null ? '' : String(value);
        if (draft === cur) return;
        void commit(draft.trim() === '' ? null : column.dataType === 'NUMBER' ? Number(draft.replace(/,/g, '')) : draft);
      }}
      className={cls}
    />
  );
}

function PoChip({ po, onChanged }: { po: ProcurementLine['pos'][number]; onChanged: (o: ProcurementOrder) => void }) {
  const { api } = useAuthed();
  const [editing, setEditing] = useState(false);
  const [eta, setEta] = useState(po.vendorEta ?? '');
  const [cost, setCost] = useState(po.unitCost == null ? '' : String(po.unitCost));
  const [qty, setQty] = useState(String(po.qty));
  const save = useAction(async () => {
    const q = parseQty(qty);
    if (q == null) throw new Error('Enter a quantity.');
    const c = cost.trim() === '' ? null : Number(cost.replace(/[$,]/g, ''));
    if (c != null && !Number.isFinite(c)) throw new Error('Enter a cost in dollars.');
    onChanged(await api.procurement.updatePoLine(po.poLineId, { qty: q, unitCost: c, vendorEta: eta || null }));
    setEditing(false);
  });
  const remove = useAction(async () => onChanged(await api.procurement.removePoLine(po.poLineId)));

  if (!editing)
    return (
      <div className="flex flex-wrap items-center gap-1 py-0.5">
        <Link href={paths.po(po.purchaseOrderId)} className="font-semibold text-ink underline-offset-2 hover:underline">
          PO {po.poNumber}
        </Link>
        {po.poStatus !== 'ISSUED' && po.poStatus !== 'CLOSED' && <Badge tone="danger">{po.poStatus === 'PENDING_APPROVAL' ? 'Waiting approval' : po.poStatus === 'DRAFT' ? 'Draft' : po.poStatus}</Badge>}
        <span className="text-sm text-muted">
          {po.vendorName} · {formatQty(po.qty)}
          {po.vendorEta && ` · ETA ${po.vendorEta}`}
          {po.received > 0 && ` · ${formatQty(po.received)} in`}
        </span>
        <button type="button" className="min-h-10 px-2 text-sm font-semibold text-brand-ink underline" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  return (
    <div className="my-1 flex flex-col gap-2 rounded-lg border border-line p-2">
      <span className="font-semibold text-ink">
        PO {po.poNumber} · {po.vendorName}
      </span>
      <div className="grid grid-cols-3 gap-2">
        <TextField label="Qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        <TextField label="Unit $" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        <TextField label="ETA" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
      </div>
      <ErrorBanner error={save.error ?? remove.error} />
      <div className="flex flex-wrap gap-2">
        <Button busy={save.busy} onClick={() => void save.run()}>
          Save
        </Button>
        <Button variant="secondary" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run()}>
          Remove from PO
        </Button>
      </div>
    </div>
  );
}

function AssignPoPanel({ order, lines, onDone, onCancel }: { order: ProcurementOrder; lines: ProcurementLine[]; onDone: (o: ProcurementOrder) => void; onCancel: () => void }) {
  const { api } = useAuthed();
  const listId = useId();
  const [poNumber, setPoNumber] = useState('');
  const [vendor, setVendor] = useState('');
  const [eta, setEta] = useState('');
  const [yardId, setYardId] = useState(order.yards[0]?.id ?? '');
  const [rows, setRows] = useState(() =>
    Object.fromEntries(lines.map((l) => [l.id, { qty: String(l.qtyToBuy > 0 ? l.qtyToBuy : l.quantity), cost: l.unitCost == null ? '' : String(l.unitCost) }])),
  );
  const save = useAction(async () => {
    const payload = lines.map((l) => {
      const r = rows[l.id]!;
      const qty = parseQty(r.qty);
      if (qty == null) throw new Error(`Enter a quantity for ${formatLineNo(l.lineNo)}.`);
      const unitCost = r.cost.trim() === '' ? null : Number(r.cost.replace(/[$,]/g, ''));
      if (unitCost != null && !Number.isFinite(unitCost)) throw new Error(`Enter a cost in dollars for ${formatLineNo(l.lineNo)}.`);
      return { lineId: l.id, qty, unitCost };
    });
    onDone(await api.procurement.assignPo(order.orderId, { poNumber, vendorName: vendor, vendorEta: eta || null, yardId: yardId || null, lines: payload }));
  });

  return (
    <Card title={`Add ${lines.length} line${lines.length === 1 ? '' : 's'} to a PO`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run();
        }}
      >
        <ErrorBanner error={save.error} />
        <div className="flex justify-end">
          <VoiceButton
            target={{
              screen: 'buying',
              siteId: null,
              companyId: order.companyId,
              schema: {
                title: `Putting lines of ${order.label} on a purchase order`,
                fields: [
                  { key: 'poNumber', label: 'PO #', type: 'text' },
                  { key: 'vendor', label: 'Vendor', type: 'text' },
                  { key: 'eta', label: 'Vendor ETA', type: 'date' },
                ],
                rows: { label: 'lines going on the PO', canAdd: false, canRemove: false, fields: [{ key: 'qty', label: 'Quantity', type: 'number' }, { key: 'cost', label: 'Unit cost ($)', type: 'number' }] },
              },
              current: () => ({ values: { poNumber, vendor, eta }, rows: lines.map((l) => ({ line: `L${l.lineNo}`, description: l.description, qty: rows[l.id]?.qty ?? '', cost: rows[l.id]?.cost ?? '' })) }),
              apply: (r) => {
                if (r.set.poNumber !== undefined) setPoNumber(str(r.set.poNumber));
                if (r.set.vendor !== undefined) setVendor(str(r.set.vendor));
                if (r.set.eta !== undefined) setEta(str(r.set.eta));
                setRows((prev) => {
                  const next = { ...prev };
                  for (const op of r.rowOps) {
                    const l = op.index != null ? lines[op.index] : undefined;
                    if (op.op !== 'update' || !l || !op.values || !next[l.id]) continue;
                    next[l.id] = { qty: op.values.qty != null ? str(op.values.qty) : next[l.id]!.qty, cost: op.values.cost != null ? str(op.values.cost) : next[l.id]!.cost };
                  }
                  return next;
                });
              },
              snapshot: () => ({ poNumber, vendor, eta, rows }),
              restore: (s) => {
                setPoNumber(s.poNumber);
                setVendor(s.vendor);
                setEta(s.eta);
                setRows(s.rows);
              },
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="PO #" required value={poNumber} onChange={(e) => setPoNumber(e.target.value)} error={fieldError(save.error, 'poNumber')} hint="Existing PO numbers add to that PO" />
          <div>
            <TextField label="Vendor" required list={listId} value={vendor} onChange={(e) => setVendor(e.target.value)} error={fieldError(save.error, 'vendorName')} />
            <datalist id={listId}>
              {order.vendors.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <VendorComplianceWarning companyId={order.companyId} vendorName={vendor} />
          </div>
          <TextField label="Vendor ETA" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
          {order.yards.length > 1 ? (
            <SelectField label="Deliver to" value={yardId} onChange={(e) => setYardId(e.target.value)} options={order.yards.map((y) => ({ value: y.id, label: y.name }))} />
          ) : (
            <p className="self-end pb-3 text-sm text-muted">{order.yards[0] ? `Delivers to ${order.yards[0].name}` : 'No yard serves this company yet'}</p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-sm text-muted">
              <tr>
                <th className="px-2 py-1">L#</th>
                <th className="px-2 py-1">Description</th>
                <th className="w-32 px-2 py-1">Qty on this PO</th>
                <th className="w-36 px-2 py-1">Unit cost (CAD)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-2 py-1 font-mono text-sm">{formatLineNo(l.lineNo)}</td>
                  <td className="px-2 py-1">
                    {l.description} <span className="text-sm text-muted">({formatQty(l.quantity)} {l.uom} ordered)</span>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      aria-label={`Quantity for ${formatLineNo(l.lineNo)}`}
                      inputMode="decimal"
                      className="min-h-11 w-full rounded-md border border-line bg-surface px-2 text-ink"
                      value={rows[l.id]!.qty}
                      onChange={(e) => setRows({ ...rows, [l.id]: { ...rows[l.id]!, qty: e.target.value } })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      aria-label={`Unit cost for ${formatLineNo(l.lineNo)}`}
                      inputMode="decimal"
                      placeholder="$"
                      className="min-h-11 w-full rounded-md border border-line bg-surface px-2 text-ink"
                      value={rows[l.id]!.cost}
                      onChange={(e) => setRows({ ...rows, [l.id]: { ...rows[l.id]!, cost: e.target.value } })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <Button type="submit" busy={save.busy}>
            Save PO
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ColumnsPanel({ order, onChanged, onClose }: { order: ProcurementOrder; onChanged: () => void; onClose: () => void }) {
  const { api } = useAuthed();
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomColumn['dataType']>('TEXT');
  const [shared, setShared] = useState(false);
  const add = useAction(async () => {
    await api.procurement.createColumn(order.companyId, { name, dataType: type, sharedWithSite: shared });
    setName('');
    onChanged();
  });
  const toggle = useAction(async (c: CustomColumn) => {
    await api.procurement.updateColumn(order.companyId, c.id, { sharedWithSite: !c.sharedWithSite });
    onChanged();
  });
  const remove = useAction(async (c: CustomColumn) => {
    await api.procurement.deleteColumn(order.companyId, c.id);
    onChanged();
  });
  const typeLabel = { TEXT: 'Text', NUMBER: 'Number', DATE: 'Date', BOOLEAN: 'Yes / no' } as const;
  return (
    <Card title={`Custom columns – ${order.companyName}`} actions={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      <p className="mb-3 text-muted">Your own columns for tracking, on every order list in this company. Site users only see columns you share.</p>
      <ErrorBanner error={add.error ?? toggle.error ?? remove.error} />
      {order.columns.length > 0 && (
        <ul className="mb-4 divide-y divide-line">
          {order.columns.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span className="text-ink">
                <strong>{c.name}</strong> <span className="text-sm text-muted">{typeLabel[c.dataType]}</span>
              </span>
              <span className="flex items-center gap-2">
                <Checkbox label="Site can see" checked={c.sharedWithSite} onChange={() => void toggle.run(c)} />
                <Button variant="ghost" onClick={() => void remove.run(c)} aria-label={`Delete column ${c.name}`}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void add.run();
        }}
      >
        <div className="flex-1">
          <TextField label="New column name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Quote #, Freight, Expedite" />
        </div>
        <div className="sm:w-40">
          <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as CustomColumn['dataType'])} options={CUSTOM_COLUMN_TYPES.map((t) => ({ value: t, label: typeLabel[t] }))} />
        </div>
        <Checkbox label="Site can see" checked={shared} onChange={setShared} />
        <Button type="submit" disabled={!name.trim()} busy={add.busy}>
          Add column
        </Button>
      </form>
    </Card>
  );
}

export function ProcurementOrderScreen() {
  const id = useSearchParams().get('id') ?? '';
  const { api } = useAuthed();
  const [order, setOrder] = useState<ProcurementOrder | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<'none' | 'po' | 'columns'>('none');

  const load = useCallback(async () => {
    try {
      setOrder(await api.procurement.order(id));
    } catch (e) {
      setLoadError(e);
    }
  }, [api, id]);
  useEffect(() => {
    void load();
  }, [load]);
  useLive((e) => {
    if (e.orderId === id && panel === 'none') void load();
  });

  const rfq = useAction(async (sent: boolean) => {
    setOrder(await api.procurement.rfq(id, [...selected], sent));
    setSelected(new Set());
  });

  if (loadError) return <ErrorBanner error={loadError} onRetry={load} />;
  if (!order) return <PageLoading />;

  const live = order.lines.filter((l) => l.status !== 'CANCELLED');
  const allSelected = live.length > 0 && live.every((l) => selected.has(l.id));
  const toggle = (lineId: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  const selectedLines = order.lines.filter((l) => selected.has(l.id));
  const total = order.lines.reduce((a, l) => a + (l.status === 'CANCELLED' ? 0 : (l.extendedCost ?? 0)), 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={paths.procurement()}
        title={order.label}
        subtitle={`${order.siteName} · ${order.companyName}${order.submittedAt ? ` · submitted ${new Date(order.submittedAt).toLocaleDateString('en-CA')}` : ''}${order.submittedByName ? ` by ${order.submittedByName}` : ''}`}
        actions={
          <>
            <Badge tone={statusTone(order.status)}>{ORDER_STATUS_LABELS[order.status]}</Badge>
            <Link href={paths.order(order.orderId)} className="min-h-12 self-center px-2 font-semibold text-brand-ink underline">
              Site view
            </Link>
          </>
        }
      />
      {order.notes && (
        <Card title="Notes from site">
          <p className="whitespace-pre-wrap text-ink">{order.notes}</p>
        </Card>
      )}

      {panel === 'po' && selectedLines.length > 0 && (
        <AssignPoPanel
          order={order}
          lines={selectedLines}
          onDone={(o) => {
            setOrder(o);
            setSelected(new Set());
            setPanel('none');
          }}
          onCancel={() => setPanel('none')}
        />
      )}
      {panel === 'columns' && <ColumnsPanel order={order} onChanged={() => void load()} onClose={() => setPanel('none')} />}

      <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2">
        <span className="px-2 font-semibold text-ink">{selected.size} selected</span>
        <Button disabled={!selected.size} onClick={() => setPanel('po')}>
          Add to PO…
        </Button>
        <Button variant="secondary" disabled={!selected.size} busy={rfq.busy} onClick={() => void rfq.run(true)}>
          Mark sent for RFQ
        </Button>
        <Button variant="ghost" disabled={!selected.size} onClick={() => void rfq.run(false)}>
          Clear RFQ
        </Button>
        <span className="flex-1" />
        <Button variant="secondary" onClick={() => setPanel(panel === 'columns' ? 'none' : 'columns')}>
          Columns…
        </Button>
      </div>
      <ErrorBanner error={rfq.error} />

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-left text-base">
          <thead className="bg-surface-2 text-sm text-muted">
            <tr>
              <th className="w-12 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all lines"
                  className="h-6 w-6 accent-[var(--brand)]"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(live.map((l) => l.id)) : new Set())}
                />
              </th>
              {['L#', 'Description', 'Ordered', 'Yard', 'To buy', 'Status', 'PO / vendor / ETA', 'Unit cost', 'Extended'].map((h) => (
                <th key={h} className="px-2 py-2 font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
              {order.columns.map((c) => (
                <th key={c.id} className="min-w-36 px-2 py-2 font-semibold whitespace-nowrap">
                  {c.name} {c.sharedWithSite && <span title="Site can see this column">👁</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const cancelled = l.status === 'CANCELLED';
              return (
                <tr key={l.id} className={cx('border-t border-line align-top', cancelled && 'text-muted', selected.has(l.id) && 'bg-surface-2')}>
                  <td className="px-2 py-2">
                    {!cancelled && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${formatLineNo(l.lineNo)}`}
                        className="h-6 w-6 accent-[var(--brand)]"
                        checked={selected.has(l.id)}
                        onChange={(e) => toggle(l.id, e.target.checked)}
                      />
                    )}
                  </td>
                  <th scope="row" className="px-2 py-2 font-mono text-sm">
                    {formatLineNo(l.lineNo)}
                  </th>
                  <td className="min-w-56 px-2 py-2">
                    {l.description}
                    <span className="block text-sm text-muted">
                      {[l.costCode, `by ${l.orderedByInitials}`, l.requiredOnSite && `needed ${l.requiredOnSite}`].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {formatQty(l.quantity)} {l.uom}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">{l.yardChecked ? (l.yardStock > 0 ? formatQty(l.yardStock) : 'None') : <span className="text-sm text-muted">Not checked</span>}</td>
                  <td className="px-2 py-2 font-semibold whitespace-nowrap">{cancelled ? '–' : l.qtyToBuy > 0 ? formatQty(l.qtyToBuy) : '✓'}</td>
                  <td className="px-2 py-2">
                    <Badge tone={statusTone(l.status)}>{LINE_STATUS_LABELS[l.status]}</Badge>
                  </td>
                  <td className="min-w-64 px-2 py-1">
                    {l.pos.length === 0 ? <span className="text-sm text-muted">–</span> : l.pos.map((p) => <PoChip key={p.poLineId} po={p} onChanged={setOrder} />)}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">{formatCad(l.unitCost)}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">{formatCad(l.extendedCost)}</td>
                  {order.columns.map((c) => (
                    <td key={c.id} className="px-1 py-1">
                      <CustomCell
                        column={c}
                        label={`${c.name} for ${formatLineNo(l.lineNo)}`}
                        value={l.custom[c.id] ?? null}
                        onSave={async (v) => {
                          await api.procurement.setCustom(l.id, c.id, v);
                          setOrder((o) => o && { ...o, lines: o.lines.map((x) => (x.id === l.id ? { ...x, custom: { ...x.custom, [c.id]: v } } : x)) });
                        }}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total > 0 && <p className="text-right text-lg font-bold text-ink">Total (CAD): {formatCad(total)}</p>}
    </div>
  );
}
