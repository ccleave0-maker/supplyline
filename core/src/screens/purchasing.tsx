'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { formatCad, formatQty, parseQty } from '../domain/inventory';
import { LOAD_PRIORITIES, PO_SHIPPING_LABELS, PO_STATUS_LABELS, type PoDefaults, type PoDetail, type PoInput, type PoStatus, type PoSummary } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, EmailLink, EmptyState, ErrorBanner, Notice, PageHeader, PageLoading, PhoneLink, SelectField, TextArea, TextField, cx } from '../ui/components';
import { ExportButtons, PdfButtons } from '../ui/export';
import { fieldError, useAction, useAsync, useDebounced } from '../ui/hooks';
import { useAuthed, useLive } from '../ui/session';
import { DropZone } from '../ui/drop-zone';
import { useAiStatus } from '../ui/voice';
import { usePlatform } from '@supplyline/platform';
import { applyRowOps, str, VoiceButton } from '../ui/voice';
import { VendorComplianceWarning } from './projects';
import { ItemList, useItemSuggestions, useSuggestionFeedback } from '../ui/suggest';
import { PoDocumentPicker } from './documents';

export const poTone = (s: PoStatus, overdue = false) => (overdue ? 'danger' : s === 'ISSUED' ? 'brand' : s === 'CLOSED' ? 'ok' : s === 'CANCELLED' ? 'danger' : 'neutral');
const dayLabel = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const RECEIVED: Record<PoSummary['received'], string> = { NONE: 'Not received', PART: 'Part received', FULL: 'All received' };

const poColumns = [
  { key: 'po', label: 'PO #' },
  { key: 'vendor', label: 'Vendor', width: 1.4 },
  { key: 'target', label: 'For', width: 2 },
  { key: 'status', label: 'Status' },
  { key: 'ordered', label: 'Ordered' },
  { key: 'expected', label: 'Expected' },
  { key: 'received', label: 'Received' },
  { key: 'total', label: 'Total (CAD)', align: 'right' as const },
];
const poRow = (p: PoSummary) => ({
  po: p.poNumber,
  vendor: p.vendorName,
  target: p.target,
  status: p.overdue ? 'Overdue' : PO_STATUS_LABELS[p.status],
  ordered: p.orderedDate,
  expected: p.expectedDate,
  received: RECEIVED[p.received],
  total: p.totals ? p.totals.total : null,
});

/** A compact PO list (job page, equipment page). */
export function PoListCard({ siteId, equipmentId }: { siteId?: string; equipmentId?: string }) {
  const { api, me } = useAuthed();
  const pos = useAsync(() => api.purchaseOrders.list({ show: 'all', siteId, equipmentId }), [api, siteId, equipmentId]);
  const newHref = `${paths.poNew()}${siteId ? `?siteId=${encodeURIComponent(siteId)}` : equipmentId ? `?equipmentId=${encodeURIComponent(equipmentId)}` : ''}`;
  return (
    <Card title="Purchase orders" actions={can(me.user, 'procurement:work') && <ButtonLink href={newHref} variant="secondary">+ New PO</ButtonLink>}>
      <ErrorBanner error={pos.error} onRetry={pos.reload} />
      {pos.data?.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {pos.data.slice(0, 15).map((p) => (
            <li key={p.id}>
              <Link href={paths.po(p.id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-semibold text-ink">PO {p.poNumber}</span> <span className="text-muted">· {p.vendorName}</span>
                  <span className="block text-sm text-muted">
                    Expected {dayLabel(p.expectedDate)} · {RECEIVED[p.received]}
                    {p.totals && ` · ${formatCad(p.totals.total)}`}
                  </span>
                </span>
                <Badge tone={poTone(p.status, p.overdue)}>{p.overdue ? 'Overdue' : PO_STATUS_LABELS[p.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        !pos.loading && <p className="text-muted">No POs yet.</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PO list
// ---------------------------------------------------------------------------
export function PurchaseOrdersScreen() {
  const { api, me } = useAuthed();
  const [show, setShow] = useState<'open' | 'drafts' | 'approval' | 'overdue' | 'all'>('open');
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const pos = useAsync(() => api.purchaseOrders.list({ show, q: search || undefined }), [api, show, search]);
  const dash = useAsync(() => api.purchaseOrders.dashboard(), [api]);
  useLive(() => {
    void pos.reload();
    void dash.reload();
  });
  const d = dash.data;
  const tabs = [
    ['open', 'Open'],
    ['overdue', `Overdue${d?.overdue ? ` (${d.overdue})` : ''}`],
    ['approval', `Waiting approval${d?.waitingApproval ? ` (${d.waitingApproval})` : ''}`],
    ['drafts', `Drafts${d?.drafts ? ` (${d.drafts})` : ''}`],
    ['all', 'All'],
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Purchase orders"
        subtitle="POs for jobs / projects and equipment."
        actions={
          <>
            {can(me.user, 'email:review') && (
              <ButtonLink href={paths.emails()} variant="secondary">
                Emails to review{d?.emailsToReview ? ` (${d.emailsToReview})` : ''}
              </ButtonLink>
            )}
            <ButtonLink href={paths.shipVia()} variant="secondary">
              Carriers
            </ButtonLink>
            {can(me.user, 'procurement:work') && <ButtonLink href={paths.poNew()}>+ New PO</ButtonLink>}
          </>
        }
      />
      {d && (d.awaitingMyApproval > 0 || d.overdue > 0) && (
        <Notice>
          {d.awaitingMyApproval > 0 && `${d.awaitingMyApproval} PO${d.awaitingMyApproval === 1 ? ' needs' : 's need'} your approval. `}
          {d.overdue > 0 && `${d.overdue} PO${d.overdue === 1 ? ' is' : 's are'} overdue.`}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={show === k} variant={show === k ? 'primary' : 'secondary'} onClick={() => setShow(k)}>
            {label}
          </Button>
        ))}
      </div>
      <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="PO #, vendor or item" />
      <ErrorBanner error={pos.error} onRetry={pos.reload} />
      {pos.loading && !pos.data ? (
        <PageLoading />
      ) : pos.data?.length ? (
        <>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
            {pos.data.map((p) => (
              <li key={p.id}>
                <Link href={paths.po(p.id)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">
                      PO {p.poNumber} · {p.vendorName}
                    </span>
                    <span className="block text-sm text-muted">
                      {p.target} · expected {dayLabel(p.expectedDate)} · {RECEIVED[p.received]}
                      {me.companies.length > 1 && ` · ${p.companyName}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {p.totals && <span className="font-semibold text-ink">{formatCad(p.totals.total)}</span>}
                    {p.awaitingMyApproval && <Badge tone="danger">Needs your OK</Badge>}
                    <Badge tone={poTone(p.status, p.overdue)}>{p.overdue ? 'Overdue' : PO_STATUS_LABELS[p.status]}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <ExportButtons title="Purchase orders" subtitle={tabs.find((t) => t[0] === show)?.[1] ?? null} columns={poColumns} rows={pos.data.map(poRow)} />
        </>
      ) : (
        <EmptyState title="No POs here" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New / edit PO
// ---------------------------------------------------------------------------
type LineForm = { id?: string; orderLineId: string | null; orderLabel: string | null; description: string; qty: string; uom: string; cost: string; why?: string };
const blankLine = (): LineForm => ({ orderLineId: null, orderLabel: null, description: '', qty: '', uom: 'EA', cost: '', why: '' });

export function PurchaseOrderEditScreen() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const { api, me, activeCompany } = useAuthed();
  const [companyId, setCompanyId] = useState(activeCompany?.id ?? me.user.companyId ?? me.companies[0]?.id ?? '');
  const [target, setTarget] = useState<'JOB' | 'EQUIPMENT'>(params.get('equipmentId') ? 'EQUIPMENT' : 'JOB');
  const [siteId, setSiteId] = useState(params.get('siteId') ?? '');
  const [equipmentId, setEquipmentId] = useState(params.get('equipmentId') ?? '');
  const [poNumber, setPoNumber] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorContactId, setVendorContactId] = useState('');
  const [orderedDate, setOrderedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [expectedDate, setExpectedDate] = useState('');
  const [yardId, setYardId] = useState('');
  const [shipToText, setShipToText] = useState('');
  const [shipViaId, setShipViaId] = useState('');
  const [shipToLocationId, setShipToLocationId] = useState('');
  const [contact1, setContact1] = useState('');
  const [contact2, setContact2] = useState('');
  const [supplierContact, setSupplierContact] = useState('');
  const [shipDirect, setShipDirect] = useState(false);
  const [notes, setNotes] = useState('');
  const [emailVendor, setEmailVendor] = useState(false);
  const [lines, setLines] = useState<LineForm[]>([blankLine()]);
  const [loaded, setLoaded] = useState(!id);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [picking, setPicking] = useState(false);
  const [loadedStatus, setLoadedStatus] = useState<PoStatus>('DRAFT');
  const [revision, setRevision] = useState(0);
  const [sendRevised, setSendRevised] = useState(true);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const committed = loadedStatus === 'ISSUED';
  // Learned defaults: the carrier this vendor usually ships with, the yard you usually use, items ordered before.
  const [typing, setTyping] = useState('');
  const itemSuggestions = useItemSuggestions(typing, { siteId: target === 'JOB' ? siteId || null : null, companyId });
  const vendorTyped = useDebounced(vendorName.trim(), 400);
  const [suggested, setSuggested] = useState<PoDefaults | null>(null);
  const feedback = useSuggestionFeedback();

  const jobs = useAsync(() => api.sites.list({ type: 'JOB', companyId }), [api, companyId]);
  const yards = useAsync(() => api.sites.list({ type: 'YARD', companyId }), [api, companyId]);
  const units = useAsync(() => api.equipment.list({ companyId }), [api, companyId]);
  const vendors = useAsync(() => (companyId ? api.vendors(companyId) : Promise.resolve([])), [api, companyId]);
  const vendorContacts = useAsync(() => api.contacts.list({ type: 'VENDOR' }), [api]);
  const allContacts = useAsync(() => api.contacts.list({}), [api]);
  const carriers = useAsync(() => (companyId ? api.shipVia.list({ companyId }) : Promise.resolve([])), [api, companyId]);
  const shipTos = useAsync(() => (target === 'JOB' && siteId ? api.shipTo(siteId) : Promise.resolve([])), [api, target, siteId]);
  const settings = useAsync(() => (companyId ? api.purchasing.get(companyId) : Promise.resolve(null)), [api, companyId]);
  const openLines = useAsync(() => (siteId && target === 'JOB' ? api.siteInventory(siteId) : Promise.resolve([])), [api, siteId, target]);

  // New PO: suggest the next number and the company's "email the vendor" default.
  useEffect(() => {
    if (id || !companyId) return;
    api.purchaseOrders.nextNumber(companyId).then((r) => setPoNumber(r.poNumber)).catch(() => undefined);
  }, [api, companyId, id]);
  useEffect(() => {
    if (!id && settings.data) setEmailVendor(settings.data.emailVendorDefault);
  }, [id, settings.data]);
  useEffect(() => {
    if (id || !companyId) return;
    api.suggestions
      .po({ companyId, vendorName: vendorTyped || undefined, description: lines[0]?.description || undefined })
      .then(setSuggested)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, companyId, vendorTyped, id]);
  useEffect(() => {
    if (id || !yards.data?.length || yardId) return;
    const usual = suggested?.deliverToYardId ? yards.data.find((y) => y.id === suggested.deliverToYardId) : undefined;
    setYardId(usual ? usual.id : yards.data[0]!.id);
  }, [yards.data, yardId, id, suggested]);
  useEffect(() => {
    if (!id && !shipViaId && suggested?.shipViaId && carriers.data?.some((c) => c.id === suggested.shipViaId)) setShipViaId(suggested.shipViaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested, carriers.data, id]);

  // Editing a draft.
  useEffect(() => {
    if (!id) return;
    api.purchaseOrders
      .get(id)
      .then((po) => {
        if (!po.can.edit) throw new Error('This PO is complete or cancelled, so it can’t be edited.');
        setLoadedStatus(po.status);
        setDocumentIds(po.documents.map((d) => d.id));
        setRevision(po.revision);
        setCompanyId(po.companyId);
        setTarget(po.siteId ? 'JOB' : 'EQUIPMENT');
        setSiteId(po.siteId ?? '');
        setEquipmentId(po.equipmentId ?? '');
        setPoNumber(po.poNumber);
        setVendorName(po.vendor.name);
        setVendorContactId(po.vendor.contactId ?? '');
        setOrderedDate(po.orderedDate ?? '');
        setExpectedDate(po.expectedDate ?? '');
        setYardId(po.deliverTo?.id ?? '');
        setShipToText(po.shipToText ?? '');
        setShipViaId(po.shipVia?.id ?? '');
        setShipToLocationId(po.shipTo?.id ?? '');
        setContact1(po.contacts.find((c) => c.role === 'SITE_1')?.id ?? '');
        setContact2(po.contacts.find((c) => c.role === 'SITE_2')?.id ?? '');
        setSupplierContact(po.contacts.find((c) => c.role === 'SUPPLIER')?.id ?? '');
        setShipDirect(po.shipDirect);
        setNotes(po.notes ?? '');
        setEmailVendor(po.emailVendor);
        setLines(po.lines.map((l) => ({ id: l.id, orderLineId: l.orderLineId, orderLabel: l.orderLabel, description: l.description, qty: String(l.qty), uom: l.uom, cost: l.unitCost == null ? '' : String(l.unitCost), why: l.offListReason ?? '' })));
        setLoaded(true);
      })
      .catch(setLoadError);
  }, [api, id]);

  // Picking the vendor from contacts fills the name; a known vendor fills its contact.
  useEffect(() => {
    const v = vendors.data?.find((x) => x.name.toLowerCase() === vendorName.trim().toLowerCase());
    if (v?.contactId && !vendorContactId) setVendorContactId(v.contactId);
  }, [vendorName, vendors.data, vendorContactId]);

  const buildInput = (): PoInput => ({
    companyId,
    poNumber: poNumber.trim(),
    vendorName: vendorName.trim(),
    vendorContactId: vendorContactId || null,
    siteId: target === 'JOB' ? siteId || null : null,
    equipmentId: target === 'EQUIPMENT' ? equipmentId || null : null,
    orderedDate: orderedDate || null,
    expectedDate: expectedDate || null,
    deliverToYardId: yardId || null,
    shipToText: shipToText.trim() || null,
    shipViaId: shipViaId || null,
    shipToLocationId: target === 'JOB' ? shipToLocationId || null : null,
    siteContact1Id: contact1 || null,
    siteContact2Id: contact2 || null,
    supplierContactId: supplierContact || null,
    shipDirect: target === 'JOB' && shipDirect,
    notes: notes.trim() || null,
    emailVendor,
    documentIds: target === 'JOB' && siteId ? documentIds : [],
    lines: lines
      .filter((l) => l.description.trim() || l.qty.trim())
      .map((l, i) => {
        const qty = parseQty(l.qty);
        if (qty == null || qty <= 0) throw new Error(`Line ${i + 1}: enter a quantity.`);
        const cost = l.cost.trim() ? Number(l.cost.replace(/[$,]/g, '')) : null;
        if (cost != null && !Number.isFinite(cost)) throw new Error(`Line ${i + 1}: enter the unit price in dollars.`);
        return { id: l.id, orderLineId: l.orderLineId, description: l.description.trim(), qty, uom: l.uom.trim() || 'EA', unitCost: cost, offListReason: l.orderLineId ? null : l.why?.trim() || null };
      }),
  });
  const save = useAction(async (issue: boolean) => {
    const input = buildInput();
    let po = id ? await api.purchaseOrders.update(id, input) : await api.purchaseOrders.create(input);
    if (committed) {
      if (sendRevised) await api.purchaseOrders.sendToVendor(po.id);
      router.replace(paths.po(po.id));
      return;
    }
    if (!id && suggested?.shipViaId && vendorName.trim()) feedback({ kind: 'PO_SHIP_VIA', contextKey: vendorName.trim().toLowerCase(), value: suggested.shipViaId, accepted: shipViaId === suggested.shipViaId, companyId });
    if (!id && suggested?.deliverToYardId) feedback({ kind: 'PO_YARD', contextKey: me.user.id, value: suggested.deliverToYardId, accepted: yardId === suggested.deliverToYardId, companyId });
    if (issue) po = await api.purchaseOrders.issue(po.id, emailVendor);
    router.replace(paths.po(po.id));
  });

  // Read a quote (PDF / photo / handwritten / tender form) into lines: quantity, unit, description + part # only.
  const platform = usePlatform();
  const aiStatus = useAiStatus();
  const [quoteNote, setQuoteNote] = useState('');
  const quote = useAction(async (f: { blob: Blob; name: string }) => {
    setQuoteNote('');
    if (!aiStatus?.available || !aiStatus.screens.includes('quoteScan')) throw new Error('Reading quotes uses the AI. An admin can turn it on (and add the Claude key) under Admin › AI.');
    const q = await api.ai.readQuote(f.blob, f.name, companyId);
    if (!q.lines.length) throw new Error('No items could be read from that quote.');
    const base = lines.filter((l) => l.description.trim() || l.qty.trim());
    setLines([...base, ...q.lines.map((l) => ({ ...blankLine(), description: l.description, qty: String(l.qty), uom: l.uom }))]);
    if (!vendorName.trim() && q.vendorName) setVendorName(q.vendorName);
    setQuoteNote(`Added ${q.lines.length} line(s) from the quote — check them before saving.${q.notes ? ` Note: ${q.notes}` : ''}`);
  });

  const subtotal = useMemo(() => lines.reduce((a, l) => a + (parseQty(l.qty) ?? 0) * (Number(l.cost.replace(/[$,]/g, '')) || 0), 0), [lines]);
  const limit = settings.data?.approvalLimit ?? null;
  const setLine = (i: number, patch: Partial<LineForm>) => setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const picked = new Set(lines.map((l) => l.orderLineId).filter(Boolean));
  const pickable = (openLines.data ?? []).filter((r) => r.status !== 'CANCELLED' && !picked.has(r.orderLineId));

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!loaded) return <PageLoading />;
  const err = (k: string) => fieldError(save.error, k);

  return (
    <div className="flex flex-col gap-4 pb-28">
      <PageHeader back={id ? paths.po(id) : paths.pos()} title={id ? `Edit PO ${poNumber}` : 'New purchase order'} />
      <div className="flex flex-wrap justify-end gap-2">
        <VoiceButton
          target={{
            screen: 'po',
            siteId: target === 'JOB' ? siteId || null : null,
            companyId,
            schema: {
              title: 'Purchase order',
              fields: [
                { key: 'poNumber', label: 'PO #', type: 'text' },
                { key: 'vendorName', label: 'Vendor', type: 'text' },
                { key: 'expectedDate', label: 'Expected delivery date (ETA)', type: 'date' },
                { key: 'orderedDate', label: 'Date ordered', type: 'date' },
                { key: 'notes', label: 'Notes on the PO', type: 'text' },
                { key: 'emailVendor', label: 'Email the PO to the vendor', type: 'boolean' },
              ],
              rows: {
                label: 'PO lines',
                canAdd: true,
                canRemove: true,
                fields: [
                  { key: 'description', label: 'Description', type: 'text' },
                  { key: 'qty', label: 'Quantity', type: 'number' },
                  { key: 'uom', label: 'Unit', type: 'text' },
                  { key: 'cost', label: 'Unit price ($)', type: 'number' },
                ],
              },
            },
            current: () => ({ values: { poNumber, vendorName, expectedDate, orderedDate, notes, emailVendor }, rows: lines.filter((l) => l.description.trim() || l.qty.trim()) }),
            apply: (r) => {
              if (r.set.poNumber !== undefined) setPoNumber(str(r.set.poNumber));
              if (r.set.vendorName !== undefined) setVendorName(str(r.set.vendorName));
              if (r.set.expectedDate !== undefined) setExpectedDate(str(r.set.expectedDate));
              if (r.set.orderedDate !== undefined) setOrderedDate(str(r.set.orderedDate));
              if (r.set.notes !== undefined) setNotes(str(r.set.notes));
              if (r.set.emailVendor != null) setEmailVendor(!!r.set.emailVendor);
              const map = (v: Record<string, string | number | boolean | null>) => ({
                ...(v.description !== undefined ? { description: str(v.description) } : {}),
                ...(v.qty !== undefined ? { qty: str(v.qty) } : {}),
                ...(v.uom !== undefined ? { uom: str(v.uom).toUpperCase() } : {}),
                ...(v.cost !== undefined ? { cost: str(v.cost) } : {}),
              });
              const base = lines.filter((l) => l.description.trim() || l.qty.trim());
              const next = applyRowOps(base, r.rowOps, (row, v) => ({ ...row, ...map(v) }), (v) => ({ ...blankLine(), ...map(v) }));
              setLines(next.length ? next : [blankLine()]);
            },
            snapshot: () => ({ lines, poNumber, vendorName, expectedDate, orderedDate, notes, emailVendor }),
            restore: (s) => {
              setLines(s.lines);
              setPoNumber(s.poNumber);
              setVendorName(s.vendorName);
              setExpectedDate(s.expectedDate);
              setOrderedDate(s.orderedDate);
              setNotes(s.notes);
              setEmailVendor(s.emailVendor);
            },
          }}
        />
      </div>
      <DropZone
        title="Drop a quote here"
        hint="PDF or photo — typed, handwritten or a tender form. Adds the quantity, unit, and description with part number for each item (no prices, no quote number)."
        busy={quote.busy}
        onFiles={(files) => void quote.run(files[0]!)}
      />
      <ErrorBanner error={quote.error} />
      {quoteNote && <Notice>{quoteNote}</Notice>}
      <ErrorBanner error={save.error} />
      <Card title="PO">
        <div className="grid gap-3 sm:grid-cols-2">
          {!id && me.companies.length > 1 && (
            <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />
          )}
          <TextField label="PO #" required value={poNumber} onChange={(e) => setPoNumber(e.target.value)} hint="Suggested next number — type over it if you need to." error={err('poNumber')} />
          <div>
            <TextField label="Vendor" required list="po-vendors" value={vendorName} onChange={(e) => setVendorName(e.target.value)} error={err('vendorName')} />
            <datalist id="po-vendors">
              {(vendors.data ?? []).map((v) => (
                <option key={v.id} value={v.name} />
              ))}
            </datalist>
            <VendorComplianceWarning companyId={companyId} vendorName={vendorName} />
            {!id && !vendorName.trim() && suggested && suggested.vendors.length > 0 && (
              <p className="text-sm text-muted">
                Usually bought from:{' '}
                {suggested.vendors.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    className="mr-2 text-brand-ink underline"
                    onClick={() => {
                      setVendorName(v.name);
                      feedback({ kind: 'VENDOR', contextKey: (lines[0]?.description ?? '').toLowerCase().slice(0, 200), value: v.name, accepted: true, companyId });
                    }}
                  >
                    {v.name}
                  </button>
                ))}
              </p>
            )}
            <ItemList id="po-item-suggestions" items={itemSuggestions} />
          </div>
          <SelectField
            label="Vendor contact (for emailing the PO)"
            placeholder="Choose from Contacts (type Vendor)"
            value={vendorContactId}
            onChange={(e) => {
              setVendorContactId(e.target.value);
              const c = vendorContacts.data?.find((x) => x.id === e.target.value);
              if (c && !vendorName.trim()) setVendorName(c.businessName ?? c.name);
            }}
            options={(vendorContacts.data ?? []).map((c) => ({ value: c.id, label: `${c.businessName ?? c.name}${c.email ? ` — ${c.email}` : ' (no email)'}` }))}
          />
        </div>
      </Card>

      <Card title="What it's for">
        <div className="mb-3 flex gap-2" role="radiogroup">
          {(['JOB', 'EQUIPMENT'] as const).map((t) => (
            <Button key={t} role="radio" aria-checked={target === t} variant={target === t ? 'primary' : 'secondary'} onClick={() => setTarget(t)}>
              {t === 'JOB' ? 'Job / project' : 'Equipment'}
            </Button>
          ))}
        </div>
        {target === 'JOB' ? (
          <SelectField
            label="Job / project"
            placeholder="Choose a job"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            options={(jobs.data ?? []).map((s) => ({ value: s.id, label: `JOB#${s.jobNumber} ${s.name}` }))}
            error={err('siteId')}
          />
        ) : (
          <SelectField
            label="Unit"
            placeholder="Choose a unit"
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
            options={(units.data ?? []).map((u) => ({ value: u.id, label: `${u.unitNumber} · ${u.description}` }))}
            error={err('equipmentId')}
          />
        )}
        <p className="mt-2 text-sm text-muted">PST is worked out from the job's province, or the unit's PST-exempt setting, when the PO is issued.</p>
      </Card>

      <Card title="Dates & delivery">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Date ordered" type="date" value={orderedDate} onChange={(e) => setOrderedDate(e.target.value)} />
          <TextField label="Expected delivery date (ETA)" hint="On the 1 PM of this day, if it isn’t received, the yard and supplier are asked and you’re told." type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          <SelectField
            label="Deliver to"
            placeholder={target === 'JOB' ? 'Straight to the job site' : 'Not set'}
            value={yardId}
            onChange={(e) => setYardId(e.target.value)}
            options={(yards.data ?? []).map((y) => ({ value: y.id, label: `${y.name} (yard)` }))}
          />
          <TextField label="Delivery instructions (optional)" value={shipToText} onChange={(e) => setShipToText(e.target.value)} />
          {target === 'JOB' && siteId && (
            <SelectField
              label="Ship to"
              placeholder="The job site"
              hint="The job's ship-to locations are set on the job page."
              value={shipToLocationId}
              onChange={(e) => setShipToLocationId(e.target.value)}
              options={(shipTos.data ?? []).map((l) => ({ value: l.id, label: l.siteType === 'YARD' ? `${l.businessName} (yard)` : l.businessName }))}
            />
          )}
          <SelectField
            label="Ship via"
            placeholder="Not set"
            hint={
              <>
                {!id && shipViaId && shipViaId === suggested?.shipViaId && 'Usual carrier for this vendor · '}
                <a className="underline" href={paths.shipVia()}>
                  Carriers & account numbers
                </a>
              </>
            }
            value={shipViaId}
            onChange={(e) => setShipViaId(e.target.value)}
            options={(carriers.data ?? []).map((c) => ({ value: c.id, label: c.accountNumber ? `${c.name} · acct ${c.accountNumber}` : c.name }))}
          />
        </div>
        {target === 'JOB' && (
          <div className="mt-3">
            <Checkbox label="Ship direct to the job" description="The vendor delivers straight to site: when the PO is issued, a BOL is made with the expected date and the site is told so they can receive it." checked={shipDirect} onChange={setShipDirect} />
          </div>
        )}
      </Card>

      <Card title="Contacts">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Site contact" placeholder="—" value={contact1} onChange={(e) => setContact1(e.target.value)} options={(allContacts.data ?? []).map((c) => ({ value: c.id, label: c.businessName ? `${c.name} (${c.businessName})` : c.name }))} />
          <SelectField label="Second site contact" placeholder="—" value={contact2} onChange={(e) => setContact2(e.target.value)} options={(allContacts.data ?? []).map((c) => ({ value: c.id, label: c.businessName ? `${c.name} (${c.businessName})` : c.name }))} />
          <SelectField label="Ordered with (at the vendor)" placeholder="—" value={supplierContact} onChange={(e) => setSupplierContact(e.target.value)} options={(allContacts.data ?? []).filter((c) => c.type !== 'PERSON').map((c) => ({ value: c.id, label: c.businessName ? `${c.name} (${c.businessName})` : c.name }))} />
        </div>
        <p className="mt-2 text-sm text-muted">Their phone numbers and emails go on the PO. Add people under Contacts (or import them from Excel).</p>
      </Card>

      <Card
        title="Lines"
        actions={
          target === 'JOB' &&
          siteId && (
            <Button variant="secondary" onClick={() => setPicking((p) => !p)}>
              {picking ? 'Done adding' : '+ From the job’s order lists'}
            </Button>
          )
        }
      >
        {picking && (
          <div className="mb-3 max-h-72 overflow-y-auto rounded-lg border border-line p-2">
            {pickable.length ? (
              pickable.map((r) => (
                <button
                  key={r.orderLineId}
                  type="button"
                  className="block w-full rounded px-2 py-2 text-left hover:bg-surface-2"
                  onClick={() =>
                    setLines((all) => [
                      ...all.filter((l) => l.description.trim() || l.qty.trim()),
                      { orderLineId: r.orderLineId, orderLabel: `${r.orderLabel} L${r.lineNo}`, description: r.description, qty: String(r.qtyOrdered), uom: r.uom, cost: '' },
                    ])
                  }
                >
                  <span className="font-semibold text-ink">+ {r.description}</span>{' '}
                  <span className="text-sm text-muted">
                    {r.orderLabel} L{r.lineNo} · {formatQty(r.qtyOrdered)} {r.uom}
                  </span>
                </button>
              ))
            ) : (
              <p className="text-muted">No open lines on this job.</p>
            )}
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {lines.map((l, i) => (
            <li key={i} className="rounded-lg border border-line p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold text-muted">
                  Line {i + 1}
                  {l.orderLabel && ` · from ${l.orderLabel}`}
                </span>
                <Button variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((all) => all.filter((_, j) => j !== i))}>
                  ✕
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_7rem_6rem_8rem]">
                <TextField
                  label="Description"
                  list="po-item-suggestions"
                  value={l.description}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTyping(v);
                    const hit = itemSuggestions.find((s) => s.description === v);
                    setLine(i, { description: v, ...(hit?.uom && (!l.uom || l.uom === 'EA') ? { uom: hit.uom } : {}) });
                    if (hit) feedback({ kind: 'ITEM', value: hit.description, accepted: true, companyId });
                  }}
                />
                <TextField label="Qty" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                <TextField label="Unit" value={l.uom} onChange={(e) => setLine(i, { uom: e.target.value })} />
                <TextField label="Unit price ($)" inputMode="decimal" value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} />
              </div>
              {target === 'JOB' && !l.orderLineId && (
                <TextField className="mt-2" label="Off-list: why? (shown on the job's order list)" placeholder="e.g. Super called — ran short" value={l.why ?? ''} onChange={(e) => setLine(i, { why: e.target.value })} />
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" onClick={() => setLines((all) => [...all, blankLine()])}>
            + Add line
          </Button>
          <span className="text-lg font-semibold text-ink">Subtotal {formatCad(subtotal)} + tax</span>
        </div>
        {limit != null && subtotal > limit && <Notice>Over the approval limit of {formatCad(limit)} — it will go to an admin or the job’s PM to approve before it’s issued.</Notice>}
        {target === 'JOB' && <p className="mt-2 text-sm text-muted">Lines you type here (off-list buys) are added to the job’s most recent order list, with the reason you give.</p>}
      </Card>

      {target === 'JOB' && siteId && <PoDocumentPicker siteId={siteId} value={documentIds} onChange={setDocumentIds} />}

      <Card>
        <TextArea label="Notes on the PO (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="mt-2">
          <Checkbox label="Email the PO to the vendor when it's committed" description="It waits in “Emails to review” first if your company set that." checked={emailVendor} onChange={setEmailVendor} />
        </div>
      </Card>

      <div className="sl-action-bar fixed inset-x-0 z-10 border-t border-line bg-surface p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <div className="flex flex-wrap gap-2">
          {committed ? (
            <>
              <Checkbox label="Send the revised PO to the vendor" checked={sendRevised} onChange={setSendRevised} />
              <Button busy={save.busy} onClick={() => void save.run(false)}>
                Save changes (Rev {revision + 1})
              </Button>
            </>
          ) : (
            <>
              <Button busy={save.busy} onClick={() => void save.run(true)}>
                {limit != null && subtotal > limit ? 'Send for approval' : 'Commit PO'}
              </Button>
              <Button variant="secondary" busy={save.busy} onClick={() => void save.run(false)}>
                Save as pending
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One PO
// ---------------------------------------------------------------------------
export function PurchaseOrderScreen() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const { api } = useAuthed();
  const po = useAsync(() => api.purchaseOrders.get(id), [api, id]);
  useLive(() => void po.reload());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [note, setNote] = useState('');
  const [emailVendor, setEmailVendor] = useState<boolean | null>(null);
  const act = useAction(async (fn: () => Promise<unknown>) => {
    await fn();
    await po.reload();
  });
  const [sent, setSent] = useState('');

  if (po.error) return <ErrorBanner error={po.error} onRetry={po.reload} />;
  const p = po.data;
  if (!p) return <PageLoading />;
  const file = (packing: boolean) => `${packing ? 'Packing-list' : 'PO'}-${p.poNumber.replace(/[^\w-]+/g, '-')}.pdf`;
  const lineCols = [
    { key: 'n', label: '#', width: 0.4 },
    { key: 'ref', label: 'Ref', width: 1.4 },
    { key: 'desc', label: 'Description', width: 3 },
    { key: 'qty', label: 'Qty', align: 'right' as const },
    { key: 'uom', label: 'Unit', width: 0.6 },
    ...(p.showPrices
      ? [
          { key: 'unit', label: 'Unit price', align: 'right' as const },
          { key: 'ext', label: 'Amount', align: 'right' as const },
        ]
      : []),
    { key: 'rec', label: 'Received', align: 'right' as const },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={paths.pos()}
        title={`PO ${p.poNumber}`}
        subtitle={`${p.vendor.name} · ${p.target}`}
        actions={
          <>
            {p.revision > 0 && <Badge>Rev {p.revision}</Badge>} <Badge tone={poTone(p.status, p.overdue)}>{p.overdue ? 'Overdue' : PO_STATUS_LABELS[p.status]}</Badge>
          </>
        }
      />
      <ErrorBanner error={act.error} />
      {sent && <Notice>{sent}</Notice>}
      {p.approval.note && p.status === 'DRAFT' && <Notice>Sent back: {p.approval.note}</Notice>}
      {p.status === 'CLOSED' && <Notice>Complete — invoiced in full{p.completedAt ? ` on ${dayLabel(p.completedAt.slice(0, 10))}` : ''}. It’s locked: credits still post, but a new invoice goes to the rejection area to be checked.</Notice>}
      {p.can.changeEta && <EtaCard po={p} onChanged={() => void po.reload()} />}
      {(p.shipping.canPost || p.shipping.loads.length > 0) && <PoShippingCard po={p} onChanged={() => void po.reload()} />}
      {p.documents.length > 0 && (
        <Card title="Attached documents">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {p.documents.map((d) => (
              <li key={d.id}>
                <a href={api.fileUrl(d.url) ?? undefined} target="_blank" rel="noreferrer" className="text-brand-ink underline">
                  {d.linkName}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm text-muted">These are added at the end of the PO PDF.</p>
        </Card>
      )}

      {p.can.approve && (
        <Card title="Needs your approval" className="border-brand">
          <p className="mb-2 text-ink">
            {p.totals && `${formatCad(p.totals.subtotal)} before tax`}
            {p.approval.limit != null && ` — over the ${formatCad(p.approval.limit)} limit.`}
          </p>
          <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <Button busy={act.busy} onClick={() => void act.run(() => api.purchaseOrders.decide(p.id, { approve: true, note: note || null }))}>
              Approve & issue
            </Button>
            <Button variant="secondary" busy={act.busy} onClick={() => void act.run(() => api.purchaseOrders.decide(p.id, { approve: false, note: note || null }))}>
              Send back
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {p.showPrices && <PdfButtons title={`PO ${p.poNumber}`} fileName={file(false)} load={() => api.purchaseOrders.pdf(p.id)} label="PO PDF" />}
        <PdfButtons title={`Packing list ${p.poNumber}`} fileName={file(true)} load={() => api.purchaseOrders.pdf(p.id, true)} label="Packing list" />
        {p.can.edit && (
          <ButtonLink href={paths.poEdit(p.id)} variant="secondary">
            Edit
          </ButtonLink>
        )}
        {p.can.sendToVendor && (
          <Button
            variant="secondary"
            busy={act.busy}
            onClick={() =>
              void act.run(async () => {
                const r = await api.purchaseOrders.sendToVendor(p.id);
                setSent(r.state === 'HELD' ? 'The email to the vendor is waiting in “Emails to review”.' : r.state === 'SENT' ? 'Sent to the vendor.' : 'The email could not be sent — see Emails to review.');
              })
            }
          >
            {p.vendorSentAt ? 'Send to vendor again' : 'Send to vendor'}
          </Button>
        )}
        {p.can.close && (
          <Button variant="ghost" busy={act.busy} onClick={() => void act.run(() => api.purchaseOrders.close(p.id))}>
            Mark complete (admin)
          </Button>
        )}
        {p.can.reopen && (
          <Button variant="secondary" busy={act.busy} onClick={() => void act.run(() => api.purchaseOrders.reopen(p.id))}>
            Reopen PO (admin)
          </Button>
        )}
        {p.can.cancel &&
          (confirmCancel ? (
            <Button variant="danger" busy={act.busy} onClick={() => void act.run(() => api.purchaseOrders.cancel(p.id))}>
              Yes, cancel PO
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
              Cancel PO
            </Button>
          ))}
        {p.status === 'DRAFT' && p.can.edit && (
          <Button
            variant="ghost"
            busy={act.busy}
            onClick={() =>
              void act.run(async () => {
                await api.purchaseOrders.remove(p.id);
                router.replace(paths.pos());
              })
            }
          >
            Delete draft
          </Button>
        )}
      </div>

      {p.can.issue && (
        <Card title="Ready to commit?">
          <Checkbox label="Email the PO to the vendor" checked={emailVendor ?? p.emailVendor} onChange={setEmailVendor} />
          <Button className="mt-2" busy={act.busy} onClick={() => void act.run(() => api.purchaseOrders.issue(p.id, emailVendor ?? p.emailVendor))}>
            {p.approval.required ? 'Send for approval' : 'Commit PO'}
          </Button>
          <p className="mt-2 text-sm text-muted">Committing emails the priced PO to the job’s PM and the packing list to the yard, and turns on the ETA chase-up. Pending POs stay quiet.</p>
        </Card>
      )}

      <Card title="Details">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted">Vendor</dt>
            <dd className="text-ink">
              {p.vendor.name}
              {p.vendor.contactName && <span className="text-muted"> — {p.vendor.contactName}</span>}
              <span className="flex flex-wrap gap-x-4">
                <PhoneLink number={p.vendor.phone} />
                <EmailLink email={p.vendor.email} />
              </span>
              {!p.vendor.email && p.vendor.contactId && (
                <Link href={paths.contactEdit(p.vendor.contactId)} className="text-sm text-brand-ink underline">
                  Add the vendor's email
                </Link>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">For</dt>
            <dd className="text-ink">
              {p.siteId ? <Link href={paths.site(p.siteId)} className="text-brand-ink underline">{p.target}</Link> : p.equipmentId ? <Link href={paths.equipmentView(p.equipmentId)} className="text-brand-ink underline">{p.target}</Link> : p.target}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Deliver to</dt>
            <dd className="text-ink">
              {p.shipTo ? p.shipTo.name : (p.deliverTo?.name ?? (p.siteId ? 'Straight to the job' : '—'))}
              {p.shipTo?.address && <span className="block text-sm text-muted">{p.shipTo.address}</span>}
              {p.shipToText && <span className="block text-sm text-muted">{p.shipToText}</span>}
              {p.shipDirect && (
                <span className="block text-sm">
                  Ship direct to site{p.directBolId && (
                    <>
                      {' · '}
                      <Link href={paths.bol(p.directBolId)} className="text-brand-ink underline">
                        its BOL
                      </Link>
                    </>
                  )}
                </span>
              )}
            </dd>
          </div>
          {p.shipVia && (
            <div>
              <dt className="text-sm text-muted">Ship via</dt>
              <dd className="text-ink">
                {p.shipVia.name}
                {p.shipVia.accountNumber && <span className="block text-sm text-muted">Account # {p.shipVia.accountNumber}</span>}
                {p.shipVia.phone && <PhoneLink number={p.shipVia.phone} className="block text-sm" />}
              </dd>
            </div>
          )}
          {p.contacts.map((c) => (
            <div key={c.role}>
              <dt className="text-sm text-muted">{c.role === 'SUPPLIER' ? 'Ordered with' : 'Site contact'}</dt>
              <dd className="text-ink">
                {c.name}
                {c.businessName && <span className="text-muted"> · {c.businessName}</span>}
                {c.phone && <PhoneLink number={c.phone} className="block text-sm" />}
                {c.email && <EmailLink email={c.email} className="block text-sm" />}
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-sm text-muted">Ordered / expected</dt>
            <dd className={cx('text-ink', p.overdue && 'font-semibold text-danger')}>
              {dayLabel(p.orderedDate)} → {dayLabel(p.expectedDate)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Issued</dt>
            <dd className="text-ink">
              {p.issuedAt ? `${new Date(p.issuedAt).toLocaleDateString('en-CA')}${p.issuedByName ? ` by ${p.issuedByName}` : ''}` : '—'}
              {p.approval.approvedByName && <span className="block text-sm text-muted">Approved by {p.approval.approvedByName}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Vendor email</dt>
            <dd className="text-ink">{p.vendorSentAt ? `Sent ${new Date(p.vendorSentAt).toLocaleDateString('en-CA')}` : p.emailVendor ? 'Will be emailed / waiting review' : 'Not emailed'}</dd>
          </div>
        </dl>
        {p.madeListId && (
          <p className="mt-2 text-sm">
            <Link href={paths.order(p.madeListId)} className="font-semibold text-brand-ink">
              The job’s order list made from this PO ›
            </Link>
          </p>
        )}
        {p.notes && <p className="mt-2 whitespace-pre-wrap text-ink">{p.notes}</p>}
      </Card>

      <Card title="Lines">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-base">
            <thead className="text-sm text-muted">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">Description</th>
                <th className="px-2 py-1 text-right">Qty</th>
                {p.showPrices && <th className="px-2 py-1 text-right">Unit price</th>}
                {p.showPrices && <th className="px-2 py-1 text-right">Amount</th>}
                <th className="px-2 py-1 text-right">Received</th>
              </tr>
            </thead>
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="px-2 py-2">{l.lineNo}</td>
                  <td className="px-2 py-2">
                    {l.description}
                    {l.orderLabel && (
                      <span className="block text-sm text-muted">
                        {l.orderId ? (
                          <Link href={paths.order(l.orderId)} className="underline">
                            {l.orderLabel}
                          </Link>
                        ) : (
                          l.orderLabel
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {formatQty(l.qty)} {l.uom}
                  </td>
                  {p.showPrices && <td className="px-2 py-2 text-right">{formatCad(l.unitCost)}</td>}
                  {p.showPrices && <td className="px-2 py-2 text-right">{formatCad(l.extended)}</td>}
                  <td className={cx('px-2 py-2 text-right', l.received >= l.qty - 1e-6 ? 'text-ok' : '')}>{formatQty(l.received)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.totals && (
          <dl className="mt-3 ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-ink">
            <dt>Subtotal</dt>
            <dd className="text-right">{formatCad(p.totals.subtotal)}</dd>
            {p.tax.hstRate > 0 ? (
              <>
                <dt>HST</dt>
                <dd className="text-right">{formatCad(p.totals.hst)}</dd>
              </>
            ) : (
              <>
                <dt>GST</dt>
                <dd className="text-right">{formatCad(p.totals.gst)}</dd>
                <dt>PST</dt>
                <dd className="text-right">{p.tax.pstRate > 0 ? formatCad(p.totals.pst) : p.tax.pstExempt ? 'Exempt' : '—'}</dd>
              </>
            )}
            <dt className="font-bold">Total</dt>
            <dd className="text-right font-bold">{formatCad(p.totals.total)}</dd>
          </dl>
        )}
        <p className="mt-2 text-sm text-muted">
          {p.tax.label}
          {p.tax.exemptionNumber && ` · exemption # ${p.tax.exemptionNumber}`}
          {p.tax.exemptionFile && (
            <>
              {' · '}
              <a href={api.fileUrl(p.tax.exemptionFile.url)!} target="_blank" rel="noreferrer" className="text-brand-ink underline">
                exemption form
              </a>
            </>
          )}
        </p>
        <ExportButtons
          className="mt-3"
          title={`PO ${p.poNumber} lines`}
          subtitle={`${p.vendor.name} · ${p.target}`}
          companyId={p.companyId}
          columns={lineCols}
          rows={p.lines.map((l) => ({ n: l.lineNo, ref: l.orderLabel, desc: l.description, qty: l.qty, uom: l.uom, unit: l.unitCost, ext: l.extended, rec: l.received }))}
        />
      </Card>
    </div>
  );
}

/** Change the expected delivery date at any time; the 1 PM chase-up moves with it. */
function EtaCard({ po, onChanged }: { po: PoDetail; onChanged: (p: PoDetail) => void }) {
  const { api } = useAuthed();
  const [editing, setEditing] = useState(false);
  const [eta, setEta] = useState(po.expectedDate ?? '');
  const save = useAction(async () => {
    onChanged(await api.purchaseOrders.setEta(po.id, eta || null));
    setEditing(false);
  });
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        {editing ? (
          <>
            <TextField label="Expected delivery date (ETA)" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
            <Button busy={save.busy} onClick={() => void save.run()}>
              Save ETA
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <div>
              <p className="text-sm text-muted">Expected delivery (ETA)</p>
              <p className="text-lg font-semibold text-ink">{po.expectedDate ? dayLabel(po.expectedDate) : 'Not set — no chase-up'}</p>
            </div>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Change ETA
            </Button>
          </>
        )}
      </div>
      <ErrorBanner error={save.error} />
      {po.status === 'ISSUED' && po.expectedDate && <p className="mt-1 text-sm text-muted">If it isn’t received by 1 PM that day, the yard and the supplier are asked and you get a notice.</p>}
    </Card>
  );
}

/** When the vendor isn't arranging shipping: post the PO to SupplyLine's load board, and see where it is. */
function PoShippingCard({ po, onChanged }: { po: PoDetail; onChanged: () => void }) {
  const { api } = useAuthed();
  const sh = po.shipping;
  const [priority, setPriority] = useState<'EMERGENCY' | 'HIGH' | 'NORMAL' | 'ANYTIME'>('NORMAL');
  const [pickup, setPickup] = useState(new Date().toLocaleDateString('en-CA'));
  const [delivery, setDelivery] = useState(po.expectedDate ?? '');
  const post = useAction(async () => {
    await api.purchaseOrders.postLoad(po.id, { priority, pickupDate: pickup || null, deliveryDate: delivery || null });
    onChanged();
  });
  return (
    <Card title="Shipping" actions={<Badge tone={sh.state === 'DELIVERED' ? 'ok' : sh.state === 'NONE' ? 'neutral' : 'brand'}>{PO_SHIPPING_LABELS[sh.state]}</Badge>}>
      {sh.loads.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {sh.loads.map((l) => (
            <li key={l.id}>
              <Link href={paths.bol(l.id)} className="text-brand-ink underline">
                {l.label}
              </Link>{' '}
              <span className="text-sm text-muted">
                {l.status === 'DRAFT' ? 'on the load board' : l.status === 'RECEIVED' ? 'delivered' : 'shipped'} · pick up {l.pickupDate ?? '—'} · deliver {l.deliveryDate ?? '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {sh.canPost && (
        <>
          <p className="text-sm text-muted">Vendor not arranging the truck? Post it to the load board: a planned load from {po.vendor.name} to {sh.destination}. When the yard ships it the PO shows as shipped, and receiving it adds it to that inventory.</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <SelectField label="Urgency" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} options={LOAD_PRIORITIES.map((x) => ({ value: x.key, label: x.label }))} />
            <TextField label="Pick up" type="date" value={pickup} onChange={(e) => setPickup(e.target.value)} />
            <TextField label="Deliver by" type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
          </div>
          <ErrorBanner error={post.error} />
          <Button className="mt-2" busy={post.busy} onClick={() => void post.run()}>
            Post to load board
          </Button>
        </>
      )}
      {!sh.canPost && sh.state === 'NONE' && sh.destination && <p className="text-sm text-muted">{sh.destination}</p>}
    </Card>
  );
}
