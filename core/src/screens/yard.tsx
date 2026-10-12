'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { formatQty, parseQty } from '../domain/inventory';
import { formatLineNo } from '../domain/numbering';
import type { IncomingLine, ReceivingLookup, StockCheckOrder } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, cx, EmptyState, ErrorBanner, List, ListRow, Notice, PageHeader, PageLoading, SelectField, TextArea, TextField } from '../ui/components';
import { useAction, useAsync, useDebounced, useWideScreen } from '../ui/hooks';
import { useAuthed, useLive } from '../ui/session';
import { ScanButton } from '../ui/scan-button';
import { applyRowOps, str, VoiceButton } from '../ui/voice';
import { ExportButtons } from '../ui/export';
import { UpcomingLoadsCard, useLoadsToday } from './schedule';

const today = () => new Date().toISOString().slice(0, 10);

function etaGroup(eta: string | null): string {
  if (!eta) return 'No ETA yet';
  const t = today();
  if (eta < t) return 'Overdue';
  if (eta === t) return 'Today';
  const week = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  return eta <= week ? 'This week' : 'Later';
}
const GROUP_ORDER = ['Overdue', 'Today', 'This week', 'Later', 'No ETA yet'];

function dateLabel(iso: string) {
  return new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------------------------------------------------------------------------
// Yard home
// ---------------------------------------------------------------------------
export function YardHubScreen() {
  const { api, me } = useAuthed();
  const canWork = can(me.user, 'yard:work');
  const checks = useAsync(() => (canWork ? api.yard.stockChecks() : Promise.resolve([])), [api, canWork]);
  const incoming = useAsync(() => api.yard.incoming(), [api]);
  const receipts = useAsync(() => api.yard.receipts(), [api]);
  const inventory = useAsync(() => api.yard.inventory(), [api]);
  const loadsToday = useLoadsToday();
  useLive(() => {
    void checks.reload();
    void incoming.reload();
    void inventory.reload();
  });

  const due = (incoming.data ?? []).filter((l) => l.vendorEta && l.vendorEta <= today()).length;
  const tile = (href: string, title: string, big: string, sub: string, highlight = false) => (
    <Link
      href={href}
      className={cx(
        'sl-btn flex min-h-28 flex-col justify-between rounded-xl border p-4',
        highlight ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-surface text-ink',
      )}
    >
      <span className="text-lg font-bold">{title}</span>
      <span className="text-3xl font-black">{big}</span>
      <span className={cx('text-sm', highlight ? '' : 'text-muted')}>{sub}</span>
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Yard" />
      <ScanButton />
      <ButtonLink href={paths.jobMaterials()} variant="secondary">
        Inventory by job
      </ButtonLink>
      <ErrorBanner error={checks.error ?? incoming.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {canWork &&
          tile(paths.yardStockChecks(), 'Stock checks', String(checks.data?.length ?? '…'), 'order lists waiting', (checks.data?.length ?? 0) > 0)}
        {canWork && tile(paths.yardReceive(), 'Receive', '+', 'a delivery (order # or PO #)')}
        {tile(paths.yardIncoming(), 'Incoming', String(incoming.data?.length ?? '…'), due ? `${due} due today or overdue` : 'lines on order')}
        {tile(paths.yardInventory(), 'In the yard', String(inventory.data?.length ?? '…'), 'items ready to ship')}
        {tile(paths.schedule(), 'Loads today', String(loadsToday.data?.filter((l) => l.status !== 'RECEIVED').length ?? '…'), 'planned or on the way')}
      </div>
      <UpcomingLoadsCard title="Next 7 days" days={7} />
      <Card title="Recent deliveries">
        {receipts.loading && !receipts.data ? (
          <PageLoading />
        ) : receipts.data?.length ? (
          <List>
            {receipts.data.slice(0, 10).map((r) => (
              <ListRow
                key={r.id}
                href={paths.yardReceipt(r.id)}
                title={[...r.poNumbers.map((p) => `PO ${p}`), ...r.orderLabels].slice(0, 3).join(' · ') || 'Delivery'}
                subtitle={`${dateLabel(r.receivedAt)} · ${r.receivedByName} · ${r.lineCount} line${r.lineCount === 1 ? '' : 's'}${r.photoCount ? ` · ${r.photoCount} photo${r.photoCount === 1 ? '' : 's'}` : ''}`}
                right={r.problemCount > 0 && <Badge tone="danger">{r.problemCount} issue{r.problemCount === 1 ? '' : 's'}</Badge>}
              />
            ))}
          </List>
        ) : (
          <p className="text-muted">No deliveries received yet.</p>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock checks
// ---------------------------------------------------------------------------
export function StockCheckListScreen() {
  const { api } = useAuthed();
  const list = useAsync(() => api.yard.stockChecks(), [api]);
  useLive(() => void list.reload());
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.yard()} title="Stock checks" subtitle="New order lists: tell procurement what the yard already has." />
      <ErrorBanner error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? (
        <PageLoading />
      ) : list.data?.length ? (
        <List>
          {list.data.map((o) => (
            <ListRow
              key={o.orderId}
              href={paths.yardStockCheck(o.orderId)}
              title={`${o.label} · ${o.siteName}`}
              subtitle={`${o.companyName} · ${o.lines.length} line${o.lines.length === 1 ? '' : 's'} to check`}
            />
          ))}
        </List>
      ) : (
        <EmptyState title="All caught up">No order lists are waiting for a stock check.</EmptyState>
      )}
    </div>
  );
}

type Answer = { mode: 'all' | 'some' | 'none'; qty: string };

export function StockCheckScreen() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const { api } = useAuthed();
  const [data, setData] = useState<StockCheckOrder | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [yardId, setYardId] = useState('');
  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  useEffect(() => {
    api.yard
      .stockCheck(id)
      .then((d) => {
        setData(d);
        setYardId(d.yards[0]?.id ?? '');
        const a: Record<string, Answer> = {};
        for (const l of d.lines) {
          if (l.yardQtyAvailable == null) continue;
          a[l.lineId] =
            l.yardQtyAvailable >= l.quantity ? { mode: 'all', qty: '' } : l.yardQtyAvailable > 0 ? { mode: 'some', qty: String(l.yardQtyAvailable) } : { mode: 'none', qty: '' };
        }
        setAnswers(a);
      })
      .catch(setLoadError);
  }, [api, id]);

  const save = useAction(async () => {
    if (!data) return;
    const lines = data.lines
      .filter((l) => answers[l.lineId])
      .map((l) => {
        const a = answers[l.lineId]!;
        const qty = a.mode === 'all' ? l.quantity : a.mode === 'none' ? 0 : parseQty(a.qty);
        if (qty == null) throw new Error(`Enter how many you have for ${formatLineNo(l.lineNo)}.`);
        return { lineId: l.lineId, qtyAvailable: Math.min(qty, l.quantity) };
      });
    if (!lines.length) throw new Error('Mark at least one line.');
    await api.yard.saveStockCheck(id, { yardId, lines });
    router.replace(paths.yardStockChecks());
  });

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!data) return <PageLoading />;
  const answered = data.lines.filter((l) => answers[l.lineId]).length;
  const set = (lineId: string, a: Answer) => setAnswers((prev) => ({ ...prev, [lineId]: a }));

  return (
    <div className="flex flex-col gap-4 pb-24">
      <PageHeader back={paths.yardStockChecks()} title={data.label} subtitle={`${data.siteName} · ${data.companyName}`} />
      <div className="flex justify-end">
        <VoiceButton
          target={{
            screen: 'stockCheck',
            companyId: data.companyId,
            schema: {
              title: 'Yard stock check: for each line, does the yard have it? all / some (how many) / none',
              rows: {
                label: 'lines',
                canAdd: false,
                canRemove: false,
                fields: [
                  { key: 'have', label: 'In the yard', type: 'choice', options: [{ value: 'all', label: 'Have all' }, { value: 'some', label: 'Have some' }, { value: 'none', label: 'None' }] },
                  { key: 'qty', label: 'How many (when some)', type: 'number' },
                ],
              },
            },
            current: () => ({ values: {}, rows: data.lines.map((l) => ({ line: `L${l.lineNo}`, description: l.description, ordered: `${l.quantity} ${l.uom}`, have: answers[l.lineId]?.mode ?? null, qty: answers[l.lineId]?.qty ?? null })) }),
            apply: (r) => {
              const next = { ...answers };
              for (const op of r.rowOps) {
                const l = op.index != null ? data.lines[op.index] : undefined;
                if (op.op !== 'update' || !l || !op.values) continue;
                const mode = (op.values.have as Answer['mode']) ?? next[l.lineId]?.mode ?? 'some';
                next[l.lineId] = { mode, qty: op.values.qty != null ? str(op.values.qty) : (next[l.lineId]?.qty ?? '') };
              }
              setAnswers(next);
            },
            snapshot: () => answers,
            restore: setAnswers,
          }}
        />
      </div>
      {data.yards.length > 1 && (
        <SelectField label="Checking stock at" value={yardId} onChange={(e) => setYardId(e.target.value)} options={data.yards.map((y) => ({ value: y.id, label: y.name }))} />
      )}
      {data.lines.map((l) => {
        const a = answers[l.lineId];
        const choice = (mode: Answer['mode'], label: string) => (
          <button
            type="button"
            aria-pressed={a?.mode === mode}
            onClick={() => set(l.lineId, { mode, qty: a?.qty ?? '' })}
            className={cx(
              'min-h-14 flex-1 rounded-lg border px-2 text-base font-bold',
              a?.mode === mode ? (mode === 'none' ? 'border-danger bg-danger text-danger-fg' : 'border-brand bg-brand text-brand-fg') : 'border-line bg-surface text-ink',
            )}
          >
            {label}
          </button>
        );
        return (
          <Card key={l.lineId}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-muted">{formatLineNo(l.lineNo)}</p>
                <p className="text-lg font-semibold text-ink">{l.description}</p>
                <p className="text-ink">
                  Ordered: <strong>{formatQty(l.quantity)} {l.uom}</strong>
                </p>
              </div>
              {l.yardQtyAvailable != null && <Badge tone="ok">Checked</Badge>}
            </div>
            <div className="flex gap-2" role="group" aria-label={`Stock for ${formatLineNo(l.lineNo)}`}>
              {choice('all', 'Have all')}
              {choice('some', 'Some')}
              {choice('none', 'None')}
            </div>
            {a?.mode === 'some' && (
              <div className="mt-3">
                <TextField
                  label={`How many ${l.uom} do you have?`}
                  inputMode="decimal"
                  value={a.qty}
                  onChange={(e) => set(l.lineId, { mode: 'some', qty: e.target.value })}
                  autoFocus
                />
              </div>
            )}
          </Card>
        );
      })}
      <div className="safe-bottom fixed inset-x-0 bottom-16 z-10 border-t border-line bg-surface p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <ErrorBanner error={save.error} />
        <Button className="w-full lg:w-auto" busy={save.busy} disabled={answered === 0} onClick={() => void save.run()}>
          Save stock check ({answered}/{data.lines.length})
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Incoming shipments
// ---------------------------------------------------------------------------
export function IncomingScreen() {
  const { api, me, activeCompany } = useAuthed();
  const wide = useWideScreen(900);
  const yards = useAsync(() => api.sites.list({ type: 'YARD', companyId: activeCompany?.id }), [api, activeCompany?.id]);
  const [yardId, setYardId] = useState('');
  const rows = useAsync(() => api.yard.incoming(yardId || undefined), [api, yardId]);
  useLive(() => void rows.reload());

  const groups = useMemo(() => {
    const g = new Map<string, IncomingLine[]>();
    for (const r of rows.data ?? []) {
      const k = etaGroup(r.vendorEta);
      g.set(k, [...(g.get(k) ?? []), r]);
    }
    return GROUP_ORDER.filter((k) => g.has(k)).map((k) => [k, g.get(k)!] as const);
  }, [rows.data]);
  const canReceive = can(me.user, 'yard:work');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.yard()} title="Incoming" subtitle="Everything on order, by vendor ETA." />
      {(yards.data?.length ?? 0) > 1 && (
        <SelectField label="Yard" placeholder="All yards" value={yardId} onChange={(e) => setYardId(e.target.value)} options={(yards.data ?? []).map((y) => ({ value: y.id, label: y.name }))} />
      )}
      <ErrorBanner error={rows.error} onRetry={rows.reload} />
      {(rows.data?.length ?? 0) > 0 && (
        <ExportButtons
          title="Incoming"
          subtitle="Everything on order, by vendor ETA"
          columns={[
            { key: 'eta', label: 'ETA' },
            { key: 'po', label: 'PO #' },
            { key: 'vendor', label: 'Vendor', width: 1.4 },
            { key: 'for', label: 'For', width: 1.6 },
            { key: 'desc', label: 'Description', width: 2.5 },
            { key: 'remaining', label: 'Still to come', align: 'right' },
            { key: 'uom', label: 'Unit', width: 0.6 },
            { key: 'yard', label: 'Yard' },
          ]}
          rows={(rows.data ?? []).map((l) => ({ eta: l.vendorEta, po: l.poNumber, vendor: l.vendorName, for: `${l.orderLabel} L${l.lineNo}`, desc: l.description, remaining: l.qtyRemaining, uom: l.uom, yard: l.yardName }))}
        />
      )}
      {rows.loading && !rows.data ? (
        <PageLoading />
      ) : groups.length === 0 ? (
        <EmptyState title="Nothing on order">Lines show up here as soon as procurement adds a PO.</EmptyState>
      ) : (
        groups.map(([group, lines]) => (
          <Card key={group} title={<span className={group === 'Overdue' ? 'text-danger' : ''}>{group}</span>}>
            {wide ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-sm text-muted">
                    <tr>
                      {['ETA', 'PO #', 'Vendor', 'List / L#', 'Description', 'Coming', 'Yard', ''].map((h) => (
                        <th key={h} className="px-2 py-1 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.poLineId} className="border-t border-line">
                        <td className="px-2 py-2 whitespace-nowrap">{l.vendorEta ?? '–'}</td>
                        <td className="px-2 py-2 font-semibold">{l.poNumber}</td>
                        <td className="px-2 py-2">{l.vendorName}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {l.orderId ? (
                            <Link className="text-brand-ink underline" href={paths.order(l.orderId)}>
                              {l.orderLabel} {formatLineNo(l.lineNo)}
                            </Link>
                          ) : (
                            `${l.orderLabel} ${formatLineNo(l.lineNo)}`
                          )}
                        </td>
                        <td className="px-2 py-2">{l.description}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {formatQty(l.qtyRemaining)} {l.uom}
                          {l.qtyReceived > 0 && <span className="text-sm text-muted"> (of {formatQty(l.qtyOnPo)})</span>}
                        </td>
                        <td className="px-2 py-2">{l.yardName ?? '–'}</td>
                        <td className="px-2 py-1">
                          {canReceive && (
                            <ButtonLink variant="secondary" href={paths.yardReceive(l.poNumber)}>
                              Receive
                            </ButtonLink>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {lines.map((l) => (
                  <li key={l.poLineId} className="rounded-lg border border-line p-3">
                    <div className="flex justify-between gap-2">
                      <strong className="text-ink">PO {l.poNumber}</strong>
                      <span className="text-muted">{l.vendorEta ?? 'No ETA'}</span>
                    </div>
                    <p className="text-ink">{l.description}</p>
                    <p className="text-sm text-muted">
                      {formatQty(l.qtyRemaining)} {l.uom} · {l.vendorName} · {l.orderLabel} {formatLineNo(l.lineNo)}
                    </p>
                    {canReceive && (
                      <ButtonLink variant="secondary" className="mt-2 w-full" href={paths.yardReceive(l.poNumber)}>
                        Receive PO {l.poNumber}
                      </ButtonLink>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))
      )}
      {!me.user.roles.includes('YARD') && !canReceive && <Notice>You can see what's coming; the yard receives it.</Notice>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Receive a delivery
// ---------------------------------------------------------------------------
interface RecvState {
  got: boolean;
  qty: string;
  problem: boolean;
  note: string;
}

export function ReceiveScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const platform = usePlatform();
  const { api } = useAuthed();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [found, setFound] = useState<ReceivingLookup | null>(null);
  const [yardId, setYardId] = useState('');
  const [state, setState] = useState<Record<string, RecvState>>({});
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<{ name: string; blob: Blob; url: string }[]>([]);
  const [progress, setProgress] = useState('');

  const search = useAction(async (query: string) => {
    setFound(null);
    const r = await api.yard.lookup(query);
    setFound(r);
    setYardId(r.defaultYardId ?? r.yards[0]?.id ?? '');
    const s: Record<string, RecvState> = {};
    for (const l of r.lines) s[l.poLineId] = { got: l.qtyRemaining > 0, qty: l.qtyRemaining > 0 ? String(l.qtyRemaining) : '0', problem: false, note: '' };
    setState(s);
  });
  useEffect(() => {
    const initial = params.get('q');
    if (initial) void search.run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  // Photo of the packing slip / BOL → find the PO or order it belongs to. The photo is kept with the receipt.
  const [scanNote, setScanNote] = useState('');
  const scan = useAction(async () => {
    setScanNote('');
    const p = await platform.camera.takePhoto();
    if (!p) return;
    const photo = { name: p.name || 'delivery-papers.jpg', blob: p.blob, url: URL.createObjectURL(p.blob) };
    setPhotos((prev) => [...prev, photo]);
    const r = await api.yard.scan(photo.blob, photo.name);
    if (r.match?.kind === 'BOL' && r.match.bolId) return router.push(paths.bolReceive(r.match.bolId));
    if (r.match) {
      setQ(r.match.query);
      await search.run(r.match.query);
      if (r.slip?.length) {
        setState((prev) => {
          const next = { ...prev };
          for (const l of r.slip!) if (next[l.poLineId]) next[l.poLineId] = { ...next[l.poLineId]!, got: true, qty: String(l.qty) };
          return next;
        });
        setScanNote(`Quantities for ${r.slip.length} line(s) were read off the packing slip — check them before saving.`);
      }
      return;
    }
    setScanNote(
      r.textSample
        ? `Couldn't find a PO or order number in that photo. It read: “${r.textSample.slice(0, 120)}…” Type the number above instead.`
        : 'Couldn’t read that photo. Try again closer, with good light, or type the number above.',
    );
  });

  const addPhotos = useAction(async (camera: boolean) => {
    const picked = camera ? [await platform.camera.takePhoto()].filter((x) => x != null) : await platform.camera.pickImages({ multiple: true });
    setPhotos((prev) => [...prev, ...picked.map((p) => ({ name: p!.name || 'photo.jpg', blob: p!.blob, url: URL.createObjectURL(p!.blob) }))]);
  });

  const save = useAction(async () => {
    if (!found) return;
    const lines = found.lines
      .filter((l) => state[l.poLineId]?.got || state[l.poLineId]?.problem)
      .map((l) => {
        const s = state[l.poLineId]!;
        const qty = s.got ? (s.qty.trim() === '0' ? 0 : parseQty(s.qty)) : 0;
        if (qty == null) throw new Error(`Enter the quantity received for ${l.orderLabel} ${formatLineNo(l.lineNo)}.`);
        return { poLineId: l.poLineId, qtyReceived: qty, problem: s.problem, problemNote: s.problem ? s.note.trim() || null : null };
      });
    if (!lines.length) throw new Error('Tick the lines that came in.');
    setProgress('Saving…');
    const r = await api.yard.receive({ yardId, purchaseOrderId: found.purchaseOrderId, orderId: found.orderId, notes: notes.trim() || null, lines });
    for (let i = 0; i < photos.length; i++) {
      setProgress(`Uploading photo ${i + 1} of ${photos.length}…`);
      await api.yard.addPhoto(r.id, photos[i]!.blob, photos[i]!.name);
    }
    setProgress('');
    router.replace(`${paths.yardReceipt(r.id)}&saved=1`);
  });

  const upd = (id: string, patch: Partial<RecvState>) => setState((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }));
  const open = found?.lines.filter((l) => l.qtyRemaining > 0) ?? [];
  const done = found?.lines.filter((l) => l.qtyRemaining <= 0) ?? [];

  return (
    <div className="flex flex-col gap-4 pb-24">
      <PageHeader back={paths.yard()} title="Receive a delivery" />
      {found && (
        <div className="flex justify-end">
          <VoiceButton
            target={{
              screen: 'yardReceive',
              companyId: found.companyId,
              schema: {
                title: `Receiving ${found.label} at the yard: what arrived on each line`,
                fields: [{ key: 'notes', label: 'Notes', type: 'text' }],
                rows: {
                  label: 'PO lines',
                  canAdd: false,
                  canRemove: false,
                  fields: [
                    { key: 'received', label: 'Arrived', type: 'boolean' },
                    { key: 'qty', label: 'Quantity received', type: 'number' },
                    { key: 'problem', label: 'Problem (damaged / wrong)', type: 'boolean' },
                    { key: 'note', label: 'What’s wrong', type: 'text' },
                  ],
                },
              },
              current: () => ({
                values: { notes },
                rows: found.lines.map((l) => ({ line: `${l.orderLabel} L${l.lineNo}`, description: l.description, expected: `${l.qtyRemaining} ${l.uom}`, received: state[l.poLineId]?.got ?? false, qty: state[l.poLineId]?.qty ?? '', problem: state[l.poLineId]?.problem ?? false, note: state[l.poLineId]?.note ?? '' })),
              }),
              apply: (r) => {
                if (r.set.notes !== undefined) setNotes(str(r.set.notes));
                setState((prev) => {
                  const next = { ...prev };
                  for (const op of r.rowOps) {
                    const l = op.index != null ? found.lines[op.index] : undefined;
                    if (op.op !== 'update' || !l || !op.values || !next[l.poLineId]) continue;
                    const v = op.values;
                    next[l.poLineId] = {
                      ...next[l.poLineId]!,
                      ...(v.received != null ? { got: !!v.received } : {}),
                      ...(v.qty != null ? { qty: str(v.qty), got: true } : {}),
                      ...(v.problem != null ? { problem: !!v.problem } : {}),
                      ...(v.note != null ? { note: str(v.note) } : {}),
                    };
                  }
                  return next;
                });
              },
              snapshot: () => ({ state, notes }),
              restore: (s) => {
                setState(s.state);
                setNotes(s.notes);
              },
            }}
          />
        </div>
      )}
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void search.run(q);
        }}
      >
        <div className="flex-1">
          <TextField label="Order # or PO #" placeholder="e.g. 2249-1, JOB#2249 LIST#1 or PO 1042" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="characters" />
        </div>
        <Button type="submit" busy={search.busy} disabled={!q.trim()}>
          Find
        </Button>
      </form>
      {!found && (
        <Card>
          <p className="mb-3 text-ink">Or take a photo of the packing slip or BOL — we'll find the PO for you.</p>
          <Button className="min-h-16 w-full text-lg" variant="secondary" busy={scan.busy || search.busy} onClick={() => void scan.run()}>
            📷 Scan delivery papers
          </Button>
          <ErrorBanner error={scan.error} />
          {scanNote && <Notice>{scanNote}</Notice>}
        </Card>
      )}
      <ErrorBanner error={search.error} />

      {found && (
        <>
          <Card
            title={found.label}
            actions={found.vendorName && <Badge>{found.vendorName}</Badge>}
          >
            {found.lines.length === 0 && <p className="text-muted">There are no purchase orders on this list yet, so there's nothing to receive.</p>}
            {found.yards.length > 1 && (
              <SelectField label="Receiving at" value={yardId} onChange={(e) => setYardId(e.target.value)} options={found.yards.map((y) => ({ value: y.id, label: y.name }))} />
            )}
          </Card>

          {open.map((l) => {
            const s = state[l.poLineId]!;
            const qty = parseQty(s.qty) ?? 0;
            const short = s.got && qty < l.qtyRemaining - 1e-6;
            return (
              <Card key={l.poLineId} className={cx(s.problem && 'border-danger')}>
                <p className="text-sm font-semibold text-muted">
                  {l.orderLabel} {formatLineNo(l.lineNo)}
                </p>
                <p className="text-lg font-semibold text-ink">{l.description}</p>
                <p className="mb-2 text-ink">
                  Expected: <strong>{formatQty(l.qtyRemaining)} {l.uom}</strong>
                  {l.qtyReceived > 0 && <span className="text-sm text-muted"> ({formatQty(l.qtyReceived)} already in)</span>}
                </p>
                <Checkbox label="Received" checked={s.got} onChange={(v) => upd(l.poLineId, { got: v })} />
                {s.got && (
                  <TextField
                    label={`Quantity received (${l.uom})`}
                    inputMode="decimal"
                    value={s.qty}
                    onChange={(e) => upd(l.poLineId, { qty: e.target.value })}
                    hint={short ? `Short by ${formatQty(l.qtyRemaining - qty)} — procurement will be told.` : undefined}
                  />
                )}
                <Checkbox label="Flag a problem" description="Damaged, wrong item, substitution… procurement gets an email." checked={s.problem} onChange={(v) => upd(l.poLineId, { problem: v })} />
                {s.problem && <TextField label="What's wrong?" value={s.note} onChange={(e) => upd(l.poLineId, { note: e.target.value })} />}
              </Card>
            );
          })}
          {done.length > 0 && (
            <p className="text-sm text-muted">
              Already fully received: {done.map((l) => `${l.orderLabel} ${formatLineNo(l.lineNo)}`).join(', ')}
            </p>
          )}

          {open.length > 0 && (
            <>
              <Card title="Photos">
                <p className="mb-3 text-muted">Take a photo of the load and the packing slip.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" busy={addPhotos.busy} onClick={() => void addPhotos.run(true)}>
                    Take photo
                  </Button>
                  <Button variant="secondary" onClick={() => void addPhotos.run(false)}>
                    Add from gallery
                  </Button>
                </div>
                <ErrorBanner error={addPhotos.error} />
                {photos.length > 0 && (
                  <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {photos.map((p, i) => (
                      <li key={p.url} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-lg object-cover" />
                        <button
                          type="button"
                          aria-label={`Remove photo ${i + 1}`}
                          onClick={() => setPhotos((prev) => prev.filter((x) => x.url !== p.url))}
                          className="absolute top-1 right-1 h-10 w-10 rounded-full bg-black/60 font-bold text-white"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <TextArea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Card>
              <div className="safe-bottom fixed inset-x-0 bottom-16 z-10 border-t border-line bg-surface p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
                <ErrorBanner error={save.error} />
                {progress && <p className="mb-2 text-muted" aria-live="polite">{progress}</p>}
                <Button className="w-full lg:w-auto" busy={save.busy} onClick={() => void save.run()}>
                  Save delivery
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function ReceiptScreen() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const saved = params.get('saved') === '1';
  const platform = usePlatform();
  const { api, me } = useAuthed();
  const r = useAsync(() => api.yard.receipt(id), [api, id]);
  const add = useAction(async () => {
    const p = await platform.camera.takePhoto();
    if (!p) return;
    await api.yard.addPhoto(id, p.blob, p.name || 'photo.jpg');
    await r.reload();
  });

  if (r.loading && !r.data) return <PageLoading />;
  if (r.error || !r.data) return <ErrorBanner error={r.error ?? 'Not found'} onRetry={r.reload} />;
  const d = r.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.yard()} title="Delivery" subtitle={`${dateLabel(d.receivedAt)} · ${d.receivedByName} · ${d.yardName}`} />
      {saved && (
        <div role="status" className="rounded-lg border border-ok bg-surface p-3 text-ink">
          <strong className="text-ok">Saved.</strong> The items are now in yard inventory.
          {d.problemCount > 0 && ' Procurement has been told about the issues.'}
        </div>
      )}
      <Card title={[...d.poNumbers.map((p) => `PO ${p}`), ...d.orderLabels].join(' · ')}>
        <ul className="divide-y divide-line">
          {d.lines.map((l, i) => {
            const short = l.qtyReceived < l.qtyExpected - 1e-6;
            return (
              <li key={i} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {l.orderLabel} {formatLineNo(l.lineNo)} · {l.description}
                  </span>
                  {l.problem ? <Badge tone="danger">Problem</Badge> : short ? <Badge tone="danger">Short</Badge> : <Badge tone="ok">OK</Badge>}
                </div>
                <p className="text-sm text-muted">
                  Got {formatQty(l.qtyReceived)} of {formatQty(l.qtyExpected)} {l.uom}
                  {l.poNumber && ` · PO ${l.poNumber}`}
                  {l.problemNote && ` · ${l.problemNote}`}
                </p>
              </li>
            );
          })}
        </ul>
        {d.notes && <p className="mt-3 whitespace-pre-wrap text-ink">Notes: {d.notes}</p>}
      </Card>
      <Card title={`Photos (${d.photos.length})`} actions={can(me.user, 'yard:work') && <Button variant="secondary" busy={add.busy} onClick={() => void add.run()}>Add photo</Button>}>
        <ErrorBanner error={add.error} />
        {d.photos.length === 0 ? (
          <p className="text-muted">No photos.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {d.photos.map((p) => (
              <li key={p.id}>
                <button type="button" className="block w-full" onClick={() => void platform.openExternal(api.fileUrl(p.url)!)} aria-label={`Open ${p.fileName}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={api.fileUrl(p.url)!} alt={p.fileName} className="aspect-square w-full rounded-lg object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yard inventory
// ---------------------------------------------------------------------------
export function YardInventoryScreen() {
  const { api, activeCompany } = useAuthed();
  const wide = useWideScreen(900);
  const yards = useAsync(() => api.sites.list({ type: 'YARD', companyId: activeCompany?.id }), [api, activeCompany?.id]);
  const [yardId, setYardId] = useState('');
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim().toLowerCase());
  const rows = useAsync(() => api.yard.inventory(yardId || undefined), [api, yardId]);
  useLive(() => void rows.reload());
  const shown = (rows.data ?? []).filter(
    (r) => !search || `${r.description} ${r.orderLabel} ${r.siteName} ${r.poNumber ?? ''}`.toLowerCase().includes(search),
  );
  const sourceLabel = { YARD_STOCK: 'Yard stock', PO_RECEIPT: 'Delivered', RETURN: 'Returned', TRANSFER: 'Brought in', VENDOR: 'At vendor' } as const;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.yard()} title="In the yard" subtitle="Ready to ship to site — build a BOL under Shipping." />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Description, job, PO" />
        {(yards.data?.length ?? 0) > 1 && (
          <SelectField label="Yard" placeholder="All yards" value={yardId} onChange={(e) => setYardId(e.target.value)} options={(yards.data ?? []).map((y) => ({ value: y.id, label: y.name }))} />
        )}
      </div>
      <ErrorBanner error={rows.error} onRetry={rows.reload} />
      {shown.length > 0 && (
        <ExportButtons
          title="In the yard"
          subtitle="Ready to ship"
          columns={[
            { key: 'yard', label: 'Yard' },
            { key: 'desc', label: 'Description', width: 2.5 },
            { key: 'qty', label: 'Available', align: 'right' },
            { key: 'uom', label: 'Unit', width: 0.6 },
            { key: 'for', label: 'For', width: 1.8 },
            { key: 'po', label: 'PO #' },
            { key: 'source', label: 'How it came in' },
            { key: 'company', label: 'Company', width: 1.4 },
          ]}
          rows={shown.map((r) => ({ yard: r.yardName, desc: r.description, qty: r.qtyAvailable, uom: r.uom, for: `${r.orderLabel} L${r.lineNo} · ${r.siteName}`, po: r.poNumber, source: sourceLabel[r.source], company: r.companyName }))}
        />
      )}
      {rows.loading && !rows.data ? (
        <PageLoading />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing in the yard" />
      ) : wide ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left">
            <thead className="bg-surface-2 text-sm text-muted">
              <tr>
                {['Description', 'Available', 'For', 'PO #', 'Source', 'Yard'].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2">{r.description}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <strong>{formatQty(r.qtyAvailable)}</strong> {r.uom}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.orderId ? (
                      <Link className="text-brand-ink underline" href={paths.order(r.orderId)}>
                        {r.orderLabel} {formatLineNo(r.lineNo ?? 0)}
                      </Link>
                    ) : (
                      <span className="text-ink">Equipment stock</span>
                    )}{' '}
                    <span className="text-sm text-muted">{r.siteName ?? r.equipmentLabel}</span>
                  </td>
                  <td className="px-3 py-2">{r.poNumber ?? '–'}</td>
                  <td className="px-3 py-2">
                    <Badge>{sourceLabel[r.source]}</Badge>
                  </td>
                  <td className="px-3 py-2">{r.yardName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <List>
          {shown.map((r) => (
            <ListRow
              key={r.id}
              href={r.orderId ? paths.order(r.orderId) : paths.equipment()}
              title={`${formatQty(r.qtyAvailable)} ${r.uom} · ${r.description}`}
              subtitle={`${r.orderLabel ? `${r.orderLabel} ${formatLineNo(r.lineNo ?? 0)} · ${r.siteName}` : `Stock for ${r.equipmentLabel ?? 'equipment'}`}${r.poNumber ? ` · PO ${r.poNumber}` : ''} · ${r.yardName}`}
              right={<Badge>{sourceLabel[r.source]}</Badge>}
            />
          ))}
        </List>
      )}
    </div>
  );
}
