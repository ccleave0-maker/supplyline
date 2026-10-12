'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { formatQty } from '../domain/inventory';
import { formatLineNo } from '../domain/numbering';
import { LINE_STATUS_LABELS } from '../domain/status';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, ButtonLink, Checkbox, EmptyState, ErrorBanner, PageHeader, PageLoading, TextField, cx } from '../ui/components';
import { useAsync, useWideScreen } from '../ui/hooks';
import { useAuthed, useLive } from '../ui/session';
import { ExportButtons } from '../ui/export';
import { statusTone } from './order';
import { ShipmentList } from './schedule';

export function SiteInventoryScreen() {
  const id = useSearchParams().get('id') ?? '';
  const { api, me } = useAuthed();
  const wide = useWideScreen(900);
  const site = useAsync(() => api.sites.get(id), [api, id]);
  const rows = useAsync(() => api.siteInventory(id), [api, id]);
  const [q, setQ] = useState('');
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  useLive((e) => {
    if (e.siteId === id) void rows.reload();
  });

  const shown = (rows.data ?? []).filter(
    (r) => (!q.trim() || r.description.toLowerCase().includes(q.trim().toLowerCase())) && (!outstandingOnly || r.leftToShip > 0),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.site(id)} title="Site inventory"
        subtitle={site.data ? `JOB#${site.data.jobNumber} · ${site.data.name}` : undefined}
        actions={
          can(me.user, 'return:create') && (
            <ButtonLink href={paths.returnNew(id)} variant="secondary">
              Return items
            </ButtonLink>
          )
        }
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Description" />
        <Checkbox label="Still to ship only" checked={outstandingOnly} onChange={setOutstandingOnly} />
      </div>
      <ErrorBanner error={rows.error} onRetry={rows.reload} />
      {shown.length > 0 && (
        <ExportButtons
          title="Site inventory"
          subtitle={site.data ? `JOB#${site.data.jobNumber} · ${site.data.name}` : null}
          companyId={site.data?.companyId}
          columns={[
            { key: 'line', label: 'List / L#', width: 1.4 },
            { key: 'desc', label: 'Description', width: 3 },
            { key: 'ordered', label: 'Ordered', align: 'right' },
            { key: 'uom', label: 'Unit', width: 0.6 },
            { key: 'shipped', label: 'Shipped', align: 'right' },
            { key: 'left', label: 'Left to ship', align: 'right' },
            { key: 'transit', label: 'In transit', align: 'right' },
            { key: 'staged', label: 'Staged', align: 'right' },
            { key: 'onsite', label: 'On site', align: 'right' },
            { key: 'returned', label: 'Returned', align: 'right' },
            { key: 'po', label: 'PO #' },
            { key: 'status', label: 'Status', width: 1.2 },
          ]}
          rows={shown.map((r) => ({
            line: `${r.orderLabel} L${r.lineNo}`,
            desc: r.description,
            ordered: r.qtyOrdered,
            uom: r.uom,
            shipped: r.qtyShipped,
            left: r.leftToShip,
            transit: r.inTransit,
            staged: r.staged,
            onsite: r.onSite,
            returned: r.qtyReturned,
            po: r.poNumbers.map((p) => p.poNumber).join(', '),
            status: LINE_STATUS_LABELS[r.status],
          }))}
        />
      )}
      {rows.loading && !rows.data ? (
        <PageLoading />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing here yet">Lines appear here as soon as an order list is submitted.</EmptyState>
      ) : wide ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-base">
            <thead className="bg-surface-2 text-sm text-muted">
              <tr>
                {['List / L#', 'Description', 'Qty ordered', 'Qty shipped', 'Left to ship', 'In transit', 'Staged', 'On site', 'Returned', 'Deliveries', 'PO #', 'Status'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.orderLineId} className={cx('border-t border-line', r.status === 'CANCELLED' && 'text-muted')}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link className="font-semibold text-brand-ink underline" href={paths.order(r.orderId)}>
                      {r.orderLabel.replace(/^JOB#\S+ /, '')} {formatLineNo(r.lineNo)}
                    </Link>
                  </td>
                  <td className="min-w-56 px-3 py-2">{r.description}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {formatQty(r.qtyOrdered)} {r.uom}
                  </td>
                  <td className="px-3 py-2 text-right">{formatQty(r.qtyShipped)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className="font-semibold">{formatQty(r.leftToShip)}</span> {r.partiallyShipped && <Badge>Partial</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right">{r.inTransit ? formatQty(r.inTransit) : ''}</td>
                  <td className="px-3 py-2 text-right">{r.staged ? formatQty(r.staged) : ''}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatQty(r.onSite)}</td>
                  <td className="px-3 py-2 text-right">{r.qtyReturned ? formatQty(r.qtyReturned) : ''}</td>
                  <td className="min-w-48 px-3 py-2">
                    <ShipmentList shipments={r.shipments} uom={r.uom} />
                  </td>
                  <td className="px-3 py-2">{r.poNumbers.map((p) => p.poNumber).join(', ')}</td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone(r.status)}>{LINE_STATUS_LABELS[r.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((r) => (
            <li key={r.orderLineId} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <Link className="font-semibold text-brand-ink underline" href={paths.order(r.orderId)}>
                  {r.orderLabel.replace(/^JOB#\S+ /, '')} {formatLineNo(r.lineNo)}
                </Link>
                <Badge tone={statusTone(r.status)}>{LINE_STATUS_LABELS[r.status]}</Badge>
              </div>
              <p className="mt-1 text-lg text-ink">{r.description}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-ink">
                <dt className="text-muted">Ordered</dt>
                <dd>
                  {formatQty(r.qtyOrdered)} {r.uom}
                </dd>
                <dt className="text-muted">Shipped</dt>
                <dd>{formatQty(r.qtyShipped)}</dd>
                <dt className="text-muted">Left to ship</dt>
                <dd className="font-semibold">
                  {formatQty(r.leftToShip)} {r.partiallyShipped && <Badge>Partial</Badge>}
                </dd>
                {r.inTransit > 0 && (
                  <>
                    <dt className="text-muted">In transit</dt>
                    <dd>{formatQty(r.inTransit)}</dd>
                  </>
                )}
                {r.staged > 0 && (
                  <>
                    <dt className="text-muted">Staged</dt>
                    <dd>{formatQty(r.staged)}</dd>
                  </>
                )}
                <dt className="text-muted">On site</dt>
                <dd className="font-semibold">{formatQty(r.onSite)}</dd>
                {r.qtyReturned > 0 && (
                  <>
                    <dt className="text-muted">Returned</dt>
                    <dd>{formatQty(r.qtyReturned)}</dd>
                  </>
                )}
                {r.shipments.length > 0 && (
                  <div className="col-span-2 mt-1">
                    <ShipmentList shipments={r.shipments} uom={r.uom} />
                  </div>
                )}
                {r.poNumbers.length > 0 && (
                  <>
                    <dt className="text-muted">PO #</dt>
                    <dd>{r.poNumbers.map((p) => p.poNumber).join(', ')}</dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
